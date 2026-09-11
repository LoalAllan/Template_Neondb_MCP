/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MCP-CONFIGURATIE — HET ENIGE BESTAND DAT JE PER KLANT AANPAST
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Alles wat van klant tot klant verschilt staat hier. De rest van de code is
 * generiek en hoeft niet aangeraakt te worden.
 *
 * HET RECHTENMODEL IN ÉÉN ALINEA:
 *
 *   Welke tabellen een MCP-rol mag lezen of schrijven, staat NIET in dit
 *   bestand maar in de database (tabellen `mcp_rollen` en `mcp_rechten`,
 *   zie sql/01-mcp-tabellen.sql). Een beheerder stelt dat in via het
 *   rechtenscherm in de applicatie van de klant. Rollen zijn onbeperkt in
 *   aantal en niet hiërarchisch; "geen toegang" is de AFWEZIGHEID van een
 *   rij, waardoor een nieuwe tabel automatisch dicht is voor elke rol.
 *
 *   Welke OPERATIES überhaupt mogelijk zijn, staat in de database zelf: de
 *   drie MCP-gebruikers (mcp_lezer, mcp_schrijver, mcp_service — zie
 *   sql/02-mcp-neon-rollen.sql) hebben geen DELETE, geen TRUNCATE, geen
 *   eigenaarschap en geen CREATE. Geen enkele fout in code kan dat veranderen.
 *
 * Wat hier WEL staat: de naam van de gebruikerstabel van de klant, de
 * tabellen waarop de applicatie zelf handelt, en de limieten.
 */

/**
 * De naam van deze server zoals de MCP-client en de goedkeuringsdialoog hem
 * tonen. Bijvoorbeeld "MCP-server Acme CRM".
 */
export const SERVER_NAAM = "MCP-server <applicatie>"; // TODO: pas aan per klant

/**
 * Het enige schema waarin het rechtenmodel werkt. Elke verwijzing naar een
 * ander schema (inclusief pg_catalog en information_schema) wordt geweigerd.
 * Vrijwel altijd "public".
 */
export const SCHEMA = "public";

/**
 * De bestaande gebruikerstabel van de applicatie van de klant.
 *
 * De migratie in sql/01-mcp-tabellen.sql voegt aan deze tabel drie kolommen
 * toe met VASTE namen: `entra_oid`, `mcp_rol_id` en `is_beheerder`. De
 * kolommen hieronder bestaan al bij de klant en kunnen dus anders heten.
 *
 * LET OP: alleen kleine letters, cijfers en underscores (zie veiligeIdentifier).
 * Deze tabel komt automatisch op de denylist: geen enkele MCP-rol kan hem ooit
 * lezen of schrijven. Anders kon een schrijfrol zijn eigen rol ophogen.
 */
export const GEBRUIKERS = {
	/** De tabelnaam, bv. "gebruikers" of "users". */
	tabel: "gebruikers",
	/** De primaire sleutel. */
	idKolom: "id",
	/** Het e-mailadres waarop de Entra-oid bij de EERSTE login gebonden wordt. */
	emailKolom: "email",
	/** Een `updated_at`-kolom die bij het binden bijgewerkt wordt, of null als die er niet is. */
	updatedAtKolom: "updated_at" as string | null,
} as const;

/**
 * Tabellen waarop de applicatie zélf handelt: instellingen, sjablonen,
 * wachtrijen, webhooks, nummerreeksen, wettelijke documenten. Lezen mag,
 * schrijven NOOIT — ook niet als de rechtentabel iets anders beweert.
 *
 * Zo'n tabel is in de praktijk veel meer dan één tabel: de applicatie leest
 * die rijen en voert ze uit met haar eigen, volledige rechten, inclusief
 * verwijderen. Schrijfrecht daarop is dus een omweg naar precies wat dit
 * model uitsluit.
 *
 * Stel deze lijst op in Fase 0 van de opdracht (docs/opdracht-app-kant.md) en
 * leg hem voor aan de eigenaar. De app van de klant houdt een identieke kopie
 * (zie docs/referentie-app/mcp-beschermd.ts) zodat het rechtenscherm de stand
 * "schrijven" daar niet eens aanbiedt. DEZE lijst is de bindende.
 *
 * Bij twijfel: opnemen. Erbij zetten is later één regel; eraf halen nadat een
 * model er al bij kon, is een ander gesprek.
 */
export const NOOIT_SCHRIJVEN: readonly string[] = [
	// TODO: vul aan per klant, bv. "instellingen", "factuur_nummerreeks", "webhook_events"
];

/**
 * Limieten. De richtwaarden komen uit de opdracht; verruim ze niet zonder
 * reden. Ze begrenzen wat er per aanroep en per uur de database ín kan —
 * de andere helft van de belofte "hier kan niets verdwijnen", want een te
 * brede UPDATE wist net zo goed als een DELETE.
 */
export const LIMIETEN = {
	/** Maximale lengte van een aangeleverde query, in tekens. */
	maxQueryLengte: 10_000,
	/** Maximaal aantal rijen dat `lees_query` teruggeeft. */
	maxRijenLees: 200,
	/** Maximaal aantal rijen dat één INSERT of UPDATE mag raken; daarboven wordt hij teruggedraaid. */
	maxRijenPerStatement: 100,
	/** Maximaal aantal geschreven rijen per rol binnen het venster. */
	maxRijenPerVenster: 1000,
	/** De lengte van dat venster, als Postgres-interval. */
	venster: "1 hour",
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Hulpfunctie — hieronder hoef je niets aan te passen.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Valideert een tabel- of kolomnaam uit dit bestand vóór hij in SQL wordt
 * geïnterpoleerd.
 *
 * WAAROM DIT VEILIG IS: identifiers kunnen in SQL niet als parameter ($1)
 * worden meegegeven, dus ze worden in de querytekst geplakt. Dat mag alleen
 * omdat (a) de waarden uit dit eigen config-bestand komen — nooit uit
 * gebruikersinvoer — en (b) deze whitelist alleen kleine letters, cijfers en
 * underscores toelaat. Introduceer nergens anders identifier-interpolatie.
 */
export function veiligeIdentifier(naam: string): string {
	if (!/^[a-z_][a-z0-9_]*$/.test(naam)) {
		throw new Error(
			`Ongeldige tabel- of kolomnaam in mcp.config.ts: "${naam}". ` +
				"Alleen kleine letters, cijfers en underscores zijn toegestaan.",
		);
	}
	return naam;
}
