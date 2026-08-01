/**
 * Centrale tool-registry.
 *
 * MyMCP.init() (src/index.ts) roept deze functie één keer per MCP-sessie aan,
 * mét het verse rolnummer van de gebruiker uit de database.
 *
 * ⚠️ HIER KOMEN GEEN TOOLS BIJ.
 *
 * Deze server heeft bewust maar drie tools — lijst_tabellen, lees_query en
 * voer_sql_uit — en die dekken samen alles af. Wil je een rol méér of minder
 * laten zien, dan pas je de tabellen van die rol aan (rollen.config.ts + de
 * GRANT's in Neon), niet de toolset.
 *
 * De harde grenzen en de verplichte procedure staan in
 * .claude/rules/mcp-rechten.md. Extra tools registreren mag uitsluitend met
 * expliciete toestemming van de eigenaar van het project.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Props } from "../types";
import { registreerSqlTools } from "./sql-tools";

export function registreerAlleTools(server: McpServer, env: Env, props: Props, rol: number): void {
	registreerSqlTools(server, env, props, rol);
}
