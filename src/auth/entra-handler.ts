/**
 * De OAuth-handler: het "gezicht" van de server tijdens het inloggen.
 *
 * Deze Hono-app wordt door de OAuth-provider (src/index.ts) aangeroepen voor
 * alles wat geen /mcp-verkeer of ingebouwd OAuth-endpoint is:
 *
 *   GET  /authorize  → goedkeuringsdialoog tonen (of overslaan bij cookie),
 *                      daarna doorsturen naar Microsoft Entra ID
 *   POST /authorize  → goedkeuring verwerken, doorsturen naar Entra
 *   GET  /callback   → terugkeer van Entra: code inwisselen, identiteit
 *                      vaststellen, POORTWACHTER (rol-check in Neon) en
 *                      tot slot de OAuth-flow afronden
 *   GET  /           → informatiepagina
 *
 * De volledige flow:
 *   MCP-client → /authorize → (dialoog) → login.microsoftonline.com
 *   → /callback → completeAuthorization() → token voor de MCP-client
 */

import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { zoekGebruikerOpEmail } from "../database/gebruikers";
import type { Props } from "../types";
import { decodeerIdToken, getAuthorizeUrl, wisselCodeIn } from "./entra";
import { clientIsAlGoedgekeurd, renderGoedkeuringsDialoog, sanitizeHtml, verwerkGoedkeuring } from "./goedkeuring";

/** Naam van de server zoals getoond in de goedkeuringsdialoog. */
const SERVER_NAAM = "Memoran connector MCP";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

// ═══════════════════════════════════════════════════════════════════════════
// GET /authorize — startpunt van de OAuth-flow (aangeroepen door de MCP-client)
// ═══════════════════════════════════════════════════════════════════════════
app.get("/authorize", async (c) => {
	// Parseer de OAuth-aanvraag van de MCP-client (client_id, redirect_uri,
	// scope, PKCE-challenge, ...) — de provider valideert de basisvelden.
	// Zonder geldige parameters (bv. iemand opent /authorize in een browser)
	// gooit parseAuthRequest een fout → nette 400 in plaats van een 500.
	let oauthReqInfo: AuthRequest;
	try {
		oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	} catch (fout) {
		console.warn("Ongeldige OAuth-aanvraag op /authorize:", fout);
		return c.text("Ongeldige OAuth-aanvraag. Dit endpoint is bedoeld voor MCP-clients, niet voor de browser.", 400);
	}
	if (!oauthReqInfo.clientId) {
		return c.text("Ongeldige OAuth-aanvraag: client-id ontbreekt.", 400);
	}

	// Al eerder goedgekeurd door deze gebruiker? Dan direct door naar Entra.
	if (await clientIsAlGoedgekeurd(c.req.raw, oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
		return redirectNaarEntra(c.req.raw, oauthReqInfo, c.env);
	}

	// Anders: goedkeuringsdialoog tonen. De oorspronkelijke aanvraag reist
	// mee in het state-veld van het formulier.
	const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
	return renderGoedkeuringsDialoog({
		client,
		serverNaam: SERVER_NAAM,
		state: { oauthReqInfo },
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /authorize — de gebruiker heeft de dialoog goedgekeurd of geweigerd
// ═══════════════════════════════════════════════════════════════════════════
app.post("/authorize", async (c) => {
	try {
		const { state, actie, headers } = await verwerkGoedkeuring(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY);
		if (actie === "weigeren") {
			return weigerToegang(state.oauthReqInfo);
		}
		return redirectNaarEntra(c.req.raw, state.oauthReqInfo, c.env, headers);
	} catch (fout) {
		console.error("Fout bij het verwerken van de goedkeuring:", fout);
		return c.text("De goedkeuring kon niet worden verwerkt. Start het inloggen opnieuw.", 400);
	}
});

/**
 * De gebruiker klikte "Annuleren": stuur de browser terug naar de redirect-URI
 * van de MCP-client met de OAuth-standaardfout `access_denied`, zodat de
 * client zelf netjes kan tonen dat de toegang geweigerd is.
 */
function weigerToegang(oauthReqInfo: Record<string, any>): Response {
	const redirectUri: unknown = oauthReqInfo?.redirectUri;
	if (typeof redirectUri !== "string" || !redirectUri) {
		throw new Error("De OAuth-aanvraag bevat geen redirect-URI om de weigering aan te melden.");
	}
	const url = new URL(redirectUri);
	url.searchParams.set("error", "access_denied");
	url.searchParams.set("error_description", "De gebruiker heeft de toegang geweigerd.");
	if (typeof oauthReqInfo.state === "string" && oauthReqInfo.state) {
		url.searchParams.set("state", oauthReqInfo.state);
	}
	return Response.redirect(url.href, 302);
}

/**
 * Stuurt de browser door naar het Entra ID login-scherm.
 *
 * De oorspronkelijke MCP-client-aanvraag gaat base64-gecodeerd mee als
 * `state`, zodat we hem in /callback weer terugkrijgen. De redirect-URI
 * wordt afgeleid van de huidige request-URL: zo werkt dezelfde code zowel
 * lokaal (http://localhost:8792/callback) als in productie.
 */
function redirectNaarEntra(
	request: Request,
	oauthReqInfo: AuthRequest | Record<string, unknown>,
	env: Env,
	extraHeaders: Record<string, string> = {},
): Response {
	return new Response(null, {
		status: 302,
		headers: {
			...extraHeaders,
			location: getAuthorizeUrl(env, {
				redirectUri: new URL("/callback", request.url).href,
				state: btoa(JSON.stringify(oauthReqInfo)),
			}),
		},
	});
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /callback — terugkeer van Microsoft na het inloggen
// ═══════════════════════════════════════════════════════════════════════════
app.get("/callback", async (c) => {
	// Heeft Microsoft zelf een fout teruggestuurd (bv. login geannuleerd)?
	const entraFout = c.req.query("error");
	if (entraFout) {
		console.error("Entra gaf een fout terug op /callback:", entraFout, c.req.query("error_description"));
		return foutPagina(c.req.raw, "Het inloggen bij Microsoft is niet gelukt of werd geannuleerd.", 400);
	}

	// 1. De oorspronkelijke MCP-client-aanvraag terughalen uit `state`.
	let oauthReqInfo: Record<string, any>;
	try {
		oauthReqInfo = JSON.parse(atob(c.req.query("state") ?? ""));
	} catch {
		return foutPagina(c.req.raw, "De callback bevat geen geldige state. Start het inloggen opnieuw.", 400);
	}
	if (!oauthReqInfo.clientId) {
		return foutPagina(c.req.raw, "De callback-state is onvolledig. Start het inloggen opnieuw.", 400);
	}

	const code = c.req.query("code");
	if (!code) {
		return foutPagina(c.req.raw, "De callback bevat geen authorization code. Start het inloggen opnieuw.", 400);
	}

	// 2. Code inwisselen bij Entra en de identiteit vaststellen.
	let identiteit: ReturnType<typeof decodeerIdToken>;
	try {
		const { idToken } = await wisselCodeIn(c.env, {
			code,
			redirectUri: new URL("/callback", c.req.url).href,
		});
		identiteit = decodeerIdToken(idToken, c.env);
	} catch (fout) {
		console.error("Fout tijdens de token-uitwisseling met Entra:", fout);
		return foutPagina(c.req.raw, "Het inloggen bij Microsoft is mislukt. Probeer het opnieuw.", 502);
	}

	// 3. POORTWACHTER: bestaat deze gebruiker in de database en heeft die
	//    een actief rolniveau? Zo niet → toegang weigeren.
	const gebruiker = await zoekGebruikerOpEmail(c.env, identiteit.email);
	const rol = gebruiker?.mcp_rol ?? 0;
	if (!gebruiker || rol < 1) {
		console.warn(`Toegang geweigerd voor ${identiteit.email} (oid: ${identiteit.oid}): niet gevonden of rol ${rol}.`);
		return foutPagina(
			c.req.raw,
			`Toegang geweigerd. Het e-mailadres <strong>${sanitizeHtml(identiteit.email)}</strong> is niet bekend ` +
				"of niet geactiveerd voor deze MCP-server. Vraag een beheerder om je account te activeren " +
				"in de applicatie, en log daarna opnieuw in.",
			403,
		);
	}

	// 4. De OAuth-flow afronden: de provider geeft de MCP-client een eigen
	//    token en versleutelt onze props erin (beschikbaar als this.props).
	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		request: oauthReqInfo as any,
		userId: identiteit.email,
		scope: oauthReqInfo.scope ?? [],
		metadata: { label: identiteit.naam },
		props: {
			email: identiteit.email,
			naam: identiteit.naam,
			oid: identiteit.oid,
			tokenIssuedAt: Date.now(),
		} satisfies Props,
	});

	console.log(`Login geslaagd voor ${identiteit.email} (oid: ${identiteit.oid}), rolniveau ${rol}.`);
	return Response.redirect(redirectTo);
});

// ═══════════════════════════════════════════════════════════════════════════
// GET / — informatiepagina voor wie de URL in een browser opent
// ═══════════════════════════════════════════════════════════════════════════
app.get("/", (c) => {
	return c.html(
		`<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><title>${sanitizeHtml(SERVER_NAAM)}</title></head>
		<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem;">
		<h1>${sanitizeHtml(SERVER_NAAM)}</h1>
		<p>Dit is een remote MCP-server. Er valt hier niets te zien in de browser 🙂</p>
		<p>Verbind een MCP-client (zoals Claude) met het endpoint <code>${new URL("/mcp", c.req.url).href}</code>
		(Streamable HTTP). Je logt vervolgens in met je Microsoft-account van de organisatie.</p>
		</body></html>`,
	);
});

/** Eenvoudige Nederlandstalige foutpagina. */
function foutPagina(request: Request, boodschapHtml: string, status: 400 | 403 | 502): Response {
	const html = `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Er ging iets mis</title></head>
<body style="font-family: system-ui, sans-serif; background: #f4f4f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0;">
	<main style="background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08); max-width: 26rem; padding: 2rem;">
		<h1 style="font-size: 1.15rem; margin: 0 0 .75rem;">${status === 403 ? "Toegang geweigerd" : "Er ging iets mis"}</h1>
		<p style="color: #444; line-height: 1.5;">${boodschapHtml}</p>
	</main>
</body>
</html>`;
	return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export const EntraHandler = app;
