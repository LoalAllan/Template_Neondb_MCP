/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ROLLENCONFIGURATIE — HET CENTRALE CONFIG-BESTAND VAN DEZE TEMPLATE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dit is het enige bestand dat je hoeft aan te passen om de rolniveaus en de
 * database-koppeling van deze MCP-server te configureren.
 *
 * HET ROLMODEL IS HIËRARCHISCH:
 *   - Elk rolniveau omvat alle rechten van de niveaus eronder.
 *   - Elke tool krijgt een MIN_NIVEAU; gebruikers met dat niveau of hoger
 *     krijgen de tool te zien, alle anderen niet.
 *   - Niveau 0 (of NULL in de database) betekent: géén toegang tot de MCP.
 *
 * HOEVEEL NIVEAUS? Kies er 1, 2 of 3 en pas NIVEAUS hieronder aan:
 *
 *   Eén niveau (iedereen dezelfde rechten):
 *     export const NIVEAUS: Record<number, string> = {
 *       1: "gebruiker",
 *     };
 *
 *   Twee niveaus:
 *     export const NIVEAUS: Record<number, string> = {
 *       1: "gebruiker",
 *       2: "admin",
 *     };
 *
 *   Drie niveaus (de standaard van deze template):
 *     zie hieronder.
 *
 * De namen zijn puur beschrijvend (voor foutmeldingen en de wie_ben_ik-tool);
 * de NUMMERS zijn wat er in de databasekolom staat en waarmee tools werken.
 */
export const NIVEAUS: Record<number, string> = {
	1: "gebruiker",
	2: "beheerder",
	3: "admin",
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DATABASE-KOPPELING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * In welke tabel en kolommen van de Neon-database staat wie toegang heeft?
 * Pas dit aan als jouw applicatie al een eigen gebruikerstabel heeft
 * (bv. tabel "users" met kolom "email" — zie README, stap 2, variant B).
 *
 * LET OP: alleen kleine letters, cijfers en underscores zijn toegestaan
 * (dit wordt bij het opstarten gecontroleerd in database/gebruikers.ts).
 */

/** De tabel waarin de gebruikers van de onderliggende applicatie staan. */
export const GEBRUIKERS_TABEL = "gebruikers";

/** De kolom met het e-mailadres (de sleutel waarmee Azure-logins gematcht worden). */
export const EMAIL_KOLOM = "email";

/** De kolom met het MCP-rolniveau (integer: 0/NULL = geen toegang, 1..3 = niveau). */
export const ROL_KOLOM = "mcp_rol";

// ═══════════════════════════════════════════════════════════════════════════
// Hulpfuncties — hieronder hoef je normaal NIETS aan te passen.
// ═══════════════════════════════════════════════════════════════════════════

/** Het hoogste geconfigureerde rolniveau (afgeleid uit NIVEAUS). */
export const MAX_NIVEAU = Math.max(...Object.keys(NIVEAUS).map(Number));

/**
 * Controleert of een gebruiker met rolniveau `rolNiveau` minstens het
 * vereiste niveau `minNiveau` heeft (hiërarchisch: hoger niveau = meer rechten).
 */
export function heeftNiveau(rolNiveau: number, minNiveau: number): boolean {
	return rolNiveau >= minNiveau;
}

/** Geeft de beschrijvende naam van een rolniveau, voor meldingen en logging. */
export function rolNaam(niveau: number): string {
	return NIVEAUS[niveau] ?? `onbekend niveau (${niveau})`;
}
