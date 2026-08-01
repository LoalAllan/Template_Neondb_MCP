# <Bedrijfsapp> — MCP-rechtenlogboek

> **Sjabloon.** Hernoem dit bestand naar de naam van de applicatie (bv. `Memoran_MCP_rules.md`) en vervang `<Bedrijfsapp>` overal door die naam. Vul daarna sectie A en B in.
>
> Dit bestand is de administratie van het rechtenmodel van de MCP-server. De regels waaraan het moet voldoen staan in [`mcp-rechten.md`](mcp-rechten.md). **Elke wijziging aan rollen, tabellen of `GRANT`'s wordt hier vastgelegd — een wijziging is pas af als dat gebeurd is.**

## Omgeving

| | |
|---|---|
| Applicatie | `<Bedrijfsapp>` |
| MCP-server | `mcp-server/` in deze repo |
| Worker-URL | `https://<worker>.<subdomein>.workers.dev/mcp` |
| Cloudflare-account | `<account-naam>` — account-ID `<...>` |
| Azure App Registration | `<naam>` — client-ID `<...>`, tenant-ID `<...>` |
| Neon-project | `<projectnaam>` — database `<db>` |
| Gebruikerstabel | `<tabel>.<email-kolom>` / rolkolom `<rol-kolom>` |

---

## A. Actuele rechtenmatrix

> De stand van nu. Werk deze tabel bij bij élke wijziging; de changelog eronder vertelt hoe we hier gekomen zijn.
>
> Maximaal 4 rollen. Elke rol heeft `lijst_tabellen` en `lees_query`; een rol met `toevoegen` of `wijzigen` heeft daarnaast `voer_sql_uit`. Er zijn geen andere tools.
>
> `DELETE`, `TRUNCATE`, `DROP`, `CREATE` en `ALTER` zijn voor geen enkele rol mogelijk — dat staat niet in deze tabel omdat het nooit anders kan zijn.

| Rol | Naam | Postgres-rol | Secret | Tools | Rechten | `GRANT` in Neon | Toegestane tabellen |
|---|---|---|---|---|---|---|---|
| 1 | `<naam>` | `mcp_rol1` | `DATABASE_URL_ROL_1` | 2 | `lezen` | `SELECT` | `<tabel>`, `<tabel>` |
| 2 | `<naam>` | `mcp_rol2` | `DATABASE_URL_ROL_2` | 3 | `toevoegen` | `SELECT, INSERT` | `<tabel>`, `<tabel>`, `<tabel>` |
| 3 | `<naam>` | `mcp_rol3` | `DATABASE_URL_ROL_3` | 3 | `wijzigen` | `SELECT, INSERT, UPDATE` | `<tabel>`, ... |
| 4 | — | — | — | — | — | — | *(vrij — dit is de laatste beschikbare rol)* |

Geen van de rollen is eigenaar van een tabel, en bij alle rollen is `CREATE ON SCHEMA public` ingetrokken.

### Wat elke rol bewust NIET ziet

Expliciet opschrijven wat er ontbreekt ten opzichte van de volledige tabellijst van de database. Dit is de belangrijkste controle: een tabel die hier nergens genoemd wordt, is per ongeluk overal toegankelijk of nergens.

| Rol | Geen toegang tot | Reden |
|---|---|---|
| 1 | `<tabel>`, `<tabel>` | `<waarom>` |
| 2 | `<tabel>` | `<waarom>` |
| 3 | `<tabel>` | `<waarom>` |
| *alle rollen* | `<gebruikerstabel>` | rolbeheer — voorkomt dat een schrijfrol zijn eigen rol ophoogt |

### Tabellen zonder enige MCP-toegang

Tabellen die in de database bestaan maar aan geen enkele MCP-rol zijn toegekend. Houd deze lijst bij, anders sluipt er ongemerkt toegang in.

- `<tabel>` — `<waarom niet>`

---

## B. Changelog

> Append-only: nieuwste bovenaan. Bestaande regels worden nooit aangepast of verwijderd — een correctie is een nieuwe regel.

### JJJJ-MM-DD — `<korte titel van de wijziging>`

| | |
|---|---|
| Door | `<naam of agent>` |
| Rol(len) | `<rolnummer(s)>` |
| Wijziging | `<wat er precies veranderd is>` |
| Reden | `<waarom, en op wiens verzoek>` |

Uitgevoerde SQL in Neon:

```sql
-- exact wat er gedraaid is, inclusief eventuele REVOKE's
GRANT SELECT ON <tabel> TO mcp_rol2;
```

Bijbehorende wijzigingen:

- [ ] `mcp-server/src/rollen.config.ts` bijgewerkt (`tabellen` én `rechten`)
- [ ] secret gezet/verwijderd (`wrangler secret put` / `delete`)
- [ ] sectie A hierboven bijgewerkt
- [ ] geverifieerd met `lijst_tabellen` als een gebruiker met deze rol
- [ ] controlequery gedraaid: geen `DELETE`/`TRUNCATE`-rechten blijven staan

---

### JJJJ-MM-DD — Eerste inrichting

| | |
|---|---|
| Door | `<naam>` |
| Rol(len) | 1 t/m `<n>` |
| Wijziging | MCP-server opgezet met `<n>` rollen zoals in sectie A |
| Reden | initiële uitrol van de MCP-connector voor `<Bedrijfsapp>` |

```sql
CREATE ROLE mcp_rol1 LOGIN PASSWORD '<...>';
GRANT USAGE ON SCHEMA public TO mcp_rol1;
REVOKE CREATE ON SCHEMA public FROM mcp_rol1;
GRANT SELECT ON projecten, taken TO mcp_rol1;
-- enz. per rol; nergens DELETE of TRUNCATE, nergens eigenaarschap
```
