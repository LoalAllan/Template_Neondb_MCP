/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ROLLENCONFIGURATIE — HET CENTRALE CONFIG-BESTAND VAN DEZE TEMPLATE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dit is het enige bestand dat je aanpast om de rollen en de database-
 * koppeling van deze MCP-server te configureren.
 *
 * HET ROLMODEL IS NIET HIËRARCHISCH — LEES DIT EERST:
 *
 *   Elke rol is een APARTE, AFGESLOTEN SCOPE. Rol 1 ziet niet wat rol 2 ziet,
 *   en een hogere rol is niet "meer" dan een lagere. Er bestaat geen
 *   optelling van rechten.
 *
 *   Elke rol krijgt exact DEZELFDE drie tools te zien:
 *     · lijst_tabellen  — welke tabellen bestaan er voor mij?
 *     · lees_query      — SELECT uitvoeren
 *     · voer_sql_uit    — schrijven (alleen als `rechten` niet "lezen" is)
 *
 *   Een leesrol ziet er dus 2, een schrijfrol 3. Nooit meer. Het verschil
 *   tussen rollen zit UITSLUITEND in welke tabellen die rol mag zien.
 *
 *   WAAROM ZO? Als rollen zouden cumuleren, zou een gebruiker meerdere
 *   query-tools naast elkaar krijgen en zou de AI-client niet meer begrijpen
 *   waarom een tabel in de ene tool wél en in de andere niet bestaat.
 *
 * WAAR ZIT DE ECHTE AFSCHERMING?
 *
 *   NIET in deze code. Elke rol heeft in Neon een EIGEN POSTGRES-ROL met
 *   GRANT's op precies de toegestane tabellen, en dus een eigen connection
 *   string (een apart Worker-secret). Vraagt een tool een tabel op waar de
 *   rol geen GRANT op heeft, dan weigert Postgres dat zelf. De code hoeft
 *   geen SQL te parseren — en kan er dus ook niet naast zitten.
 *
 *   Zie README, hoofdstuk "Stap 2 — Database voorbereiden".
 *
 * HARDE GRENZEN (zie .claude/rules/mcp-rechten.md):
 *   · maximaal 4 rollen;
 *   · maximaal 3 tools per rol — er komen geen tools bij.
 */

/**
 * Wat een rol met data mag doen.
 *
 * VERWIJDEREN EN STRUCTUURWIJZIGINGEN STAAN HIER BEWUST NIET TUSSEN:
 * DELETE, TRUNCATE, DROP, CREATE, ALTER, GRANT en REVOKE zijn via deze
 * MCP-server voor géén enkele rol mogelijk. Dat is een harde grens, geen
 * instelling — zie .claude/rules/mcp-rechten.md.
 */
export type Rechten =
	/** Alleen SELECT. Onbeperkt lezen en analyseren binnen de eigen tabellen. */
	| "lezen"
	/** SELECT + INSERT. Mag nieuwe rijen toevoegen, bestaande niet aanraken. */
	| "toevoegen"
	/** SELECT + INSERT + UPDATE. Mag ook bestaande rijen bijwerken. */
	| "wijzigen";

/** De configuratie van één MCP-rol. */
export type RolConfig = {
	/** Beschrijvende naam, voor meldingen en logging. */
	naam: string;
	/**
	 * Naam van het Worker-secret met de connection string van de Postgres-rol
	 * die bij dit niveau hoort (bv. "DATABASE_URL_ROL_1").
	 */
	secretNaam: string;
	/**
	 * Wat deze rol met data mag doen. Bij "lezen" wordt `voer_sql_uit` niet
	 * geregistreerd en ziet de gebruiker maar 2 tools.
	 *
	 * LET OP: dit stuurt wat de tools tónen en toelaten. De echte grens zijn
	 * de GRANT's van de bijbehorende Postgres-rol in Neon — die moeten hier
	 * mee overeenkomen, en mogen NOOIT DELETE of TRUNCATE bevatten.
	 */
	rechten: Rechten;
	/**
	 * De tabellen die deze rol mag benaderen.
	 *
	 * BESCHRIJVEND — de GRANT's in Neon zijn de waarheid. Deze lijst wordt
	 * alleen gebruikt in de tool-beschrijvingen, zodat de AI-client meteen
	 * weet waar hij mag zoeken en geen mislukte pogingen doet. Wijkt hij af
	 * van de GRANT's, dan is de configuratie fout: controleer het met de
	 * tool `lijst_tabellen`, die de werkelijke rechten uitleest.
	 */
	tabellen: string[];
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DE ROLLEN VAN DEZE KLANT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * De sleutel (1, 2, 3, 4) is het getal dat in de rolkolom van de
 * gebruikerstabel staat. Een gebruiker met een waarde die hier niet als
 * sleutel voorkomt (0, NULL, of een onbekend getal) krijgt géén toegang.
 *
 * Hieronder staat een INGEVULD VOORBEELD. Vervang het door de echte rollen
 * en tabellen van de klant, en leg elke wijziging vast in
 * .claude/rules/<Klant>_MCP_rules.md — dat is verplicht.
 */
export const ROLLEN: Record<number, RolConfig> = {
	1: {
		naam: "projectmedewerker",
		secretNaam: "DATABASE_URL_ROL_1",
		rechten: "lezen",
		tabellen: ["projecten", "taken"],
	},
	2: {
		naam: "accountmanager",
		secretNaam: "DATABASE_URL_ROL_2",
		rechten: "toevoegen",
		tabellen: ["projecten", "taken", "klanten", "contactpersonen"],
	},
	3: {
		naam: "beheerder",
		secretNaam: "DATABASE_URL_ROL_3",
		rechten: "wijzigen",
		tabellen: ["projecten", "taken", "klanten", "contactpersonen", "facturen"],
	},
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DATABASE-KOPPELING VOOR DE LOGIN (los van de rollen hierboven)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * In welke tabel en kolommen staat wie welke rol heeft? Deze lookup gebruikt
 * het secret DATABASE_URL — een APARTE verbinding die als enige de
 * gebruikerstabel mag lezen. Geen enkele MCP-rol krijgt daar een GRANT op,
 * anders zou een schrijfrol zijn eigen rolniveau kunnen ophogen.
 *
 * LET OP: alleen kleine letters, cijfers en underscores zijn toegestaan
 * (dit wordt gecontroleerd in database/gebruikers.ts).
 */

/** De tabel waarin de gebruikers van de onderliggende applicatie staan. */
export const GEBRUIKERS_TABEL = "gebruikers";

/** De kolom met het e-mailadres (de sleutel waarmee Azure-logins gematcht worden). */
export const EMAIL_KOLOM = "email";

/** De kolom met het MCP-rolnummer (0/NULL = geen toegang, verder een sleutel uit ROLLEN). */
export const ROL_KOLOM = "mcp_rol";

// ═══════════════════════════════════════════════════════════════════════════
// Grenzen en hulpfuncties — hieronder hoef je NIETS aan te passen.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Harde bovengrens op het aantal rollen. Meer rollen maken het rechtenmodel
 * onoverzichtelijk en zijn niet toegestaan zonder expliciete toestemming van
 * de eigenaar — zie .claude/rules/mcp-rechten.md.
 */
export const MAX_ROLLEN = 4;

/**
 * Maximaal aantal rijen dat `lees_query` teruggeeft. Begrenst de output zodat
 * één query de context van de AI-client niet opblaast.
 */
export const MAX_RIJEN = 500;

/** Controleert of een rolnummer uit de database een geconfigureerde rol is. */
export function isGeldigeRol(niveau: number | null | undefined): boolean {
	return typeof niveau === "number" && ROLLEN[niveau] !== undefined;
}

/** Geeft de configuratie van een rol; gooit als het nummer niet bestaat. */
export function rolConfig(niveau: number): RolConfig {
	const config = ROLLEN[niveau];
	if (!config) {
		throw new Error(`Rol ${niveau} is niet geconfigureerd in rollen.config.ts.`);
	}
	return config;
}

/** Geeft de beschrijvende naam van een rol, voor meldingen en logging. */
export function rolNaam(niveau: number): string {
	return ROLLEN[niveau]?.naam ?? `onbekende rol (${niveau})`;
}

/** Mag deze rol iets naar de database schrijven? Zo niet: geen `voer_sql_uit`. */
export function magSchrijven(rechten: Rechten): boolean {
	return rechten !== "lezen";
}

/** Eén zin die beschrijft wat een rol mag — gebruikt in de tool-beschrijvingen. */
export function rechtenOmschrijving(rechten: Rechten): string {
	switch (rechten) {
		case "lezen":
			return "Jouw rol mag gegevens uitsluitend uitlezen en analyseren.";
		case "toevoegen":
			return "Jouw rol mag gegevens uitlezen en nieuwe rijen toevoegen, maar bestaande rijen niet wijzigen.";
		case "wijzigen":
			return "Jouw rol mag gegevens uitlezen, nieuwe rijen toevoegen en bestaande rijen bijwerken.";
	}
}
