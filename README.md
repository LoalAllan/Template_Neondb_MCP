# Template: MCP-server met instelbare rechten voor een bedrijfsapplicatie met Neon-database

**Waarvoor dient deze repo?**

Dit is een **template**, geen eindproduct. Een AI-coding agent haalt deze repo op en integreert hem in de codebase van een klant — een bedrijfs- of CRM-applicatie met een **Neon Postgres-database**, een gebruikerstabel en een Microsoft-login.

Het resultaat is per klant:

1. een eigen **remote MCP-server** (Cloudflare Worker) waarmee gebruikers via hun AI-client (Claude bijvoorbeeld) met de database praten, ingelogd met hun Microsoft-account;
2. een **rechtenscherm** in de applicatie van de klant — "Connector" — waarin een beheerder per rol, per cluster en per tabel instelt wat een AI-model mag zien (lezen) en wijzigen (schrijven);
3. een **skill** in de klantrepo die bij elke schemawijziging bewaakt dat er niets stilletjes openvalt.

```
   Codebase van de klant (CRM / bedrijfsapp)
   ├── app/                       de bestaande applicatie
   │   └── … /connector           ← het rechtenscherm (deel B van het stappenplan)
   ├── mcp-server/                ← deze template (deel A)
   └── .claude/skills/mcp-rechten ← de skill (deel C)

                    beide praten met dezelfde database
                                  │
   ┌──────────────────────────────┴──────────────────────────────┐
   │                    Neon Postgres (van de klant)             │
   │   klanten · projecten · facturen · …                       │
   │   mcp_rollen · mcp_rechten · mcp_schrijfquota  ← het model │
   └───────┬──────────────────────┬──────────────────────┬───────┘
     mcp_lezer              mcp_schrijver           mcp_service
     alleen SELECT          SELECT/INSERT/UPDATE    rechten lezen, teller
   ┌───────┴──────────────────────┴──────────────────────┴───────┐
   │        Cloudflare Worker (eigen account van de klant)       │
   │   OAuthProvider → Microsoft Entra ID (tenant van de klant)  │
   │   MyMCP → rechten per aanroep → parser → poort → uitvoeren  │
   └──────────────────────────────┬──────────────────────────────┘
                                  │  POST /mcp (Streamable HTTP)
                          MCP-client van de gebruiker
```

Wat de template meebrengt:

- 🔐 **Microsoft Entra ID** als login — alleen accounts uit de tenant van de klant (single-tenant), gekoppeld op de onveranderlijke `oid`;
- 👥 **Onbeperkt rollen**, door een beheerder aangemaakt in het rechtenscherm, met per tabel de stand *geen toegang · lezen · schrijven*;
- 🛠️ **Drie tools** — `lijst_tabellen`, `lees_query`, `schrijf_query` — voor élke rol dezelfde namen;
- 🛡️ **Twee lagen afscherming**: de database bepaalt *welke operaties* kunnen (geen `DELETE`, geen DDL, voor niemand), de server bepaalt *welke tabel voor welke rol* (echte SQL-parser, denylist, rijbegrenzing, cumulatieve schrijfquota);
- 🚫 **Nooit verwijderen, nooit structuurwijzigingen**, en rechten die bij **elke tool-aanroep** vers uit de database komen;
- 🧪 **Tests** die de hele rechtenmatrix en elke bekende omzeiling zonder database doorlopen;
- 🚀 **Alleen Streamable HTTP** op `/mcp`;
- 📐 Een **opdracht en design-brief** voor de app-kant, plus referentie-snippets en een skill.

---

## Hoe werkt de toegangscontrole?

1. De gebruiker logt in met zijn **Microsoft-account**. Single-tenant: accounts van buiten de tenant weigert Microsoft zelf.
2. Bij de eerste login bindt de server de Entra-`oid` **eenmalig** aan de rij in de gebruikerstabel die op e-mail matcht. Daarna is de `oid` leidend — een e-mailadres is te wijzigen en opnieuw uit te geven, een `oid` niet.
3. Geen rij, of `mcp_rol_id` is `NULL`? → **login geweigerd**.
4. Wél een rol? → de tools worden geregistreerd met beschrijvingen die de tabellen van die rol noemen. Een rol zonder schrijfrecht ziet 2 tools, anders 3.
5. Bij **elke tool-aanroep** leest de server de rechten opnieuw, ontleedt hij de query tot een syntaxboom, verzamelt hij élke geraakte tabel uit élke tak, toetst hij eerst de denylist en de lijst "nooit schrijven", dan pas de rechten van de rol, en voert hij uit via de verbinding van de juiste databasegebruiker — begrensd in rijen, omvang en tijd.

### Rollen zijn scopes, geen niveaus

Rollen zijn niet hiërarchisch en tellen nooit op. Elke rol is een verzameling tabelrechten. "Geen toegang" is de **afwezigheid van een rij** in `mcp_rechten`: een nieuwe tabel is daardoor automatisch dicht voor elke rol, zonder dat iemand eraan hoeft te denken.

Moet een gebruiker minder kunnen? Dan zet de beheerder zijn rol anders. Je schrijft geen beperktere tool.

### Wat de MCP-server nooit kan

| | |
|---|---|
| ❌ `DELETE`, `TRUNCATE` | er kan via de MCP nooit data verdwijnen |
| ❌ `DROP`, `CREATE`, `ALTER` | de databasestructuur verandert nooit — ook geen tijdelijke tabellen |
| ❌ `GRANT`, `REVOKE`, `MERGE`, `COPY`, `DO`, `CALL`, `SET`, transactiebesturing | buiten het rechtenmodel om, of kunnen rijen verwijderen |
| ❌ Meerdere statements per aanroep | één statement tegelijk |
| ❌ Een `UPDATE` zonder `WHERE`, of die te veel rijen raakt | wordt teruggedraaid; overschrijven is de andere helft van verwijderen |
| ❌ Meer dan het uurplafond schrijven | de cumulatieve teller in de database grijpt in |

Lezen is daarentegen **onbeperkt** binnen de tabellen van de rol: joins, CTE's, subqueries, window-functies, aggregaties. Voor tussenresultaten gebruik je een CTE, geen tijdelijke tabel.

> Moet er wél iets "weg" kunnen? Gebruik een statusveld (soft delete) in de applicatie en laat een rol met schrijfrecht dat veld bijwerken. Echt verwijderen gebeurt in de applicatie, door code die daarvoor geschreven en getest is.

### Waar de afscherming zit

**Wélke operaties** kunnen, staat in de database: drie kale Postgres-rollen (`sql/02-mcp-neon-rollen.sql`) zonder `DELETE`, zonder eigenaarschap en zonder `CREATE` op het schema. Geen enkele fout in code kan daar iets aan veranderen.

**Wélke tabel voor wélke rol**, staat in de applicatie: `mcp_rechten` in de database, geklikt in het rechtenscherm, en afgedwongen in de server door een echte parser (`src/database/analyse.ts`), een gedeelde poort (`poort.ts`), een gehardcodeerde denylist (`beschermd.ts`), rijbegrenzing (`uitvoering.ts`) en een schrijfteller (`quota.ts`). Die splitsing is een bewuste ruil: één databaserol per MCP-rol is sterker, maar schaalt niet naar rollen die een beheerder zelf aanmaakt.

De volledige redenering staat in [CLAUDE.md](CLAUDE.md) en in de skill (`docs/mcp-rechten/SKILL.md`).

---

## Vereisten

- **Node.js 20+** en **pnpm** (`corepack enable pnpm` of `npm install -g pnpm`)
- Een **Cloudflare-account** voor deze klant (gratis volstaat)
- Een **Azure-tenant** van de klant waarin je een App Registration mag aanmaken
- De **Neon-database** van de klantapplicatie, met rechten om rollen aan te maken (de eigenaar)
- Een applicatie met een **per-persoon Microsoft-login** en een **gebruikerstabel** (de app-kant bouwt daarop voort; een app met één gedeeld wachtwoord is geen kandidaat — zie de opdracht, §7)

---

## 🤖 Stappenplan voor AI-agents

Werk de vier delen van boven naar beneden af. Deel A levert een werkende, veilige server. Deel B bouwt het rechtenscherm in de app van de klant. Deel C installeert de bewaking. Deel D bewijst dat alles klopt.

**Vaste regels, voor alle delen:**

- Verzin geen waarden voor secrets, tenant-ID's, account-ID's, KV-ID's of wachtwoorden — vraag ze aan de eigenaar.
- Voeg geen vierde tool toe, maak `DELETE` nergens mogelijk, en zet nooit zelf rechten in `mcp_rechten`. Iedereen begint dicht.
- Lees [CLAUDE.md](CLAUDE.md) vóór je code in `mcp-server/` wijzigt, en `docs/mcp-rechten/SKILL.md` vóór je aan rechten, tabellen of `GRANT`'s komt.
- Meld eerlijk wat niet af is. Half af en benoemd is bruikbaar; half af en stilgehouden is een beveiligingsgat.

### Deel A — de server (in `mcp-server/`)

| # | Actie | Waar | Verificatie |
|---|---|---|---|
| A1 | Template plaatsen als `mcp-server/` in de klantrepo, **zonder** `.git`; `pnpm install` (met `--ignore-workspace` als de klantrepo een `pnpm-workspace.yaml` heeft) | [Stap 1](#stap-1--de-template-in-de-klantrepo-plaatsen) | `pnpm run type-check` en `pnpm test` groen |
| A2 | Fase 0 mini: gebruikerstabel en kolomnamen vaststellen; het schema doorlopen en een voorstel maken voor `NOOIT_SCHRIJVEN` (instellingen, nummerreeksen, wachtrijen, webhooks, wettelijke documenten) en voor identiteitsdragers (sessies, tokens, sleutels); **leg beide voor** aan de eigenaar | de codebase van de klant | bevestigde lijsten |
| A3 | `src/mcp.config.ts` invullen; identiteitsdragers aan `DENYLIST` in `src/database/beschermd.ts` toevoegen | [Stap 2](#stap-2--configureren) | `pnpm run type-check`, `pnpm test` |
| A4 | `sql/01-mcp-tabellen.sql` opnemen in het migratiesysteem van de klant en draaien | [Stap 3a](#3a-de-tabellen-van-het-rechtenmodel) | tabellen bestaan; niemand heeft een rol |
| A5 | `sql/02-mcp-neon-rollen.sql` invullen (kopie buiten git!) en als eigenaar draaien in Neon | [Stap 3b](#3b-de-drie-databasegebruikers) | `sql/03-controle.sql`: eerste query geeft nul rijen |
| A6 | Azure App Registration | [Stap 4](#stap-4--azure-app-registration) | client-ID, tenant-ID en client secret in bezit |
| A7 | Cloudflare-account, account-ID, API-token, KV-namespace, Worker-naam | [Stap 5](#stap-5--cloudflare-opzetten) | `wrangler whoami` toont het juiste account; geen `VERVANG_MIJ` meer in `wrangler.jsonc` |
| A8 | `.dev.vars` invullen en lokaal testen met de MCP Inspector | [Stap 6](#stap-6--lokaal-ontwikkelen) | een testgebruiker mét rol ziet 2 of 3 tools; zonder rol wordt de login geweigerd |
| A9 | Secrets in productie, deployen, productie-redirect-URI in Azure | [Stap 7](#stap-7--deployen-en-verbinden) | login werkt via de gedeployde URL |

Na A9 is de server af. Er is nog geen enkel recht toegekend — dat kan pas met het scherm uit deel B, of tijdelijk met de hand (`INSERT INTO mcp_rollen`, `INSERT INTO mcp_rechten`, `UPDATE <gebruikerstabel> SET mcp_rol_id = …`) om te testen.

### Deel B — de app-kant (in de applicatie van de klant)

| # | Actie | Waar |
|---|---|---|
| B1 | Plak `docs/opdracht-app-kant.md` **en** `docs/design-brief-connector.md` samen in één nieuwe sessie van de coding agent, in de codebase van de klant | beide documenten zijn zelfdragend |
| B2 | Volg de werkwijze uit de opdracht (§15): Fase 0 → clusters en technische tabellen voorstellen en laten bevestigen → beheerderspoort → publiceer-actie met server-side validatie → rol toewijzen aan gebruikers → het scherm → skill en notitie → afrondingscheck | `docs/referentie-app/` bevat de framework-agnostische logica |
| B3 | Kies in Fase 0 de layoutvariant (A, B of C uit de design-brief) op basis van het designsysteem van de klant en leg de keuze voor vóór je bouwt | `docs/voorbeelden/` |

De server hoeft voor deel B niet aangepast te worden. Wél moet de app-kopie van de beschermde lijsten identiek zijn aan `src/database/beschermd.ts` en `NOOIT_SCHRIJVEN` in `src/mcp.config.ts`.

### Deel C — de bewaking (in de klantrepo)

| # | Actie | Waar |
|---|---|---|
| C1 | Kopieer `docs/mcp-rechten/SKILL.md` naar `.claude/skills/mcp-rechten/SKILL.md` in de root van de klantrepo; vul de `<pad naar …>`-placeholders in; verwijder de installatiesectie | `docs/mcp-rechten/SKILL.md` |
| C2 | **Stel** de blokken uit `docs/claude-md-notitie.md` **voor** aan de eigenaar voor de `CLAUDE.md` van de klant. Wijzig die `CLAUDE.md` niet ongevraagd | `docs/claude-md-notitie.md` |
| C3 | Verwijs vanuit de `CLAUDE.md` van de klantrepo naar `mcp-server/CLAUDE.md` (onderdeel van dezelfde notitie) | |

### Deel D — eindverificatie

1. In `mcp-server/`: `pnpm run type-check`, `pnpm test`, `pnpm exec wrangler deploy --dry-run` → alles groen.
2. Op een Neon-**testbranch** met `sql/01` + `sql/02` gedraaid: `MCP_TEST_BRANCH=1 pnpm test` → de databaserechten-tests groen.
3. `sql/03-controle.sql` op productie → eerste query nul rijen; tweede query toont alleen `mcp_service` op de beschermde tabellen.
4. Met de MCP Inspector als testgebruiker: `lijst_tabellen` = precies de rechten van zijn rol; `lees_query` buiten de rol → "Deze rol heeft geen toegang tot …"; `schrijf_query` met `DELETE` → geweigerd; een recht intrekken in het scherm → de eerstvolgende aanroep wordt geweigerd zonder her-login.
5. De app-tests uit de opdracht (§13): publiceer-actie, beheerderspoort (incl. "ingetrokken beheerderschap geldt zonder her-login"), views, clustercontroles.
6. Aan de eigenaar gemeld: wat er is aangescherpt, welke restrisico's overblijven (opdracht §17), en of er point-in-time-herstel op de database staat.

### Waarden die je per klant verzamelt

| Waarde | Waar vandaan | Waar nodig |
|---|---|---|
| Naam en kolommen van de gebruikerstabel | de codebase van de klant | `src/mcp.config.ts`, `sql/01`, `sql/02` |
| Cloudflare account-ID | dashboard → Workers & Pages → rechterkolom | `wrangler.jsonc` |
| Worker-naam | zelf kiezen, uniek binnen het account | `wrangler.jsonc` |
| workers.dev-subdomein | dashboard → Workers & Pages → Subdomain | redirect-URI in Azure |
| KV-namespace-ID | `wrangler kv namespace create OAUTH_KV` | `wrangler.jsonc` |
| Azure client-ID + tenant-ID | Azure → App registrations → Overview | secrets |
| Azure client secret | Azure → Certificates & secrets | secret (verloopt!) |
| Drie Neon-connection strings | Neon → Connect → kies `mcp_lezer` / `mcp_schrijver` / `mcp_service` | secrets `DATABASE_URL_LEZER`, `_SCHRIJVER`, `_SERVICE` |
| Entra-`oid` van de eerste beheerder | Entra → Users → Object ID | envvar `MCP_EERSTE_BEHEERDER_OID` in de **app** (opdracht §7) |

---

## Stap 1 — De template in de klantrepo plaatsen

De MCP-server komt als **submap** in de repo van de klantapplicatie te staan, met een eigen `package.json` en een eigen deploy. Eén repo, gedeelde database, gescheiden deploys.

```
klantrepo/
├── app/                        de bestaande applicatie
├── mcp-server/                 ← de inhoud van deze template
│   ├── src/
│   ├── sql/
│   ├── docs/
│   ├── test/
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── pnpm-workspace.yaml
│   ├── wrangler.jsonc
│   └── CLAUDE.md
└── .claude/
    └── skills/
        └── mcp-rechten/SKILL.md   ← uit mcp-server/docs/mcp-rechten/ (deel C)
```

1. Kopieer de inhoud van deze repo naar `mcp-server/` — **zonder** de `.git`-map.
2. Draai `pnpm install` **in `mcp-server/`**, niet in de root. Heeft de klantrepo een `pnpm-workspace.yaml`, gebruik dan `pnpm install --ignore-workspace` — en zet `mcp-server` **niet** in `packages:` van de klant (de Worker mag niet mee gehoist worden).
3. Sluit `mcp-server` uit in de root-`tsconfig.json` van de klant (`"exclude": ["mcp-server"]`) als de app een eigen TypeScript-build heeft.

---

## Stap 2 — Configureren

Open [`src/mcp.config.ts`](src/mcp.config.ts). Dat is het enige codebestand dat je voor een klant aanpast:

```ts
export const SERVER_NAAM = "MCP-server Acme CRM";
export const SCHEMA = "public";
export const GEBRUIKERS = { tabel: "users", idKolom: "id", emailKolom: "email", updatedAtKolom: "updated_at" };
export const NOOIT_SCHRIJVEN = ["instellingen", "factuur_nummerreeks", "webhook_events"];
export const LIMIETEN = { maxQueryLengte: 10_000, maxRijenLees: 200, maxRijenPerStatement: 100, maxRijenPerVenster: 1000, venster: "1 hour" };
```

- `GEBRUIKERS` beschrijft de **bestaande** gebruikerstabel. De kolommen `entra_oid`, `mcp_rol_id` en `is_beheerder` voegt de migratie toe met vaste namen.
- `NOOIT_SCHRIJVEN` zijn de tabellen waarop de applicatie zelf handelt: lezen mag, schrijven nooit — ook niet als de rechtentabel anders beweert. Bij twijfel: opnemen.
- Voeg in [`src/database/beschermd.ts`](src/database/beschermd.ts) de identiteitsdragers van de klant aan de `DENYLIST` toe (sessies, tokens, API-sleutels, uitnodigingen). De gebruikerstabel en de drie `mcp_*`-tabellen staan er al.

Daarna: `pnpm run type-check` en `pnpm test`.

---

## Stap 3 — Database voorbereiden

### 3a. De tabellen van het rechtenmodel

Neem [`sql/01-mcp-tabellen.sql`](sql/01-mcp-tabellen.sql) op als migratie in het migratiesysteem van de klant (Drizzle, Prisma, ruwe SQL — volg wat de klant gebruikt), met `<gebruikerstabel>` ingevuld. Het maakt `mcp_rollen`, `mcp_rechten` en `mcp_schrijfquota` aan en voegt `entra_oid`, `mcp_rol_id` en `is_beheerder` toe aan de gebruikerstabel.

Er komt **geen enkel recht** mee: iedereen begint dicht. Meld dat aan de eigenaar vóór je de migratie draait — tot het scherm er is (deel B), werkt de MCP-toegang niet, en dat is de bedoeling.

Had de applicatie al een ouder rechtenveld voor MCP-toegang (een `mcp_rol`-nummer bijvoorbeeld)? Verwijder het in dezelfde migratie. Twee rechtenbronnen naast elkaar is precies de dubbelzinnigheid die dit model uitsluit.

### 3b. De drie databasegebruikers

Maak een kopie van [`sql/02-mcp-neon-rollen.sql`](sql/02-mcp-neon-rollen.sql) **buiten de repo**, vul de placeholders en de drie wachtwoorden in, en draai hem als eigenaar in de Neon SQL Editor. Gooi de kopie daarna weg.

Wat het doet: drie kale rollen (`mcp_lezer`, `mcp_schrijver`, `mcp_service`) zonder eigenaarschap en zonder `CREATE`; `search_path`, `statement_timeout` en read-only op de rol; `SELECT` per tabel aan de lezer, `SELECT/INSERT/UPDATE` per tabel aan de schrijver; en aan de service alleen wat hij nodig heeft: de rechten lezen, de `oid` binden, de teller bijwerken.

> ⚠️ **De MCP-gebruikers mogen nooit eigenaar van de tabellen zijn**, en nooit `DELETE` of `TRUNCATE` krijgen. Gebruik nooit `GRANT … ON ALL TABLES` of `ALTER DEFAULT PRIVILEGES` voor tabelrechten: een nieuwe tabel hoort dicht te zijn, ook in de database.

**Elke latere migratie die een bedrijfstabel toevoegt, bevat de bijbehorende `GRANT`-regels** — en werkt `sql/02` bij, zodat dat bestand een database vanaf nul kan opbouwen. De skill wijst je erop.

### 3c. Controleren

Draai [`sql/03-controle.sql`](sql/03-controle.sql). De eerste query moet **nul rijen** teruggeven. Let op: die query ziet alleen te ruime rechten; een ontbrekend recht (bijvoorbeeld geen `SELECT` voor `mcp_schrijver`, waardoor élke `UPDATE` faalt) bewijs je met `MCP_TEST_BRANCH=1 pnpm test` op een Neon-testbranch.

---

## Stap 4 — Azure App Registration

1. Ga naar [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Vul in:
   - **Name**: bv. `MCP-server <applicatienaam>`;
   - **Supported account types**: ⚠️ **"Accounts in this organizational directory only (Single tenant)"**;
   - **Redirect URI**: platform **Web**, waarde `http://localhost:8792/callback` (voor lokaal ontwikkelen).
3. Klik **Register** en noteer van de **Overview**-pagina:
   - **Application (client) ID** → wordt `AZURE_CLIENT_ID`;
   - **Directory (tenant) ID** → wordt `AZURE_TENANT_ID`.
4. Ga naar **Certificates & secrets** → **New client secret** → kies een verlooptermijn → kopieer **direct** de *Value* → wordt `AZURE_CLIENT_SECRET`.
   > ⏰ Zet een herinnering vóór de verloopdatum: een verlopen secret is de meest voorkomende oorzaak van een plots kapotte login (fout `AADSTS7000222`).
5. Ga naar **API permissions** en controleer dat de *delegated* permissions `openid`, `profile` en `email` aanwezig zijn (Microsoft Graph).
6. Ga naar **Token configuration** → **Add optional claim** → type **ID** → vink **email** aan → **Add**. De `oid`-claim staat altijd in het id_token; de server weigert een token zonder.
7. Kom je later terug voor productie (stap 7): voeg dan onder **Authentication** → **Web** → **Redirect URIs** ook `https://<worker>.<subdomein>.workers.dev/callback` toe.

---

## Stap 5 — Cloudflare opzetten

Elke klant krijgt een **eigen Cloudflare-account**, zodat kosten, toegang en logs gescheiden blijven.

### 5a. Account aanmaken

1. Maak het account aan op [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up), op een e-mailadres van de klant.
2. Bevestig het e-mailadres en zet tweestapsverificatie aan.
3. Het gratis Workers-plan volstaat voor de meeste klanten; zie [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/).

### 5b. Account-ID ophalen

Ga in het dashboard naar **Workers & Pages**. In de rechterkolom staat het **Account ID**. Zet dat in [`wrangler.jsonc`](wrangler.jsonc):

```jsonc
"account_id": "hier-het-account-id",
```

Zonder deze regel kiest wrangler zelf een account, of blijft hij wachten op een keuze — wat een AI-agent laat hangen.

### 5c. Authenticeren

**Werk je met de hand:** `pnpm exec wrangler login`.

**Werk je als AI-agent, of in CI:** `wrangler login` opent een browser en wacht — dat blokkeert. Gebruik een API-token:

1. [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → sjabloon **Edit Cloudflare Workers** → beperk tot het account van deze klant.
2. `export CLOUDFLARE_API_TOKEN=...` (bash) of `$env:CLOUDFLARE_API_TOKEN = "..."` (PowerShell).
3. Controleer met `pnpm exec wrangler whoami`.

### 5d. Worker-naam en subdomein

Kies in [`wrangler.jsonc`](wrangler.jsonc) een unieke `"name"` (bv. `acme-crm-mcp`). Stel in het dashboard onder **Workers & Pages → Subdomain** het workers.dev-subdomein in. De URL wordt `https://<name>.<subdomein>.workers.dev`.

### 5e. KV-namespace aanmaken

```bash
pnpm exec wrangler kv namespace create OAUTH_KV
```

Zet het teruggegeven **ID** in [`wrangler.jsonc`](wrangler.jsonc) onder `kv_namespaces`. De binding **moet** `OAUTH_KV` heten.

### 5f. Durable Objects

De MCP-sessies draaien als Durable Object met SQLite-opslag; beschikbaar op het gratis plan. Laat de `migrations`-sectie in `wrangler.jsonc` ongemoeid.

---

## Stap 6 — Lokaal ontwikkelen

```bash
cp .dev.vars.example .dev.vars   # daarna invullen
pnpm run dev                     # dev-server op http://localhost:8792
```

In `.dev.vars` vul je in: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `COOKIE_ENCRYPTION_KEY` (`openssl rand -hex 32`) en de drie connection strings `DATABASE_URL_LEZER`, `DATABASE_URL_SCHRIJVER`, `DATABASE_URL_SERVICE` (pooled host). Ontbreekt er één, dan weigert de server élke aanroep — bewust.

### Testen met de MCP Inspector

```bash
pnpm dlx @modelcontextprotocol/inspector
```

1. Kies transport **Streamable HTTP** en URL `http://localhost:8792/mcp`.
2. **Connect** → goedkeuringsdialoog → Microsoft-login.
3. Log in met een account dat een rij in de gebruikerstabel heeft én een rol (zolang het scherm er nog niet is: geef er tijdelijk één met de hand).
4. Onder **Tools** zie je 2 of 3 tools. Roep `lijst_tabellen` aan: precies de tabellen uit `mcp_rechten` van die rol, met kolommen en commentaar. 🎉

---

## Stap 7 — Deployen en verbinden

```bash
pnpm exec wrangler secret put AZURE_CLIENT_ID
pnpm exec wrangler secret put AZURE_CLIENT_SECRET
pnpm exec wrangler secret put AZURE_TENANT_ID
pnpm exec wrangler secret put COOKIE_ENCRYPTION_KEY
pnpm exec wrangler secret put DATABASE_URL_LEZER
pnpm exec wrangler secret put DATABASE_URL_SCHRIJVER
pnpm exec wrangler secret put DATABASE_URL_SERVICE

pnpm run deploy
pnpm exec wrangler tail          # live logs meekijken
```

Vergeet de productie-redirect-URI in Azure niet (stap 4, punt 7).

### Claude (web/desktop) als client

Voeg een **custom connector / remote MCP-server** toe met URL `https://<worker>.<subdomein>.workers.dev/mcp`. Claude ontdekt de OAuth-endpoints automatisch en start de Microsoft-login.

### Clients die alleen lokale (stdio) servers ondersteunen

```json
{
	"mcpServers": {
		"acme-crm": {
			"command": "npx",
			"args": ["mcp-remote", "https://<worker>.<subdomein>.workers.dev/mcp"]
		}
	}
}
```

> Hier staat bewust `npx`: deze configuratie draait op de machine van de eindgebruiker, los van deze repo.

---

## Beveiligingsnotities

- **De databaserol bepaalt wat er kán, de code bepaalt wat er mág.** Beide lagen zijn nodig; geen van beide is een vangnet voor de andere.
- **De gebruikerstabel en de `mcp_*`-tabellen zijn voor `mcp_lezer` en `mcp_schrijver` onzichtbaar.** Alleen `mcp_service` leest ze, en die kan verder niets — óók geen `UPDATE` op `mcp_rol_id` of `is_beheerder`.
- **Rechten komen bij elke tool-aanroep vers uit de database.** Een ingetrokken recht geldt bij de eerstvolgende aanroep, ook midden in een sessie.
- **Geen enkele terugval.** Ontbreekt een secret, dan weigert de server dienst; hernoemt iemand een beschermde tabel, dan ook.
- **Foutmeldingen zijn geen orakel.** Een onbestaande tabel, een gesloten tabel en een beschermde tabel geven dezelfde melding.
- **Secrets horen nergens in code of git**: lokaal alleen in `.dev.vars`, productie alleen via `wrangler secret put`.
- **Single-tenant is een harde grens**: Microsoft weigert accounts van buiten de tenant, en de server controleert daarbovenop `tid`, `aud` en `exp` van elk id_token.
- **De MCP-client krijgt nooit Microsoft-tokens te zien**: de OAuth-provider geeft eigen tokens uit.
- **Goedkeurings-cookies zijn HMAC-ondertekend** met `COOKIE_ENCRYPTION_KEY`; zonder die sleutel weigert de server te tekenen.

### Over de huisstijl van het inlogscherm

De goedkeuringsdialoog ([`src/auth/goedkeuring.ts`](src/auth/goedkeuring.ts)) draagt bewust het merk van de **leverancier**, niet van de klant: elke klant ziet hetzelfde scherm. Het logo en de naam staan daarom hardcoded in `src/auth/logo.ts` en `src/auth/goedkeuring.ts`. Dat is een keuze, geen omissie — laat het staan. Het rechtenscherm in de app draagt daarentegen wél de huisstijl van de klant (zie de design-brief).

---

## Problemen oplossen (FAQ)

| Symptoom | Oorzaak & oplossing |
|---|---|
| "De MCP-server is niet volledig geconfigureerd (… ontbreekt)" | Een van de zeven secrets ontbreekt. Zet hem in `.dev.vars` of met `wrangler secret put`. Er is bewust geen terugval. |
| "De MCP-server weigert dienst: een beschermde tabel is hernoemd of verdwenen" | Een naam uit de `DENYLIST` bestaat niet in het schema. Corrigeer `GEBRUIKERS.tabel` in `mcp.config.ts` of de lijst in `beschermd.ts`. |
| "Deze rol heeft geen toegang tot …" | Correct gedrag: geen rij in `mcp_rechten` voor die tabel, of de tabel is beschermd. Zet het recht in het rechtenscherm. |
| "Deze bewerking is niet toegestaan" bij een `UPDATE` die wél mag | Postgres' *permission denied*: `mcp_schrijver` mist `SELECT` op die tabel (nodig voor de `WHERE`), of de `GRANT` voor een nieuwe tabel ontbreekt. Zie `sql/02`, §4. |
| "Deze bewerking raakt te veel rijen en is niet uitgevoerd" | De rijgrens per statement (`LIMIETEN.maxRijenPerStatement`). Bewust; de bewerking is teruggedraaid. |
| "Er zijn de afgelopen tijd te veel rijen gewijzigd met deze rol" | De cumulatieve teller (`LIMIETEN.maxRijenPerVenster` per venster). Loopt vanzelf leeg. |
| Een functie of constructie wordt geweigerd in een legitieme leesquery | De allowlist in `analyse.ts` kent hem niet. Herschrijf de query, of breid de allowlist bewust uit (baan B in de skill). |
| Gebruiker ziet 2 tools maar zou moeten kunnen schrijven | Zijn rol heeft nergens `schrijven`. Zet het in het scherm; bij de volgende sessie verschijnt `schrijf_query`. |
| "DELETE is niet toegestaan" | Correct gedrag, voor elke rol. Soft delete via een statusveld en `UPDATE`. |
| Login geweigerd: "niet bekend of niet geactiveerd" | Geen rij op dat e-mailadres, of `mcp_rol_id` is `NULL`. Geef de gebruiker een rol in de app. |
| Iemand met een nieuw e-mailadres erft een oude rol | Kan niet: de koppeling loopt op `oid`. Wil je een rij aan een ander geven, zet dan `entra_oid` op `NULL` én wijzig het e-mailadres of de rol. |
| `AADSTS50011` (redirect URI mismatch) | De redirect-URI in Azure komt niet **exact** overeen. Lokaal `http://localhost:8792/callback`, productie `https://<worker-url>/callback`. |
| `AADSTS7000222` / login werkte en is nu kapot | Het client secret is verlopen. Nieuw secret in Azure, dan `.dev.vars` + `wrangler secret put AZURE_CLIENT_SECRET`. |
| `AADSTS50020` (user account does not exist in tenant) | De gebruiker hoort niet bij de tenant — precies wat single-tenant moet doen. |
| wrangler wacht of kiest het verkeerde account | `account_id` ontbreekt in `wrangler.jsonc`, of `CLOUDFLARE_API_TOKEN` is niet gezet. |
| Deploy-fout over KV of `VERVANG_MIJ…` | Stap 5e overgeslagen. |
| `pnpm install` zegt "Already up to date" maar er ontbreekt van alles | De klantrepo heeft een `pnpm-workspace.yaml`: gebruik `pnpm install --ignore-workspace` in `mcp-server/`. |
| Type-fouten rond `McpServer` na een dependency-update | Twee versies van `@modelcontextprotocol/sdk`. De override in `pnpm-workspace.yaml` houdt hem op 1.29.0. |

---

## Projectstructuur

```
├── README.md                    ← dit bestand: de complete setup-gids + het stappenplan
├── CLAUDE.md                    ← gids voor AI-agents die aan de code werken
├── wrangler.jsonc               ← Worker-configuratie (naam, account-ID, KV-ID)
├── .dev.vars.example            ← voorbeeld van alle secrets
├── pnpm-workspace.yaml          ← pnpm-instellingen (build-scripts, sdk-override)
├── vitest.config.ts
├── src/
│   ├── mcp.config.ts            ← ⭐ het enige config-bestand per klant
│   ├── index.ts                 ← entrypoint: MyMCP + OAuthProvider (alleen /mcp)
│   ├── types.ts                 ← Props (identiteit)
│   ├── auth/                    ← Entra ID-login, oid-binding, goedkeuringsdialoog
│   ├── database/                ← analyse, poort, beschermd, rechten, quota, uitvoering, verbinding
│   ├── tools/                   ← de drie tools + de registry
│   └── utils/                   ← uniforme succes-/foutantwoorden
├── test/                        ← testmatrix, omzeilingen, reviewbevindingen, databaserechten
├── sql/
│   ├── 01-mcp-tabellen.sql      ← migratiesjabloon
│   ├── 02-mcp-neon-rollen.sql   ← de drie databasegebruikers (bron van waarheid)
│   └── 03-controle.sql          ← controlequery's
└── docs/
    ├── opdracht-app-kant.md     ← ⭐ de opdracht voor het rechtenscherm (deel B)
    ├── design-brief-connector.md← ⭐ de vormgeving: invarianten + drie varianten
    ├── voorbeelden/             ← de drie referentiebeelden
    ├── referentie-app/          ← framework-agnostische logica-snippets
    ├── mcp-rechten/SKILL.md     ← de skill voor de klantrepo (deel C)
    └── claude-md-notitie.md     ← de blokken voor de CLAUDE.md van de klant
```
