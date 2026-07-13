/**
 * Gedeelde typedefinities voor de MCP-server.
 */

/**
 * Props: de identiteit van de ingelogde gebruiker, zoals vastgesteld tijdens
 * de OAuth-callback (auth/entra-handler.ts). De OAuth-provider versleutelt
 * deze props in het uitgegeven token en levert ze bij elke MCP-sessie weer
 * aan als `this.props` in de MyMCP-klasse (src/index.ts).
 *
 * BELANGRIJK ONTWERPBESLUIT: het rolniveau zit hier bewust NIET in.
 * De rol wordt bij elke nieuwe MCP-sessie vers opgezocht in de database
 * (zie MyMCP.init), zodat een rolwijziging in de UI van de applicatie
 * direct effect heeft zonder dat de gebruiker opnieuw hoeft in te loggen.
 */
export type Props = {
	/** E-mailadres (lowercase) — dé sleutel waarmee de gebruiker in de database gematcht wordt. */
	email: string;
	/** Weergavenaam uit het Microsoft-id_token. */
	naam: string;
	/** Onveranderlijk Azure object-ID van de gebruiker (gelogd voor traceerbaarheid). */
	oid: string;
	/** Tijdstip (ms sinds epoch) waarop het token is uitgegeven. */
	tokenIssuedAt: number;
} & Record<string, unknown>; // vereist door de Props-generic van McpAgent

/**
 * Eén rij uit de gebruikerstabel, zoals teruggegeven door
 * database/gebruikers.ts (kolomnamen genormaliseerd via SQL-aliassen).
 */
export type GebruikerRij = {
	email: string;
	/** Rolniveau: 0 of NULL = geen toegang, 1..MAX_NIVEAU = toegang met dat niveau. */
	mcp_rol: number | null;
};
