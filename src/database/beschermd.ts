/**
 * De twee gehardcodeerde lijsten.
 *
 * ⚠ Deze lijsten staan BEWUST in de broncode en niet in de database. Zet je ze
 * in de database, dan zijn ze te wijzigen door precies wie ze niet mag wijzigen.
 *
 * De app van de klant houdt een kopie (zie docs/referentie-app/mcp-beschermd.ts),
 * zodat de publiceer-actie van het rechtenscherm kan weigeren wat wij toch nooit
 * zouden uitvoeren. DEZE is de bindende.
 */

import { GEBRUIKERS, NOOIT_SCHRIJVEN } from "../mcp.config";

/**
 * Regel 7 — de rechten beschermen zichzelf.
 *
 * Nooit leesbaar, nooit schrijfbaar, door geen enkele rol, en niet aan te
 * zetten vanuit de UI of vanuit de database. Zonder deze lijst kan een rol met
 * schrijfrechten zichzelf tot de ruimste rol promoveren met één UPDATE.
 *
 * De lijst is breder dan alleen rollen en rechten: alles waarmee je je een
 * identiteit kunt aanmeten hoort erop — sessies, accounts, tokens,
 * API-sleutels, uitnodigingen, wachtwoordherstel. Heeft de klant zulke
 * tabellen, voeg ze dan hier toe (en NIET in mcp.config.ts: de denylist hoort
 * bij de veiligheidslaag, en elke wijziging eraan is "baan B" in de skill).
 */
export const DENYLIST: readonly string[] = [
	GEBRUIKERS.tabel,
	"mcp_rollen",
	"mcp_rechten",
	"mcp_schrijfquota",
	// TODO per klant: sessies, tokens, api-sleutels, uitnodigingen, ...
];

/**
 * Tabellen waarop de applicatie zélf handelt: lezen mag, schrijven nooit —
 * ook niet als de rechtentabel iets anders beweert. De lijst zelf staat in
 * mcp.config.ts; hier alleen de toetsing.
 */
export { NOOIT_SCHRIJVEN };

export function staatOpDenylist(tabelnaam: string): boolean {
	return DENYLIST.includes(tabelnaam);
}

export function magNooitSchrijven(tabelnaam: string): boolean {
	return NOOIT_SCHRIJVEN.includes(tabelnaam);
}
