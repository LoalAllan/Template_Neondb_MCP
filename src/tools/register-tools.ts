/**
 * Centrale tool-registry.
 *
 * Dit is de ENIGE plek waar tool-modules worden aangesloten. MyMCP.init()
 * (src/index.ts) roept deze functie één keer per MCP-sessie aan, mét de verse
 * rolcontext van de gebruiker.
 *
 * ⚠ Komt er ooit een tool bij die de database raakt, dan MOET die door de
 * gedeelde poort (database/poort.ts) — nooit rechtstreeks naar een
 * verbinding. Zo'n toevoeging is een wijziging aan de veiligheidslaag en
 * vraagt de zware controle, geen gewone review.
 *
 * De toolset zelf is bewust drie tools en groeit niet; zie database-tools.ts.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RolContext } from "../database/rechten";
import type { Props } from "../types";
import { registreerDatabaseTools } from "./database-tools";

export function registreerAlleTools(
	server: McpServer,
	env: Env,
	props: Props,
	context: RolContext,
): void {
	registreerDatabaseTools(server, env, props, context);
}
