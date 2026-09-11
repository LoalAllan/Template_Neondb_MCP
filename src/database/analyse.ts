/**
 * Queryanalyse — het hart van de handhaving.
 *
 * ⚠ VEILIGHEIDSKRITISCH. Elke wijziging hier valt onder de zware controle:
 * drie parallelle reviewers (omzeiling · fail-open · rechtenescalatie), met
 * unanimiteit. Zie de skill .claude/skills/mcp-rechten/SKILL.md.
 *
 * DE REGEL: we ONTLEDEN, we raden niet. Reguliere expressies zijn hier geen
 * beveiliging — die kunnen commentaar, string-literals, geneste constructies
 * en hoofdlettervarianten niet betrouwbaar uit elkaar houden. De boom is de
 * poort; de tekstcontroles hieronder staan er alleen náást, als vangnet.
 *
 * EN: bij twijfel weigeren. Een knooptype dat we niet kennen, een naam die
 * niet ondubbelzinnig te herleiden is, een constructie die de analyse niet
 * kent — allemaal weigeren. Een geweigerde legitieme query is een klein
 * ongemak; een toegelaten schadelijke query is niet terug te draaien.
 */

import { Parser } from "node-sql-parser/build/postgresql";
import { LIMIETEN, SCHEMA } from "../mcp.config";

const PARSER_OPTIES = { database: "postgresql" } as const;

/** Richtwaarde uit de opdracht; langer dan dit is nooit een handquery. */
export const MAX_QUERY_LENGTE = LIMIETEN.maxQueryLengte;

export type Operatie = "lezen" | "schrijven";

export type Analyse =
  | {
      ok: true;
      operatie: Operatie;
      /** Élke geraakte relatie, uit élke tak van de boom. */
      relaties: string[];
      /** Bij schrijven: de doeltabel van de INSERT/UPDATE. */
      doel: string | null;
      /**
       * De namen van alle CTE's in de query.
       *
       * ⚠ Deze mogen hier NIET zomaar uit `relaties` geschrapt worden. CTE-
       * zichtbaarheid is in Postgres LEXICAAL: een CTE die in een subquery is
       * gedefinieerd, schaduwt een gelijknamige tabel op het hoofdniveau niet,
       * en een schema-gekwalificeerde verwijzing (`public.tabel`) leest altijd
       * de echte tabel. Globaal schrappen maakte daardoor een leesbypass
       * mogelijk: `... FROM transactions ... (WITH transactions AS (SELECT 1) …)`
       * kwam er ongezien doorheen.
       *
       * De poort lost dit op tegen de catalogus: valt een CTE-naam samen met
       * een bestaande relatie, dan is de query niet ondubbelzinnig te herleiden
       * en wordt hij geweigerd (regel 8).
       */
      cteNamen: string[];
      /**
       * De query zoals hij uitgevoerd mag worden: getrimd en zonder
       * afsluitende puntkomma. Die puntkomma zou de omhulling breken
       * waarmee we het aantal geraakte rijen begrenzen.
       */
      genormaliseerd: string;
      /** Heeft het schrijfstatement een eigen RETURNING-tak? */
      heeftReturning: boolean;
    }
  | { ok: false; reden: string };

/* ══════════════════════════════════════════════════════════════════ *
 * Allowlists. Wat hier niet in staat, gaat er niet door. Groei ze
 * bewust — niet door alles wat onbekend is door te laten.
 * ══════════════════════════════════════════════════════════════════ */

/**
 * De knooptypes die de analyse begrijpt. Komt de parser iets tegen dat hier
 * niet in staat, dan weigeren we: we kunnen dan niet garanderen dat we alle
 * relatieverwijzingen eruit hebben gehaald.
 */
const KNOOPTYPES = new Set([
  // statements
  "select", "insert", "update", "values", "returning", "conflict",
  // uitdrukkingen
  "binary_expr", "unary_expr", "column_ref", "expr", "expr_list", "case",
  "when", "else", "function", "aggr_func", "cast", "extract", "interval",
  "window", "window_func", "origin", "star", "default", "column",
  // literals
  "number", "string", "single_quote_string", "double_quote_string",
  "bool", "null", "param", "var", "array", "row",
  // modifiers
  "ASC", "DESC", "DISTINCT", "DISTINCT ON", "ON", "ALL",
]);

/**
 * Ingebouwde functies die rekenen, tekst bewerken, datums hanteren of
 * aggregeren — en die geen data of catalogus raken.
 *
 * BEWUST NIET IN DEZE LIJST, ook al zijn ze ingebouwd:
 *  - de introspectiefuncties: to_regclass (bestaat deze tabel?),
 *    pg_get_viewdef (de volledige definitie van een view, inclusief de
 *    kolomnamen van gesloten tabellen), obj_description en col_description
 *    (juist de databasecommentaren), has_table_privilege, current_setting,
 *    pg_relation_size — die zien er onschuldig uit maar geven het schema prijs;
 *  - repeat, lpad, rpad en generate_series: honderd rijen kunnen gigabytes
 *    zijn, en zonder DELETE krijg je die er niet meer uit;
 *  - alles wat het bestandssysteem, externe verbindingen of serverinstellingen
 *    raakt (pg_read_file, lo_import, dblink, set_config, pg_sleep, …).
 *
 * Élke door de gebruiker gedefinieerde functie is sowieso verboden: die kan
 * onder water elke tabel lezen of schrijven en is van buitenaf niet te
 * beoordelen.
 */
const FUNCTIES = new Set([
  // aggregatie
  "count", "sum", "avg", "min", "max", "array_agg", "string_agg", "bool_and",
  "bool_or", "every", "stddev", "variance", "percentile_cont", "percentile_disc",
  // vensterfuncties
  "row_number", "rank", "dense_rank", "percent_rank", "cume_dist", "ntile",
  "lag", "lead", "first_value", "last_value", "nth_value",
  // rekenen
  "abs", "ceil", "ceiling", "floor", "round", "trunc", "sign", "mod", "power",
  "sqrt", "exp", "ln", "log", "greatest", "least", "div", "width_bucket",
  // tekst
  "lower", "upper", "initcap", "length", "char_length", "character_length",
  "trim", "btrim", "ltrim", "rtrim", "substr", "substring", "position",
  "strpos", "replace", "split_part", "left", "right", "reverse", "concat",
  "concat_ws", "format", "md5", "starts_with", "regexp_replace", "regexp_match",
  "to_char", "quote_literal",
  // datum & tijd
  "now", "current_date", "current_time", "current_timestamp", "localtime",
  "localtimestamp", "date_trunc", "date_part", "age", "extract", "to_date",
  "to_timestamp", "make_date", "make_interval", "justify_days",
  // conversie & null-afhandeling
  "cast", "coalesce", "nullif", "to_number", "nvl",
  /*
   * Kwantoren en groepeer-constructies. De parser levert deze als
   * function-knoop af, maar ze raken zélf geen data: ze staan om een
   * subquery of een uitdrukking heen waar de wandeling gewoon in afdaalt,
   * zodat elke tabel daarbinnen alsnog in `relaties` belandt.
   *
   * Ze ontbraken, met een absurd gevolg: `NOT EXISTS` werkte (dat is een
   * unary_expr) en het gewone `EXISTS` niet. De opdracht noemt subquery's en
   * aggregaties uitdrukkelijk als gewenst.
   */
  "exists", "any", "all", "some",
  "rollup", "cube", "grouping sets", "grouping",
  // json (lezen)
  "json_build_object", "jsonb_build_object", "json_agg", "jsonb_agg",
  "json_array_length", "jsonb_array_length", "jsonb_extract_path_text",
]);

/**
 * Casts. Een cast is GÉÉN functie-aanroep en staat als een heel ander
 * knooppunt in de boom — hij glipt dus langs elke controle die op
 * functienamen werkt. `SELECT 'geheime_tabel'::regclass` doet precies wat
 * to_regclass doet: vaststellen of een tabel bestaat, zonder er één aan te
 * raken. Daarom gaat de allowlist óók over casts, en is de hele reg*-familie
 * als doeltype verboden.
 */
const CAST_TYPES = new Set([
  "char", "varchar", "character", "text", "citext",
  "int", "int2", "int4", "int8", "integer", "smallint", "bigint",
  "numeric", "decimal", "real", "float", "float4", "float8", "double",
  "boolean", "bool", "date", "time", "timestamp", "timestamptz", "interval",
  "uuid", "json", "jsonb", "bytea",
]);

/**
 * Sleutelwoorden die je ZONDER haakjes schrijft en die de parser daarom niet
 * als functie-aanroep ontleedt maar als kolomverwijzing. Ze glippen zo langs
 * de functie-allowlist heen en geven informatie over de omgeving prijs.
 * Er bestaat in dit schema geen kolom met een van deze namen.
 */
const NILADISCHE_SLEUTELWOORDEN = new Set([
  "current_schema",
  "current_catalog",
  "current_database",
  "current_role",
  "current_user",
  "session_user",
  "user",
  "current_date",
  "current_time",
  "current_timestamp",
  "localtime",
  "localtimestamp",
]);

/**
 * Gereserveerde woorden die NOOIT een relatienaam kunnen zijn.
 *
 * Dit is geen netheid maar een reparatie. `SELECT * FROM only transactions`
 * wordt door de parser ontleed als tabel `only` met alias `transactions`: het
 * SLEUTELWOORD wordt de relatie en de échte tabel verdwijnt uit élke tak van
 * de analyse — ook uit de vangnetlijst van de parser. Postgres leest daar
 * gewoon `transactions`.
 *
 * Zodra de parser een naam teruggeeft die geen naam kán zijn, weten we dat
 * onze boom niet overeenkomt met wat Postgres gaat uitvoeren. Dan is er maar
 * één veilig antwoord: weigeren (regel 8).
 */
const GERESERVEERD = new Set([
  "only", "lateral", "natural", "cross", "inner", "outer", "left", "right",
  "full", "join", "on", "using", "where", "group", "order", "having", "limit",
  "offset", "fetch", "for", "union", "intersect", "except", "with", "select",
  "from", "as", "and", "or", "not", "null", "true", "false", "distinct", "all",
  "any", "some", "exists", "into", "values", "set", "returning", "default",
  "table", "tablesample", "ordinality", "recursive", "case", "when", "then",
  "else", "end", "between", "like", "ilike", "similar", "is", "in", "asc",
  "desc", "nulls", "first", "last", "window", "over", "partition", "by",
]);

/** Het enige schema waarin dit model werkt. */
// Het schema komt uit mcp.config.ts (SCHEMA).

/* ══════════════════════════════════════════════════════════════════ *
 * Tekstvoorbewerking
 * ══════════════════════════════════════════════════════════════════ */

/**
 * Strookt commentaar en string-literals weg, zodat een tekstcontrole niet
 * struikelt over `-- x⏎DROP TABLE y` en geen vals alarm geeft op een
 * onschuldige `WHERE tekst = 'graag verwijderen'`.
 *
 * Dit is NIET de poort — de boom is de poort. Dit is alleen om betrouwbaar
 * te kunnen zien of er dubbele aanhalingstekens in de query staan.
 */
export function kaalGemaakt(sql: string): string {
  let uit = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const volgende = sql[i + 1];
    if (c === "-" && volgende === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      uit += " ";
      continue;
    }
    if (c === "/" && volgende === "*") {
      i += 2;
      let diepte = 1; // Postgres nest blokcommentaar
      while (i < sql.length && diepte > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { diepte++; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { diepte--; i += 2; continue; }
        i++;
      }
      uit += " ";
      continue;
    }
    if (c === "'" || ((c === "e" || c === "E") && volgende === "'")) {
      // E'…' is een escape-string: daarin is de backslash wél een escape, ook
      // met standard_conforming_strings aan. Wie dat negeert, leest E'\\'' als
      // een afgesloten string en slikt de rest van de query op — waarna een
      // verstopt aanhalingsteken onopgemerkt blijft.
      const escapeString = c !== "'";
      i += escapeString ? 2 : 1;
      while (i < sql.length) {
        if (escapeString && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      uit += "''";
      continue;
    }
    if (c === "$") {
      // Dollar-quoting ($$ … $$ / $tag$ … $tag$) — de vorm waarin DO-blokken
      // en functiebodies leven. We herkennen hem alleen om hem te kunnen
      // weigeren; doorlaten doen we hem nooit.
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const eind = sql.indexOf(tag, i + tag.length);
        i = eind === -1 ? sql.length : eind + tag.length;
        uit += " $$ ";
        continue;
      }
    }
    uit += c;
    i++;
  }
  return uit;
}

/* ══════════════════════════════════════════════════════════════════ *
 * De analyse
 * ══════════════════════════════════════════════════════════════════ */

interface Verzameling {
  relaties: Set<string>;
  cteNamen: Set<string>;
  statements: string[];
  doelen: string[];
  heeftReturning: boolean;
  fout: string | null;
}

function faal(v: Verzameling, reden: string): void {
  if (v.fout === null) v.fout = reden;
}

/**
 * Loopt de HÉLE boom af. Niet alleen de takken die we verwachten: bouw je
 * alleen die, dan mis je gegarandeerd iets — `INSERT INTO open VALUES (1)
 * RETURNING (SELECT token FROM sessies)` haalt data uit een tabel die nooit
 * in je verzameling belandt.
 *
 * Daarom is dit een generieke wandeling over élk object en élke array, met
 * herkenning van de vormen die een relatie, een functie of een cast dragen.
 */
function loop(knoop: unknown, v: Verzameling, magKleinLetteren: boolean): void {
  if (knoop === null || knoop === undefined) return;
  if (Array.isArray(knoop)) {
    for (const k of knoop) loop(k, v, magKleinLetteren);
    return;
  }
  if (typeof knoop !== "object") return;

  const o = knoop as Record<string, unknown>;

  // 1. Knooptype toetsen.
  if (typeof o.type === "string" && !KNOOPTYPES.has(o.type)) {
    faal(v, `onbekende constructie (${o.type})`);
  }
  if (typeof o.type === "string" && ["select", "insert", "update"].includes(o.type)) {
    v.statements.push(o.type);
    if ((o.type === "insert" || o.type === "update") && o.returning) {
      v.heeftReturning = true;
    }
  }

  // 1b. Een UPDATE zonder WHERE overschrijft de hele tabel. Dit toetsen we op
  //     de BOOM en niet op de tekst: een tekstcontrole is te omzeilen met een
  //     voorafgaand blokcommentaar of het woord "where" in een stringliteral.
  //     De DO UPDATE-tak van een upsert telt hier NIET mee: die heeft geen
  //     eigen doeltabel en raakt per definitie alleen de conflicterende rij,
  //     dus een WHERE eisen zou elke upsert onmogelijk maken. Een echt
  //     UPDATE-statement herken je aan zijn `table`-tak.
  if (o.type === "update" && Array.isArray(o.table)) {
    if (o.where === null || o.where === undefined) {
      faal(v, "Een UPDATE zonder WHERE zou de hele tabel overschrijven en is niet toegestaan.");
    } else if (altijdWaar(o.where)) {
      faal(v, "Deze voorwaarde geldt voor elke rij en is daarom niet toegestaan.");
    }
  }

  // 1c. Niladische sleutelwoorden zien eruit als een kolom maar zijn het niet.
  if (o.type === "column_ref" && o.table === null) {
    const kolom = leesNaam(
      typeof o.column === "object" && o.column !== null
        ? (o.column as Record<string, unknown>).expr
        : o.column,
    );
    if (kolom && NILADISCHE_SLEUTELWOORDEN.has(kolom.toLowerCase())) {
      faal(v, `${kolom} is niet toegestaan`);
    }
  }

  // 2. `SELECT … INTO nieuwe_tabel` maakt een tabel aan; dat is DDL.
  if (o.into && typeof o.into === "object") {
    const into = o.into as Record<string, unknown>;
    if (into.position !== null && into.position !== undefined) {
      faal(v, "SELECT … INTO maakt een tabel aan");
    }
  }

  // 3. CTE-namen registreren. Een CTE-naam is géén tabel, maar de tabellen
  //    ín die CTE tellen wél mee.
  if (Array.isArray(o.with)) {
    for (const cte of o.with as Record<string, unknown>[]) {
      const naam = leesNaam(cte?.name);
      if (!naam) {
        faal(v, "CTE-naam is niet te herleiden");
        continue;
      }
      const genormaliseerd = normaliseer(naam, magKleinLetteren);
      if (genormaliseerd === null) {
        /*
         * Stil overslaan was een gat. Een bequoteerde CTE-naam met een
         * hoofdletter (`WITH "X" AS (…)`) gaf hier null, waardoor `cteNamen`
         * leeg bleef — en dáármee sloeg de harde regel "geen WITH bij
         * schrijven" over. Een schrijvende CTE kwam er dan doorheen, met een
         * omhulling die alleen de buitenste UPDATE telde. Dat het vandaag
         * strandde op de Postgres-grammatica was geluk, geen beveiliging.
         */
        faal(v, "CTE-naam is niet ondubbelzinnig te herleiden");
        continue;
      }
      v.cteNamen.add(genormaliseerd);
    }
  }

  // 4. Relatieverwijzingen. `from` (select), `table` (insert/update).
  for (const sleutel of ["from", "table"]) {
    const waarde = o[sleutel];
    if (!Array.isArray(waarde)) continue;
    for (const item of waarde as Record<string, unknown>[]) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.table !== "string") continue; // afgeleide tabel of LATERAL
      const schema = item.db;
      if (schema !== null && schema !== undefined && schema !== SCHEMA) {
        faal(v, "verwijzing buiten het toepassingsschema");
        continue;
      }
      const naam = normaliseer(item.table, magKleinLetteren);
      if (naam === null) {
        faal(v, "tabelnaam is niet ondubbelzinnig te herleiden");
        continue;
      }
      if (GERESERVEERD.has(naam)) {
        // Zie GERESERVEERD: de parser en Postgres zijn het hier oneens over
        // wat de relatie is. Dan klopt onze hele boom niet.
        faal(v, "tabelnaam is niet ondubbelzinnig te herleiden");
        continue;
      }
      v.relaties.add(naam);
      if (sleutel === "table" && (o.type === "insert" || o.type === "update")) {
        v.doelen.push(naam);
      }
    }
  }

  // 5. Functies — allowlist, geen denylist.
  if (o.type === "function" || o.type === "aggr_func" || o.type === "window_func") {
    const naam = functieNaam(o);
    if (naam === null) faal(v, "functie-aanroep is niet te herleiden");
    else if (!FUNCTIES.has(naam.toLowerCase())) faal(v, `functie ${naam} is niet toegestaan`);
  }

  // 6. Casts — de allowlist geldt ook hier, en de reg*-familie is verboden.
  if (o.type === "cast") {
    for (const t of castTypes(o)) {
      const kort = t.toLowerCase();
      if (kort.startsWith("reg")) faal(v, "casten naar een reg-type is niet toegestaan");
      else if (!CAST_TYPES.has(kort)) faal(v, `casten naar ${t} is niet toegestaan`);
    }
  }

  // 7. Alles wat we hierboven niet expliciet behandelden, wandelen we alsnog
  //    af — dat is precies de garantie die §5.3 vraagt.
  for (const waarde of Object.values(o)) loop(waarde, v, magKleinLetteren);
}

/** Herkent de goedkope altijd-ware voorwaarden (`WHERE true`, `WHERE 1=1`). */
function altijdWaar(knoop: unknown): boolean {
  if (!knoop || typeof knoop !== "object") return false;
  const o = knoop as Record<string, unknown>;
  if (o.type === "bool" && o.value === true) return true;
  if (o.type === "binary_expr" && o.operator === "=") {
    const l = o.left as Record<string, unknown> | null;
    const r = o.right as Record<string, unknown> | null;
    if (l?.type === "number" && r?.type === "number" && l.value === r.value) return true;
  }
  return false;
}

function leesNaam(knoop: unknown): string | null {
  if (typeof knoop === "string") return knoop;
  if (knoop && typeof knoop === "object") {
    const o = knoop as Record<string, unknown>;
    if (typeof o.value === "string") return o.value;
  }
  return null;
}

function functieNaam(o: Record<string, unknown>): string | null {
  const naam = o.name;
  if (typeof naam === "string") return naam;
  if (naam && typeof naam === "object") {
    const n = naam as Record<string, unknown>;
    if (Array.isArray(n.name)) {
      // Meerdelig (schema.functie) → altijd weigeren: eigen functies zijn verboden.
      if (n.name.length !== 1) return null;
      return leesNaam(n.name[0]);
    }
    if (typeof n.value === "string") return n.value;
  }
  return null;
}

function castTypes(o: Record<string, unknown>): string[] {
  const uit: string[] = [];
  const doel = o.target;
  const lijst = Array.isArray(doel) ? doel : doel ? [doel] : [];
  for (const t of lijst) {
    if (t && typeof t === "object") {
      const dt = (t as Record<string, unknown>).dataType;
      if (typeof dt === "string") uit.push(dt);
      else uit.push("onbekend");
    } else if (typeof t === "string") {
      uit.push(t);
    }
  }
  return uit.length > 0 ? uit : ["onbekend"];
}

/**
 * Namen oplossen volgens de regels van Postgres.
 *
 * In Postgres kunnen `tabel` en `"Tabel"` naast elkaar bestaan als twee
 * verschillende tabellen; wie de aanhalingstekens weghaalt, laat ze op één
 * sleutel vallen en opent met een recht op de ene ook de andere. De parser
 * bewaart helaas niet óf een naam bequoteerd was — dus doen we het strikt:
 *
 *  - staat er nergens een dubbel aanhalingsteken in de query, dan zijn álle
 *    namen onbequoteerd en mogen we ze veilig naar kleine letters vouwen,
 *    precies zoals Postgres zelf doet;
 *  - staat er wél één, dan eisen we dat elke naam al in kleine letters staat.
 *    Anders is niet vast te stellen wélke tabel bedoeld wordt → weigeren.
 *
 * Dit schema is volledig in kleine letters, dus in de praktijk breekt dit
 * niets. Het is strenger dan nodig, en dat is hier de goede kant.
 */
function normaliseer(naam: string, magKleinLetteren: boolean): string | null {
  const kandidaat = magKleinLetteren ? naam.toLowerCase() : naam;
  if (!/^[a-z_][a-z0-9_]*$/.test(kandidaat)) return null;
  return kandidaat;
}

/**
 * Ontleedt en toetst één aangeleverde query. Geeft terug wélke operatie het
 * is en élke relatie die hij raakt — of een reden om te weigeren.
 *
 * De rechtentoetsing zelf gebeurt NIET hier maar in poort.ts: deze functie
 * weet niets van rollen.
 */
export function analyseer(ruw: string): Analyse {
  const sql = ruw.trim();
  if (!sql) return { ok: false, reden: "De query is leeg." };
  if (sql.length > MAX_QUERY_LENGTE) {
    return { ok: false, reden: "De query is te lang." };
  }

  const kaal = kaalGemaakt(sql);

  // Dollar-quoting kan alleen een DO-blok of een functiebody zijn; beide
  // vallen buiten de toegestane operaties.
  if (kaal.includes("$$")) {
    return { ok: false, reden: "Deze constructie is niet toegestaan." };
  }

  const magKleinLetteren = !kaal.includes('"');

  let bomen: unknown;
  try {
    bomen = new Parser().astify(sql, PARSER_OPTIES);
  } catch {
    // Onontleedbaar = onbeoordeelbaar. Nooit "waarschijnlijk veilig".
    return { ok: false, reden: "Deze query kon niet ontleed worden en is daarom geweigerd." };
  }

  const lijst = Array.isArray(bomen) ? bomen : [bomen];
  if (lijst.length !== 1) {
    return { ok: false, reden: "Voer één statement per keer uit." };
  }

  const v: Verzameling = {
    relaties: new Set(),
    cteNamen: new Set(),
    statements: [],
    doelen: [],
    heeftReturning: false,
    fout: null,
  };
  loop(lijst[0], v, magKleinLetteren);

  if (v.fout) return { ok: false, reden: v.fout };

  if (v.statements.length === 0) {
    return { ok: false, reden: "Deze query bevat geen leesbare instructie." };
  }
  for (const s of v.statements) {
    if (s !== "select" && s !== "insert" && s !== "update") {
      return { ok: false, reden: "Alleen lezen, toevoegen en bijwerken zijn mogelijk." };
    }
  }

  // Tweede bron náást de eigen wandeling: de relatielijst van de parser. We
  // nemen de VERENIGING — wat de één vindt en de ander mist, telt gewoon mee.
  // Dat kan alleen strenger uitpakken, nooit ruimer.
  try {
    const geparseerd = new Parser().parse(sql, PARSER_OPTIES) as { tableList?: string[] };
    for (const item of geparseerd.tableList ?? []) {
      const delen = item.split("::");
      const schema = delen[1];
      const tabel = delen[2];
      if (!tabel) continue;
      if (schema && schema !== "null" && schema !== SCHEMA) {
        return { ok: false, reden: "verwijzing buiten het toepassingsschema" };
      }
      const naam = normaliseer(tabel, magKleinLetteren);
      if (naam === null) {
        return { ok: false, reden: "tabelnaam is niet ondubbelzinnig te herleiden" };
      }
      v.relaties.add(naam);
    }
  } catch {
    return { ok: false, reden: "Deze query kon niet ontleed worden en is daarom geweigerd." };
  }

  // Systeemcatalogi blijven buiten bereik, ook ongekwalificeerd: Postgres zet
  // pg_catalog impliciet vooraan in het zoekpad, dus `SELECT * FROM pg_class`
  // komt daar uit — search_path alleen redt je hier niet.
  for (const r of v.relaties) {
    if (r.startsWith("pg_") || r === "information_schema") {
      return { ok: false, reden: "verwijzing buiten het toepassingsschema" };
    }
  }

  // De afsluitende puntkomma moet eraf: hij zou de omhulling breken waarmee
  // we straks begrenzen. De parser heeft al vastgesteld dat het één statement is.
  const genormaliseerd = sql.replace(/;\s*$/, "");

  const schrijft = v.statements.some((s) => s === "insert" || s === "update");
  if (!schrijft) {
    return {
      ok: true,
      operatie: "lezen",
      relaties: [...v.relaties],
      doel: null,
      cteNamen: [...v.cteNamen],
      genormaliseerd,
      heeftReturning: false,
    };
  }

  // Een schrijvende CTE moet in Postgres op het HOOGSTE niveau staan en is
  // dus niet te omhullen — en zonder omhulling is er geen rijbegrenzing, want
  // de HTTP-driver kent geen interactieve transactie waarin we kunnen
  // terugdraaien. Daarom weigeren we hem. Dat is strenger dan de opdracht
  // vraagt, en bewust: liever een geweigerde legitieme query dan een
  // schrijfpad zonder rem.
  if (v.cteNamen.size > 0) {
    return {
      ok: false,
      reden:
        "Een schrijfquery met een WITH-onderdeel kan niet begrensd worden en is daarom niet toegestaan.",
    };
  }

  const doelen = [...new Set(v.doelen)];
  if (doelen.length !== 1) {
    return { ok: false, reden: "Schrijf naar één tabel per keer." };
  }
  return {
    ok: true,
    operatie: "schrijven",
    relaties: [...v.relaties],
    doel: doelen[0],
    cteNamen: [],
    genormaliseerd,
    heeftReturning: v.heeftReturning,
  };
}
