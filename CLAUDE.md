# CLAUDE.md — Gids voor AI coding agents

Dit bestand is de handleiding voor AI-agents (en developers) die aan deze MCP-server werken. Lees het volledig voordat je code wijzigt.

> **Deze repo is een template.** Hij wordt per klant geïntegreerd in de codebase van een bedrijfs- of CRM-applicatie, als submap `mcp-server/`. Het stappenplan voor die integratie staat in [README.md](README.md). Werk je in een klantrepo, lees dan óók de skill `mcp-rechten` (`.claude/skills/mcp-rechten/SKILL.md`, geleverd via `docs/mcp-rechten/`).

## Projectoverzicht

Remote MCP-server op Cloudflare Workers. Login via Microsoft Entra ID (single-tenant, de tenant van de klant), autorisatie **per rol en per tabel** (drie standen: geen toegang · lezen · schrijven; rollen en rechten staan in de Neon-database van de klant en worden beheerd in het rechtenscherm van diens applicatie), transport **uitsluitend Streamable HTTP** op `/mcp`.

⚠️ **Deze server geeft een taalmodel rechtstreeks SQL-toegang tot een productiedatabase.** Twee dingen zijn niet onderhandelbaar: **verwijderen bestaat niet** en **structuurwijzigingen bestaan niet**, voor geen enkele rol. Alles wat met rollen, tabellen, rechten en `GRANT`'s te maken heeft, valt onder de skill `mcp-rechten`.

**Dataflow:**

```
MCP-client → POST /mcp (Bearer-token)
  → OAuthProvider (src/index.ts, export default): token valideren, props ontsleutelen
  → MyMCP Durable Object (src/index.ts): init() draait 1× per sessie
      → controleerConfiguratie() → alle zeven secrets aanwezig, anders weigeren
      → leesRolContext() → rol + rechten vers uit Neon (via mcp_service, op Entra-oid)
      → registreerAlleTools() → toolbeschrijvingen gevuld met de tabellen van de rol
  → tool-handler → leesRolContext() OPNIEUW (rechten nooit cachen)
                 → toets() in database/poort.ts (de poort)
                 → uitvoeren via mcp_lezer of mcp_schrijver, begrensd (uitvoering.ts, quota.ts)
```

**Bestanden:**

| Bestand | Rol |
|---|---|
| `src/mcp.config.ts` | ⭐ Het enige bestand dat je per klant aanpast: servernaam, schema, gebruikerstabel, `NOOIT_SCHRIJVEN`, limieten |
| `src/index.ts` | Entrypoint: `MyMCP` (McpAgent/Durable Object) + `OAuthProvider`-wiring |
| `src/types.ts` | `Props` — de identiteit uit het token; bevat bewust GEEN rol of rechten |
| `src/auth/entra-handler.ts` | Hono-app: `/authorize`, `/callback` (poortwachter + eenmalige oid-binding), `/` |
| `src/auth/entra.ts` | Entra-endpoints: authorize-URL, code-inwisseling, id_token-decodering (oid verplicht) |
| `src/auth/goedkeuring.ts` | Goedkeuringsdialoog (huisstijl van de leverancier) + HMAC-ondertekend cookie + `sanitizeHtml` |
| `src/database/analyse.ts` | ⚠️ De queryanalyse: parser, allowlists, relatieverzameling |
| `src/database/poort.ts` | ⚠️ De gedeelde toetsing die élke databasetool doorloopt |
| `src/database/beschermd.ts` | ⚠️ De denylist (afgeleid uit de config) + toetsing van `NOOIT_SCHRIJVEN` |
| `src/database/rechten.ts` | ⚠️ Identiteit (oid-binding) + de rechten, vers per aanroep |
| `src/database/quota.ts` | ⚠️ De cumulatieve schrijfteller |
| `src/database/uitvoering.ts` | ⚠️ De omhullingen die begrenzen en terugdraaien |
| `src/database/verbinding.ts` | ⚠️ De drie databaseverbindingen — géén terugval |
| `src/tools/database-tools.ts` | ⚠️ De drie tools (`lijst_tabellen`, `lees_query`, `schrijf_query`) |
| `src/tools/register-tools.ts` | Tool-registry — er komen hier geen tools bij |
| `src/utils/antwoorden.ts` | `createSuccessResponse`, `createErrorResponse`, `formatDatabaseError` (anti-orakel) |
| `test/` | vitest: testmatrix, omzeilingen, reviewbevindingen (zonder DB) + databaserechten (met `MCP_TEST_BRANCH=1`) |
| `sql/` | `01` migratiesjabloon, `02` de drie databaserollen en hun `GRANT`'s (bron van waarheid), `03` controlequery's |
| `docs/` | de opdracht en de design-brief voor de app-kant, de skill, de referentie-snippets en de CLAUDE.md-notitie |

De bestanden met ⚠️ vormen samen de veiligheidslaag. Elke wijziging daar is **baan B** in de skill `mcp-rechten`: drie parallelle reviewers, unanimiteit vereist.

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
- In dit project betekent dat concreet: een nieuwe klant vraagt om `src/mcp.config.ts` invullen en de SQL-sjablonen draaien — niet om nieuwe code. Een nieuwe rol of een nieuw tabelrecht vraagt om helemaal niets in deze repo: dat regelt de beheerder in het rechtenscherm.

## Package management & tooling

**CRUCIAAL: dit project gebruikt pnpm (níét npm) voor Node.js-packagebeheer en de Wrangler CLI voor Cloudflare Workers-ontwikkeling.**

- Installeer dependencies uitsluitend met `pnpm install`; commit nooit een `package-lock.json` of `yarn.lock` naast de `pnpm-lock.yaml`.
- Heeft de klantrepo zelf een `pnpm-workspace.yaml`, installeer dan in `mcp-server/` met **`pnpm install --ignore-workspace`** — anders denkt pnpm dat er in deze map niets te installeren valt.
- `@modelcontextprotocol/sdk` staat **exact** op 1.29.0, met een override in `pnpm-workspace.yaml`: `agents` pint diezelfde versie exact, en twee kopieën in één bundel geven onverenigbare `McpServer`-types.
- Draai Wrangler altijd via het project (`pnpm run <script>` of `pnpm exec wrangler ...`), nooit via een los geïnstalleerde globale versie.
- **`wrangler login` is interactief en laat je hangen.** Gebruik als agent een API-token in `CLOUDFLARE_API_TOKEN` — zie README.

## Commando's

```bash
pnpm install         # dependencies installeren (dit project gebruikt pnpm!)
pnpm run dev         # dev-server op http://localhost:8792
pnpm run type-check  # tsc --noEmit — draai dit na ELKE wijziging
pnpm test            # vitest: de testmatrix + élke omzeiling, zonder database
MCP_TEST_BRANCH=1 pnpm test   # óók de databaserechten, ALLEEN tegen een Neon-testbranch
pnpm run deploy      # wrangler deploy — LET OP: altijd `pnpm run deploy`,
                     # want `pnpm deploy` (zonder run) is een ingebouwd pnpm-commando
pnpm run cf-typegen  # types hergenereren na wijzigingen in wrangler.jsonc
pnpm exec wrangler deploy --dry-run   # bundel bouwen en meten; de parser weegt mee
pnpm exec wrangler tail               # live logs van de gedeployde Worker
pnpm exec wrangler secret put <NAAM>  # secret in productie zetten
```

## Het rolmodel in één alinea

Welke tabellen een rol mag lezen of schrijven, staat **niet in deze code** maar in de database (`mcp_rollen`, `mcp_rechten`); een beheerder klikt het in het rechtenscherm van de applicatie. Rollen zijn onbeperkt in aantal en niet hiërarchisch. "Geen toegang" is de **afwezigheid van een rij**, waardoor een nieuwe tabel automatisch dicht is. Welke **operaties** überhaupt kunnen, staat in de database zelf: `mcp_lezer` mag alleen `SELECT`, `mcp_schrijver` alleen `SELECT/INSERT/UPDATE`, `mcp_service` alleen zijn eigen huishouding — geen van drieën heeft `DELETE`, eigenaarschap of `CREATE`. De code ertussen (parser, poort, denylist, quota) bepaalt *welke tabel voor welke rol* en vangt wat de database niet kan onderscheiden.

Elke rol krijgt **dezelfde toolnamen**: `lijst_tabellen`, `lees_query` en — zodra de rol ergens schrijfrecht heeft — `schrijf_query`. Nooit varianten per rol.

## Recept: de template voor een nieuwe klant configureren

1. `src/mcp.config.ts`: `SERVER_NAAM`, `SCHEMA`, `GEBRUIKERS` (tabel + kolomnamen), `NOOIT_SCHRIJVEN`, eventueel `LIMIETEN`.
2. `src/database/beschermd.ts`: identiteitsdragers van de klant (sessies, tokens, sleutels) aan de `DENYLIST` toevoegen.
3. `sql/01-mcp-tabellen.sql` in het migratiesysteem van de klant; `sql/02-mcp-neon-rollen.sql` als eigenaar in Neon (tabellijsten invullen); `sql/03-controle.sql` → nul rijen.
4. `pnpm run type-check` en `pnpm test`.
5. De rest (Azure, Cloudflare, secrets, app-kant) staat in het stappenplan in README.md.

## Recept: de database aanraken

**Er is precies één manier**, en die staat in `src/tools/database-tools.ts`. Kopieer dat patroon; verzin er geen tweede.

1. **Lees de rechten vers** met `leesRolContext(env, props.oid, props.email)` — bij ÉLKE aanroep, niet één keer per sessie. De context die `init()` heeft gelezen, dient alleen om de toolbeschrijvingen te vullen en is nooit de beveiliging.
2. **Laat de query door de poort**: `toets(neonCatalogus(env), context, sql, "lezen" | "schrijven")`. Die doet de volledige volgorde: ontleden, meervoudige statements weigeren, élke relatie uit élke tak verzamelen, de twee gehardcodeerde lijsten toetsen, en pas dán de rechten van de rol.
3. **Voer uit via de juiste verbinding**, altijd omhuld: `bouwLeesStatement()` of `bouwSchrijfStatement()` uit `database/uitvoering.ts`, in `arrayMode` (dubbele kolomnamen slaan anders data plat).
4. **Reserveer vóór je schrijft** met `reserveer()` en corrigeer achteraf met `corrigeer()`.
5. **Fouten** altijd door `formatDatabaseError()` — die geeft nooit een onbekende databasemelding door, want die kan tabelnamen bevatten die de aanroeper niet noemde.

Waarden gaan altijd als parameter (`$1`) mee. Tabel- en kolomnamen komen uitsluitend uit de catalogus, uit `beschermd.ts`, of uit `mcp.config.ts` via `veiligeIdentifier()` — nooit uit gebruikersinvoer. Introduceer geen andere identifier-interpolatie.

## Zod v4 + MCP SDK: valkuilen

Relevant als je aan de bestaande tools sleutelt — nieuwe tools komen er niet bij.

- Registreer tools met **`server.registerTool(naam, config, handler)`**. Het oudere `server.tool()` is als *deprecated* gemarkeerd.
- De `inputSchema` in het config-object is een **raw shape**: `{ veld: z.string() }` — **géén** `z.object({...})` eromheen.
- Geef **elke** parameter een `.describe("...")` in het Nederlands — dat is wat de AI-client leest.
- Elke tool heeft een `title` én eerlijke annotaties (`readOnlyHint` voor de leestools, `destructiveHint` voor `schrijf_query`). Een schrijftool die zich voordoet als alleen-lezen ontneemt de gebruiker het moment waarop hij nog kan ingrijpen.

## Wat je NIET doet

- ❌ **Geen `DELETE`, `MERGE` of DDL toevoegen** aan de toegestane operaties — voor geen enkele rol, achter geen enkele vlag, niet "eenmalig". Het antwoord op "maar ik wil kunnen opruimen" is een soft delete via `UPDATE`.
- ❌ **Geen vierde tool en geen toolnamen die per rol verschillen.** Moet iemand minder kunnen, dan zet de beheerder zijn rechten anders.
- ❌ **Geen rol of rechten in `Props` stoppen**, en ze nergens cachen. Ze komen bij élke tool-aanroep vers uit de database.
- ❌ **Geen terugval op een ruimere verbinding** wanneer een secret ontbreekt. Falen is luid en dicht, nooit stil en open.
- ❌ **De denylist niet naar de database verplaatsen.** Dan is ze te wijzigen door precies wie ze niet mag wijzigen.
- ❌ **Geen regex als poort.** Een tekstcontrole mag ernaast staan als vangnet, nooit ervoor.
- ❌ **De oid niet binden buiten het login-pad** (`magBinden` alleen in `/callback`).
- ❌ **Geen `GRANT` op de beschermde tabellen** aan `mcp_lezer` of `mcp_schrijver`; geen `ALTER DEFAULT PRIVILEGES`; geen `GRANT … ON ALL TABLES`.
- ❌ **Geen SSE toevoegen** (geen `serveSSE`, geen `/sse`-route). Streamable HTTP op `/mcp` is het enige transport.
- ❌ **`neon()` niet cachen** op de Durable Object-instantie of in module-scope — per aanroep via `getDb()`/`withDatabase()`.
- ❌ **Geen secrets of connection strings** in code, logs richting de client, foutmeldingen of commits.
- ❌ **`mcp.config.ts` niet omzeilen** met hardcoded tabel- of kolomnamen elders in de code.
- ❌ **Goedkeurings-HTML niet uitbreiden zonder `sanitizeHtml()`** op alle client-metadata (XSS). De huisstijl van de dialoog is die van de leverancier en blijft ongewijzigd.
- ❌ **`tools` niet registreren buiten `registreerAlleTools`** om.
- ❌ De `migrations`-sectie in `wrangler.jsonc` niet bewerken; bij het hernoemen van `MyMCP` een nieuwe migratie-tag toevoegen.
- ❌ **De parser niet via de default entry importeren** (`node-sql-parser` is 2,5 MB); alleen `node-sql-parser/build/postgresql`.

## Taalconventies

- **Alle user-facing tekst is Nederlands**: tool-namen, tool-beschrijvingen, parameterbeschrijvingen, succes- en foutmeldingen, HTML-pagina's, comments, documentatie.
- **Identifiers**: domeinbegrippen in het Nederlands (`leesRolContext`, `magNooitSchrijven`, `registreerDatabaseTools`), framework-/technische begrippen in het Engels (`Props`, `Env`, `server`, `createSuccessResponse`).

## Verificatiechecklist na elke wijziging

1. `pnpm run type-check` → schoon.
2. `pnpm test` → alle tests groen. Raakte je de veiligheidslaag (⚠️), draai dan óók baan B uit de skill `mcp-rechten`: drie parallelle reviewers, unanimiteit.
3. `pnpm exec wrangler deploy --dry-run` → bundel bouwt.
4. `pnpm run dev` → start zonder fouten; `curl http://localhost:8792/.well-known/oauth-authorization-server` → JSON met endpoints.
5. Met de MCP Inspector (`pnpm dlx @modelcontextprotocol/inspector`, Streamable HTTP, `http://localhost:8792/mcp`): inloggen en controleren dat het aantal tools klopt (2 zonder schrijfrecht, 3 mét).
6. `lijst_tabellen` → precies de tabellen uit `mcp_rechten` van die rol, met `mag_toevoegen`/`mag_bijwerken` en de kolomcommentaren.
7. `lees_query` op een tabel buiten de rol → "Deze rol heeft geen toegang tot …" (dezelfde melding als voor een onbestaande tabel).
8. `schrijf_query` met een `DELETE` → geweigerd met uitleg. Controleer daarna in de Neon-editor als `mcp_schrijver` dat `DELETE` óók daar op *permission denied* stuit.
9. Bij een wijziging aan `sql/02`: `sql/03-controle.sql` → nul rijen bij de eerste query.
