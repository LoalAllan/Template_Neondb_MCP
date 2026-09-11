/**
 * Gedeelde typedefinities voor de MCP-server.
 */

/**
 * Props: de identiteit van de ingelogde gebruiker, zoals vastgesteld tijdens
 * de OAuth-callback (auth/entra-handler.ts). De OAuth-provider versleutelt
 * deze props in het uitgegeven token en levert ze bij elke MCP-sessie weer
 * aan als `this.props` in de MyMCP-klasse (src/index.ts).
 *
 * BELANGRIJK ONTWERPBESLUIT: de rol en de rechten zitten hier bewust NIET in.
 * Ze worden bij ÉLKE tool-aanroep vers uit de database gelezen (zie
 * database/rechten.ts), zodat een ingetrokken recht onmiddellijk geldt — ook
 * midden in een lopende sessie. Cache dit nergens.
 */
export type Props = {
	/** E-mailadres (lowercase) — het label, en de sleutel voor de EERSTE koppeling. */
	email: string;
	/** Weergavenaam uit het Microsoft-id_token. */
	naam: string;
	/**
	 * Onveranderlijk Entra object-ID — DÉ matching-sleutel.
	 *
	 * Een e-mailadres is in Entra te wijzigen en opnieuw uit te geven: wie het
	 * adres van een vertrokken beheerder toegewezen krijgt, zou diens rol erven.
	 * Daarom matcht de server op de oid, en dient e-mail alleen om de oid bij de
	 * eerste login eenmalig aan een rij te binden.
	 */
	oid: string;
	/** Tijdstip (ms sinds epoch) waarop het token is uitgegeven. */
	tokenIssuedAt: number;
} & Record<string, unknown>; // vereist door de Props-generic van McpAgent
