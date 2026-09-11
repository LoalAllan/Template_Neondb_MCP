/**
 * De drie standen van het rechtenscherm.
 *
 * Drie standen per tabel, maar slechts TWEE waarden in de database:
 * "geen toegang" is de AFWEZIGHEID van een rij in `mcp_rechten`. Dat is niet
 * cosmetisch — het is het mechanisme waardoor een nieuwe tabel automatisch
 * gesloten is voor elke rol. Voeg hier dus nooit een waarde "geen" toe.
 *
 * De labels zijn de woorden die overal terugkomen: op de knoop, in het
 * standenmenu, in het proefblad en in de bevestiging. Nooit SELECT/RW/niveau 2.
 */

export const MCP_RECHT_NIVEAUS = ["lezen", "schrijven"] as const;
export type McpRechtNiveau = (typeof MCP_RECHT_NIVEAUS)[number];

/** De stand van één tabel zoals de beheerder hem ziet; null = geen rij = dicht. */
export type Stand = McpRechtNiveau | null;

/** Een cluster kan ook ongelijk staan; een tabel nooit. */
export type ClusterStand = Stand | "gedeeltelijk";

/** De werkstand van het scherm: tabelnaam → niveau. Geen sleutel = dicht. */
export type Rechten = Record<string, McpRechtNiveau>;

export type StandSleutel = "geen" | McpRechtNiveau;

/** `null` → "geen", zodat MCP_STAND_META te indexeren is. */
export function standSleutel(stand: Stand): StandSleutel {
  return stand ?? "geen";
}

/**
 * De drieklank: rust (kleurloos — dicht is de gezonde toestand, geen alarm),
 * koel (lezen) en warm (schrijven, het merkaccent). Kleur draagt nooit alleen:
 * elke stand heeft óók een eigen lijnstijl en een eigen teken, zodat het
 * scherm in grijstinten leesbaar blijft.
 */
export const MCP_STAND_META: Record<StandSleutel, { label: string; teken: string; uitleg: string }> = {
  geen: {
    label: "Geen toegang",
    teken: "—",
    uitleg: "Deze rol ziet de tabel niet en kan hem niet bevragen.",
  },
  lezen: {
    label: "Lezen",
    teken: "◦",
    uitleg: "Deze rol mag de tabel bevragen, maar niets toevoegen of wijzigen.",
  },
  schrijven: {
    label: "Schrijven",
    teken: "●",
    uitleg: "Deze rol mag lezen, rijen toevoegen en bestaande rijen bijwerken. Verwijderen kan nooit.",
  },
};

/** De aflezende stand "gedeeltelijk" heeft een teken, maar geen eigen kleur. */
export const GEDEELTELIJK_TEKEN = "◐";

/**
 * De drie standen in kleur, uitgedrukt in de tokens van de codebase.
 * Vervang de variabelenamen door die van het designsysteem van de klant;
 * introduceer geen nieuw palet. "geen" = de sterke randkleur, "lezen" = de
 * énige koele tint op het scherm, "schrijven" = het merkaccent.
 */
export const STAND_KLEUR: Record<StandSleutel, string> = {
  geen: "var(--color-border-strong)",
  lezen: "var(--color-status-cool)",
  schrijven: "var(--color-accent)",
};

/** De stand van een cluster volgt uit zijn tabellen — nooit andersom. */
export function clusterStand(tabellen: string[], rechten: Rechten): ClusterStand {
  if (tabellen.length === 0) return null;
  const eerste = rechten[tabellen[0]] ?? null;
  for (const naam of tabellen) {
    if ((rechten[naam] ?? null) !== eerste) return "gedeeltelijk";
  }
  return eerste;
}

/**
 * Welke standen komen in een cluster voor? Bepaalt de kleur van de verbinding:
 * staat er ergens `schrijven`, dan schrijven; anders `lezen` als dat voorkomt;
 * anders `geen`. Meer dan één stand = gemengd (halve dekking, holle landing).
 */
export function standenInCluster(tabellen: string[], rechten: Rechten): StandSleutel[] {
  const set = new Set<StandSleutel>();
  for (const naam of tabellen) set.add(standSleutel(rechten[naam] ?? null));
  return [...set];
}
