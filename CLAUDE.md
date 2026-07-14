# CLAUDE.md — Gids voor AI coding agents

Dit bestand is de handleiding voor AI-agents (en developers) die aan deze MCP-server werken. Lees het volledig voordat je tools toevoegt of code wijzigt.

## Projectoverzicht

Remote MCP-server op Cloudflare Workers. Login via Microsoft Entra ID (single-tenant), autorisatie via rolniveaus in een Neon Postgres-database, transport **uitsluitend Streamable HTTP** op `/mcp`.

**Dataflow:**

```
MCP-client → POST /mcp (Bearer-token)
  → OAuthProvider (src/index.ts, export default): token valideren, props ontsleutelen
  → MyMCP Durable Object (src/index.ts): init() draait 1× per sessie
      → zoekGebruikerOpEmail() → rolniveau vers uit Neon
      → registreerAlleTools(server, env, props, rol) → alleen tools ≥ rolniveau
  → tool-handlers → Neon (via withDatabase)
```

**Bestanden:**

| Bestand | Rol |
|---|---|
| `src/index.ts` | Entrypoint: `MyMCP` (McpAgent/Durable Object) + `OAuthProvider`-wiring |
| `src/rollen.config.ts` | ⭐ Rolniveaus + tabel-/kolomnamen — het enige config-bestand |
| `src/types.ts` | `Props` (identiteit uit het token; bevat bewust GEEN rol) en `GebruikerRij` |
| `src/auth/entra-handler.ts` | Hono-app: `/authorize`, `/callback` (poortwachter), `/` |
| `src/auth/entra.ts` | Entra-endpoints: authorize-URL, code-inwisseling, id_token-decodering |
| `src/auth/goedkeuring.ts` | Goedkeuringsdialoog + HMAC-ondertekend cookie + `sanitizeHtml` |
| `src/database/verbinding.ts` | `getDb()` (Neon HTTP-driver) + `withDatabase()` wrapper |
| `src/database/gebruikers.ts` | `zoekGebruikerOpEmail()`, `controleerActueleRol()` |
| `src/database/veiligheid.ts` | `valideerSqlQuery()`, `isSchrijfOperatie()` — vangnet voor tools met ruwe SQL |
| `src/tools/register-tools.ts` | Centrale tool-registry — hier sluit je nieuwe modules aan |
| `src/tools/wie-ben-ik.ts` | Voorbeeldtool = het kopieerbare recept |
| `src/utils/antwoorden.ts` | `createSuccessResponse`, `createErrorResponse`, `formatDatabaseError` |

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
- Ontwerp zo dat nieuwe functionaliteit kan worden toegevoegd met minimale aanpassingen aan bestaande code — in dit project: nieuwe tools komen erbij als nieuwe module in `src/tools/` plus één regel in de registry, zonder bestaande code te wijzigen.

## Package management & tooling

**CRUCIAAL: dit project gebruikt pnpm (níét npm) voor Node.js-packagebeheer en de Wrangler CLI voor Cloudflare Workers-ontwikkeling.**

- Installeer dependencies uitsluitend met `pnpm install`; commit nooit een `package-lock.json` of `yarn.lock` naast de `pnpm-lock.yaml`.
- Draai Wrangler altijd via het project (`pnpm run <script>` of `pnpm exec wrangler ...`), nooit via een los geïnstalleerde globale versie.

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

## Recept: nieuwe tool toevoegen

**Stap 1** — Maak `src/tools/<naam>.ts` (bestandsnaam kebab-case, Nederlands):

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { heeftNiveau } from "../rollen.config";
import type { Props } from "../types";
import { withDatabase } from "../database/verbinding";
import { createErrorResponse, createSuccessResponse, formatDatabaseError } from "../utils/antwoorden";

/** Minimaal vereist rolniveau voor deze module (zie src/rollen.config.ts). */
const MIN_NIVEAU = 2;

export function registreerKlantTools(server: McpServer, env: Env, props: Props, rol: number): void {
	if (!heeftNiveau(rol, MIN_NIVEAU)) return; // rol-gating: NIET weglaten

	server.tool(
		"zoek_klant", // snake_case, Nederlands
		"Zoekt klanten op (een deel van) hun naam en geeft maximaal 10 resultaten terug.",
		{
			zoekterm: z.string().min(1).describe("(Deel van) de klantnaam om op te zoeken"),
		},
		async ({ zoekterm }) => {
			try {
				const klanten = await withDatabase(env, async (sql) => {
					return sql`SELECT id, naam, email FROM klanten
					           WHERE naam ILIKE ${"%" + zoekterm + "%"} LIMIT 10`;
				});
				return createSuccessResponse(`${klanten.length} klant(en) gevonden.`, klanten);
			} catch (fout) {
				return createErrorResponse(formatDatabaseError(fout));
			}
		},
	);
}
```

**Stap 2** — Kies `MIN_NIVEAU` bewust: lezen = laag niveau, schrijven = hoger, destructief = hoogste.

**Stap 3** — Voeg één regel toe in `src/tools/register-tools.ts`:

```ts
registreerKlantTools(server, env, props, rol);
```

**Stap 4** — `pnpm run type-check` moet schoon zijn.

Meerdere gerelateerde tools mogen samen in één module (één `registreer<Naam>`-functie, per tool eventueel een eigen niveau-check als ze verschillen).

## Recept: rol-gating

- **Standaard (altijd doen):** de `if (!heeftNiveau(rol, MIN_NIVEAU)) return;` bovenaan de registreer-functie. Tools zijn dan onzichtbaar voor te lage rollen. Het rolniveau komt bij elke **nieuwe sessie** vers uit de database.
- **Extra (alleen voor destructieve tools):** een live her-check binnen de handler, zodat ook een rolwijziging *tijdens* een lopende sessie afgedwongen wordt:

```ts
import { controleerActueleRol } from "../database/gebruikers";

async ({ ... }) => {
	if (!(await controleerActueleRol(env, props.email, MIN_NIVEAU))) {
		return createErrorResponse("Je rol is gewijzigd; deze actie is niet meer toegestaan.");
	}
	// ... de eigenlijke actie
}
```

Gebruik dit spaarzaam: elke aanroep kost een extra database-query.

## Recept: database-toegang

- Altijd via `withDatabase(env, async (sql) => ...)` — geeft logging en uniforme foutafhandeling.
- **Waarden ALTIJD als parameter** in de tagged template: `` sql`... WHERE id = ${id}` ``. De driver parametriseert dit automatisch (veilig tegen SQL-injectie). **NOOIT** gebruikersinvoer in de querystring concateneren.
- Dynamische tabel-/kolomnamen kunnen niet als parameter; die mogen alleen uit `rollen.config.ts` komen en gaan door de whitelist in `database/gebruikers.ts` (`veiligeIdentifier`). Introduceer geen andere identifier-interpolatie.
- Meerdere statements in één transactie: `sql.transaction([...])` (niet-interactief; de HTTP-driver ondersteunt geen `BEGIN`/`COMMIT` over meerdere requests).
- Fouten richting de gebruiker altijd door `formatDatabaseError()` halen (verbergt connection strings en credentials).

## Recept: een tool die ruwe SQL accepteert

Soms wil je een generieke query-tool waarbij de AI-client zelf SQL aanlevert (lezen én — voor hoge rollen — schrijven). Dat mag, maar ALLEEN volgens dit recept. De regels:

1. **Lees- en schrijf-tools zijn gescheiden tools** met verschillende `MIN_NIVEAU`'s (lezen laag, schrijven het hoogste niveau).
2. **Altijd eerst `valideerSqlQuery()`** (uit `src/database/veiligheid.ts`).
3. **De lees-tool weigert schrijfoperaties** via `isSchrijfOperatie()`.
4. **De schrijf-tool doet een live rolcheck per aanroep** via `controleerActueleRol()` — een ingetrokken rol moet ook binnen een lopende sessie direct effect hebben.
5. **De échte bescherming van de lees-tool is een read-only databaserol in Neon**: maak in Neon een rol met alleen `SELECT`-rechten, zet die connection string als apart secret (bv. `DATABASE_URL_READONLY`) en gebruik hem in de lees-tool. De regex-checks zijn de tweede verdedigingslinie, niet de eerste.
6. **Begrens de output**: dwing een `LIMIT` af of kap het aantal geretourneerde rijen af, zodat één query de context van de client niet opblaast.

```ts
import { z } from "zod";
import { isSchrijfOperatie, valideerSqlQuery } from "../database/veiligheid";
import { controleerActueleRol } from "../database/gebruikers";
import { withDatabase } from "../database/verbinding";
import { createErrorResponse, createSuccessResponse, formatDatabaseError } from "../utils/antwoorden";

// ── LEES-TOOL (bv. MIN_NIVEAU = 1) ──────────────────────────────────────
server.tool(
	"lees_query",
	"Voert een read-only SQL-query (SELECT) uit op de database en geeft de rijen terug.",
	{
		sql: z.string().min(1).describe("De uit te voeren SELECT-query (alleen lezen)"),
	},
	async ({ sql: queryTekst }) => {
		const validatie = valideerSqlQuery(queryTekst);
		if (!validatie.geldig) return createErrorResponse(validatie.fout ?? "Ongeldige query.");
		if (isSchrijfOperatie(queryTekst)) {
			return createErrorResponse("Deze tool voert alleen leesqueries uit. Gebruik de schrijf-tool (indien je rol dat toelaat).");
		}
		try {
			// Idealiter via een read-only rol: neon(env.DATABASE_URL_READONLY)
			const rijen = await withDatabase(env, async (sql) => sql.query(queryTekst));
			return createSuccessResponse(`${(rijen as unknown[]).length} rij(en) gevonden.`, rijen);
		} catch (fout) {
			return createErrorResponse(formatDatabaseError(fout));
		}
	},
);

// ── SCHRIJF-TOOL (MIN_NIVEAU = MAX_NIVEAU) ──────────────────────────────
server.tool(
	"voer_sql_uit",
	"Voert een SQL-statement uit dat de database mag wijzigen (INSERT, UPDATE, DELETE, ...). Alleen voor het hoogste rolniveau.",
	{
		sql: z.string().min(1).describe("Het uit te voeren SQL-statement"),
	},
	async ({ sql: queryTekst }) => {
		// Live her-check: rol kan tijdens de sessie ingetrokken zijn.
		if (!(await controleerActueleRol(env, props.email, MIN_NIVEAU))) {
			return createErrorResponse("Je rol is gewijzigd; deze actie is niet meer toegestaan.");
		}
		const validatie = valideerSqlQuery(queryTekst);
		if (!validatie.geldig) return createErrorResponse(validatie.fout ?? "Ongeldige query.");
		try {
			const resultaat = await withDatabase(env, async (sql) => sql.query(queryTekst));
			console.log(`Schrijfoperatie door ${props.email}: ${queryTekst.slice(0, 100)}`);
			return createSuccessResponse("Statement uitgevoerd.", resultaat);
		} catch (fout) {
			return createErrorResponse(formatDatabaseError(fout));
		}
	},
);
```

> **Weet wat het vangnet wél en niet is:** `valideerSqlQuery` stopt de overduidelijke ongelukken (DROP, TRUNCATE, "WHERE 1=1"-verwijderingen, gestapelde statements). Het stopt géén doordachte aanvallen — daarvoor bestaan de read-only databaserol en de rolniveaus. De Neon HTTP-driver voert bovendien maar één statement per aanroep uit, wat gestapelde injecties sowieso blokkeert.

## Zod v4 + MCP SDK: valkuilen

- Het parameterschema van `server.tool()` is een **raw shape**: `{ veld: z.string() }` — **géén** `z.object({...})` eromheen.
- Geef **elke** parameter een `.describe("...")` in het Nederlands — dat is wat de AI-client leest.
- Een tool zonder parameters krijgt `{}` als schema.
- Tool-namen: snake_case, Nederlands, kort (`zoek_klant`, `maak_offerte`).

## Wat je NIET doet

- ❌ **Geen SSE toevoegen** (geen `serveSSE`, geen `/sse`-route). Streamable HTTP op `/mcp` is het enige transport — dat is een bewuste, harde keuze.
- ❌ **Geen rolniveau in `Props` stoppen** of uit het token lezen. De rol komt altijd vers uit de database (zie `MyMCP.init`), anders werken rolwijzigingen niet meer door.
- ❌ **`neon()` niet cachen** op de Durable Object-instantie of in module-scope met state — per aanroep instantiëren via `getDb()`/`withDatabase()`.
- ❌ **Geen secrets of connection strings** in code, logs richting de client, foutmeldingen of commits. Volledige fouten mogen wel naar `console.error` (serverlogs).
- ❌ **`rollen.config.ts` niet omzeilen** met hardcoded niveaus of tabelnamen elders in de code.
- ❌ **Goedkeurings-HTML niet uitbreiden zonder `sanitizeHtml()`** op alle client-metadata (XSS).
- ❌ **`tools` niet registreren buiten `registreerAlleTools`** om — de registry is de enige aansluitplek.
- ❌ De `migrations`-sectie in `wrangler.jsonc` niet bewerken; bij het hernoemen van `MyMCP` een nieuwe migratie-tag toevoegen.

## Taalconventies

- **Alle user-facing tekst is Nederlands**: tool-namen, tool-beschrijvingen, parameterbeschrijvingen, succes- en foutmeldingen, HTML-pagina's, comments, documentatie.
- **Identifiers**: domeinbegrippen in het Nederlands (`heeftNiveau`, `zoekGebruikerOpEmail`, `registreerKlantTools`), framework-/technische begrippen in het Engels (`Props`, `Env`, `server`, `createSuccessResponse`).

## Verificatiechecklist na elke wijziging

1. `pnpm run type-check` → schoon.
2. `pnpm run dev` → start zonder fouten.
3. `curl http://localhost:8792/.well-known/oauth-authorization-server` → JSON met endpoints.
4. Met de MCP Inspector (`pnpm dlx @modelcontextprotocol/inspector`, Streamable HTTP, `http://localhost:8792/mcp`): inloggen en controleren dat de toolset klopt voor het rolniveau van de testgebruiker.
5. Bij nieuwe tools: de tool aanroepen met geldige én ongeldige invoer; foutpad geeft een nette Nederlandse melding via `createErrorResponse`.
