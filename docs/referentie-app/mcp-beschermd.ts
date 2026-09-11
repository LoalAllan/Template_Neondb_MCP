/**
 * De beschermde lijsten van het MCP-rechtenmodel — DE APP-KANT-KOPIE.
 *
 * ⚠ DIT IS EEN KOPIE. De bindende versie staat in de broncode van de
 * MCP-server: `mcp-server/src/database/beschermd.ts` (denylist) en
 * `NOOIT_SCHRIJVEN` in `mcp-server/src/mcp.config.ts`. Die server weigert
 * onafhankelijk van deze app, ook als het beheerscherm volledig
 * gecompromitteerd zou raken.
 *
 * Waarom hier dan toch een kopie? Omdat de publiceer-actie server-side moet
 * weigeren wat de MCP-server toch nooit zou uitvoeren: zonder die controle is
 * de rechtentabel een vrij beschrijfbaar tekstveld en liegt het scherm over
 * wat er openstaat.
 *
 * Houd beide identiek. De skill `mcp-rechten` wijst je bij elke
 * schemawijziging op nieuwe tabellen die hier thuishoren.
 */

/**
 * De denylist — de rechten beschermen zichzelf.
 *
 * Nooit leesbaar, nooit schrijfbaar, door geen enkele rol, en niet aan te
 * zetten vanuit de UI of vanuit de database. Alles waarmee je je een identiteit
 * kunt aanmeten hoort erop: de gebruikerstabel, sessies, tokens, API-sleutels,
 * uitnodigingen, wachtwoordherstel.
 */
export const MCP_DENYLIST: readonly string[] = [
  "<gebruikerstabel>",
  "mcp_rollen",
  "mcp_rechten",
  "mcp_schrijfquota",
  // + elke identiteitsdrager in dit schema — identiek aan de server
] as const;

/**
 * Tabellen waarop de applicatie zélf handelt. Lezen mag, schrijven nooit.
 * De app leest die rijen en voert ze uit met haar eigen, volledige rechten;
 * schrijfrecht erop is een omweg naar precies wat dit model uitsluit.
 *
 * Noteer per tabel waaróm, zodat een volgende ontwikkelaar hem niet "even"
 * weghaalt. Voorbeeld:
 *  - instellingen           → stuurt het gedrag van de app
 *  - factuur_nummerreeks    → de doorlopende reeks mag nooit springen
 *  - webhook_events         → dedup-administratie; schrijven laat echte webhooks vallen
 */
export const MCP_NOOIT_SCHRIJVEN: readonly string[] = [
  // identiek aan NOOIT_SCHRIJVEN in mcp-server/src/mcp.config.ts
] as const;

/**
 * Technische tabellen: machinerie, geen bedrijfsdata.
 *
 * Standaard verborgen in het rechtenscherm achter één knop ("Machinerie"),
 * nooit onderdeel van een cluster (en dus nooit meegenomen door een
 * clusterklik), maar wél toekenbaar zodra ze zichtbaar zijn. Verwar dit niet
 * met de denylist: die is *nooit*, deze is *uit het zicht*. Dit is een gewone
 * lijst, geen beveiligingslijst — bijwerken is baan A in de skill.
 */
export const MCP_TECHNISCHE_TABELLEN: readonly string[] = [
  // bv. "sync_logboek", "migraties", "webhook_events", "ui_voorkeuren"
] as const;

export function staatOpDenylist(tabelnaam: string): boolean {
  return MCP_DENYLIST.includes(tabelnaam);
}

export function magNooitSchrijven(tabelnaam: string): boolean {
  return MCP_NOOIT_SCHRIJVEN.includes(tabelnaam);
}

export function isTechnisch(tabelnaam: string): boolean {
  return MCP_TECHNISCHE_TABELLEN.includes(tabelnaam);
}
