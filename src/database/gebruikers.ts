/**
 * Gebruikers-lookup: de koppeling tussen Azure-logins en de gebruikerstabel
 * van de onderliggende applicatie in Neon.
 *
 * De matching gebeurt op E-MAILADRES (lowercase) — een bewuste keuze zodat
 * beheerders de toegang eenvoudig kunnen beheren vanuit de UI van de
 * applicatie. Het onveranderlijke Azure object-ID (oid) wordt wel gelogd
 * voor traceerbaarheid, maar is niet de matching-sleutel.
 *
 * Dit bestand is de ENIGE plek die de AUTH-verbinding (DATABASE_URL) gebruikt.
 * Geen enkele MCP-rol heeft een GRANT op de gebruikerstabel — anders kon een
 * gebruiker met schrijfrechten zijn eigen rolniveau ophogen.
 */

import { EMAIL_KOLOM, GEBRUIKERS_TABEL, ROL_KOLOM } from "../rollen.config";
import type { GebruikerRij } from "../types";
import { getDb } from "./verbinding";

/**
 * Valideert een tabel- of kolomnaam uit rollen.config.ts.
 *
 * WAAROM DIT VEILIG IS: tabel- en kolomnamen kunnen in SQL niet als
 * parameter ($1) worden meegegeven, dus ze worden in de querytekst
 * geïnterpoleerd. Dat mag hier omdat (a) de waarden uit ons eigen
 * config-bestand komen — nooit uit gebruikersinvoer — en (b) deze whitelist
 * alleen kleine letters, cijfers en underscores toelaat, zodat SQL-injectie
 * via een verkeerd geconfigureerde naam uitgesloten is.
 */
function veiligeIdentifier(naam: string): string {
	if (!/^[a-z_][a-z0-9_]*$/.test(naam)) {
		throw new Error(
			`Ongeldige tabel- of kolomnaam in rollen.config.ts: "${naam}". ` +
				"Alleen kleine letters, cijfers en underscores zijn toegestaan.",
		);
	}
	return naam;
}

/**
 * Zoekt een gebruiker op e-mailadres (case-insensitief) in de gebruikerstabel.
 *
 * @returns De gevonden rij, of null als het e-mailadres niet voorkomt.
 */
export async function zoekGebruikerOpEmail(env: Env, email: string): Promise<GebruikerRij | null> {
	const sql = getDb(env);
	const tabel = veiligeIdentifier(GEBRUIKERS_TABEL);
	const emailKolom = veiligeIdentifier(EMAIL_KOLOM);
	const rolKolom = veiligeIdentifier(ROL_KOLOM);

	// Het e-mailadres zelf gaat WEL als parameter ($1) mee — dat is
	// gebruikersinvoer en moet dus altijd geparametriseerd worden.
	const rijen = (await sql.query(
		`SELECT ${emailKolom} AS email, ${rolKolom} AS mcp_rol
		 FROM ${tabel}
		 WHERE lower(${emailKolom}) = $1
		 LIMIT 1`,
		[email.toLowerCase().trim()],
	)) as GebruikerRij[];

	return rijen[0] ?? null;
}

/**
 * Haalt LIVE (met een verse database-query) op welke rol een gebruiker op dit
 * moment heeft. Geeft 0 terug als de gebruiker niet bestaat of geen rol heeft.
 *
 * De rol wordt normaal één keer per sessie opgezocht (zie MyMCP.init in
 * src/index.ts). Deze functie is bedoeld voor de schrijf-tool, die óók binnen
 * een lopende sessie zeker wil weten dat de rol niet net gewijzigd of
 * ingetrokken is. Gebruik hem spaarzaam: elke aanroep kost een query.
 *
 * LET OP: het rolmodel is NIET hiërarchisch. Vergelijk dus op gelijkheid met
 * de rol waarmee de sessie gestart is, niet op "groter dan":
 *
 *   if ((await haalHuidigeRol(env, props.email)) !== rol) {
 *     return createErrorResponse("Je rol is gewijzigd; deze actie is niet meer toegestaan.");
 *   }
 */
export async function haalHuidigeRol(env: Env, email: string): Promise<number> {
	const gebruiker = await zoekGebruikerOpEmail(env, email);
	return gebruiker?.mcp_rol ?? 0;
}
