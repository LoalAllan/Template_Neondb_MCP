# CLAUDE.md — Gids voor AI coding agents

Dit bestand is de handleiding voor AI-agents (en developers) die aan deze MCP-server werken. Lees het volledig voordat je code wijzigt.

> **Lees eerst het regelbestand.** Alles wat met rollen, tabellen en rechten te maken heeft, valt onder [`.claude/rules/mcp-rechten.md`](.claude/rules/mcp-rechten.md). Dat bestand is bindend en gaat vóór wat hier staat. Kernpunten: **maximaal 3 tools per rol**, **maximaal 4 rollen**, **nooit verwijderen of structuurwijzigingen**, en **elke rechtenwijziging wordt gelogd** in `.claude/rules/<Bedrijfsapp>_MCP_rules.md`.

## Projectoverzicht

Deze repo is een **template**. Hij wordt per klant geïntegreerd in de codebase van een bedrijfs- of CRM-applicatie, als submap `mcp-server/`. Elke klant krijgt zo een eigen remote MCP-server op zijn eigen Cloudflare-account, die praat met de Neon-database van zijn applicatie.

Login via Microsoft Entra ID (single-tenant, de tenant van de klant), autorisatie via een rolnummer in de gebruikerstabel van de Neon-database, transport **uitsluitend Streamable HTTP** op `/mcp`.

**Dataflow:**

```
MCP-client → POST /mcp (Bearer-token)
  → OAuthProvider (src/index.ts, export default): token valideren, props ontsleutelen
  → MyMCP Durable Object (src/index.ts): init() draait 1× per sessie
      → zoekGebruikerOpEmail() → rolnummer vers uit Neon (auth-verbinding)
      → isGeldigeRol() → onbekend nummer = geen toegang
      → registreerAlleTools(server, env, props, rol) → de 2 of 3 tools van die rol
  → tool-handlers → Neon via withRolDatabase(env, rol, ...) → de verbinding van díé rol
```

**Bestanden:**

| Bestand | Rol |
|---|---|
| `src/index.ts` | Entrypoint: `MyMCP` (McpAgent/Durable Object) + `OAuthProvider`-wiring |
| `src/rollen.config.ts` | ⭐ De rollen, hun tabellen en hun secrets — het enige config-bestand |
| `src/types.ts` | `Props` (identiteit uit het token; bevat bewust GEEN rol) en `GebruikerRij` |
| `src/auth/entra-handler.ts` | Hono-app: `/authorize`, `/callback` (poortwachter), `/` |
| `src/auth/entra.ts` | Entra-endpoints: authorize-URL, code-inwisseling, id_token-decodering |
| `src/auth/goedkeuring.ts` | Goedkeuringsdialoog + HMAC-ondertekend cookie + `sanitizeHtml` |
| `src/database/verbinding.ts` | `getDb()`/`withDatabase()` (auth) en `getRolDb()`/`withRolDatabase()` (per rol) |
| `src/database/gebruikers.ts` | `zoekGebruikerOpEmail()`, `haalHuidigeRol()` |
| `src/database/veiligheid.ts` | `valideerLeesQuery()`, `valideerSchrijfStatement()` — allowlist van statementsoorten |
| `src/tools/sql-tools.ts` | De drie tools: `lijst_tabellen`, `lees_query`, `voer_sql_uit` |
| `src/tools/register-tools.ts` | Tool-registry — er komen hier geen tools bij |
| `src/utils/antwoorden.ts` | `createSuccessResponse`, `createErrorResponse`, `formatDatabaseError` |
| `.claude/rules/mcp-rechten.md` | ⭐ Bindende regels voor het rechtenmodel |
| `.claude/rules/Bedrijfsapp_MCP_rules.md` | Sjabloon voor het rechtenlogboek per klant |

## Kernprincipes

**BELANGRIJK: pas deze principes toe bij ELKE codewijziging:**

### KISS (Keep It Simple, Stupid)

- Eenvoud is een expliciet ontwerpdoel.
- Kies waar mogelijk de rechttoe-rechtaan-oplossing boven de complexe.
- Eenvoudige oplossingen zijn makkelijker te begrijpen, te onderhouden en te debuggen.

### YAGNI (You Aren't Gonna Need It)

- Bouw geen functionaliteit op speculatie.
- Implementeer features pas wanneer ze nodig zijn, niet wanneer je verwacht dat ze ooit nuttig zouden kunnen worden.

### Open/Closed-principe

- Software-onderdelen moeten open zijn voor uitbreiding, maar gesloten voor wijziging.
- In dit project betekent dat concreet: een nieuwe klant of een nieuwe rol vraagt om een entry in `ROLLEN` plus `GRANT`'s in Neon — niet om nieuwe code.

## Package management & tooling

**CRUCIAAL: dit project gebruikt pnpm (níét npm) voor Node.js-packagebeheer en de Wrangler CLI voor Cloudflare Workers-ontwikkeling.**

- Installeer dependencies uitsluitend met `pnpm install`; commit nooit een `package-lock.json` of `yarn.lock` naast de `pnpm-lock.yaml`.
- Draai Wrangler altijd via het project (`pnpm run <script>` of `pnpm exec wrangler ...`), nooit via een los geïnstalleerde globale versie.
- **`wrangler login` is interactief en laat je hangen.** Gebruik als agent een API-token in `CLOUDFLARE_API_TOKEN` — zie README, stap 5c.

## Commando's

```bash
pnpm install         # dependencies installeren (dit project gebruikt pnpm!)
pnpm run dev         # dev-server op http://localhost:8792
pnpm run type-check  # tsc --noEmit — draai dit na ELKE wijziging
pnpm run deploy      # wrangler deploy — LET OP: altijd `pnpm run deploy`,
                     # want `pnpm deploy` (zonder run) is een ingebouwd pnpm-commando
pnpm run cf-typegen  # types hergenereren na wijzigingen in wrangler.jsonc
pnpm exec wrangler tail             # live logs van de gedeployde Worker
pnpm exec wrangler secret put <NAAM>  # secret in productie zetten
```

## Het rolmodel: scopes, geen niveaus

Dit is het belangrijkste ontwerpbesluit van de template.

**Rollen zijn niet hiërarchisch.** Rol 2 is niet "meer" dan rol 1; rechten tellen nooit op. Elke rol is een eigen, afgesloten scope met een eigen database-verbinding.

Elke rol krijgt **dezelfde toolnamen**: `lijst_tabellen`, `lees_query` en — zodra `rechten` niet `"lezen"` is — `voer_sql_uit`. Nooit varianten per rol. Zou een gebruiker meerdere query-tools naast elkaar zien, dan kan de AI-client niet meer verklaren waarom een tabel in de ene tool wél en in de andere niet bestaat.

Wat een rol met data mag, staat in `RolConfig.rechten`:

| Waarde | Mag | `GRANT` in Neon |
|---|---|---|
| `lezen` | `SELECT` — onbeperkt lezen en analyseren | `SELECT` |
| `toevoegen` | + nieuwe rijen toevoegen | `SELECT, INSERT` |
| `wijzigen` | + bestaande rijen bijwerken | `SELECT, INSERT, UPDATE` |

`DELETE`, `TRUNCATE`, `DROP`, `CREATE` en `ALTER` staan hier bewust niet tussen: die zijn voor **geen enkele rol** mogelijk. Gebruik `magSchrijven(config.rechten)` in plaats van op de stringwaarde te vergelijken.

Er is dus **geen `heeftNiveau()` meer** en geen `MIN_NIVEAU` per tool. Vergelijk rollen altijd op **gelijkheid**, nooit met `>=`:

```ts
// ✅ correct — de rol kan tijdens de sessie gewijzigd zijn
if ((await haalHuidigeRol(env, props.email)) !== rol) { ... }

// ❌ fout — suggereert een hiërarchie die niet bestaat
if (rol >= 2) { ... }
```

Het rolnummer komt bij elke **nieuwe sessie** vers uit de database (`MyMCP.init`), zodat een rolwijziging doorwerkt zonder her-login. Voor `voer_sql_uit` gebeurt er bovendien per aanroep een live her-check.

## Waar de beveiliging zit

In deze volgorde van belang:

1. **`GRANT`'s in Neon.** Elke rol heeft een eigen Postgres-rol met rechten op precies de toegestane tabellen, en dus een eigen connection string (secret `DATABASE_URL_ROL_n`). Alles daarbuiten weigert Postgres zelf. Hier zit de echte grens. Drie eigenschappen maken verwijderen en structuurwijzigingen samen onmogelijk: geen `DELETE`/`TRUNCATE`-recht, geen eigenaarschap van de tabellen (een eigenaar kan altijd `DROP` en `ALTER`), en geen `CREATE` op het schema.
2. **De `READ ONLY`-transactie** waarin `lees_query` draait: ook een rol mét schrijfrechten kan er niets mee wijzigen.
3. **De allowlist** in `src/database/veiligheid.ts` — `valideerLeesQuery()` en `valideerSchrijfStatement()`. Die laten alleen `SELECT`, `WITH`, `INSERT` en (bij `wijzigen`) `UPDATE` door en weigeren al de rest op naam, mét uitleg. `normaliseerVoorAnalyse()` strookt eerst commentaar en stringliterals weg — anders glipt `-- x⏎DELETE FROM …` erdoor en geeft een onschuldige `WHERE tekst = 'graag verwijderen'` vals alarm. Dit is een vangnet dat een verkeerd gezette `GRANT` niet meteen fataal maakt, geen vervanging van laag 1.

De lijst `tabellen` in `rollen.config.ts` is **beschrijvend**: hij vult de tool-beschrijvingen. Twijfel je of hij klopt? Roep `lijst_tabellen` aan — die leest de werkelijke rechten uit `information_schema`.

De **auth-verbinding** (`DATABASE_URL`) staat hier los van: die leest alleen de gebruikerstabel, en geen enkele MCP-rol heeft daar een `GRANT` op. Anders kon een schrijfrol zijn eigen rolnummer ophogen.

## Recept: rechten van een rol wijzigen

Dit is wat je in dit project het vaakst doet. Er komt geen code bij kijken behalve één regel config.

1. **Scope bepalen** — welke tabellen, lezen of ook schrijven. Vraag het als het niet expliciet is opgedragen.
2. **In Neon:** `GRANT` of `REVOKE` op de Postgres-rol. Noteer de exacte SQL.
3. **Secret zetten** als het om een nieuwe rol gaat: `pnpm exec wrangler secret put DATABASE_URL_ROL_<n>` (en in `.dev.vars` voor lokaal).
4. **`ROLLEN` bijwerken** in `src/rollen.config.ts` (`naam`, `secretNaam`, `rechten`, `tabellen`) → `pnpm run type-check`.
5. **Loggen** in `.claude/rules/<Bedrijfsapp>_MCP_rules.md` — sectie A (matrix) én sectie B (changelog), met de uitgevoerde SQL. **De wijziging is pas af als dit gebeurd is.**
6. **Verifiëren** met `lijst_tabellen` als een gebruiker met die rol, plus de controlequery op `information_schema.role_table_grants` (nul rijen met `DELETE`/`TRUNCATE`).

Kolommen of rijen afschermen doe je met een **view** in Neon: geef `SELECT` op de view, géén `GRANT` op de onderliggende tabel, en neem de view op in de allowlist alsof het een tabel is.

## Recept: database-toegang in code

- Tools draaien **altijd** via `withRolDatabase(env, rol, async (sql) => ...)`. Nooit via `withDatabase()` — dat is de auth-verbinding en die hoort de gebruikerstabel te lezen, meer niet.
- **Waarden ALTIJD als parameter** in de tagged template: `` sql`... WHERE id = ${id}` ``. De driver parametriseert dit automatisch. **NOOIT** gebruikersinvoer in de querystring concateneren.
- Dynamische tabel-/kolomnamen kunnen niet als parameter; die mogen alleen uit `rollen.config.ts` komen en gaan door de whitelist in `database/gebruikers.ts` (`veiligeIdentifier`). Introduceer geen andere identifier-interpolatie.
- **Typeer het resultaat**: de driver geeft een ruwe union terug (`any[][] | Record<string, any>[] | FullQueryResults`), waar bijvoorbeeld `.length` níét op bestaat. Declareer een rij-type en cast de awaited query — `` (await sql`...`) as KlantRij[] `` — anders loopt `pnpm run type-check` vast.
- Fouten richting de gebruiker altijd door `formatDatabaseError()` halen (verbergt connection strings en credentials, en vertaalt `permission denied` naar een bruikbare melding).

## Zod v4 + MCP SDK: valkuilen

Relevant als je aan de bestaande tools sleutelt — nieuwe tools komen er niet bij.

- Registreer tools met **`server.registerTool(naam, config, handler)`**. Het oudere `server.tool()` is in de SDK als *deprecated* gemarkeerd.
- De `inputSchema` in het config-object is een **raw shape**: `{ veld: z.string() }` — **géén** `z.object({...})` eromheen.
- Geef **elke** parameter een `.describe("...")` in het Nederlands — dat is wat de AI-client leest.
- Een tool zonder parameters laat `inputSchema` gewoon weg (zoals `lijst_tabellen`).
- Elke tool heeft een `title` én één van `readOnlyHint`/`destructiveHint`. Zonder die hints moet de gebruiker élke aanroep bevestigen, ook die van een leestool.

| Soort tool | Annotatie | Gevolg in de client |
|---|---|---|
| Leest alleen | `{ readOnlyHint: true }` | mag draaien zonder bevestiging per aanroep |
| Wijzigt of verwijdert data | `{ destructiveHint: true }` | vraagt altijd om bevestiging |

> De MCP-specificatie kent ook `idempotentHint` en `openWorldHint`. Die gebruiken we bewust niet (YAGNI).

## Wat je NIET doet

- ❌ **Nooit `DELETE`, `TRUNCATE`, `DROP`, `CREATE` of `ALTER` mogelijk maken** — niet via een `GRANT`, niet door de allowlist in `veiligheid.ts` te verruimen, niet "eenmalig". Moet er iets weg kunnen, dan is het antwoord een soft-delete-veld met een `UPDATE`.
- ❌ **Geen eigenaarschap** van tabellen bij een MCP-rol, en **geen `CREATE` op het schema**. Beide omzeilen elke `GRANT`.
- ❌ **Geen vierde tool toevoegen** en **geen vijfde rol**. Harde grenzen — zie `.claude/rules/mcp-rechten.md`. Loop je ertegenaan, stop dan en vraag de eigenaar.
- ❌ **Geen toolnamen die per rol verschillen.** Beperken doe je via de tabel-allowlist of via `rechten`.
- ❌ **Geen rechten afdwingen in toolcode** (een lijstje geblokkeerde tabelnamen, een regex over de SQL). Rechten horen in `GRANT`'s.
- ❌ **Geen `GRANT` op de gebruikers-/rollentabel** aan een MCP-rol.
- ❌ **Geen `ALTER DEFAULT PRIVILEGES`** voor een MCP-rol — dan krijgt hij automatisch rechten op nieuwe tabellen.
- ❌ **Geen rechtenwijziging zonder logboekregel** in `.claude/rules/<Bedrijfsapp>_MCP_rules.md`.
- ❌ **Geen hiërarchische vergelijkingen** (`rol >= n`). Het model kent geen niveaus.
- ❌ **Geen SSE toevoegen** (geen `serveSSE`, geen `/sse`-route). Streamable HTTP op `/mcp` is het enige transport — een bewuste, harde keuze.
- ❌ **Geen rolnummer in `Props` stoppen** of uit het token lezen. De rol komt altijd vers uit de database.
- ❌ **`neon()` niet cachen** op de Durable Object-instantie of in module-scope met state — per aanroep instantiëren via `getRolDb()`/`withRolDatabase()`.
- ❌ **Geen secrets of connection strings** in code, logs richting de client, foutmeldingen of commits. Volledige fouten mogen wel naar `console.error` (serverlogs).
- ❌ **`rollen.config.ts` niet omzeilen** met hardcoded rolnummers of tabelnamen elders in de code.
- ❌ **Goedkeurings-HTML niet uitbreiden zonder `sanitizeHtml()`** op alle client-metadata (XSS). De huisstijl zelf is die van de leverancier en blijft ongewijzigd.
- ❌ **`tools` niet registreren buiten `registreerAlleTools`** om — de registry is de enige aansluitplek.
- ❌ De `migrations`-sectie in `wrangler.jsonc` niet bewerken; bij het hernoemen van `MyMCP` een nieuwe migratie-tag toevoegen.

## Taalconventies

- **Alle user-facing tekst is Nederlands**: tool-namen, tool-beschrijvingen, parameterbeschrijvingen, succes- en foutmeldingen, HTML-pagina's, comments, documentatie.
- **Identifiers**: domeinbegrippen in het Nederlands (`isGeldigeRol`, `zoekGebruikerOpEmail`, `withRolDatabase`), framework-/technische begrippen in het Engels (`Props`, `Env`, `server`, `createSuccessResponse`).

## Verificatiechecklist na elke wijziging

1. `pnpm run type-check` → schoon.
2. `pnpm run dev` → start zonder fouten.
3. `curl http://localhost:8792/.well-known/oauth-authorization-server` → JSON met endpoints.
4. Met de MCP Inspector (`pnpm dlx @modelcontextprotocol/inspector`, Streamable HTTP, `http://localhost:8792/mcp`): inloggen en controleren dat het aantal tools klopt (2 bij `lezen`, 3 bij `toevoegen`/`wijzigen`).
5. `lijst_tabellen` aanroepen → de tabellen komen overeen met de allowlist, en `mag_toevoegen`/`mag_wijzigen` met de `rechten`.
6. Een query op een tabel buiten de scope → nette melding dat de rol daar geen toegang toe heeft.
7. `voer_sql_uit` met een `DELETE` → geweigerd met uitleg. Controleer daarna in de Neon-editor als díé rol dat de `DELETE` óók daar op *permission denied* stuit.
8. Bij een rechtenwijziging: staat de logboekregel in `.claude/rules/<Bedrijfsapp>_MCP_rules.md`?
