# Notitie voor de `CLAUDE.md` van de klantrepo

> **Voor de AI-agent die de template installeert:** de `CLAUDE.md` van de klant is van de
> eigenaar. Wijzig hem niet ongevraagd. Stel onderstaande twee blokken **voor** aan de eigenaar
> (in je oplevering, met dit bestand als bijlage) en laat hem beslissen waar ze landen —
> doorgaans in een sectie met "on demand"-regels of naast de andere projectregels. Verwijder dit
> bestand daarna uit `mcp-server/docs/`.
>
> Vervang `<gebruikerstabel>` door de echte naam en `<pad naar het rechtenscherm>` door de route in
> de app.

---

**Eigen MCP-server → `mcp-server/`** — remote MCP-server van deze applicatie (Cloudflare Worker,
Microsoft Entra ID-login single-tenant, Streamable HTTP op `/mcp`). Zelfstandig **pnpm**-project,
los van de app; lees vóór élke wijziging daar **`mcp-server/CLAUDE.md`**. Toegang per gebruiker via
tabel `<gebruikerstabel>` (kolom `mcp_rol_id` → `mcp_rollen`; NULL = geen toegang), beheerd in het
rechtenscherm op **`<pad naar het rechtenscherm>`** door gebruikers met `is_beheerder`. De server
koppelt op de onveranderlijke Entra-`oid` en leest de rechten bij **élke tool-aanroep** vers uit de
database, zodat een ingetrokken recht onmiddellijk geldt.

**MCP-rechten → skill `mcp-rechten`** (`.claude/skills/mcp-rechten/`). Laad die skill vóór
élke migratie of schemawijziging, vóór elke wijziging in `mcp-server/`, vóór elke wijziging aan het
rechtenscherm of de publiceer-actie, en bij elke vraag over wat een MCP-rol mag zien of doen. Kern:
deny-by-default per rol per tabel, **nooit DELETE, nooit DDL**, voor geen enkele rol. Nieuwe
tabellen zijn automatisch gesloten, maar de `GRANT` hoort in de migratie. Er is geen apart
logboek; `mcp-server/sql/02-mcp-neon-rollen.sql` is de bron van waarheid voor de databaserechten.

**Database-commentaar** — geef elke nieuwe tabel en kolom een `COMMENT ON` in de migratie. De
MCP-server toont dat commentaar aan het AI-model, en het rechtenscherm aan de beheerder; zonder
commentaar raden ze allebei.
