-- ═══════════════════════════════════════════════════════════════════════════
-- MCP-databasegebruikers voor Memoran — draai dit als `neondb_owner`
-- in de Neon-console (SQL Editor), project hidden-truth-62447186.
--
-- WAAROM DIT BESTAAT
-- De handhaving van het MCP-rechtenmodel heeft twee dimensies, en ze liggen
-- bewust op verschillende plekken:
--
--   • WELKE TABELLEN een rol mag raken, is applicatiedata: dat staat in
--     mcp_rechten en je klikt het in /instellingen. Dat moet wel — wie rollen
--     aanmaakt, kan geen databaserollen en connection strings aanmaken.
--
--   • WELKE OPERATIES überhaupt mogelijk zijn, staat hier, in de database.
--     Deze gebruikers hebben simpelweg geen DELETE, geen TRUNCATE, geen
--     eigenaarschap en geen recht om objecten aan te maken. Geen enkele fout
--     in de applicatiecode kan daar iets aan veranderen.
--
-- Die tweede dimensie is wat de belofte "hier kan niets verdwijnen" overeind
-- houdt, ook als de queryanalyse in de Worker ooit een gat blijkt te hebben.
--
-- VOORAF: vervang de drie wachtwoorden hieronder door sterke, willekeurige
-- waarden. Kies ALFANUMERIEK (geen leestekens) — dat scheelt URL-encoding-gedoe
-- in de connection string.
--
-- ⚠ VUL ZE HIER NIET IN. Dit bestand staat in git. Maak een kopie BUITEN de
--   repo, vul die in, en gooi hem weg zodra de Worker-secrets gezet zijn. Eén
--   keer vergeten te wissen vóór een commit en de wachtwoorden staan permanent
--   in de historie.
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
--     GRANT SELECT, INSERT, UPDATE ON <tabel> TO mcp_schrijver;  -- als het mag
--
-- Let op dat SELECT ook in die tweede regel staat: Postgres eist het voor elke
-- kolom die een UPDATE of RETURNING leest. Laat je het weg, dan is geen enkele
-- UPDATE op die tabel mogelijk.
--
-- en werk de lijsten in §3 en §4 hieronder bij, zodat dit bestand een database
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

GRANT CONNECT ON DATABASE neondb TO mcp_lezer, mcp_schrijver, mcp_service;

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
-- de database leest een andere.
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
-- NIET in deze lijst (en dat is opzet): gebruikers, mcp_rollen, mcp_rechten,
-- mcp_schrijfquota. Die vier zijn voor lezer en schrijver volledig gesloten —
-- zij zijn de enige echte tweede laag onder de queryanalyse.
-- ───────────────────────────────────────────────────────────────────────────

GRANT SELECT ON
  activities,
  bedrijfsprofiel,
  companies,
  company_types,
  contacts,
  content_posts,
  cost_categories,
  forecast_items,
  operations_columns,
  operations_notes,
  operations_tasks,
  peppol_documents,
  peppol_registrations,
  peppol_webhook_events,
  projects,
  sales_invoice_lines,
  sales_invoices,
  sync_runs,
  termijnvisie_notes,
  transactions,
  video_notes,
  videos
TO mcp_lezer;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. SCHRIJVER — uitsluitend INSERT en UPDATE, per tabel
--
-- Geen DELETE, geen TRUNCATE, geen DDL. Schrijven betekent in dit model
-- uitsluitend: rijen toevoegen en bestaande rijen bijwerken.
--
-- Zeven tabellen ontbreken bewust, want daarop handelt de applicatie zelf
-- (zie MCP_NOOIT_SCHRIJVEN in de code): bedrijfsprofiel (de afzender op élke
-- factuur), peppol_registrations, peppol_webhook_events (dedup), 
-- peppol_documents (ubl_xml is het wettelijke origineel), sales_invoices +
-- sales_invoice_lines (verstuurde facturen en de nummerreeks) en sync_runs.
--
-- ⚠ SELECT HOORT ERBIJ, en dat is niet vrijblijvend.
--
-- Hier stond eerst "SELECT heeft de schrijver niet nodig: leesqueries lopen
-- altijd via mcp_lezer". Dat is onjuist, en het brak élke schrijfactie.
-- Postgres eist SELECT op elke kolom die je LEEST — ook binnen een
-- schrijfoperatie:
--
--   * UPDATE ... WHERE id = '...'   leest `id`      → SELECT nodig
--   * INSERT ... RETURNING id       leest `id`      → SELECT nodig
--
-- Omdat de poort een WHERE VERPLICHT stelt bij elke UPDATE, was zonder SELECT
-- geen enkele UPDATE mogelijk. Alleen een kale INSERT zonder RETURNING kwam er
-- doorheen. De melding die de gebruiker kreeg was "Deze bewerking is niet
-- toegestaan" — de vertaling van Postgres' permission denied, niet van de poort.
--
-- Dit verruimt niets wat telt: mcp_lezer heeft SELECT op deze tabellen al, de
-- rolscheiding zit in de applicatielaag, en DELETE en DDL blijven onmogelijk.
-- ───────────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON
  activities,
  companies,
  company_types,
  contacts,
  content_posts,
  cost_categories,
  forecast_items,
  operations_columns,
  operations_notes,
  operations_tasks,
  projects,
  termijnvisie_notes,
  transactions,
  video_notes,
  videos
TO mcp_schrijver;

-- Sequences: alle primaire sleutels zijn uuid met gen_random_uuid(), dus er is
-- geen enkele serial-achtige standaardwaarde en dus geen USAGE ON SEQUENCE
-- nodig. Komt er ooit een serial-kolom bij, verleen dan gericht op díé
-- sequence — nooit op alle.

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
-- ───────────────────────────────────────────────────────────────────────────

GRANT SELECT ON gebruikers, mcp_rollen, mcp_rechten TO mcp_service;
-- De oid-binding bij de eerste login is de enige schrijfactie op gebruikers.
GRANT UPDATE (entra_oid, updated_at) ON gebruikers TO mcp_service;
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
--
-- Vandaag staan er geen eigen functies in public. Deze regels zijn er voor het
-- moment dat die er wél komen.
-- ───────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL ROUTINES  IN SCHEMA public FROM PUBLIC;

-- Geef het gericht terug aan wie het nodig heeft: de applicatie zelf.
-- ALTER DEFAULT PRIVILEGES geldt ALLEEN voor objecten die gemaakt worden door
-- de rol die dit commando uitvoert. Draaien je migraties onder een andere
-- gebruiker dan neondb_owner, dan krijgen nieuwe functies opnieuw EXECUTE aan
-- PUBLIC en is de maatregel stilletjes verlopen — stel het dan in voor díé rol.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO neondb_owner;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. De oude rol opruimen
--
-- mcp_readonly is aangemaakt met `GRANT SELECT ON ALL TABLES` + ALTER DEFAULT
-- PRIVILEGES. Dat gaf leesrecht op gebruikers (inclusief de rolniveaus) én zou
-- elke nieuwe tabel automatisch openzetten. Beide zijn nu verboden.
-- ───────────────────────────────────────────────────────────────────────────

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM mcp_readonly;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM mcp_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM mcp_readonly;
REVOKE CONNECT ON DATABASE neondb FROM mcp_readonly;
DROP ROLE IF EXISTS mcp_readonly;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. DE CONTROLEQUERY — draai deze na ÉLKE wijziging aan de databaserechten
--
-- Ze moet NUL rijen teruggeven. Staat er iets, dan is er een GRANT te ruim
-- gezet. Twee seconden werk, en het enige dat bewijst dat de belofte
-- "hier kan niets verdwijnen" nog geldt.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee LIKE 'mcp\_%'
  AND privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

-- En deze moet bevestigen dat de beschermde tabellen onbereikbaar zijn voor
-- lezer en schrijver (verwacht: alleen mcp_service, en alleen SELECT plus
-- UPDATE op gebruikers.entra_oid).
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee LIKE 'mcp\_%'
  AND table_name IN ('gebruikers', 'mcp_rollen', 'mcp_rechten', 'mcp_schrijfquota')
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
--   pnpm exec wrangler secret delete DATABASE_URL_READONLY
--
-- Lokaal komen dezelfde drie in mcp-server/.dev.vars.
--
-- ⚠ De Worker WEIGERT elke tool-aanroep zolang een van deze drie ontbreekt.
--    Dat is opzet: falen is luid en dicht, nooit stil en open.
--
-- ⚠ Dit bestand is de enige bron van waarheid voor deze rechten: heb je SQL
--    uitgevoerd die hier niet in staat, zet ze er dan in dezelfde wijziging bij.
-- ═══════════════════════════════════════════════════════════════════════════
