/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DE DRIE TOOLS VAN DEZE MCP-SERVER — ER KOMEN ER GEEN BIJ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   lijst_tabellen  welke tabellen en kolommen bestaan er voor mijn rol?
 *   lees_query      een SELECT uitvoeren
 *   voer_sql_uit    rijen toevoegen, en bij rechten "wijzigen" ook bijwerken
 *
 * Elke rol krijgt exact deze tools, met exact deze namen. Een rol zonder
 * schrijfrechten ziet er 2. Het verschil tussen rollen zit UITSLUITEND in
 * welke tabellen zichtbaar zijn — niet in welke tools bestaan.
 *
 * WAAROM GEEN APARTE TOOLS PER DATASOORT? Zodra een rol meerdere query-tools
 * naast elkaar heeft, kan de AI-client niet meer verklaren waarom een tabel
 * in de ene tool wél en in de andere niet bestaat. Wil je een rol beperken,
 * dan haal je tabellen uit zijn allowlist — je schrijft geen nieuwe tool.
 * Zie .claude/rules/mcp-rechten.md.
 *
 * WAT ER NOOIT KAN, VOOR GEEN ENKELE ROL:
 *   DELETE · TRUNCATE · DROP · CREATE · ALTER · GRANT · REVOKE · MERGE
 *   Er kan via deze server geen data verdwijnen en niets aan de structuur
 *   veranderen. Lezen is daarentegen onbeperkt binnen de tabellen van de rol.
 *
 * WAAR ZIT DE BEVEILIGING?
 *   1. In Postgres: elke rol draait op een eigen databaserol met GRANT's op
 *      precies de toegestane tabellen — zonder DELETE-recht, zonder
 *      eigenaarschap en zonder CREATE op het schema. Alles daarbuiten weigert
 *      Postgres zelf. Dat is de echte grens.
 *   2. `lees_query` draait bovendien in een READ ONLY-transactie, zodat ook
 *      een rol mét schrijfrechten er niets mee kan wijzigen.
 *   3. De allowlist in database/veiligheid.ts is het vangnet erboven: die
 *      weigert alles wat geen SELECT/INSERT/UPDATE is, mét uitleg in plaats
 *      van een ruwe Postgres-fout.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { haalHuidigeRol } from "../database/gebruikers";
import { valideerLeesQuery, valideerSchrijfStatement } from "../database/veiligheid";
import { withRolDatabase } from "../database/verbinding";
import { MAX_RIJEN, magSchrijven, rechtenOmschrijving, rolConfig, rolNaam } from "../rollen.config";
import type { Props } from "../types";
import { createErrorResponse, createSuccessResponse, formatDatabaseError } from "../utils/antwoorden";

/** Eén rij zoals de driver hem teruggeeft (kolomnaam → waarde). */
type Rij = Record<string, unknown>;

/** Eén rij uit de tabellen-inventaris (vóór het groeperen per tabel). */
type InventarisRij = {
	schema: string;
	tabel: string;
	soort: string;
	mag_toevoegen: boolean;
	mag_wijzigen: boolean;
	kolom: string;
	type: string;
};

/**
 * Inventaris van alles wat de HUIDIGE databaserol mag zien.
 *
 * `information_schema` toont per definitie alleen objecten waarop de
 * ingelogde rol rechten heeft; `has_table_privilege` maakt dat expliciet.
 * Deze query heeft dus geen enkele kennis nodig van rollen.config.ts — hij
 * leest de werkelijke GRANT's uit. Wijkt het resultaat af van de lijst in
 * rollen.config.ts, dan klopt de configuratie niet.
 *
 * INSERT en UPDATE worden bewust APART gerapporteerd, en DELETE wordt niet
 * eens opgevraagd: dat recht hoort nergens te bestaan. Zou het er toch staan,
 * dan moet dat opvallen bij een controle op de GRANT's — niet weggemoffeld
 * worden in één verzamelbooleaan.
 */
const INVENTARIS_QUERY = `
	SELECT t.table_schema AS schema,
	       t.table_name   AS tabel,
	       t.table_type   AS soort,
	       has_table_privilege(
	           quote_ident(t.table_schema) || '.' || quote_ident(t.table_name), 'INSERT'
	       )              AS mag_toevoegen,
	       has_table_privilege(
	           quote_ident(t.table_schema) || '.' || quote_ident(t.table_name), 'UPDATE'
	       )              AS mag_wijzigen,
	       c.column_name  AS kolom,
	       c.data_type    AS type
	FROM information_schema.tables t
	JOIN information_schema.columns c
	  ON c.table_schema = t.table_schema
	 AND c.table_name   = t.table_name
	WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
	  AND t.table_type IN ('BASE TABLE', 'VIEW')
	ORDER BY t.table_schema, t.table_name, c.ordinal_position
`;

/**
 * Registreert de tools die bij `rol` horen.
 *
 * Er is bewust GEEN niveau-check meer: het rolmodel is niet hiërarchisch en
 * de rol is al gevalideerd in MyMCP.init (src/index.ts). De afscherming zit
 * in de connection string die bij deze rol hoort.
 */
export function registreerSqlTools(server: McpServer, env: Env, props: Props, rol: number): void {
	const config = rolConfig(rol);
	const tabelZin =
		config.tabellen.length > 0
			? `Beschikbare tabellen voor jouw rol (${rolNaam(rol)}): ${config.tabellen.join(", ")}. ` +
				"Andere tabellen bestaan niet voor deze verbinding en leveren een foutmelding op."
			: `Gebruik lijst_tabellen om te zien wat je rol (${rolNaam(rol)}) mag benaderen.`;

	/** Staat in élke tool-beschrijving, zodat de client het niet blijft proberen. */
	const grenzenZin =
		"Verwijderen (DELETE, TRUNCATE) en structuurwijzigingen (CREATE, DROP, ALTER) zijn met deze server " +
		"onmogelijk — ook tijdelijke tabellen. Gebruik voor tussenresultaten een CTE (WITH ...) of een subquery.";

	// ── 1. lijst_tabellen ────────────────────────────────────────────────
	server.registerTool(
		"lijst_tabellen",
		{
			title: "Tabellen tonen",
			description:
				"Toont alle tabellen en kolommen die jouw rol mag benaderen, met per tabel of je er rijen aan mag " +
				"toevoegen en of je bestaande rijen mag wijzigen. Roep dit aan vóór je een query schrijft: wat hier " +
				"niet in staat, bestaat niet voor jouw verbinding.",
			annotations: { readOnlyHint: true },
		},
		async () => {
			try {
				const rijen = await withRolDatabase(env, rol, async (sql) => {
					return (await sql.query(INVENTARIS_QUERY)) as InventarisRij[];
				});

				const tabellen = groepeerPerTabel(rijen);
				if (tabellen.length === 0) {
					return createErrorResponse(
						`Je rol (${rolNaam(rol)}) heeft op dit moment op geen enkele tabel rechten. ` +
							"Waarschijnlijk zijn de GRANT's in Neon nog niet gezet. Neem contact op met een beheerder.",
					);
				}

				return createSuccessResponse(
					`${tabellen.length} tabel(len) beschikbaar voor rol "${rolNaam(rol)}". ` +
						`${rechtenOmschrijving(config.rechten)} ${grenzenZin}`,
					tabellen,
				);
			} catch (fout) {
				return createErrorResponse(formatDatabaseError(fout));
			}
		},
	);

	// ── 2. lees_query ────────────────────────────────────────────────────
	server.registerTool(
		"lees_query",
		{
			title: "Query uitvoeren (lezen)",
			description:
				"Voert een read-only SQL-query uit en geeft de rijen terug. Je hebt hierin volledige vrijheid: joins, " +
				"CTE's (WITH), subqueries, window-functies, aggregaties en berekende kolommen mogen allemaal. " +
				`Er worden maximaal ${MAX_RIJEN} rijen teruggegeven — bouw zelf een LIMIT en filters in. ` +
				tabelZin,
			inputSchema: {
				sql: z.string().min(1).describe("De uit te voeren SELECT-query (alleen lezen, één statement)"),
			},
			annotations: { readOnlyHint: true },
		},
		async ({ sql: queryTekst }) => {
			const validatie = valideerLeesQuery(queryTekst);
			if (!validatie.geldig) {
				return createErrorResponse(validatie.fout ?? "Ongeldige query.");
			}

			try {
				const rijen = await withRolDatabase(env, rol, async (sql) => {
					// READ ONLY-transactie: ook een rol mét schrijfrechten kan via
					// deze tool niets wijzigen. Postgres dwingt dat af, niet wij.
					const [resultaat] = await sql.transaction([sql.query(queryTekst)], {
						readOnly: true,
						fullResults: true,
					});
					return resultaat.rows as Rij[];
				});

				const afgekapt = rijen.length > MAX_RIJEN;
				const getoond = afgekapt ? rijen.slice(0, MAX_RIJEN) : rijen;
				const melding = afgekapt
					? `${rijen.length} rij(en) gevonden; de eerste ${MAX_RIJEN} worden getoond. Verfijn je query met een LIMIT of extra filters.`
					: `${rijen.length} rij(en) gevonden.`;

				return createSuccessResponse(melding, getoond);
			} catch (fout) {
				return createErrorResponse(formatDatabaseError(fout));
			}
		},
	);

	// ── 3. voer_sql_uit — alleen voor rollen die mogen schrijven ─────────
	if (!magSchrijven(config.rechten)) {
		return;
	}

	const magWijzigen = config.rechten === "wijzigen";

	server.registerTool(
		"voer_sql_uit",
		{
			title: "SQL-statement uitvoeren",
			description:
				(magWijzigen
					? "Voert een INSERT- of UPDATE-statement uit: nieuwe rijen toevoegen of bestaande rijen bijwerken. "
					: "Voert een INSERT-statement uit: nieuwe rijen toevoegen. Bestaande rijen kun je niet wijzigen. ") +
				"Voeg RETURNING toe als je wil zien wat er precies weggeschreven is. " +
				grenzenZin +
				" " +
				tabelZin,
			inputSchema: {
				sql: z
					.string()
					.min(1)
					.describe(
						magWijzigen
							? "Het uit te voeren INSERT- of UPDATE-statement (één statement)"
							: "Het uit te voeren INSERT-statement (één statement)",
					),
			},
			annotations: { destructiveHint: true },
		},
		async ({ sql: queryTekst }) => {
			// Live her-check: de rol kan tijdens deze sessie gewijzigd of
			// ingetrokken zijn. Het model is NIET hiërarchisch, dus vergelijken
			// we op gelijkheid — niet op "minstens".
			const huidigeRol = await haalHuidigeRol(env, props.email);
			if (huidigeRol !== rol) {
				console.warn(`Schrijfpoging geweigerd voor ${props.email}: rol was ${rol}, is nu ${huidigeRol}.`);
				return createErrorResponse(
					"Je rol is gewijzigd; deze actie is niet meer toegestaan. Verbreek de verbinding en log opnieuw in.",
				);
			}

			const validatie = valideerSchrijfStatement(queryTekst, config.rechten);
			if (!validatie.geldig) {
				return createErrorResponse(validatie.fout ?? "Ongeldig statement.");
			}

			try {
				const resultaat = await withRolDatabase(env, rol, async (sql) => {
					return sql.query<false, true>(queryTekst, [], { fullResults: true });
				});

				console.log(
					`Schrijfoperatie door ${props.email} (rol ${rol}/${rolNaam(rol)}): ${queryTekst.slice(0, 200)}`,
				);

				const rijen = resultaat.rows as Rij[];
				const melding = `${resultaat.command ?? "Statement"} uitgevoerd; ${resultaat.rowCount ?? 0} rij(en) geraakt.`;
				return createSuccessResponse(melding, rijen.length > 0 ? rijen.slice(0, MAX_RIJEN) : undefined);
			} catch (fout) {
				return createErrorResponse(formatDatabaseError(fout));
			}
		},
	);
}

/**
 * Groepeert de platte inventaris-rijen tot één item per tabel.
 *
 * De query levert één rij per kolom; voor de client is één object per tabel
 * met een kolomlijst veel bruikbaarder (en een stuk korter).
 */
function groepeerPerTabel(rijen: InventarisRij[]) {
	const perTabel = new Map<
		string,
		{
			schema: string;
			tabel: string;
			soort: string;
			mag_toevoegen: boolean;
			mag_wijzigen: boolean;
			kolommen: Array<{ naam: string; type: string }>;
		}
	>();

	for (const rij of rijen) {
		const sleutel = `${rij.schema}.${rij.tabel}`;
		let item = perTabel.get(sleutel);
		if (!item) {
			item = {
				schema: rij.schema,
				tabel: rij.tabel,
				soort: rij.soort === "VIEW" ? "view" : "tabel",
				mag_toevoegen: rij.mag_toevoegen,
				mag_wijzigen: rij.mag_wijzigen,
				kolommen: [],
			};
			perTabel.set(sleutel, item);
		}
		item.kolommen.push({ naam: rij.kolom, type: rij.type });
	}

	return [...perTabel.values()];
}
