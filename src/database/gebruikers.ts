/**
 * Gebruikers-lookup: de koppeling tussen Azure-logins en de gebruikerstabel
 * van de onderliggende applicatie in Neon.
 *
 * De matching gebeurt op E-MAILADRES (lowercase) — een bewuste keuze zodat
 * beheerders de toegang eenvoudig kunnen beheren vanuit de UI van de
 * applicatie. Het onveranderlijke Azure object-ID (oid) wordt wel gelogd
 * voor traceerbaarheid, maar is niet de matching-sleutel.
 */

import { EMAIL_KOLOM, GEBRUIKERS_TABEL, ROL_KOLOM, heeftNiveau } from "../rollen.config";
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
 * Controleert LIVE (met een verse database-query) of een gebruiker op dit
 * moment minstens `minNiveau` heeft.
 *
 * Standaard worden tools al per sessie gefilterd op rol (zie MyMCP.init in
 * src/index.ts); deze extra check is bedoeld voor destructieve tools die
 * óók binnen een lopende sessie zeker willen zijn dat de rol niet net is
 * ingetrokken. Gebruik hem spaarzaam: elke aanroep kost een database-query.
 *
 * Voorbeeldgebruik bovenaan een tool-handler:
 *
 *   if (!(await controleerActueleRol(env, props.email, 3))) {
 *     return createErrorResponse("Je rol is gewijzigd; deze actie is niet meer toegestaan.");
 *   }
 */
export async function controleerActueleRol(env: Env, email: string, minNiveau: number): Promise<boolean> {
	const gebruiker = await zoekGebruikerOpEmail(env, email);
	return heeftNiveau(gebruiker?.mcp_rol ?? 0, minNiveau);
}
