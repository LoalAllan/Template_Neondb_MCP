-- ═══════════════════════════════════════════════════════════════════════════
-- De schema-atlas: hoe de APP het schema leest voor het rechtenscherm.
--
-- De app leest tabellen, kolommen, sleutels en view-bronnen zelf uit de
-- catalogus, via haar eigen (volledige) verbinding. Het verbod op
-- systeemcatalogi geldt de MCP-querytool, niet de app — die moet het schema
-- juist kunnen tonen, inclusief de kolommen en hun commentaar.
--
-- Ververs bij het openen van de pagina; cachen mag, maar kort, zodat een
-- verse migratie meteen zichtbaar is. Filter denylist-tabellen weg vóór je
-- iets teruggeeft (ook de structuur blijft dicht). Vervang 'public' door het
-- schema uit mcp-server/src/mcp.config.ts als dat afwijkt.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Alle kolommen van alle tabellen en views, mét het commentaar dat de
--    database draagt. Dit commentaar is de reden dat een beheerder een
--    geïnformeerde keuze maakt in plaats van een gok.
SELECT c.relname                              AS tabel,
       c.relkind                              AS soort,        -- 'r' tabel, 'v' view
       a.attname                              AS kolom,
       format_type(a.atttypid, a.atttypmod)   AS type,
       NOT a.attnotnull                       AS nullable,
       col_description(c.oid, a.attnum)       AS commentaar,
       a.attnum                               AS positie
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'v')
   AND a.attnum > 0
   AND NOT a.attisdropped
 ORDER BY c.relname, a.attnum;

-- 2. Verplichte, cascaderende sleutels (kind → ouder). Een tabel met zo'n
--    sleutel hoort in het cluster van zijn ouder; is hij daar niet ingedeeld,
--    dan verschijnt hij in "Nog niet ingedeeld" en staat het cluster op
--    "gedeeltelijk".
SELECT src.relname AS kind, doel.relname AS ouder
  FROM pg_constraint con
  JOIN pg_class src   ON src.oid  = con.conrelid
  JOIN pg_class doel  ON doel.oid = con.confrelid
  JOIN pg_namespace n ON n.oid    = src.relnamespace
 WHERE con.contype = 'f'
   AND con.confdeltype = 'c'
   AND n.nspname = 'public'
   AND NOT EXISTS (
         SELECT 1 FROM unnest(con.conkey) AS k(attnum)
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
          WHERE NOT a.attnotnull
       );

-- 3. Welke tabellen een view leest (door geneste views heen), om bij een view
--    in het scherm te tonen: "Deze view leest: klanten, contactpersonen."
--    Let op: dit is de PRESENTATIE-variant. De publiceer-actie gebruikt de
--    strengere variant uit publiceer-validatie.md, die ook functie-
--    afhankelijkheden ziet en gelijk moet blijven aan de MCP-server.
WITH RECURSIVE keten AS (
  SELECT v.oid AS view_oid, v.relname AS view_naam, d.refobjid AS bron_oid
    FROM pg_class v
    JOIN pg_namespace n ON n.oid = v.relnamespace AND n.nspname = 'public'
    JOIN pg_rewrite rw  ON rw.ev_class = v.oid
    JOIN pg_depend d    ON d.objid = rw.oid AND d.classid = 'pg_rewrite'::regclass
   WHERE v.relkind = 'v' AND d.refobjid <> v.oid
   UNION
  SELECT k.view_oid, k.view_naam, d2.refobjid
    FROM keten k
    JOIN pg_class v2    ON v2.oid = k.bron_oid AND v2.relkind = 'v'
    JOIN pg_rewrite rw2 ON rw2.ev_class = v2.oid
    JOIN pg_depend d2   ON d2.objid = rw2.oid AND d2.classid = 'pg_rewrite'::regclass
   WHERE d2.refobjid <> v2.oid
)
SELECT DISTINCT k.view_naam AS view, b.relname AS bron
  FROM keten k
  JOIN pg_class b ON b.oid = k.bron_oid
 WHERE b.relkind IN ('r', 'v');

-- 4. Álle foreign keys — niet alleen de verplichte cascades. Hieruit volgt de
--    tekst "Verwijst naar Relaties" onder een uitgeklapt cluster: open je
--    Facturen maar niet Relaties, dan is klant_id een kale sleutel zonder naam.
SELECT DISTINCT src.relname AS kind, doel.relname AS ouder
  FROM pg_constraint con
  JOIN pg_class src   ON src.oid  = con.conrelid
  JOIN pg_class doel  ON doel.oid = con.confrelid
  JOIN pg_namespace n ON n.oid    = src.relnamespace
 WHERE con.contype = 'f' AND n.nspname = 'public';

-- Daarna per tabel in de app:
--   schrijvenUitgesloten = (soort = 'v') OR magNooitSchrijven(naam)
--   technisch            = isTechnisch(naam)
-- en: staatOpDenylist(naam) → helemaal weglaten (verzegelde kaart toont alleen de naam).
