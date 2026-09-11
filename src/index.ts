/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ENTRYPOINT van de MCP-server.
 *
 * Architectuur in één oogopslag:
 *
 *   MCP-client (bv. Claude)
 *      │  POST /mcp  (Streamable HTTP — het enige transport van deze server)
 *      ▼
 *   OAuthProvider (de export onderaan dit bestand)
 *      │  · valideert het Bearer-token van de client
 *      │  · ontsleutelt de props (e-mail, naam, oid) uit het token
 *      │  · alles wat géén /mcp of OAuth-endpoint is → EntraHandler
 *      ▼
 *   MyMCP (Durable Object, één instantie per MCP-sessie)
 *      │  · init() draait één keer per sessie: verse rol-lookup in Neon
 *      │    en registratie van de tools die bij die rol horen
 *      ▼
 *   Neon Postgres (de database van de onderliggende applicatie)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { EntraHandler } from "./auth/entra-handler";
import { leesRolContext } from "./database/rechten";
import { controleerConfiguratie } from "./database/verbinding";
import { SERVER_NAAM } from "./mcp.config";
import { registreerAlleTools } from "./tools/register-tools";
import type { Props } from "./types";

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: SERVER_NAAM,
		version: "1.0.0",
	});

	/**
	 * Wordt één keer uitgevoerd bij de start van elke MCP-sessie.
	 *
	 * ROL-TIMING (bewust ontwerp):
	 *   - Bij de OAuth-login (/callback) fungeert de rol-check als
	 *     poortwachter: onbekende gebruikers krijgen geen token.
	 *   - Hier lezen we de rechten opnieuw, om de TOOLBESCHRIJVINGEN te
	 *     kunnen vullen met de tabellen die deze rol mag benaderen.
	 *   - Die context is NOOIT de beveiliging. Elke tool-aanroep leest de
	 *     rechten daarna opnieuw vers (database/rechten.ts), zodat een
	 *     ingetrokken recht ook midden in een lopende sessie meteen geldt.
	 */
	async init() {
		// De props komen uit het versleutelde OAuth-token. Zonder geldige
		// login bestaan ze niet — dan is er niets te registreren.
		const props = this.props;
		if (!props?.email) {
			throw new Error("Geen toegang: deze sessie bevat geen geldige identiteit. Log opnieuw in.");
		}

		// Een Worker kent geen startmoment, dus de configuratiecontrole draait
		// hier én bij elke verbinding. Ontbreekt er een secret, dan weigert de
		// server dienst — hij valt nooit terug op een ruimere verbinding.
		controleerConfiguratie(this.env);

		const context = await leesRolContext(this.env, props.oid, props.email);
		if (!context) {
			// De gebruiker is na de token-uitgifte verwijderd, of zijn rol is
			// ingetrokken.
			console.warn(`Sessie geweigerd voor ${props.email}: geen actieve rol (meer).`);
			throw new Error(
				"Geen toegang: je account is niet (meer) geactiveerd voor deze MCP-server. " +
					"Vraag een beheerder om je een rol te geven in de applicatie.",
			);
		}

		console.log(
			`MCP-sessie gestart: ${props.email} (oid: ${props.oid}), rol "${context.rolNaam}" ` +
				`met ${context.rechten.size} tabelrecht(en).`,
		);

		registreerAlleTools(this.server, this.env, props, context);
	}
}

/**
 * De OAuth-provider is de voordeur van de hele Worker.
 *
 *   - apiRoute "/mcp": het enige MCP-endpoint — Streamable HTTP.
 *     Er is BEWUST geen SSE-endpoint (verouderd transport); voeg er ook
 *     geen toe.
 *   - defaultHandler: de EntraHandler (login-flow via Microsoft).
 *   - authorize/token/register: standaard OAuth 2.1-endpoints; de provider
 *     serveert daarnaast automatisch /.well-known/oauth-authorization-server
 *     zodat MCP-clients alles zelf kunnen ontdekken.
 *
 * De `as any`-casts zijn nodig door een bekende type-mismatch tussen de
 * `agents`- en `workers-oauth-provider`-packages; functioneel is dit het
 * officiële Cloudflare-patroon.
 */
export default new OAuthProvider({
	apiRoute: "/mcp",
	apiHandler: MyMCP.serve("/mcp") as any,
	defaultHandler: EntraHandler as any,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
});
