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
 *      │    en registratie van de tools die bij dat rolniveau horen
 *      ▼
 *   Neon Postgres (de database van de onderliggende applicatie)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { EntraHandler } from "./auth/entra-handler";
import { zoekGebruikerOpEmail } from "./database/gebruikers";
import { rolNaam } from "./rollen.config";
import { registreerAlleTools } from "./tools/register-tools";
import type { Props } from "./types";

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Neon CRM MCP-server", // TODO: pas aan naar de naam van jouw applicatie
		version: "1.0.0",
	});

	/**
	 * Wordt één keer uitgevoerd bij de start van elke MCP-sessie.
	 *
	 * ROL-TIMING (bewust ontwerp):
	 *   - Bij de OAuth-login (/callback) fungeert de rol-check als
	 *     poortwachter: onbekende gebruikers krijgen geen token.
	 *   - Hier in init() zoeken we de rol OPNIEUW op. Zo werkt een
	 *     rolwijziging in de UI van de applicatie door bij de
	 *     eerstvolgende nieuwe sessie, zonder her-login.
	 *   - Het rolniveau zit bewust NIET in de props: het token blijft
	 *     geldig, maar de rechten komen altijd vers uit de database.
	 */
	async init() {
		// De props komen uit het versleutelde OAuth-token. Zonder geldige
		// login bestaan ze niet — dan is er niets te registreren.
		const props = this.props;
		if (!props?.email) {
			throw new Error("Geen toegang: deze sessie bevat geen geldige identiteit. Log opnieuw in.");
		}

		const gebruiker = await zoekGebruikerOpEmail(this.env, props.email);
		const rol = gebruiker?.mcp_rol ?? 0;

		if (!gebruiker || rol < 1) {
			// De gebruiker is na de token-uitgifte verwijderd of gedeactiveerd.
			console.warn(`Sessie geweigerd voor ${props.email}: geen actieve rol (meer).`);
			throw new Error(
				"Geen toegang: je account is niet (meer) geactiveerd voor deze MCP-server. " +
					"Vraag een beheerder om je toegang te activeren in de applicatie.",
			);
		}

		console.log(`MCP-sessie gestart: ${props.email} (oid: ${props.oid}), rolniveau ${rol} (${rolNaam(rol)}).`);

		// Registreer alleen de tools die bij dit rolniveau horen.
		registreerAlleTools(this.server, this.env, props, rol);
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
