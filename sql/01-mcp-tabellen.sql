-- ═══════════════════════════════════════════════════════════════════════════
-- 01 — De tabellen van het MCP-rechtenmodel (migratiesjabloon)
--
-- ⚠ DIT IS EEN REFERENTIE, GEEN SCRIPT OM LOS TE DRAAIEN.
--
-- De klant beheert zijn schema met Drizzle. Zet de tabellen, de enum en de
-- drie gebruikerskolommen in het Drizzle-schema van de klant (zie
-- docs/referentie-app/drizzle-schema.ts), genereer de migratie met drizzle-kit,
-- en vergelijk de gegenereerde SQL met wat hieronder staat: dezelfde tabellen,
-- kolommen, ON DELETE-regels en de unieke index. Voeg daarna de COMMENT
-- ON-regels hieronder met de hand toe aan de gegenereerde migratie — Drizzle
-- genereert die niet. Draai de migratie zoals de klant dat altijd doet, als de
-- EIGENAAR van de database, nooit als een van de MCP-gebruikers.
--
-- Vervang <gebruikerstabel> door de naam van de bestaande gebruikerstabel van
-- de applicatie (dezelfde naam als GEBRUIKERS.tabel in src/mcp.config.ts).
-- Heeft die tabel al een kolom die zo heet, of een ander rechtenveld voor
-- MCP-toegang, dan is dat een beslissing voor de eigenaar — niet stilzwijgend
-- hernoemen.
--
-- WAT DIT DOET
--   • mcp_rollen        — een rol is een benoemde verzameling tabelrechten
--   • mcp_rechten       — één rij per (rol × tabel) waar toegang IS verleend;
--                         geen rij = geen toegang → nieuwe tabellen zijn
--                         automatisch dicht voor elke rol
--   • mcp_schrijfquota  — de cumulatieve schrijfteller per rol
--   • <gebruikerstabel> — krijgt drie kolommen erbij: entra_oid (de
--                         onveranderlijke koppelsleutel), mcp_rol_id (NULL =
--                         geen toegang) en is_beheerder (wie rechten mag uitdelen)
--
-- WAT DIT BEWUST NIET DOET
--   • geen enkele INSERT in mcp_rechten: iedereen begint dicht, en de
--     beheerder bouwt de rechten daarna bewust op in het rechtenscherm;
--   • geen GRANT's: die staan in 02-mcp-neon-rollen.sql (eenmalig) en, voor
--     élke nieuwe bedrijfstabel, in de migratie die die tabel aanmaakt;
--   • geen eerste beheerder: zie de opdracht (docs/opdracht-app-kant.md, §7)
--     voor de eenmalige bootstrap via MCP_EERSTE_BEHEERDER_OID.
--
-- De COMMENT ON-regels zijn geen versiering: de MCP-server toont
-- kolomcommentaar aan het AI-model, en het rechtenscherm toont het aan de
-- beheerder. Neem ze over.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TYPE mcp_recht_niveau AS ENUM ('lezen', 'schrijven');

CREATE TABLE mcp_rollen (
	id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	naam         text NOT NULL UNIQUE,
	omschrijving text,
	versie       integer NOT NULL DEFAULT 1,
	created_at   timestamptz NOT NULL DEFAULT now(),
	updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mcp_rechten (
	id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	rol_id     uuid NOT NULL REFERENCES mcp_rollen (id) ON DELETE CASCADE,
	tabelnaam  text NOT NULL,
	niveau     mcp_recht_niveau NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX mcp_rechten_rol_tabel_idx ON mcp_rechten (rol_id, tabelnaam);

CREATE TABLE mcp_schrijfquota (
	rol_id        uuid PRIMARY KEY REFERENCES mcp_rollen (id) ON DELETE CASCADE,
	rijen         integer NOT NULL DEFAULT 0,
	venster_start timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE <gebruikerstabel>
	ADD COLUMN entra_oid    text UNIQUE,
	ADD COLUMN mcp_rol_id   uuid REFERENCES mcp_rollen (id) ON DELETE RESTRICT,
	ADD COLUMN is_beheerder boolean NOT NULL DEFAULT false;

-- ───────────────────────────────────────────────────────────────────────────
-- Commentaar — wat de database zelf over deze tabellen vertelt
-- ───────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE mcp_rollen IS
	'MCP-rechtenmodel: een rol is een benoemde verzameling tabelrechten, aangemaakt door een beheerder in het rechtenscherm van de applicatie. VEILIGHEIDSKRITISCH: deze tabel staat op de gehardcodeerde denylist van de MCP-server en is voor geen enkele MCP-rol leesbaar of schrijfbaar.';
COMMENT ON COLUMN mcp_rollen.naam IS
	'Unieke, door de beheerder gekozen naam van de rol (bv. "Sales lezen").';
COMMENT ON COLUMN mcp_rollen.omschrijving IS
	'Vrije tekst: waarvoor deze rol dient. Puur informatief.';
COMMENT ON COLUMN mcp_rollen.versie IS
	'Gaat bij elke publicatie van rechten met één omhoog. Nodig om gelijktijdig bewerken te herkennen: omdat "geen toegang" de afwezigheid van een rij is, laat een ingetrokken recht geen spoor na.';

COMMENT ON TABLE mcp_rechten IS
	'MCP-rechtenmodel: een rij per (rol x tabel) waar toegang IS verleend. Geen rij = geen toegang; daardoor is een nieuwe tabel automatisch gesloten voor elke rol. VEILIGHEIDSKRITISCH: staat op de denylist van de MCP-server.';
COMMENT ON COLUMN mcp_rechten.rol_id IS
	'De rol die dit recht draagt. Cascade: een rol verwijderen ruimt zijn rechten mee op, zodat er nooit een verweesd recht blijft staan.';
COMMENT ON COLUMN mcp_rechten.tabelnaam IS
	'Naam van de tabel of view in het toepassingsschema, als platte tekst. Bewust GEEN verwijzing naar een catalogus: wordt een tabel hernoemd, dan wijst het recht nergens meer naar en vervalt de toegang. Dat is de gewenste richting van falen.';
COMMENT ON COLUMN mcp_rechten.niveau IS
	'lezen of schrijven. Er bestaat bewust geen waarde voor "geen toegang" - dat is de afwezigheid van de rij. Schrijven impliceert lezen op diezelfde tabel en betekent uitsluitend INSERT en UPDATE; DELETE bestaat in dit model niet.';

COMMENT ON TABLE mcp_schrijfquota IS
	'Cumulatieve schrijfteller per MCP-rol met een voortschrijdend tijdvenster. Een grens per statement is geen grens als je hem tweehonderd keer herhaalt. Staat bewust in de database en niet in het geheugen: de MCP-server draait op Cloudflare Workers, waar een teller in het geheugen bij elke aanroep weer nul is. VEILIGHEIDSKRITISCH: staat op de denylist.';
COMMENT ON COLUMN mcp_schrijfquota.rijen IS
	'Aantal gereserveerde/gewijzigde rijen binnen het huidige venster. Alleen de smalle serviceverbinding van de MCP-server werkt dit bij.';
COMMENT ON COLUMN mcp_schrijfquota.venster_start IS
	'Begin van het huidige tijdvenster; is het venster verlopen, dan begint de teller opnieuw bij nul.';

COMMENT ON COLUMN <gebruikerstabel>.entra_oid IS
	'Microsoft Entra object-id (claim oid) - de onveranderlijke matching-sleutel van de MCP-server. Wordt bij de eerste geslaagde login eenmalig vastgelegd op de rij die op e-mail matcht; daarna is de oid leidend. E-mail is hiervoor ongeschikt: dat is in Entra te wijzigen en opnieuw uit te geven.';
COMMENT ON COLUMN <gebruikerstabel>.mcp_rol_id IS
	'De MCP-rol van deze gebruiker; NULL = geen MCP-toegang (de standaard voor elke nieuwe gebruiker). De rol wordt bij elke tool-aanroep vers gelezen, zodat een ingetrokken recht onmiddellijk geldt.';
COMMENT ON COLUMN <gebruikerstabel>.is_beheerder IS
	'Mag deze gebruiker MCP-rollen en -rechten beheren? Staat los van de MCP-rol: beheerder zijn zegt wie instelt, de rol zegt wat een model mag. Wordt bij ELKE beheeractie server-side uit de database gelezen, nooit uit een token of sessie. De laatste beheerder kan zichzelf niet degraderen.';
