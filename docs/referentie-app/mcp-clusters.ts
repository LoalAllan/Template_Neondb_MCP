/**
 * De clusterindeling van het rechtenscherm.
 *
 * Dit is een REDACTIONELE laag bovenop het schema, met de hand geschreven. Een
 * heuristiek op sleutels en naamstammen zet juist de tabellen uit elkaar die
 * inhoudelijk bij elkaar horen, en een uitleg in gewone taal valt sowieso niet
 * af te leiden — die moet iemand schrijven. De indeling wordt voorgesteld door
 * de agent en bevestigd door de eigenaar (opdracht §8.2).
 *
 * ⚠ Een cluster is een BEDIENINGSGEMAK, nooit de waarheid. Het rechtenmodel
 * blijft per tabel: één klik op een cluster schrijft een rij per tabel, en het
 * proefblad bij het publiceren noemt de echte tabelnamen.
 *
 * ⚠ Het vangnet is niet-onderhandelbaar. Een tabel die hier niet geclaimd is
 * en niet technisch of verzegeld is, verschijnt in "Nog niet ingedeeld" —
 * zichtbaar en dicht. Zo kan een migratie nooit een tabel stilletjes in een
 * open cluster laten belanden, en blijft de fail-safe uit het datamodel
 * ("geen rij = geen toegang") overeind.
 *
 * ⚠ De indeling staat in de BRONCODE — niet in de database (dan kan wie er
 * niet bij hoort hem wijzigen) en niet in een configuratiescherm. De layout op
 * het scherm wordt uit deze indeling berekend en nooit opgeslagen.
 */

/** Eén tabel of view zoals de schema-atlas hem aanlevert (zie schema-atlas.sql). */
export interface AtlasTabel {
  naam: string;
  soort: "tabel" | "view";
  /** Voor een view: de tabellen die hij (transitief) leest. */
  leest?: string[];
  kolommen: { naam: string; type: string; nullable: boolean; commentaar: string | null }[];
  /** Ouder-tabellen waarnaar deze tabel met een verplichte, cascaderende sleutel verwijst. */
  verplichteCascades: string[];
  /** View of NOOIT_SCHRIJVEN: de stand "schrijven" bestaat hier niet. */
  schrijvenUitgesloten: boolean;
  /** Uit MCP_TECHNISCHE_TABELLEN: machinerie, standaard uit het zicht. */
  technisch: boolean;
}

/* ------------------------------------------------------------------ *
 * De kaart
 * ------------------------------------------------------------------ */

/**
 * Optionele groepering van clusters (bv. "Commercieel", "Geld", "Werk").
 * Bij minder dan ~8 clusters laat je dit weg en zet je alles in één vleugel.
 */
export type VleugelSleutel = "commercieel" | "geld" | "werk";

export const MCP_VLEUGELS: readonly { sleutel: VleugelSleutel; titel: string }[] = [
  { sleutel: "commercieel", titel: "Commercieel" },
  { sleutel: "geld", titel: "Geld" },
  { sleutel: "werk", titel: "Werk" },
] as const;

export interface ClusterDefinitie {
  /** Stabiele sleutel — verandert nooit, ook niet als de titel wijzigt. Bepaalt ook het icoon. */
  sleutel: string;
  /** Clusternaam, mét punt (merkgrammatica: "Relaties." leest als een uitspraak, "Relaties" als een label). */
  titel: string;
  /** Eén zin gewone taal, zonder tabelnamen: waar gaat dit cluster over? */
  uitleg: string;
  vleugel: VleugelSleutel;
  /** Wat eronder valt. Technische tabellen horen hier NIET in. */
  tabellen: readonly string[];
  /** Concrete waarschuwing die de beheerder moet zien vóór hij de deur opent. */
  voetnoot?: string;
}

/**
 * VOORBEELDINDELING in het voorbeelddomein van de template. Vervang door de
 * indeling die je in Fase 0 hebt voorgesteld en de eigenaar heeft bevestigd.
 * Mik op vijf tot twaalf clusters; boven de vijftien groepeer je op tabellen
 * in plaats van op betekenis.
 */
export const MCP_CLUSTERS: readonly ClusterDefinitie[] = [
  {
    sleutel: "relaties",
    titel: "Relaties.",
    uitleg: "Wie je klanten zijn en wie je bij hen spreekt.",
    vleugel: "commercieel",
    tabellen: ["klanten", "contactpersonen"],
    voetnoot: "Let op: klanten draagt ook de omzet- en margecijfers per klant.",
  },
  {
    sleutel: "contactmomenten",
    titel: "Contactmomenten.",
    uitleg: "Elk gesprek, telefoontje en mailtje, met de uitkomst erbij.",
    vleugel: "commercieel",
    tabellen: ["contactmomenten"],
  },
  {
    sleutel: "projecten",
    titel: "Projecten.",
    uitleg: "Wat er loopt en wat er te doen staat.",
    vleugel: "werk",
    tabellen: ["projecten", "taken"],
  },
  {
    sleutel: "facturen",
    titel: "Facturen.",
    uitleg: "Wat je factureerde, regel voor regel.",
    vleugel: "geld",
    tabellen: ["facturen", "factuurregels"],
    voetnoot: "De applicatie schrijft hier zelf: de nummerreeks loopt door. Lezen kan, schrijven nooit.",
  },
  {
    sleutel: "boekhouding",
    titel: "Boekhouding.",
    uitleg: "Wat er in- en uitgaat, met de categorie erbij.",
    vleugel: "geld",
    tabellen: ["transacties", "kostcategorieen"],
  },
] as const;

/** De sleutel van het vangnetcluster. Bestaat alleen als er iets in valt. */
export const ONGEPLAATST = "ongeplaatst";

/* ------------------------------------------------------------------ *
 * Wat het scherm krijgt
 * ------------------------------------------------------------------ */

export interface Kamer {
  sleutel: string;
  titel: string;
  uitleg: string;
  voetnoot: string | null;
  tabellen: AtlasTabel[];
  /** Alle tabellen zijn `schrijvenUitgesloten` → "schrijven" bestaat hier nooit als keuze. */
  leeszaal: boolean;
  /** Titels van andere clusters waarnaar deze verwijst (kale FK's, geen rechten). Als TEKST tonen, nooit als lijn. */
  verwijstNaar: string[];
  /** Vangnet: hier staan tabellen die nog nergens zijn ingedeeld. */
  ongeplaatst: boolean;
  /** Machinerie, standaard uit het zicht. */
  technisch: boolean;
}

export interface VleugelView {
  /** Vleugelsleutel, of "ongeplaatst" voor het vangnet. */
  sleutel: string;
  titel: string;
  kamers: Kamer[];
}

export interface Plattegrond {
  vleugels: VleugelView[];
  /** Machinerie: elke technische tabel als eigen kleine kamer. */
  kelder: Kamer[];
  /** De denylist, als één verzegelde kaart zonder verbinding. */
  verzegeld: string[];
}

/** Eén foreign key, cluster-agnostisch aangeleverd door de schema-atlas. */
export interface Verwijzing {
  kind: string;
  ouder: string;
}

/**
 * Bouwt de plattegrond. Volgorde is bewust:
 *  1. technische tabellen gaan naar de kelder en doen aan niets anders mee;
 *  2. de rest wordt over de clusters verdeeld volgens MCP_CLUSTERS;
 *  3. wat overblijft valt in "Nog niet ingedeeld" — nooit stilzwijgend weg.
 */
export function bouwPlattegrond(
  tabellen: AtlasTabel[],
  verwijzingen: Verwijzing[] = [],
  verzegeld: readonly string[] = [],
): Plattegrond {
  const perNaam = new Map(tabellen.map((t) => [t.naam, t]));
  const geplaatst = new Set<string>();

  // 1 — de kelder. Machinerie hoort niet in een scherm over klantgegevens.
  const kelder: Kamer[] = tabellen
    .filter((t) => t.technisch)
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl"))
    .map((t) => {
      geplaatst.add(t.naam);
      return {
        sleutel: `technisch:${t.naam}`,
        titel: t.naam.replace(/_/g, " "),
        uitleg: "",
        voetnoot: null,
        tabellen: [t],
        leeszaal: t.schrijvenUitgesloten,
        verwijstNaar: [],
        ongeplaatst: false,
        technisch: true,
      };
    });

  // 2 — de clusters, in de volgorde van de kaart.
  const kamerVanTabel = new Map<string, string>();
  const kamers: Kamer[] = [];
  for (const def of MCP_CLUSTERS) {
    const leden = def.tabellen
      .map((naam) => perNaam.get(naam))
      .filter((t): t is AtlasTabel => t !== undefined && !t.technisch);
    if (leden.length === 0) continue; // het hele cluster bestaat niet (meer)
    for (const t of leden) {
      geplaatst.add(t.naam);
      kamerVanTabel.set(t.naam, def.sleutel);
    }
    kamers.push({
      sleutel: def.sleutel,
      titel: def.titel,
      uitleg: def.uitleg,
      voetnoot: def.voetnoot ?? null,
      tabellen: leden,
      leeszaal: leden.every((t) => t.schrijvenUitgesloten),
      verwijstNaar: [],
      ongeplaatst: false,
      technisch: false,
    });
  }

  // 3 — het vangnet. Zichtbaar en dicht, met een waarschuwing.
  const rest = tabellen
    .filter((t) => !geplaatst.has(t.naam))
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
  if (rest.length > 0) {
    for (const t of rest) kamerVanTabel.set(t.naam, ONGEPLAATST);
    kamers.push({
      sleutel: ONGEPLAATST,
      titel: "Nog niet ingedeeld.",
      uitleg:
        "Deze tabellen zijn na de laatste indeling bijgekomen. Ze staan dicht tot iemand ze bewust openzet.",
      voetnoot:
        "Hoort een tabel bij een bestaand cluster? Voeg hem dan toe aan MCP_CLUSTERS in dit bestand.",
      tabellen: rest,
      leeszaal: rest.every((t) => t.schrijvenUitgesloten),
      verwijstNaar: [],
      ongeplaatst: true,
      technisch: false,
    });
  }

  // Kruisverwijzingen als TEKST, nooit als lijn: een lijn tussen clusters
  // suggereert dat toegang zich voortplant, en dat doet ze niet.
  const titelVan = new Map(kamers.map((k) => [k.sleutel, k.titel.replace(/\.$/, "")]));
  const kruis = new Map<string, Set<string>>();
  for (const v of verwijzingen) {
    const van = kamerVanTabel.get(v.kind);
    const naar = kamerVanTabel.get(v.ouder);
    if (!van || !naar || van === naar) continue;
    const doel = titelVan.get(naar);
    if (!doel) continue;
    if (!kruis.has(van)) kruis.set(van, new Set());
    kruis.get(van)!.add(doel);
  }
  for (const k of kamers) {
    k.verwijstNaar = [...(kruis.get(k.sleutel) ?? [])].sort((a, b) => a.localeCompare(b, "nl"));
  }

  const vleugels: VleugelView[] = MCP_VLEUGELS.map((v) => ({
    sleutel: v.sleutel,
    titel: v.titel,
    kamers: kamers.filter(
      (k) => MCP_CLUSTERS.find((d) => d.sleutel === k.sleutel)?.vleugel === v.sleutel,
    ),
  })).filter((v) => v.kamers.length > 0);

  // Het vangnet hoort nergens thuis — precies daarom valt het op.
  const zwevend = kamers.filter((k) => k.ongeplaatst);
  if (zwevend.length > 0) {
    vleugels.push({ sleutel: ONGEPLAATST, titel: "Nog niet ingedeeld", kamers: zwevend });
  }

  return { vleugels, kelder, verzegeld: [...verzegeld] };
}

/**
 * De kelder als één kaart "Machinerie". Op het scherm is machinerie één ding
 * dat je aan- of uitzet, geen losse kaartjes — maar het rechtenmodel blijft
 * per tabel, dus de tabellen zelf blijven allemaal zichtbaar in de uitklapper.
 *
 * `leeszaal` is bewust een AND over alle leden: zolang één technische tabel
 * beschrijfbaar is, mag de kaart openkunnen. De tabellen die dat niet mogen,
 * weigeren dan op hun eigen rij — dezelfde regel als bij een gewoon cluster.
 */
export function bundelMachinerie(kelder: Kamer[]): Kamer | null {
  if (kelder.length === 0) return null;
  const tabellen = kelder.flatMap((k) => k.tabellen);
  return {
    sleutel: "machinerie",
    titel: "Machinerie.",
    uitleg: "Logboeken, wachtrijen en interne hulptabellen. Zelden nuttig voor een model.",
    voetnoot: null,
    tabellen,
    leeszaal: tabellen.every((t) => t.schrijvenUitgesloten),
    verwijstNaar: [],
    ongeplaatst: false,
    technisch: true,
  };
}

/* ------------------------------------------------------------------ *
 * Dev-asserts — vangen de twee fouten die je bij het bijwerken maakt.
 * Falen in ontwikkeling, niet in productie.
 * ------------------------------------------------------------------ */

if (process.env.NODE_ENV !== "production") {
  const gezien = new Set<string>();
  for (const def of MCP_CLUSTERS) {
    for (const naam of def.tabellen) {
      if (gezien.has(naam)) {
        throw new Error(
          `mcp-clusters: tabel "${naam}" staat in meer dan één cluster. Eén tabel hoort in precies één cluster.`,
        );
      }
      gezien.add(naam);
    }
  }
  const sleutels = new Set<string>();
  for (const def of MCP_CLUSTERS) {
    if (sleutels.has(def.sleutel)) {
      throw new Error(`mcp-clusters: dubbele clustersleutel "${def.sleutel}".`);
    }
    sleutels.add(def.sleutel);
  }
  // De derde controle — "een cluster wijst naar een tabel die niet bestaat" —
  // kan alleen tegen de catalogus: doe die in bouwPlattegrond() of in een test
  // die de schema-atlas inleest, en laat hem in ontwikkeling hard falen.
}
