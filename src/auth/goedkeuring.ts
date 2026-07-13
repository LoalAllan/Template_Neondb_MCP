/**
 * Goedkeuringsdialoog en goedkeurings-cookie.
 *
 * Wanneer een MCP-client (bv. Claude) voor het eerst verbinding maakt, tonen
 * we de gebruiker een dialoog: "wil je deze client toegang geven?". Na
 * goedkeuring onthouden we dat in een ondertekend cookie, zodat de dialoog
 * bij een volgende login van dezelfde client wordt overgeslagen.
 *
 * BEVEILIGING:
 *   - Het cookie is ondertekend met HMAC-SHA256 (sleutel: COOKIE_ENCRYPTION_KEY),
 *     zodat een gebruiker de lijst met goedgekeurde clients niet kan vervalsen.
 *   - Alle client-metadata die in de dialoog terechtkomt (naam, URI's) gaat
 *     door sanitizeHtml() — die gegevens komen van de client zelf en zijn
 *     dus niet te vertrouwen (XSS-preventie).
 */

import type { ClientInfo } from "@cloudflare/workers-oauth-provider";

const COOKIE_NAAM = "mcp-goedgekeurde-clients";
const COOKIE_MAX_AGE_SECONDEN = 60 * 60 * 24 * 30; // 30 dagen

// ═══════════════════════════════════════════════════════════════════════════
// HMAC-ondertekening (WebCrypto)
// ═══════════════════════════════════════════════════════════════════════════

async function importeerHmacSleutel(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
		"verify",
	]);
}

/** Ondertekent data en geeft de handtekening als hex-string terug. */
async function ondertekenData(secret: string, data: string): Promise<string> {
	const sleutel = await importeerHmacSleutel(secret);
	const handtekening = await crypto.subtle.sign("HMAC", sleutel, new TextEncoder().encode(data));
	return [...new Uint8Array(handtekening)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Controleert of een hex-handtekening klopt voor de gegeven data. */
async function verifieerHandtekening(secret: string, handtekeningHex: string, data: string): Promise<boolean> {
	if (!/^[0-9a-f]+$/.test(handtekeningHex) || handtekeningHex.length % 2 !== 0) {
		return false;
	}
	const sleutel = await importeerHmacSleutel(secret);
	const bytes = new Uint8Array(handtekeningHex.match(/.{2}/g)!.map((hex) => Number.parseInt(hex, 16)));
	return crypto.subtle.verify("HMAC", sleutel, bytes, new TextEncoder().encode(data));
}

// ═══════════════════════════════════════════════════════════════════════════
// Cookie lezen/schrijven
// ═══════════════════════════════════════════════════════════════════════════

function leesCookieWaarde(request: Request, naam: string): string | null {
	const cookieHeader = request.headers.get("Cookie");
	if (!cookieHeader) return null;
	for (const deel of cookieHeader.split(";")) {
		const [sleutel, ...rest] = deel.trim().split("=");
		if (sleutel === naam) return rest.join("=");
	}
	return null;
}

/** Leest de lijst van goedgekeurde client-ID's uit het cookie (of [] bij ontbreken/knoeien). */
async function leesGoedgekeurdeClients(request: Request, secret: string): Promise<string[]> {
	const cookieWaarde = leesCookieWaarde(request, COOKIE_NAAM);
	if (!cookieWaarde) return [];

	// Formaat: "<handtekening-hex>.<base64(JSON-array van client-ids)>"
	const [handtekening, payload] = cookieWaarde.split(".");
	if (!handtekening || !payload) return [];

	try {
		if (!(await verifieerHandtekening(secret, handtekening, payload))) {
			console.warn("Goedkeurings-cookie met ongeldige handtekening genegeerd.");
			return [];
		}
		const lijst = JSON.parse(atob(payload));
		return Array.isArray(lijst) ? lijst.filter((id): id is string => typeof id === "string") : [];
	} catch {
		return [];
	}
}

/** Bouwt de Set-Cookie-header met een bijgewerkte, ondertekende goedkeuringslijst. */
async function bouwGoedkeuringsCookie(clientIds: string[], secret: string): Promise<string> {
	const payload = btoa(JSON.stringify(clientIds));
	const handtekening = await ondertekenData(secret, payload);
	return (
		`${COOKIE_NAAM}=${handtekening}.${payload}; ` +
		`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDEN}`
	);
}

/** Is deze MCP-client al eerder door de gebruiker goedgekeurd? */
export async function clientIsAlGoedgekeurd(request: Request, clientId: string, secret: string): Promise<boolean> {
	const goedgekeurd = await leesGoedgekeurdeClients(request, secret);
	return goedgekeurd.includes(clientId);
}

// ═══════════════════════════════════════════════════════════════════════════
// Goedkeuringsdialoog (HTML)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Escapet HTML-bijzondere tekens. Verplicht voor ALLE client-metadata die in
 * de dialoog wordt getoond: die gegevens komen van de (onvertrouwde) client.
 */
export function sanitizeHtml(onveilig: string): string {
	return onveilig
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Toont de goedkeuringsdialoog. Bij "Goedkeuren" POST het formulier terug
 * naar /authorize, met de oorspronkelijke OAuth-aanvraag in het (base64-
 * gecodeerde) hidden veld `state`.
 */
export function renderGoedkeuringsDialoog(
	opties: { client: ClientInfo | null; serverNaam: string; state: Record<string, unknown> },
): Response {
	const clientNaam = opties.client?.clientName ? sanitizeHtml(opties.client.clientName) : "Onbekende MCP-client";
	const redirectUris = (opties.client?.redirectUris ?? []).map((uri) => sanitizeHtml(uri));
	const stateGecodeerd = btoa(JSON.stringify(opties.state));

	const html = `<!DOCTYPE html>
<html lang="nl">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Toegang goedkeuren — ${sanitizeHtml(opties.serverNaam)}</title>
	<style>
		body { font-family: system-ui, sans-serif; background: #f4f4f5; margin: 0;
		       display: flex; align-items: center; justify-content: center; min-height: 100vh; }
		.kaart { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.08);
		         max-width: 26rem; padding: 2rem; }
		h1 { font-size: 1.15rem; margin: 0 0 .75rem; }
		p  { color: #444; line-height: 1.5; }
		.client { background: #f4f4f5; border-radius: 8px; padding: .75rem 1rem; margin: 1rem 0;
		          word-break: break-all; font-size: .9rem; }
		.knoppen { display: flex; gap: .75rem; margin-top: 1.5rem; }
		button { flex: 1; padding: .65rem 1rem; border-radius: 8px; border: 1px solid #d4d4d8;
		         background: #fff; font-size: 1rem; cursor: pointer; }
		button.primair { background: #1a56db; border-color: #1a56db; color: #fff; }
	</style>
</head>
<body>
	<main class="kaart">
		<h1>Toegang goedkeuren</h1>
		<p>De onderstaande MCP-client vraagt toegang tot <strong>${sanitizeHtml(opties.serverNaam)}</strong>.
		   Na goedkeuring log je in met je Microsoft-account van de organisatie.</p>
		<div class="client">
			<strong>${clientNaam}</strong>
			${redirectUris.map((uri) => `<div>${uri}</div>`).join("")}
		</div>
		<form method="post" action="/authorize">
			<input type="hidden" name="state" value="${sanitizeHtml(stateGecodeerd)}">
			<div class="knoppen">
				<button type="submit" class="primair">Goedkeuren</button>
			</div>
		</form>
	</main>
</body>
</html>`;

	return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/**
 * Verwerkt de POST van de goedkeuringsdialoog:
 *   1. haalt de oorspronkelijke OAuth-aanvraag uit het hidden state-veld;
 *   2. voegt de client toe aan de goedgekeurde lijst (ondertekend cookie).
 *
 * @returns De gedecodeerde state en de headers (Set-Cookie) voor de redirect.
 */
export async function verwerkGoedkeuring(
	request: Request,
	secret: string,
): Promise<{ state: Record<string, any>; headers: Record<string, string> }> {
	const formulier = await request.formData();
	const stateGecodeerd = formulier.get("state");
	if (typeof stateGecodeerd !== "string" || !stateGecodeerd) {
		throw new Error("Het goedkeuringsformulier bevat geen state-veld.");
	}

	let state: Record<string, any>;
	try {
		state = JSON.parse(atob(stateGecodeerd));
	} catch {
		throw new Error("Het state-veld van het goedkeuringsformulier is ongeldig.");
	}

	const clientId: unknown = state?.oauthReqInfo?.clientId;
	if (typeof clientId !== "string" || !clientId) {
		throw new Error("De OAuth-aanvraag in het goedkeuringsformulier is onvolledig.");
	}

	const bestaande = await leesGoedgekeurdeClients(request, secret);
	const bijgewerkt = [...new Set([...bestaande, clientId])];

	return {
		state,
		headers: { "Set-Cookie": await bouwGoedkeuringsCookie(bijgewerkt, secret) },
	};
}
