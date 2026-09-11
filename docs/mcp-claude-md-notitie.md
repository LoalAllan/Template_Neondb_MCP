# Notitie voor `CLAUDE.md` (handmatig toe te voegen)

`CLAUDE.md` mag alleen door jou gewijzigd worden — vandaar dit losse bestand.
Plak onderstaand blok in de sectie **"On demand Rules"**, direct onder de regel
over de eigen MCP-server, en verwijder daarna dit bestand.

---

**MCP-rechten → skill `mcp-rechten`** (`.claude/skills/mcp-rechten/`). Laad die skill vóór
élke migratie of schemawijziging, vóór elke wijziging in `mcp-server/`, en bij elke vraag over wat
een MCP-rol mag zien of doen. Kern: deny-by-default per rol per tabel, **nooit DELETE, nooit DDL**,
voor geen enkele rol. Nieuwe tabellen zijn automatisch gesloten, maar de `GRANT` hoort in de
migratie. Er is geen apart logboek meer; `docs/mcp-neon-rollen.sql` is de bron van waarheid voor de
databaserechten.

---

## En vervang deze regel (de oude beschrijving klopt niet meer)

Zoek in de sectie "On demand Rules" naar het blok dat begint met
**"Eigen MCP-server → `mcp-server/`"**. De laatste zin daarvan luidt nu:

> Toegang per gebruiker via tabel `gebruikers` (kolom `mcp_rol`: 0 = geen, 1 = gebruiker/lezen,
> 2 = admin), beheerd in de UI op **/instellingen**; de server leest de rol bij elke nieuwe sessie
> vers uit de database.

Dat rolmodel bestaat niet meer (de kolom `mcp_rol` is verwijderd). Vervang die zin door:

> Toegang per gebruiker via tabel `gebruikers` (kolom `mcp_rol_id` → `mcp_rollen`; NULL = geen
> toegang), beheerd in de UI op **/instellingen**. De server koppelt op de onveranderlijke
> Entra-`oid` en leest de rechten bij **élke tool-aanroep** vers uit de database, zodat een
> ingetrokken recht onmiddellijk geldt.
