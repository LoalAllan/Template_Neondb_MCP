/**
 * Centrale tool-registry.
 *
 * Dit is de ENIGE plek waar tool-modules worden aangesloten. MyMCP.init()
 * (src/index.ts) roept deze functie één keer per MCP-sessie aan, mét het
 * verse rolniveau van de gebruiker uit de database.
 *
 * Elke tool-module beslist ZELF of hij registreert, op basis van zijn eigen
 * MIN_NIVEAU (zie src/tools/wie-ben-ik.ts als voorbeeld). Gebruikers met een
 * te laag niveau krijgen de tool daardoor nooit te zien.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Props } from "../types";
import { registreerWieBenIk } from "./wie-ben-ik";

export function registreerAlleTools(server: McpServer, env: Env, props: Props, rol: number): void {
	// ── TOOL-REGISTRATIE ────────────────────────────────────────────────
	// Voeg hier één regel toe per nieuwe tool-module:

	registreerWieBenIk(server, env, props, rol);

	// Voorbeeld voor je volgende module (zie CLAUDE.md voor het recept):
	// registreerKlantTools(server, env, props, rol);
}
