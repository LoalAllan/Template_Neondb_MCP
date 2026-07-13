/**
 * Microsoft Entra ID (Azure AD) — de upstream identity provider.
 *
 * Deze module bevat alle Entra-specifieke logica:
 *   1. de authorize-URL bouwen waarnaar de gebruiker wordt doorgestuurd;
 *   2. de authorization code inwisselen voor tokens (server-side, met
 *      client_secret — wij zijn een "confidential client");
 *   3. het id_token decoderen en de identiteit (e-mail, naam, oid) eruit halen.
 *
 * OVER PKCE RICHTING ENTRA: de OAuth-provider van deze Worker handelt PKCE
 * richting de MCP-clients al automatisch af. Richting Entra gebruiken we
 * bewust géén PKCE: de code-uitwisseling gebeurt server-side over TLS en is
 * al beschermd met het client_secret. Dat houdt de template eenvoudig.
 */

/** De claims uit een Entra id_token die wij gebruiken. */
export type EntraClaims = {
	/** Audience — moet gelijk zijn aan ons AZURE_CLIENT_ID. */
	aud?: string;
	/** Tenant-ID — moet gelijk zijn aan ons AZURE_TENANT_ID (single-tenant!). */
	tid?: string;
	/** Onveranderlijk object-ID van de gebruiker in Azure. */
	oid?: string;
	/** Vervaltijd (seconden sinds epoch). */
	exp?: number;
	/** E-mailadres (aanwezig als de optional claim "email" is geconfigureerd). */
	email?: string;
	/** Gebruikersnaam, meestal het UPN/e-mailadres. Fallback voor `email`. */
	preferred_username?: string;
	/** Weergavenaam. */
	name?: string;
	[claim: string]: unknown;
};

/** De identiteit die we uit het id_token destilleren. */
export type EntraIdentiteit = {
	/** E-mailadres, genormaliseerd naar lowercase — dé matching-sleutel. */
	email: string;
	naam: string;
	oid: string;
};

/**
 * Bouwt de URL van het Entra authorize-endpoint waarnaar de browser van de
 * gebruiker wordt doorgestuurd om in te loggen bij Microsoft.
 *
 * @param opties.redirectUri  Ons /callback-adres (moet exact geregistreerd
 *                            staan in de Azure App Registration).
 * @param opties.state        Ondoorzichtige waarde die Entra ongewijzigd
 *                            terugstuurt naar /callback (wij stoppen er de
 *                            oorspronkelijke MCP-client-aanvraag in).
 */
export function getAuthorizeUrl(env: Env, opties: { redirectUri: string; state: string }): string {
	const params = new URLSearchParams({
		client_id: env.AZURE_CLIENT_ID,
		response_type: "code",
		redirect_uri: opties.redirectUri,
		response_mode: "query",
		// openid + profile + email volstaan: we hebben alleen de identiteit
		// nodig (e-mail, naam, oid), geen Microsoft Graph-toegang.
		scope: "openid profile email",
		state: opties.state,
	});
	return `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/authorize?${params}`;
}

/**
 * Wisselt de authorization code (uit de callback) in voor tokens bij het
 * Entra token-endpoint. Dit gebeurt server-side over TLS, met client_secret.
 *
 * @returns Het ruwe id_token (JWT) van Microsoft.
 */
export async function wisselCodeIn(env: Env, opties: { code: string; redirectUri: string }): Promise<{ idToken: string }> {
	const respons = await fetch(`https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.AZURE_CLIENT_ID,
			client_secret: env.AZURE_CLIENT_SECRET,
			grant_type: "authorization_code",
			code: opties.code,
			redirect_uri: opties.redirectUri,
			scope: "openid profile email",
		}),
	});

	if (!respons.ok) {
		// Volledige fout alleen in de serverlogs — nooit richting de gebruiker
		// (kan AADSTS-codes en configuratiedetails bevatten).
		console.error("Entra token-endpoint gaf een fout:", respons.status, await respons.text());
		throw new Error("Inloggen bij Microsoft is mislukt: de token-uitwisseling werd geweigerd.");
	}

	const data = (await respons.json()) as { id_token?: string };
	if (!data.id_token) {
		throw new Error("Microsoft gaf geen id_token terug. Controleer of de scope 'openid' is aangevraagd.");
	}
	return { idToken: data.id_token };
}

/** Decodeert een base64url-string (JWT-onderdeel) naar UTF-8-tekst. */
function decodeerBase64Url(deel: string): string {
	const b64 = deel.replace(/-/g, "+").replace(/_/g, "/");
	const opgevuld = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
	const binair = atob(opgevuld);
	// Via TextDecoder zodat namen met accenten (é, ü, ...) correct decoderen.
	return new TextDecoder().decode(Uint8Array.from(binair, (teken) => teken.charCodeAt(0)));
}

/**
 * Haalt de identiteit van de gebruiker uit het id_token.
 *
 * WAAROM GEEN JWKS-HANDTEKENINGVERIFICATIE? Het id_token komt hier NIET via
 * de browser binnen, maar rechtstreeks uit het antwoord van het Microsoft
 * token-endpoint over TLS (zie wisselCodeIn). We weten dus al zeker dat het
 * van Microsoft komt. Ter controle valideren we wél de inhoud:
 *   - tid  == onze tenant   (alleen gebruikers uit ónze organisatie)
 *   - aud  == onze client   (het token is voor óns uitgegeven)
 *   - exp  in de toekomst   (het token is niet verlopen)
 * Zou je ooit tokens uit een onvertrouwde bron accepteren (bv. rechtstreeks
 * van een client), dan MOET je wel JWKS-verificatie toevoegen (bv. met jose).
 */
export function decodeerIdToken(idToken: string, env: Env): EntraIdentiteit {
	const delen = idToken.split(".");
	if (delen.length !== 3) {
		throw new Error("Het id_token van Microsoft heeft geen geldig JWT-formaat.");
	}

	const claims = JSON.parse(decodeerBase64Url(delen[1])) as EntraClaims;

	// ── Sanity-checks ──────────────────────────────────────────────────
	if (claims.tid !== env.AZURE_TENANT_ID) {
		throw new Error("Het id_token komt niet uit de verwachte Azure-tenant.");
	}
	if (claims.aud !== env.AZURE_CLIENT_ID) {
		throw new Error("Het id_token is niet uitgegeven voor deze applicatie.");
	}
	if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) {
		throw new Error("Het id_token van Microsoft is verlopen.");
	}

	// ── E-mailadres bepalen ────────────────────────────────────────────
	// Voorkeur: de expliciete "email"-claim (optional claim in Azure).
	// Fallback: preferred_username — in een single-tenant organisatie is
	// dat vrijwel altijd het UPN, en dus een e-mailadres.
	const ruwEmail = claims.email ?? claims.preferred_username;
	if (!ruwEmail || !ruwEmail.includes("@")) {
		throw new Error(
			"Er is geen e-mailadres gevonden in het Microsoft-id_token. " +
				"Voeg in Azure de optional claim 'email' toe aan het ID-token (zie README, stap 3).",
		);
	}

	return {
		email: ruwEmail.toLowerCase().trim(),
		naam: claims.name ?? ruwEmail,
		oid: claims.oid ?? "onbekend",
	};
}
