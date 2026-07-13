/**
 * Diagnostische voorbeeldtool: wie_ben_ik
 *
 * Deze tool bestaat om twee redenen:
 *   1. Hij verifieert de hele keten end-to-end: OAuth-login → props →
 *      rol-lookup in Neon → tool-registratie → antwoord.
 *   2. Hij is het KOPIEERBARE RECEPT voor elke nieuwe tool die je (of een
 *      AI coding agent) later toevoegt. Zie ook CLAUDE.md, "Recept: nieuwe
 *      tool toevoegen".
 *
 * ── HET RECEPT IN 4 STAPPEN ────────────────────────────────────────────────
 *   1. Maak een nieuw bestand src/tools/<naam>.ts naar dit voorbeeld.
 *   2. Kies het MIN_NIVEAU (zie src/rollen.config.ts).
 *   3. Registreer de tool(s) binnen de registreer<Naam>-functie.
 *   4. Voeg één regel toe in src/tools/register-tools.ts.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { heeftNiveau, rolNaam } from "../rollen.config";
import type { Props } from "../types";
import { createSuccessResponse } from "../utils/antwoorden";

/**
 * Het minimale rolniveau dat deze tool vereist. Gebruikers onder dit niveau
 * krijgen de tool niet eens te zien (de registratie wordt overgeslagen).
 */
const MIN_NIVEAU = 1;

export function registreerWieBenIk(server: McpServer, env: Env, props: Props, rol: number): void {
	// Rol-gating bij registratie: dit patroon staat bovenaan ELKE tool-module.
	if (!heeftNiveau(rol, MIN_NIVEAU)) return;

	server.tool(
		// Toolnaam: kort, snake_case, Nederlands.
		"wie_ben_ik",
		// Beschrijving: één duidelijke Nederlandse zin — dit is wat de
		// AI-client leest om te beslissen wanneer hij de tool gebruikt.
		"Geeft terug wie je bent volgens deze MCP-server: je naam, e-mailadres en rolniveau.",
		// Parameterschema: een "raw shape" — een kaal object met zod-types.
		// LET OP (zod v4 + MCP SDK): GEEN z.object() eromheen wikkelen!
		//   Goed:  { zoekterm: z.string().describe("...") }
		//   Fout:  z.object({ zoekterm: z.string() })
		// Deze tool heeft geen parameters, dus een leeg object.
		{},
		// De handler: geef altijd een antwoord terug via de helpers uit
		// src/utils/antwoorden.ts.
		async () =>
			createSuccessResponse(
				`Je bent ingelogd als ${props.naam} (${props.email}) met rolniveau ${rol} (${rolNaam(rol)}).`,
			),
	);

	// ── VOORBEELD MET PARAMETERS EN DATABASE (ter referentie) ──────────────
	// Zo ziet een echte businesstool eruit; verwijder dit blok gerust zodra
	// je eigen tools hebt. Vergeet de imports niet:
	//   import { z } from "zod";
	//   import { withDatabase } from "../database/verbinding";
	//   import { createErrorResponse, formatDatabaseError } from "../utils/antwoorden";
	//
	// server.tool(
	// 	"zoek_klant",
	// 	"Zoekt klanten op (een deel van) hun naam en geeft maximaal 10 resultaten terug.",
	// 	{
	// 		zoekterm: z.string().min(1).describe("(Deel van) de klantnaam om op te zoeken"),
	// 	},
	// 	async ({ zoekterm }) => {
	// 		try {
	// 			const klanten = await withDatabase(env, async (sql) => {
	// 				// Waarden ALTIJD via ${...}-parameters — nooit string-concatenatie!
	// 				return sql`SELECT id, naam, email FROM klanten
	// 				           WHERE naam ILIKE ${"%" + zoekterm + "%"} LIMIT 10`;
	// 			});
	// 			return createSuccessResponse(`${klanten.length} klant(en) gevonden.`, klanten);
	// 		} catch (fout) {
	// 			return createErrorResponse(formatDatabaseError(fout));
	// 		}
	// 	},
	// );
}
