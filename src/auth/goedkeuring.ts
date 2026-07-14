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
import { MEMORAN_LOGO_DATA_URI } from "./logo";

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
 * Toont de goedkeuringsdialoog in de Memoran-huisstijl. Bij "Toegang verlenen"
 * of "Annuleren" POST het formulier terug naar /authorize, met de oorspronkelijke
 * OAuth-aanvraag in het (base64-gecodeerde) hidden veld `state` en de gekozen
 * actie in het veld `actie`.
 */
export function renderGoedkeuringsDialoog(
	opties: { client: ClientInfo | null; serverNaam: string; state: Record<string, unknown> },
): Response {
	const clientNaam = opties.client?.clientName ? sanitizeHtml(opties.client.clientName) : "Onbekende MCP-client";
	const redirectUris = (opties.client?.redirectUris ?? []).map((uri) => sanitizeHtml(uri));
	const eersteCallback = redirectUris[0] ?? "—";
	const serverNaam = sanitizeHtml(opties.serverNaam);
	const stateGecodeerd = btoa(JSON.stringify(opties.state));

	const html = `<!DOCTYPE html>
<html lang="nl">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Toegang goedkeuren — ${serverNaam}</title>
	<style>
		* { box-sizing: border-box; }
		body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #efe9df; margin: 0;
		       display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 1.5rem;
		       color: #1c1b18; }
		.kaart { background: #fff; border: 1px solid #e6e1d6; border-radius: 20px;
		         box-shadow: 0 8px 30px rgba(60,50,30,.10); width: 100%; max-width: 29.5rem; padding: 1.75rem; }

		/* ── Header: logo + badge ─────────────────────────────────────── */
		.kop { display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: 1.1rem; }
		.merk { display: flex; align-items: center; gap: .55rem; font-weight: 700; font-size: 1.05rem; }
		.merk img { width: 30px; height: 30px; border-radius: 8px; display: block; }
		.badge-ms { display: inline-flex; align-items: center; gap: .35rem; border: 1px solid #cfe3cf;
		            background: #f4faf4; color: #2e6b3e; border-radius: 999px; padding: .3rem .7rem;
		            font-size: .72rem; font-weight: 600; white-space: nowrap; }

		h1 { font-size: 1.55rem; margin: 0 0 .5rem; letter-spacing: -.02em; }
		.intro { color: #6b675e; line-height: 1.5; font-size: .88rem; margin: 0 0 1.25rem; }

		/* ── Flow-diagram: agent → slot → connector ───────────────────── */
		.flow { display: flex; align-items: stretch; gap: .4rem; margin-bottom: 1.25rem; }
		.flow-kaart { flex: 1; border: 1px solid #e6e1d6; background: #fbfaf7; border-radius: 14px;
		              padding: .9rem .6rem; display: flex; flex-direction: column; align-items: center;
		              text-align: center; gap: .3rem; min-width: 0; }
		.flow-kaart.aanvraag { border-color: #ecd9c3; background: #fdfaf5; }
		.flow-icoon { width: 46px; height: 46px; border-radius: 50%; background: #fff; border: 1px solid #e6e1d6;
		              display: flex; align-items: center; justify-content: center; }
		.flow-icoon img { width: 46px; height: 46px; border-radius: 50%; display: block; }
		.flow-naam { font-weight: 700; font-size: .88rem; word-break: break-word; }
		.flow-sub { color: #8a8578; font-size: .74rem; }
		.flow-status { display: inline-flex; align-items: center; gap: .3rem; font-size: .72rem; font-weight: 600; }
		.flow-status.ok { color: #2e7d43; }
		.flow-status.aanvraag { color: #c4571d; }
		.stip { width: 7px; height: 7px; border-radius: 50%; background: #e06a1f; display: inline-block; }
		.verbinding { display: flex; align-items: center; gap: .15rem; color: #b3ad9f; flex: 0 0 auto; }
		.verbinding .lijn { width: 14px; border-top: 2px dashed #cfc9bb; }
		.slot { width: 30px; height: 30px; border-radius: 50%; background: #1c1b18; color: #fff;
		        display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }

		/* ── Detailtabel ──────────────────────────────────────────────── */
		.details { border: 1px solid #e6e1d6; border-radius: 14px; overflow: hidden; margin-bottom: 1rem; }
		.detail-rij { display: flex; align-items: center; gap: .65rem; padding: .7rem .9rem; font-size: .84rem; }
		.detail-rij + .detail-rij { border-top: 1px solid #eee9de; }
		.detail-rij svg { flex: 0 0 auto; color: #8a8578; }
		.detail-label { color: #6b675e; flex: 0 0 6.2rem; }
		.detail-waarde { font-weight: 500; word-break: break-all; min-width: 0; flex: 1; }
		.kopieer { flex: 0 0 auto; border: none; background: none; color: #8a8578; cursor: pointer;
		           padding: .25rem; border-radius: 6px; display: flex; }
		.kopieer:hover { background: #f2efe8; color: #1c1b18; }

		/* ── Infobanner en badges ─────────────────────────────────────── */
		.info { display: flex; align-items: flex-start; gap: .55rem; border: 1px solid #e6e1d6; border-radius: 12px;
		        padding: .7rem .9rem; color: #6b675e; font-size: .82rem; line-height: 1.45; margin-bottom: 1rem; }
		.info svg { flex: 0 0 auto; margin-top: .1rem; }
		.chips { display: flex; gap: .6rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
		.chip { display: inline-flex; align-items: center; gap: .4rem; border: 1px solid #d5e6d5;
		        background: #f7fbf7; color: #2e6b3e; border-radius: 10px; padding: .5rem .8rem;
		        font-size: .78rem; font-weight: 600; }

		/* ── Knoppen ──────────────────────────────────────────────────── */
		.knoppen { display: flex; gap: .75rem; }
		button.knop { font: inherit; cursor: pointer; border-radius: 13px; padding: .75rem 1rem; font-size: .92rem; }
		button.annuleren { flex: 1; background: #fff; border: 1px solid #d9d4c8; color: #1c1b18; }
		button.annuleren:hover { background: #f7f5f0; }
		button.verlenen { flex: 1.4; background: #1c1b18; border: 1px solid #1c1b18; color: #fff; font-weight: 600;
		                  display: inline-flex; align-items: center; justify-content: center; gap: .5rem; }
		button.verlenen:hover { background: #33312c; }
	</style>
</head>
<body>
	<main class="kaart">
		<div class="kop">
			<div class="merk"><img src="${MEMORAN_LOGO_DATA_URI}" alt="Memoran-logo">Memoran</div>
			<span class="badge-ms">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
				Microsoft beveiligde client
			</span>
		</div>

		<h1>Toegang goedkeuren</h1>
		<p class="intro">Deze agent vraagt toegang tot je MCP-server.<br>Controleer de gegevens hieronder voordat je doorgaat.</p>

		<div class="flow">
			<div class="flow-kaart">
				<div class="flow-icoon">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4a463c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V5"/><circle cx="12" cy="4" r="1"/><circle cx="9.2" cy="13" r=".6" fill="#4a463c"/><circle cx="14.8" cy="13" r=".6" fill="#4a463c"/><path d="M9.5 16.2h5"/></svg>
				</div>
				<div class="flow-naam">${clientNaam}</div>
				<div class="flow-sub">AI-agent</div>
				<span class="flow-status ok">
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>
					Geverifieerde client
				</span>
			</div>
			<div class="verbinding">
				<span class="lijn"></span>
				<span class="slot"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></span>
				<span class="lijn"></span>
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>
			</div>
			<div class="flow-kaart aanvraag">
				<img class="flow-icoon" src="${MEMORAN_LOGO_DATA_URI}" alt="">
				<div class="flow-naam">Memoran connector</div>
				<div class="flow-sub">MCP-connector</div>
				<span class="flow-status aanvraag"><span class="stip"></span>Verzoek om toegang</span>
			</div>
		</div>

		<div class="details">
			<div class="detail-rij">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>
				<span class="detail-label">Agent</span>
				<span class="detail-waarde">${clientNaam}</span>
			</div>
			<div class="detail-rij">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>
				<span class="detail-label">MCP-service</span>
				<span class="detail-waarde">${serverNaam}</span>
			</div>
			<div class="detail-rij">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>
				<span class="detail-label">Callback URL</span>
				<span class="detail-waarde">${eersteCallback}${redirectUris.slice(1).map((uri) => `<br>${uri}`).join("")}</span>
				<button type="button" class="kopieer" data-url="${eersteCallback}" title="Callback URL kopiëren" aria-label="Callback URL kopiëren">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
				</button>
			</div>
		</div>

		<div class="info">
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".5" fill="currentColor"/></svg>
			Na goedkeuring log je in met je Microsoft-account van de organisatie.
		</div>

		<div class="chips">
			<span class="chip">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>
				Audit logging actief
			</span>
			<span class="chip">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
				Beveiligde sessie
			</span>
		</div>

		<form method="post" action="/authorize">
			<input type="hidden" name="state" value="${sanitizeHtml(stateGecodeerd)}">
			<div class="knoppen">
				<button type="submit" class="knop annuleren" name="actie" value="weigeren">Annuleren</button>
				<button type="submit" class="knop verlenen" name="actie" value="goedkeuren">Toegang verlenen <span aria-hidden="true">✦</span></button>
			</div>
		</form>
	</main>
	<script>
		document.querySelector(".kopieer").addEventListener("click", (gebeurtenis) => {
			const knop = gebeurtenis.currentTarget;
			navigator.clipboard.writeText(knop.dataset.url).then(() => {
				knop.style.color = "#2e7d43";
				setTimeout(() => { knop.style.color = ""; }, 1200);
			});
		});
	</script>
</body>
</html>`;

	return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/**
 * Verwerkt de POST van de goedkeuringsdialoog:
 *   1. haalt de oorspronkelijke OAuth-aanvraag uit het hidden state-veld;
 *   2. leest de gekozen actie ("goedkeuren" of "weigeren");
 *   3. voegt de client — alleen bij goedkeuren — toe aan de goedgekeurde
 *      lijst (ondertekend cookie).
 *
 * @returns De gedecodeerde state, de actie en de headers (Set-Cookie) voor de redirect.
 */
export async function verwerkGoedkeuring(
	request: Request,
	secret: string,
): Promise<{ state: Record<string, any>; actie: "goedkeuren" | "weigeren"; headers: Record<string, string> }> {
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

	const actie = formulier.get("actie") === "weigeren" ? "weigeren" : "goedkeuren";
	if (actie === "weigeren") {
		return { state, actie, headers: {} };
	}

	const bestaande = await leesGoedgekeurdeClients(request, secret);
	const bijgewerkt = [...new Set([...bestaande, clientId])];

	return {
		state,
		actie,
		headers: { "Set-Cookie": await bouwGoedkeuringsCookie(bijgewerkt, secret) },
	};
}
