-- ═══════════════════════════════════════════════════════════════════════════
-- 02 — De MCP-databasegebruikers. Draai dit EENMALIG als de eigenaar van de
-- database (bv. `neondb_owner`) in de Neon-console (SQL Editor), NADAT
-- 01-mcp-tabellen.sql via de migraties is gedraaid.
--
-- WAAROM DIT BESTAAT
-- De handhaving van het MCP-rechtenmodel heeft twee dimensies, en ze liggen
-- bewust op verschillende plekken:
--
--   • WELKE TABELLEN een rol mag raken, is applicatiedata: dat staat in
--     mcp_rechten en de beheerder klikt het in het rechtenscherm. Dat moet wel —
--     wie rollen aanmaakt, kan geen databaserollen en connection strings aanmaken.
--
--   • WELKE OPERATIES überhaupt mogelijk zijn, staat hier, in de database.
--     Deze gebruikers hebben simpelweg geen DELETE, geen TRUNCATE, geen
--     eigenaarschap en geen recht om objecten aan te maken. Geen enkele fout
--     in de applicatiecode kan daar iets aan veranderen.
--
-- Die tweede dimensie is wat de belofte "hier kan niets verdwijnen" overeind
-- houdt, ook als de queryanalyse in de Worker ooit een gat blijkt te hebben.
--
-- ⚠ DIT IS EEN SJABLOON. De tabellijsten in §3 en §4 komen uit het
--   voorbeelddomein van de template (klanten, projecten, facturen, …) en
--   bestaan bij de klant NIET. Draai dit bestand nooit één-op-één: lees eerst
--   het Drizzle-schema en de catalogus van de klant, en vervang elke tabelnaam
--   door wat er werkelijk staat. Een GRANT op een onbestaande tabel faalt
--   luid; een vergeten GRANT op een bestaande tabel faalt stil — controleer
--   daarom achteraf met 03-controle.sql én MCP_TEST_BRANCH=1 pnpm test.
--
-- VOORAF — VUL IN:
--   <database>        de databasenaam (in Neon meestal `neondb`)
--   <gebruikerstabel> de gebruikerstabel van de applicatie (= GEBRUIKERS.tabel
--                     in src/mcp.config.ts)
--   <updated_at>      de updated_at-kolom van die tabel; heeft ze die niet,
--                     schrap dan die kolom uit de GRANT UPDATE in §5
--   de tabellijsten in §3 en §4 (zie de instructie daar)
--   de drie wachtwoorden: sterk, willekeurig en ALFANUMERIEK (geen leestekens —
--   dat scheelt URL-encoding-gedoe in de connection string)
--
-- ⚠ VUL DE WACHTWOORDEN NIET HIER IN. Dit bestand staat in git. Maak een kopie
--   BUITEN de repo, vul die in, en gooi hem weg zodra de Worker-secrets gezet
--   zijn. Eén keer vergeten te wissen vóór een commit en de wachtwoorden staan
--   permanent in de historie.
--
--   Let ook op: de \set-regels hieronder zijn psql-commando's. De Neon-webeditor
--   kent ze niet — vervang in je kopie de :'…'-plaatshouders door de waarden zelf.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- DIT BESTAND GROEIT MEE MET ELKE MIGRATIE DIE EEN TABEL TOEVOEGT.
--
-- Een nieuwe tabel is voor élke MCP-rol automatisch gesloten (geen rij in
-- mcp_rechten) — dáár hoef je niets voor te doen. Maar zonder GRANT is hij ook
-- onbereikbaar zódra de beheerder hem in het rechtenscherm openzet: Postgres
-- weigert dan alsnog, met een melding die niets verklaart.
--
-- Zet de GRANT-regels dus in de migratie zelf, net als de COMMENT ON-regels:
--
--     GRANT SELECT ON <tabel> TO mcp_lezer;
--     GRANT SELECT, INSERT, UPDATE ON <tabel> TO mcp_schrijver;  -- als schrijven ooit mag
--
-- Let op dat SELECT ook in die tweede regel staat: Postgres eist het voor elke
-- kolom die een UPDATE of RETURNING leest. Laat je het weg, dan is geen enkele
-- UPDATE op die tabel mogelijk.
--
-- En werk de lijsten in §3 en §4 hieronder bij, zodat dit bestand een database
-- vanaf nul correct blijft opbouwen. Zie de skill `mcp-rechten`
-- (.claude/skills/mcp-rechten/SKILL.md), baan A: recht versus GRANT, en de drie
-- gevallen waarin je juist NIETS grant.
-- ═══════════════════════════════════════════════════════════════════════════

\set LEZER_WW      'VERVANG_MIJ_lezer'
\set SCHRIJVER_WW  'VERVANG_MIJ_schrijver'
\set SERVICE_WW    'VERVANG_MIJ_service'

-- ───────────────────────────────────────────────────────────────────────────
-- 1. De drie rollen, kaal aangemaakt
--
-- Geen superuser, geen CREATEDB, geen CREATEROLE, geen BYPASSRLS, geen
-- lidmaatschap van andere rollen. En van geen enkel object eigenaar — niet
-- omdat een eigenaar rechten "houdt" (die kun je intrekken), maar omdat hij
-- ze zichzelf altijd opnieuw kan geven, en DROP/ALTER sowieso uit
-- eigenaarschap volgen, buiten elke GRANT om.
-- ───────────────────────────────────────────────────────────────────────────

CREATE ROLE mcp_lezer     WITH LOGIN PASSWORD :'LEZER_WW'     NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
CREATE ROLE mcp_schrijver WITH LOGIN PASSWORD :'SCHRIJVER_WW' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
CREATE ROLE mcp_service   WITH LOGIN PASSWORD :'SERVICE_WW'   NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;

GRANT CONNECT ON DATABASE <database> TO mcp_lezer, mcp_schrijver, mcp_service;

-- "Rechten per schema verlenen" bestaat niet in Postgres: op een schema geef
-- je alleen USAGE. Zonder dit werkt geen enkele query.
GRANT USAGE ON SCHEMA public TO mcp_lezer, mcp_schrijver, mcp_service;

-- Zonder deze REVOKE kan een gebruiker eigen tabellen aanmaken, is hij van
-- díé tabellen eigenaar, en daarmee almachtig binnen zijn eigen hoekje —
-- inclusief DROP en ALTER. Dit is de derde poot onder de belofte dat er niets
-- kan verdwijnen: geen DELETE-recht, geen eigenaarschap, geen CREATE.
REVOKE CREATE ON SCHEMA public FROM mcp_lezer, mcp_schrijver, mcp_service, PUBLIC;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Sessie-instellingen op de ROL, niet op de sessie
--
-- `SET LOCAL` buiten een transactie doet niets (alleen een waarschuwing), en
-- een gewone `SET` op een gepoolde verbinding lekt naar de volgende gebruiker
-- ervan. Op de rol gezet geldt het altijd, ook in een HTTP-driver zonder
-- sessiestatus.
-- ───────────────────────────────────────────────────────────────────────────

-- Zonder dit lost Postgres een ongekwalificeerde naam bij de UITVOERING op via
-- het zoekpad — niet via de catalogus-opzoeking die de Worker deed. Een tweede
-- schema vóór public in dat pad betekent: de Worker keurt de ene tabel goed en
-- de database leest een andere. (Gebruik je een ander schema dan public, pas
-- dan hier én in src/mcp.config.ts (SCHEMA) dezelfde naam toe.)
ALTER ROLE mcp_lezer     SET search_path = public, pg_temp;
ALTER ROLE mcp_schrijver SET search_path = public, pg_temp;
ALTER ROLE mcp_service   SET search_path = public, pg_temp;

ALTER ROLE mcp_lezer     SET statement_timeout = '10s';
ALTER ROLE mcp_schrijver SET statement_timeout = '30s';
ALTER ROLE mcp_service   SET statement_timeout = '10s';

-- De read-only transactie in de Worker valt in een HTTP-driver geruisloos weg;
-- deze vorm werkt altijd en is daar het enige slot.
ALTER ROLE mcp_lezer SET default_transaction_read_only = on;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. LEZER — uitsluitend SELECT, per tabel
--
-- Nooit `ON ALL TABLES`: dat verleent ook op de beschermde tabellen, en het
-- is een momentopname die nieuwe tabellen niet dekt. En nooit
-- ALTER DEFAULT PRIVILEGES — daarmee zou een NIEUWE tabel automatisch rechten
-- krijgen, en dat ondergraaft precies de fail-safe waar de hele opzet op rust:
-- een nieuwe tabel hoort dicht te zijn, in de applicatielaag én in de database.
--
-- LET OP: dit is de vereniging over alle rollen. Mag één MCP-rol een tabel
-- lezen, dan heeft deze gedeelde lezer dat recht. Onderscheid per rol gebeurt
-- uitsluitend in de applicatielaag; de database garandeert het SOORT handeling,
-- niet welke tabel voor welke rol.
--
-- NIET in deze lijst (en dat is opzet): <gebruikerstabel>, mcp_rollen,
-- mcp_rechten, mcp_schrijfquota, en alles wat verder op de denylist in
-- src/database/beschermd.ts staat (sessies, tokens, sleutels). Die zijn voor
-- lezer en schrijver volledig gesloten — zij zijn de enige echte tweede laag
-- onder de queryanalyse.
--
-- VUL IN: elke bedrijfstabel en view die minstens één MCP-rol ooit mag lezen.
-- Hieronder staat het voorbeelddomein van de template — vervang het.
-- ───────────────────────────────────────────────────────────────────────────

GRANT SELECT ON
  klanten,
  contactpersonen,
  contactmomenten,
  projecten,
  taken,
  facturen,
  factuurregels,
  transacties,
  kostcategorieen,
  instellingen
TO mcp_lezer;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. SCHRIJVER — SELECT, INSERT en UPDATE, per tabel
--
-- Geen DELETE, geen TRUNCATE, geen DDL. Schrijven betekent in dit model
-- uitsluitend: rijen toevoegen en bestaande rijen bijwerken.
--
-- NIET in deze lijst: de tabellen in NOOIT_SCHRIJVEN (src/mcp.config.ts) —
-- daarop handelt de applicatie zelf (instellingen, nummerreeksen, wachtrijen,
-- webhooks, wettelijke documenten). En nooit een view: die is geen schrijfdoel.
--
-- ⚠ SELECT HOORT ERBIJ, en dat is niet vrijblijvend.
--
-- Postgres eist SELECT op elke kolom die je LEEST — ook binnen een
-- schrijfoperatie:
--
--   * UPDATE ... WHERE id = '...'   leest `id`      → SELECT nodig
--   * INSERT ... RETURNING id       leest `id`      → SELECT nodig
--
-- Omdat de poort een WHERE VERPLICHT stelt bij elke UPDATE, is zonder SELECT
-- geen enkele UPDATE mogelijk. Alleen een kale INSERT zonder RETURNING komt er
-- dan doorheen, en de gebruiker krijgt "Deze bewerking is niet toegestaan" —
-- de vertaling van Postgres' permission denied, niet van de poort.
--
-- Dit verruimt niets wat telt: mcp_lezer heeft SELECT op deze tabellen al, de
-- rolscheiding zit in de applicatielaag, en DELETE en DDL blijven onmogelijk.
--
-- VUL IN: elke bedrijfstabel waarop minstens één MCP-rol ooit mag schrijven.
-- ───────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON
  klanten,
  contactpersonen,
  contactmomenten,
  projecten,
  taken,
  transacties,
  kostcategorieen
TO mcp_schrijver;

-- Sequences: heeft een tabel een serial-/bigserial-kolom, dan vereist INSERT
-- ook USAGE op de bijbehorende sequence. Bij uuid-sleutels met
-- gen_random_uuid() of GENERATED … AS IDENTITY is dat niet nodig. Verleen
-- gericht op díé sequence — nooit `ON ALL SEQUENCES`:
--
--     GRANT USAGE ON SEQUENCE <tabel>_id_seq TO mcp_schrijver;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. SERVICE — de eigen huishouding van de Worker
--
-- Deze verbinding lost een knoop op die anders onoplosbaar is. De server moet
-- bij ÉLKE aanroep de rechten lezen, bij elke aanroep controleren dat de
-- beschermde tabelnamen nog bestaan, en de schrijfteller bijwerken — allemaal
-- op tabellen die voor lezer en schrijver volledig gesloten zijn.
--
-- Precies dat en niets meer. Er draait NOOIT een aangeleverde query op deze
-- verbinding; hij is alleen bereikbaar vanuit de eigen code van de server.
--
-- ⚠ GEEN UPDATE op mcp_rol_id of is_beheerder, en geen INSERT/UPDATE op
--   mcp_rollen of mcp_rechten: anders kon de server zichzelf promoveren.
-- ───────────────────────────────────────────────────────────────────────────

GRANT SELECT ON <gebruikerstabel>, mcp_rollen, mcp_rechten TO mcp_service;
-- De oid-binding bij de eerste login is de enige schrijfactie op de
-- gebruikerstabel. Heeft die tabel geen <updated_at>-kolom, schrap die dan hier
-- én zet GEBRUIKERS.updatedAtKolom op null in src/mcp.config.ts.
GRANT UPDATE (entra_oid, <updated_at>) ON <gebruikerstabel> TO mcp_service;
-- Ook hier is SELECT nodig: de reserveringsquery in quota.ts leest de teller
-- in haar WHERE-tak en geeft hem terug met RETURNING. Zonder SELECT faalt élke
-- reservering — en dus élke schrijfactie, nog vóór de query wordt uitgevoerd.
GRANT SELECT, INSERT, UPDATE ON mcp_schrijfquota TO mcp_service;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Functierechten: intrekken van PUBLIC, niet van de gebruikers
--
-- Postgres verleent EXECUTE op functies standaard aan PUBLIC. `REVOKE EXECUTE
-- ... FROM mcp_lezer` haalt daarom NIETS weg: het recht loopt via PUBLIC en
-- blijft gewoon bestaan. Wie die vorm opschrijft en afvinkt, levert een
-- systeem waarin elke SECURITY DEFINER-functie nog uitvoerbaar is.
--
-- Uitsluitend in public — niet in pg_catalog, want daar leven de operatoren en
-- casts waar élke query op steunt.
-- ───────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL ROUTINES  IN SCHEMA public FROM PUBLIC;

-- Geef het gericht terug aan wie het nodig heeft: de applicatie zelf.
-- ALTER DEFAULT PRIVILEGES geldt ALLEEN voor objecten die gemaakt worden door
-- de rol die dit commando uitvoert. Draaien je migraties onder een andere
-- gebruiker dan de eigenaar, dan krijgen nieuwe functies opnieuw EXECUTE aan
-- PUBLIC en is de maatregel stilletjes verlopen — stel het dan in voor díé rol.
-- Vervang <eigenaar> door de rol waarmee de applicatie en de migraties draaien.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO <eigenaar>;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. (Optioneel) Een bestaande, te ruime MCP-rol opruimen
--
-- Had de klant al een databaserol voor AI-toegang, bijvoorbeeld aangemaakt
-- met `GRANT SELECT ON ALL TABLES` en/of ALTER DEFAULT PRIVILEGES? Dan gaf die
-- leesrecht op de gebruikerstabel én zou hij elke nieuwe tabel automatisch
-- openzetten. Beide zijn nu verboden. Vervang <oude_rol> en draai:
-- ───────────────────────────────────────────────────────────────────────────

-- REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM <oude_rol>;
-- REVOKE ALL PRIVILEGES ON SCHEMA public FROM <oude_rol>;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM <oude_rol>;
-- REVOKE CONNECT ON DATABASE <database> FROM <oude_rol>;
-- DROP ROLE IF EXISTS <oude_rol>;
-- -- en daarna: pnpm exec wrangler secret delete <OUD_SECRET>

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. DE CONTROLEQUERY — draai deze na ÉLKE wijziging aan de databaserechten
--
-- Ze moet NUL rijen teruggeven. Staat er iets, dan is er een GRANT te ruim
-- gezet. Twee seconden werk, en het enige dat bewijst dat de belofte
-- "hier kan niets verdwijnen" nog geldt. (Meer controles: 03-controle.sql.)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee LIKE 'mcp\_%'
  AND privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

-- En deze moet bevestigen dat de beschermde tabellen onbereikbaar zijn voor
-- lezer en schrijver (verwacht: alleen mcp_service, en alleen SELECT plus
-- UPDATE op entra_oid/<updated_at> van de gebruikerstabel).
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee LIKE 'mcp\_%'
  AND table_name IN ('<gebruikerstabel>', 'mcp_rollen', 'mcp_rechten', 'mcp_schrijfquota')
ORDER BY grantee, table_name, privilege_type;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. DAARNA: de secrets zetten
--
-- Haal per rol de connection string op in de Neon-console (Connect → kies de
-- rol) en zet ze als Worker-secrets. Gebruik de POOLED host (-pooler).
--
--   cd mcp-server
--   pnpm exec wrangler secret put DATABASE_URL_LEZER
--   pnpm exec wrangler secret put DATABASE_URL_SCHRIJVER
--   pnpm exec wrangler secret put DATABASE_URL_SERVICE
--
-- Lokaal komen dezelfde drie in mcp-server/.dev.vars.
--
-- ⚠ De Worker WEIGERT elke tool-aanroep zolang een van deze drie ontbreekt.
--    Dat is opzet: falen is luid en dicht, nooit stil en open.
--
-- ⚠ Dit bestand is de enige bron van waarheid voor deze rechten: heb je SQL
--    uitgevoerd die hier niet in staat, zet ze er dan in dezelfde wijziging bij.
-- ═══════════════════════════════════════════════════════════════════════════
