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

		// ── De drie MCP-databaseverbindingen ───────────────────────────────
		//
		// ⚠ Ontbreekt er één, dan WEIGERT de server dienst. Er is bewust geen
		// terugval op een ruimere verbinding: dat is de klassieke fail-open,
		// waarbij de beveiliging verdwijnt zonder dat er iets stukgaat.
		//
		// De volledige gebruiker (de eigenaar van de database) hoort bij de
		// migraties en de applicatie van de klant en wordt hier BEWUST niet
		// gedeclareerd — geen enkele MCP-tool mag hem gebruiken.
		//
		// Zie sql/02-mcp-neon-rollen.sql voor de GRANT's die hierbij horen.

		/** Postgres-rol `mcp_lezer`: uitsluitend SELECT, draait read-only. */
		DATABASE_URL_LEZER: string;
		/** Postgres-rol `mcp_schrijver`: uitsluitend INSERT en UPDATE — nooit DELETE, nooit DDL. */
		DATABASE_URL_SCHRIJVER: string;
		/** Postgres-rol `mcp_service`: leest de rechten, bindt de Entra-oid en werkt de schrijfteller bij. Meer niet. */
		DATABASE_URL_SERVICE: string;
	}
}

export {};
