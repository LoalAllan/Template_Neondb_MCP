// ═══════════════════════════════════════════════════════════════════════════
// Typedefinities van de Worker-omgeving (bindings + secrets).
//
// Dit bestand is handgeschreven als startpunt. Voeg je nieuwe bindings toe in
// wrangler.jsonc (bv. R2, D1, extra KV), hergenereer dan de types met:
//   pnpm run cf-typegen
// en neem de secrets hieronder opnieuw op als ze uit de output verdwijnen.
// ═══════════════════════════════════════════════════════════════════════════

declare global {
	interface Env {
		// ── Bindings uit wrangler.jsonc ────────────────────────────────────
		/** KV-opslag voor de OAuth-provider (tokens, grants, client-registraties). */
		OAUTH_KV: KVNamespace;
		/** Durable Object-namespace waarin de MCP-sessies draaien. */
		MCP_OBJECT: DurableObjectNamespace;

		// ── Secrets (lokaal via .dev.vars, productie via `wrangler secret put`) ──
		/** Application (client) ID van de Azure App Registration. */
		AZURE_CLIENT_ID: string;
		/** Client secret van de Azure App Registration. */
		AZURE_CLIENT_SECRET: string;
		/** Directory (tenant) ID van de Azure-tenant (single-tenant). */
		AZURE_TENANT_ID: string;
		/** Sleutel (64 hex-tekens) voor het ondertekenen van goedkeurings-cookies. */
		COOKIE_ENCRYPTION_KEY: string;
		/** Neon Postgres connection string. */
		DATABASE_URL: string;
	}
}

export {};
