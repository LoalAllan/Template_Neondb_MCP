# Template: MCP-server voor een bedrijfsapplicatie met Neon-database

**Waarvoor dient deze repo?**

Dit is een **template**, geen eindproduct. Een AI-coding agent haalt deze repo op en integreert hem in de codebase van een klant — altijd een bedrijfs- of CRM-applicatie met een **Neon Postgres-database** waarin een gebruikerslijst met verschillende rollen staat.

Het resultaat is per klant een eigen MCP-server: de gebruikers van die applicatie loggen in met hun Microsoft-account en krijgen via hun AI-client (Claude, bijvoorbeeld) toegang tot precies dat deel van de database dat bij hun rol hoort. Eén klant, één Cloudflare-account, één Worker, één set rollen.

```
   Codebase van de klant (CRM / bedrijfsapp)
   ├── app/                      de bestaande applicatie
   ├── mcp-server/               ← deze template komt hier te staan
   └── .claude/rules/            ← regels + rechtenlogboek voor de MCP-server

                    beide praten met dezelfde database
                                  │
   ┌──────────────────────────────┴──────────────────────────────┐
   │                    Neon Postgres (van de klant)             │
   │   gebruikers · klanten · projecten · facturen · ...         │
   └──────────────────────────────┬──────────────────────────────┘
                                  │  per rol een eigen Postgres-rol
                                  │  met eigen GRANT's
   ┌──────────────────────────────┴──────────────────────────────┐
   │        Cloudflare Worker (eigen account van de klant)       │
   │   OAuthProvider → Microsoft Entra ID (tenant van de klant)  │
   │   MyMCP (Durable Object) → rol opzoeken → tools registreren │
   └──────────────────────────────┬──────────────────────────────┘
                                  │  POST /mcp (Streamable HTTP)
                          MCP-client van de gebruiker
```

Wat de template meebrengt:

- 🔐 **Microsoft Entra ID (Azure AD)** als login — alleen accounts uit de tenant van de klant (single-tenant);
- 👥 **Tot 4 rollen**, per gebruiker instelbaar **in de database** en dus beheerbaar vanuit de UI van de applicatie;
- 🛠️ **Drie tools** — `lijst_tabellen`, `lees_query`, `voer_sql_uit` — die samen alles afdekken;
- 🛡️ **Afscherming door Postgres zelf**: elke rol draait op een eigen databaserol met eigen `GRANT`'s;
- 🚫 **Nooit verwijderen, nooit structuurwijzigingen**: `DELETE`, `DROP`, `CREATE` en `ALTER` zijn voor geen enkele rol mogelijk;
- 🚀 **Alleen Streamable HTTP** op `/mcp` — het moderne MCP-transport, geen verouderde SSE;
- 📋 Een **regelbestand** (`.claude/rules/mcp-rechten.md`) dat in de klantrepo afdwingt hoe rechten beheerd en gelogd worden.

---

## Hoe werkt de toegangscontrole?

1. De gebruiker logt in met zijn **Microsoft-account van de organisatie**. Single-tenant: accounts van buiten de tenant weigert Microsoft zelf al.
2. De server zoekt het **e-mailadres** (lowercase) op in de gebruikerstabel van de Neon-database en leest daar het **rolnummer**.
3. Staat dat nummer niet als rol geconfigureerd (0, `NULL`, of een onbekend getal)? → **login geweigerd** met een duidelijke melding.
4. Wél een geldige rol? → de sessie draait op de **database-verbinding van die rol**, en de gebruiker krijgt de tools van die rol.
5. Het rolnummer wordt bij **elke nieuwe MCP-sessie vers** uit de database gelezen. Een rolwijziging werkt dus door zonder her-login.

### Rollen zijn scopes, geen niveaus

Dit is het belangrijkste ontwerpbesluit van de template, en het wijkt af van wat je misschien verwacht.

**Rollen zijn niet hiërarchisch.** Rol 2 is niet "meer" dan rol 1. Elke rol is een eigen, afgesloten scope; rechten tellen nooit op. Elke rol ziet **dezelfde drie toolnamen**:

| Rol | Rechten | Tools | Tabellen |
|---|---|---|---|
| 1 · projectmedewerker | `lezen` | `lijst_tabellen`, `lees_query` | `projecten`, `taken` |
| 2 · accountmanager | `toevoegen` | + `voer_sql_uit` | + `klanten`, `contactpersonen` |
| 3 · beheerder | `wijzigen` | + `voer_sql_uit` | + `facturen` |

Een rol met `rechten: "lezen"` ziet 2 tools in plaats van 3. Dat is de enige toegestane variatie in de toolset.

De drie rechtenniveaus:

| Waarde | Wat de rol met data mag |
|---|---|
| `lezen` | `SELECT` — onbeperkt lezen en analyseren binnen de eigen tabellen |
| `toevoegen` | `SELECT` + `INSERT` — nieuwe rijen toevoegen, bestaande niet aanraken |
| `wijzigen` | `SELECT` + `INSERT` + `UPDATE` — ook bestaande rijen bijwerken |

**Waarom zo?** Zouden rollen cumuleren, dan kreeg een gebruiker meerdere query-tools naast elkaar en kon de AI-client niet meer verklaren waarom een tabel in de ene tool wél en in de andere niet bestaat. Nu is het simpel: er is één manier om te lezen, één om te schrijven, en de rol bepaalt wat er bestaat.

Moet een gebruiker minder kunnen? Dan haal je **tabellen uit zijn allowlist** of zet je zijn `rechten` lager — je schrijft geen beperktere tool.

### Wat de MCP-server nooit kan

Ongeacht de rol, ongeacht de configuratie:

| | |
|---|---|
| ❌ `DELETE`, `TRUNCATE` | er kan via de MCP nooit data verdwijnen |
| ❌ `DROP`, `CREATE`, `ALTER` | de databasestructuur verandert nooit — ook geen tijdelijke tabellen |
| ❌ `GRANT`, `REVOKE` | rechten worden buiten de MCP om beheerd |
| ❌ `MERGE`, `COPY`, `DO`, `CALL` | kunnen rijen verwijderen of buiten het rechtenmodel om werken |
| ❌ Meerdere statements per aanroep | één statement tegelijk |

Lezen is daarentegen **onbeperkt** binnen de tabellen van de rol: joins, CTE's (`WITH`), subqueries, window-functies, aggregaties en berekende kolommen mogen allemaal. Voor tussenresultaten gebruik je een CTE, niet een tijdelijke tabel.

> **Eén nuance, eerlijk gezegd:** een rol met `wijzigen` kan met een `UPDATE` velden leegmaken. Verwijderen is onmogelijk, overschrijven niet. Wil je dat ook uitsluiten, geef die rol dan `toevoegen`.
>
> Moet er wél iets "weg" kunnen? Gebruik een statusveld (soft delete) in de applicatie en laat een `wijzigen`-rol dat veld bijwerken. De rij blijft dan bestaan en is terug te draaien.

### Waar de afscherming echt zit

Niet in de applicatiecode. Elke rol heeft in Neon een **eigen Postgres-rol** met `GRANT`'s op precies de toegestane tabellen, en dus een eigen connection string als Worker-secret. Vraagt een tool iets buiten die scope, dan weigert **Postgres** dat.

Drie eigenschappen van die rol zijn samen wat verwijderen en structuurwijzigingen onmogelijk maakt:

1. **geen `DELETE`- of `TRUNCATE`-recht** — er kan niets verdwijnen;
2. **geen eigenaarschap van de tabellen** — een eigenaar kan altijd `DROP` en `ALTER`, hoe je de `GRANT`'s ook zet;
3. **geen `CREATE` op het schema** — anders maakt de rol eigen tabellen aan waar hij dan eigenaar (en dus almachtig) van is.

Daarboven nog twee lagen: `lees_query` draait in een `READ ONLY`-transactie (ook een schrijfrol kan er niets mee wijzigen), en de allowlist in `src/database/veiligheid.ts` weigert alles wat geen `SELECT`/`INSERT`/`UPDATE` is, mét uitleg in plaats van een ruwe Postgres-fout. Die allowlist is een vangnet: hij zorgt dat een verkeerd gezette `GRANT` niet meteen fataal is, maar de `GRANT`'s blijven de echte grens.

---

## Vereisten

- **Node.js 20+** en **pnpm** (installeer met `corepack enable pnpm` of `npm install -g pnpm`)
- Een **Cloudflare-account** voor deze klant (gratis volstaat) — zie [Stap 5](#stap-5--cloudflare-opzetten)
- Een **Azure-tenant** van de klant waarin je een App Registration mag aanmaken
- De **Neon-database** van de klantapplicatie, met rechten om rollen aan te maken

---

## 🤖 Snelstart voor AI-agents

Werk deze checklist van boven naar beneden af. Elke stap verwijst naar een detailsectie.

| # | Actie | Waar | Verificatie |
|---|---|---|---|
| 1 | Template in de klantrepo plaatsen | `mcp-server/` → **Stap 1** | `pnpm install` draait zonder fouten |
| 2 | Regelbestanden overnemen | `.claude/rules/` → **Stap 1** | beide bestanden staan er, logboek hernoemd naar de klantnaam |
| 3 | Rollen bepalen en vastleggen | [`src/rollen.config.ts`](src/rollen.config.ts) → **Stap 2** | `pnpm run type-check` schoon |
| 4 | Rolkolom in de gebruikerstabel | SQL uit **Stap 3** | testgebruiker heeft een geldig rolnummer |
| 5 | Postgres-rollen + `GRANT`'s in Neon | SQL uit **Stap 3** | één rol per MCP-rol, plus de auth-rol |
| 6 | Azure App Registration | Azure Portal → **Stap 4** | client-ID, tenant-ID en client secret in bezit |
| 7 | Cloudflare-account, account-ID, API-token | **Stap 5** | `wrangler whoami` toont het juiste account |
| 8 | KV-namespace + Worker-naam | **Stap 5** | geen `VERVANG_MIJ`-placeholder meer in `wrangler.jsonc` |
| 9 | `.dev.vars` invullen en lokaal testen | **Stap 6** | Inspector verbindt en toont de juiste tools |
| 10 | Secrets in productie + deploy | **Stap 7** | — |
| 11 | Productie-redirect-URI toevoegen in Azure | `https://<worker-url>/callback` | login werkt via de gedeployde URL |
| 12 | Rechtenmatrix invullen in het logboek | `.claude/rules/<Klant>_MCP_rules.md` | sectie A en B ingevuld |

> **Voor AI-agents:** verzin geen waarden voor secrets, tenant-ID's, account-ID's of KV-ID's — vraag die aan de gebruiker als ze ontbreken. Voeg geen tools toe en geen vijfde rol. Lees [`.claude/rules/mcp-rechten.md`](.claude/rules/mcp-rechten.md) vóór je aan het rechtenmodel komt, en [CLAUDE.md](CLAUDE.md) vóór je code wijzigt.

### Waarden die je per klant verzamelt

Houd deze lijst bij tijdens de opzet; ze horen allemaal in het logboekbestand (behalve de secrets zelf).

| Waarde | Waar vandaan | Waar nodig |
|---|---|---|
| Cloudflare account-ID | dashboard → Workers & Pages → rechterkolom | `wrangler.jsonc` |
| Worker-naam | zelf kiezen, uniek binnen het account | `wrangler.jsonc` |
| workers.dev-subdomein | dashboard → Workers & Pages → Subdomain | redirect-URI in Azure |
| KV-namespace-ID | `wrangler kv namespace create OAUTH_KV` | `wrangler.jsonc` |
| Azure client-ID + tenant-ID | Azure → App registrations → Overview | secrets |
| Azure client secret | Azure → Certificates & secrets | secret (verloopt!) |
| Neon auth-connection string | Neon → Connection Details | secret `DATABASE_URL` |
| Neon rol-connection strings | per aangemaakte Postgres-rol | secrets `DATABASE_URL_ROL_n` |

---

## Stap 1 — De template in de klantrepo plaatsen

De MCP-server komt als **submap** in de repo van de klantapplicatie te staan, met een eigen `package.json` en een eigen deploy. Eén repo, gedeelde database, gescheiden deploys.

```
klantrepo/
├── app/                      de bestaande applicatie
├── mcp-server/               ← de inhoud van deze template
│   ├── src/
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── wrangler.jsonc
│   └── CLAUDE.md
└── .claude/
    └── rules/
        ├── mcp-rechten.md          ← ongewijzigd overnemen
        └── <Klant>_MCP_rules.md    ← hernoemd sjabloon, per klant ingevuld
```

Wat je doet:

1. Kopieer de inhoud van deze repo naar `mcp-server/` — **zonder** de `.git`-map.
2. Verplaats `.claude/rules/mcp-rechten.md` en `.claude/rules/Bedrijfsapp_MCP_rules.md` naar `.claude/rules/` in de **root** van de klantrepo. Hernoem het tweede bestand naar de naam van de applicatie (bv. `Memoran_MCP_rules.md`). Claude Code leest die map automatisch mee.
3. Draai `pnpm install` **in `mcp-server/`**, niet in de root.
4. Verwijs vanuit de `CLAUDE.md` van de klantrepo naar `mcp-server/CLAUDE.md`, zodat een agent die in de root werkt weet dat de submap eigen regels heeft.

> **Lockfile-conflict vermijden.** Gebruikt de klantrepo een pnpm-workspace (`pnpm-workspace.yaml`), zet `mcp-server` dan **niet** in `packages:` — anders wordt de Worker mee gehoist en klopt de dependency-resolutie voor Cloudflare niet meer. Houd `mcp-server/pnpm-lock.yaml` apart. Gebruikt de klantrepo npm of yarn, dan is dat geen probleem: de submap heeft zijn eigen lockfile en wordt los geïnstalleerd.

---

## Stap 2 — Rollen bepalen

Open [`src/rollen.config.ts`](src/rollen.config.ts). Dat is het enige codebestand dat je voor de configuratie aanpast.

Kijk eerst hoe de klantapplicatie zijn rollen al bijhoudt (een tekstkolom `role`, een `role_id` naar een rollentabel, een koppeltabel) en beslis daarna welke MCP-rollen daaruit volgen. Vaak vallen meerdere applicatierollen samen in één MCP-rol — dat is prima, en vaak juist wenselijk, want er zijn er **maximaal 4**.

```ts
export const ROLLEN: Record<number, RolConfig> = {
	1: {
		naam: "projectmedewerker",
		secretNaam: "DATABASE_URL_ROL_1",
		rechten: "lezen",
		tabellen: ["projecten", "taken"],
	},
	2: {
		naam: "accountmanager",
		secretNaam: "DATABASE_URL_ROL_2",
		rechten: "toevoegen",
		tabellen: ["projecten", "taken", "klanten", "contactpersonen"],
	},
};
```

- De **sleutel** (1, 2, 3, 4) is het getal dat in de rolkolom van de gebruikerstabel staat.
- `rechten` is `"lezen"`, `"toevoegen"` of `"wijzigen"`. Bij `"lezen"` wordt `voer_sql_uit` niet geregistreerd — de gebruiker ziet 2 tools. Verwijderen en structuurwijzigingen zijn geen optie: die kunnen bij geen enkele waarde.
- `tabellen` is **beschrijvend**: het vult de tool-beschrijvingen zodat de AI-client weet waar hij mag zoeken. De `GRANT`'s in Neon zijn de waarheid.

`rechten` moet overeenkomen met de `GRANT`'s van de bijbehorende Postgres-rol (stap 3b). Klopt dat niet, dan krijgt de gebruiker een tool te zien die de database vervolgens weigert.

In hetzelfde bestand staat ook waar de gebruikerslijst zit:

```ts
export const GEBRUIKERS_TABEL = "gebruikers"; // of bv. "users"
export const EMAIL_KOLOM = "email";
export const ROL_KOLOM = "mcp_rol";
```

---

## Stap 3 — Database voorbereiden

Er zijn twee dingen nodig in de Neon-database van de klant: een **rolnummer per gebruiker**, en per MCP-rol een **eigen Postgres-rol**.

### 3a. Rolnummer per gebruiker

Heeft de applicatie al een gebruikerstabel (meestal wel), voeg dan één kolom toe:

```sql
-- Bestaande gebruikerstabel uitbreiden; iedereen begint op 0 = geen toegang
ALTER TABLE users
	ADD COLUMN mcp_rol integer NOT NULL DEFAULT 0
	CHECK (mcp_rol BETWEEN 0 AND 4);   -- pas de bovengrens aan je aantal rollen aan

-- Activeer daarna wie toegang moet krijgen:
UPDATE users SET mcp_rol = 2 WHERE email = 'iemand@klant.be';
```

Pas dan [`src/rollen.config.ts`](src/rollen.config.ts) aan (`GEBRUIKERS_TABEL = "users"`).

Heeft de applicatie nog geen gebruikerstabel, of wil je de MCP-toegang los houden:

```sql
CREATE TABLE gebruikers (
	id            serial PRIMARY KEY,
	email         text NOT NULL UNIQUE,       -- het Microsoft-e-mailadres
	naam          text,
	mcp_rol       integer NOT NULL DEFAULT 0  -- 0 = geen toegang, 1..4 = rol
	              CHECK (mcp_rol BETWEEN 0 AND 4),
	aangemaakt_op timestamptz NOT NULL DEFAULT now()
);

-- De server zoekt altijd op lower(email)
CREATE UNIQUE INDEX gebruikers_email_lower_idx ON gebruikers (lower(email));
```

Heeft de applicatie de rollen al als tekst of als foreign key, dan kun je de vertaling in de database leggen met een gegenereerde kolom of een trigger, zodat beheerders in de UI van de applicatie blijven werken en `mcp_rol` vanzelf volgt:

```sql
-- Voorbeeld: rolnaam uit de applicatie → MCP-rolnummer
ALTER TABLE users ADD COLUMN mcp_rol integer GENERATED ALWAYS AS (
	CASE role
		WHEN 'admin'      THEN 3
		WHEN 'manager'    THEN 2
		WHEN 'medewerker' THEN 1
		ELSE 0
	END
) STORED;
```

> **Tip:** koppel `mcp_rol` aan een instelling in de beheer-UI van de applicatie ("MCP-toegang: geen / medewerker / manager / admin"). Dan beheer je de toegang zonder ooit SQL te schrijven.

### 3b. Een Postgres-rol per MCP-rol

Dit is de eigenlijke afscherming. Maak in de Neon SQL-editor per MCP-rol een databaserol aan met `GRANT`'s op precies de toegestane tabellen.

> ⚠️ **De MCP-rollen mogen nooit eigenaar van de tabellen zijn.** Een eigenaar kan altijd `DROP` en `ALTER` uitvoeren, ongeacht welke `GRANT`'s je zet. Maak dus losse rollen aan — gebruik nooit `neondb_owner` of de rol waarmee de applicatie zelf migraties draait.

```sql
-- ── Auth-rol: mag ALLEEN de gebruikerstabel lezen ──────────────────────
CREATE ROLE mcp_auth LOGIN PASSWORD '<sterk-wachtwoord>';
GRANT USAGE ON SCHEMA public TO mcp_auth;
REVOKE CREATE ON SCHEMA public FROM mcp_auth;
GRANT SELECT (email, mcp_rol) ON users TO mcp_auth;

-- ── Rol 1: projectmedewerker — rechten: "lezen" ───────────────────────
CREATE ROLE mcp_rol1 LOGIN PASSWORD '<sterk-wachtwoord>';
GRANT USAGE ON SCHEMA public TO mcp_rol1;
REVOKE CREATE ON SCHEMA public FROM mcp_rol1;
GRANT SELECT ON projecten, taken TO mcp_rol1;

-- ── Rol 2: accountmanager — rechten: "toevoegen" ──────────────────────
CREATE ROLE mcp_rol2 LOGIN PASSWORD '<sterk-wachtwoord>';
GRANT USAGE ON SCHEMA public TO mcp_rol2;
REVOKE CREATE ON SCHEMA public FROM mcp_rol2;
GRANT SELECT, INSERT ON projecten, taken, klanten, contactpersonen TO mcp_rol2;
-- Sequences zijn nodig zodra een rol rijen mag INSERTen in tabellen met serial-kolommen:
GRANT USAGE ON SEQUENCE projecten_id_seq, taken_id_seq, klanten_id_seq TO mcp_rol2;

-- ── Rol 3: beheerder — rechten: "wijzigen" ────────────────────────────
CREATE ROLE mcp_rol3 LOGIN PASSWORD '<sterk-wachtwoord>';
GRANT USAGE ON SCHEMA public TO mcp_rol3;
REVOKE CREATE ON SCHEMA public FROM mcp_rol3;
GRANT SELECT, INSERT, UPDATE ON projecten, taken, klanten, contactpersonen, facturen TO mcp_rol3;
GRANT USAGE ON SEQUENCE projecten_id_seq, taken_id_seq, klanten_id_seq, facturen_id_seq TO mcp_rol3;

-- users: geen GRANT aan welke mcp_rol dan ook = bestaat niet voor de MCP.
-- Nergens DELETE, nergens TRUNCATE, nergens CREATE.
```

De `GRANT`'s per rechtenwaarde:

| `rechten` in de config | `GRANT` in Neon |
|---|---|
| `lezen` | `SELECT` |
| `toevoegen` | `SELECT, INSERT` (+ `USAGE` op de sequences) |
| `wijzigen` | `SELECT, INSERT, UPDATE` (+ `USAGE` op de sequences) |

`DELETE` en `TRUNCATE` komen in geen enkele rij voor. Dat is geen vergetelheid.

> **Over `REVOKE CREATE ON SCHEMA public`:** vanaf Postgres 15 geeft `public` dat recht niet meer standaard weg, maar op oudere databases en op zelf aangemaakte schema's wél. De `REVOKE` kost niets en dekt beide gevallen af — laat hem staan.

Haal daarna per rol de connection string op in de Neon Console (Connection Details → kies de rol). Die worden de secrets `DATABASE_URL` (voor `mcp_auth`) en `DATABASE_URL_ROL_1`, `_2`, … .

### Controleren dat er niets is blijven staan

Draai dit ná de opzet. Het moet **nul rijen** teruggeven:

```sql
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee LIKE 'mcp\_%'
  AND privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');
```

En dit toont de volledige rechtenkaart, om te vergelijken met `rollen.config.ts` en met de matrix in het logboek:

```sql
SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS rechten
FROM information_schema.role_table_grants
WHERE grantee LIKE 'mcp\_%'
GROUP BY grantee, table_name
ORDER BY grantee, table_name;
```

Regels om je aan te houden:

- ❌ **Nooit `DELETE` of `TRUNCATE`**, voor geen enkele rol.
- ❌ **Nooit eigenaarschap** van de tabellen bij een MCP-rol.
- ❌ **Nooit een `GRANT` op de gebruikers-/rollentabel** aan een MCP-rol. Anders zet een schrijfrol zijn eigen `mcp_rol` op het hoogste niveau.
- ❌ **Geen `ALTER DEFAULT PRIVILEGES`.** Daarmee krijgt een rol automatisch rechten op tabellen die later worden aangemaakt, en is de allowlist waardeloos.
- ✅ **Kolommen of rijen afschermen doe je met een view.** Maak een view met alleen de toegestane kolommen/rijen, geef daar `SELECT` op, en geef de onderliggende tabel géén `GRANT`. De view verschijnt dan gewoon in `lijst_tabellen`.

---

## Stap 4 — Azure App Registration

1. Ga naar [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Vul in:
   - **Name**: bv. `MCP-server <applicatienaam>`;
   - **Supported account types**: ⚠️ **"Accounts in this organizational directory only (Single tenant)"** — alléén accounts uit de organisatie van de klant kunnen dan inloggen;
   - **Redirect URI**: platform **Web**, waarde `http://localhost:8792/callback` (voor lokaal ontwikkelen).
3. Klik **Register** en noteer van de **Overview**-pagina:
   - **Application (client) ID** → wordt `AZURE_CLIENT_ID`;
   - **Directory (tenant) ID** → wordt `AZURE_TENANT_ID`.
4. Ga naar **Certificates & secrets** → **New client secret** → kies een verlooptermijn → kopieer **direct** de *Value* (die zie je maar één keer!) → wordt `AZURE_CLIENT_SECRET`.
   > ⏰ Zet een herinnering vóór de verloopdatum: een verlopen secret is de meest voorkomende oorzaak van een plots kapotte login (fout `AADSTS7000222`).
5. Ga naar **API permissions** en controleer dat de *delegated* permissions `openid`, `profile` en `email` aanwezig zijn (Microsoft Graph). `User.Read` mag blijven staan maar is niet vereist.
6. Ga naar **Token configuration** → **Add optional claim** → type **ID** → vink **email** aan → **Add**. Zo staat het e-mailadres gegarandeerd in het id_token.
7. Kom je later terug voor productie (stap 7): voeg dan onder **Authentication** → **Web** → **Redirect URIs** ook `https://<worker>.<subdomein>.workers.dev/callback` toe.

---

## Stap 5 — Cloudflare opzetten

Elke klant krijgt een **eigen Cloudflare-account**, zodat kosten, toegang en logs gescheiden blijven.

### 5a. Account aanmaken

1. Maak het account aan op [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up), op een e-mailadres van de klant.
2. Bevestig het e-mailadres en zet tweestapsverificatie aan.
3. Het gratis Workers-plan volstaat voor de meeste klanten. Bekijk de limieten op [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/); het betaalde plan ($5/maand) is nodig bij veel verkeer of langere CPU-tijd.

### 5b. Account-ID ophalen

Ga in het dashboard naar **Workers & Pages**. In de rechterkolom staat het **Account ID**. Zet dat in [`wrangler.jsonc`](wrangler.jsonc):

```jsonc
"account_id": "hier-het-account-id",
```

Zonder deze regel kiest wrangler zelf een account, of blijft hij wachten op een keuze — wat een AI-agent laat hangen zodra je toegang hebt tot meerdere accounts.

### 5c. Authenticeren

**Werk je met de hand:**

```bash
pnpm exec wrangler login
```

**Werk je als AI-agent, of in CI:** `wrangler login` opent een browser en wacht op interactie — dat blokkeert. Gebruik dan een API-token:

1. Ga naar [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token**.
2. Kies het sjabloon **Edit Cloudflare Workers**.
3. Beperk het token tot het account van deze klant en maak het aan.
4. Zet het token in de omgeving:

```bash
export CLOUDFLARE_API_TOKEN=...        # bash
$env:CLOUDFLARE_API_TOKEN = "..."      # PowerShell
```

Controleer met `pnpm exec wrangler whoami` dat je in het juiste account zit.

### 5d. Worker-naam en subdomein

Kies in [`wrangler.jsonc`](wrangler.jsonc) een unieke `"name"` (bv. `acme-crm-mcp`). Stel daarna in het dashboard onder **Workers & Pages → Subdomain** het workers.dev-subdomein in als dat er nog niet is. De volledige URL wordt:

```
https://<name>.<subdomein>.workers.dev
```

Die URL heb je nodig voor de Azure-redirect-URI (stap 4, punt 7) en voor de MCP-client.

### 5e. KV-namespace aanmaken

De OAuth-provider bewaart tokens, grants en client-registraties in KV:

```bash
pnpm exec wrangler kv namespace create OAUTH_KV
```

Het commando geeft een **ID** terug. Zet dat in [`wrangler.jsonc`](wrangler.jsonc):

```jsonc
"kv_namespaces": [
	{ "binding": "OAUTH_KV", "id": "hier-het-id-uit-het-commando" }
]
```

De binding **moet** `OAUTH_KV` heten — dat verwacht `@cloudflare/workers-oauth-provider`. Namespaces beheer je verder via [KV in het dashboard](https://developers.cloudflare.com/kv/).

### 5f. Durable Objects

De MCP-sessies draaien als [Durable Object](https://developers.cloudflare.com/durable-objects/) met SQLite-opslag (`new_sqlite_classes` in de `migrations`-sectie). Dat is beschikbaar op het gratis plan; je hoeft niets aan te zetten. Laat de `migrations`-sectie ongemoeid — hernoem je de klasse `MyMCP`, voeg dan een nieuwe migratie-tag toe in plaats van de bestaande te bewerken.

### 5g. Nuttige links

| | |
|---|---|
| Workers-documentatie | https://developers.cloudflare.com/workers/ |
| Wrangler-configuratie | https://developers.cloudflare.com/workers/wrangler/configuration/ |
| Secrets in Workers | https://developers.cloudflare.com/workers/configuration/secrets/ |
| Durable Objects | https://developers.cloudflare.com/durable-objects/ |
| Workers KV | https://developers.cloudflare.com/kv/ |
| Eigen domein koppelen | https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ |

---

## Stap 6 — Lokaal ontwikkelen

```bash
cp .dev.vars.example .dev.vars   # daarna invullen
pnpm run dev                     # dev-server op http://localhost:8792
```

In `.dev.vars` vul je in: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `COOKIE_ENCRYPTION_KEY` (genereer met `openssl rand -hex 32`), `DATABASE_URL` (de auth-verbinding) en één `DATABASE_URL_ROL_n` per rol.

### Testen met de MCP Inspector

```bash
pnpm dlx @modelcontextprotocol/inspector
```

1. Kies transport **Streamable HTTP** en URL `http://localhost:8792/mcp`.
2. Klik **Connect** → je gaat via de goedkeuringsdialoog naar het Microsoft-loginscherm.
3. Log in met een account dat in stap 3a een geldig rolnummer kreeg.
4. Onder **Tools** zie je 2 of 3 tools, afhankelijk van de rol. Roep `lijst_tabellen` aan: wat daar staat, moet exact overeenkomen met de allowlist van die rol. 🎉

---

## Stap 7 — Deployen en verbinden

```bash
# Secrets in productie zetten
pnpm exec wrangler secret put AZURE_CLIENT_ID
pnpm exec wrangler secret put AZURE_CLIENT_SECRET
pnpm exec wrangler secret put AZURE_TENANT_ID
pnpm exec wrangler secret put COOKIE_ENCRYPTION_KEY
pnpm exec wrangler secret put DATABASE_URL          # auth-verbinding
pnpm exec wrangler secret put DATABASE_URL_ROL_1    # per rol één
pnpm exec wrangler secret put DATABASE_URL_ROL_2

pnpm run deploy
pnpm exec wrangler tail          # live logs meekijken
```

Vergeet de productie-redirect-URI in Azure niet (stap 4, punt 7): `https://<worker>.<subdomein>.workers.dev/callback`.

### Claude (web/desktop) als client

Voeg een **custom connector / remote MCP-server** toe met URL:

```
https://<worker>.<subdomein>.workers.dev/mcp
```

Claude ontdekt de OAuth-endpoints automatisch en start de Microsoft-login.

### Clients die alleen lokale (stdio) servers ondersteunen

Gebruik [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) als brug:

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

> Hier staat bewust `npx`: deze configuratie draait op de machine van de eindgebruiker, los van deze repo en zijn package manager.

---

## Verifiëren dat alles werkt

1. **Leesrol** — inloggen met een gebruiker met `rechten: "lezen"`. Verwacht: **exact 2 tools**, geen `voer_sql_uit`.
2. **`lijst_tabellen`** — de lijst komt exact overeen met de allowlist van die rol in `rollen.config.ts`, en `mag_toevoegen`/`mag_wijzigen` kloppen met de `rechten`. Wijkt het af, dan lopen de `GRANT`'s en de config uiteen.
3. **Buiten de scope** — `lees_query` met `SELECT * FROM <tabel-buiten-de-rol>` → melding dat je rol daar geen toegang toe heeft. **Dit is de kernverificatie:** de code liet het toe, Postgres weigerde het.
4. **Verwijderen is onmogelijk** — `voer_sql_uit` met `DELETE FROM <tabel>` → geweigerd met uitleg. Controleer daarna in de **Neon SQL-editor als díé rol** dat `DELETE FROM <tabel>` óók daar op *permission denied* stuit. Slaagt hij daar wél, dan is de code de enige grens en staan de `GRANT`'s fout.
5. **Structuur is onaantastbaar** — als de MCP-rol in de Neon-editor: `DROP TABLE <tabel>` en `CREATE TABLE t (x int)` → beide *permission denied*. Dat bewijst dat eigenaarschap en `CREATE` correct zijn ingetrokken.
6. **Toevoegen versus wijzigen** — bij een `toevoegen`-rol: `INSERT` slaagt, `UPDATE` wordt geweigerd met de melding dat de rol alleen mag toevoegen.
7. **Andere rol** — rolnummer in de database wijzigen, verbinding verbreken en opnieuw verbinden. Verwacht: **3 tools** en een andere tabellijst. Rollen cumuleren niet.
8. **Rolwijziging tijdens een sessie** — rolnummer wijzigen zonder opnieuw te verbinden, dan `voer_sql_uit` aanroepen → geweigerd door de live her-check.
9. **Privilege escalation** — `voer_sql_uit` met `UPDATE users SET mcp_rol = 4 WHERE ...` → geweigerd door Postgres, want geen `GRANT` op die tabel.
10. **Weigering** — rolnummer op `0` zetten en inloggen → *"Toegang geweigerd"* met het e-mailadres erbij.
11. **Logboek** — staat de wijziging uit stap 7 ook in `.claude/rules/<Klant>_MCP_rules.md`? Zo niet, is de procedure niet gevolgd.

---

## Rechten aanpassen

Alles wat met rollen, tabellen en `GRANT`'s te maken heeft, valt onder **[`.claude/rules/mcp-rechten.md`](.claude/rules/mcp-rechten.md)**. Kort samengevat:

- maximaal **3 tools per rol** en maximaal **4 rollen** — harde grenzen;
- er komen **geen tools bij**; meer of minder rechten regel je via de tabel-allowlist;
- elke wijziging wordt vastgelegd in `.claude/rules/<Klant>_MCP_rules.md`, met de uitgevoerde SQL erbij.

De volledige procedure (scope → `GRANT` → secret → `rollen.config.ts` → loggen → verifiëren) staat in dat regelbestand.

---

## Beveiligingsnotities

- **De databaserol is de grens, niet de code.** Applicatiecode die SQL controleert is een vangnet; `GRANT`'s zijn de beveiliging.
- **De gebruikerstabel is voor geen enkele MCP-rol toegankelijk.** Alleen de aparte auth-verbinding leest hem, en die kan verder niets.
- **Secrets horen nergens in code of git**: lokaal alleen in `.dev.vars` (staat in `.gitignore`), productie alleen via `wrangler secret put`.
- **Single-tenant is een harde grens**: Microsoft weigert accounts van buiten de tenant, en de server controleert daarbovenop de `tid`-claim van elk id_token.
- **E-mail is de matching-sleutel** (bewuste keuze voor beheergemak). Wijzigt een e-mailadres in Azure, dan matcht de gebruiker niet meer — geen toegang, dus de veilige kant — tot de rij in de database bijgewerkt is. Het onveranderlijke Azure object-ID (`oid`) staat in de logs voor traceerbaarheid.
- **De MCP-client krijgt nooit Microsoft-tokens te zien**: de OAuth-provider geeft eigen tokens uit en bewaart de identiteit er versleuteld in.
- **Goedkeurings-cookies zijn HMAC-ondertekend** met `COOKIE_ENCRYPTION_KEY`; vervang die sleutel als hij ooit lekt (gebruikers moeten dan éénmalig opnieuw goedkeuren).

### Over de huisstijl van het inlogscherm

De goedkeuringsdialoog ([`src/auth/goedkeuring.ts`](src/auth/goedkeuring.ts)) draagt bewust het merk van de **leverancier**, niet van de klant: elke klant ziet hetzelfde scherm. Het logo en de naam staan daarom hardcoded in `src/auth/logo.ts` en `src/auth/entra-handler.ts`. Dat is een keuze, geen omissie — laat het staan.

---

## Problemen oplossen (FAQ)

| Symptoom | Oorzaak & oplossing |
|---|---|
| `Het secret DATABASE_URL_ROL_n ontbreekt` | De Postgres-rol is nog niet aangemaakt of het secret nog niet gezet. Zie stap 3b en stap 7. |
| `permission denied for table ...` | Correct gedrag: die tabel hoort niet bij deze rol. Wil je hem wél toevoegen, volg dan de procedure in `.claude/rules/mcp-rechten.md`. |
| `lijst_tabellen` toont meer/minder dan `rollen.config.ts` | De `GRANT`'s en de allowlist lopen uiteen. De `GRANT`'s zijn leidend; werk `rollen.config.ts` bij (of corrigeer de `GRANT`'s) en log het. |
| Gebruiker ziet 2 tools maar zou moeten kunnen schrijven | `rechten: "lezen"` in `rollen.config.ts`. Zet hem op `"toevoegen"` of `"wijzigen"` én geef de Postgres-rol de bijbehorende `GRANT`. |
| "Jouw rol mag alleen nieuwe gegevens toevoegen" | De rol staat op `rechten: "toevoegen"`. Dat weigert ook een upsert (`INSERT ... ON CONFLICT DO UPDATE`), want die wijzigt bestaande rijen. |
| "DELETE is met deze MCP-server niet mogelijk" | Correct gedrag, voor elke rol. Moet er iets "weg" kunnen, gebruik dan een statusveld (soft delete) en een `wijzigen`-rol. |
| `permission denied for sequence ...` bij een INSERT | De rol mist `GRANT USAGE ON SEQUENCE`. Zie stap 3b. |
| Een `DELETE` slaagt in de Neon-editor als een MCP-rol | Er staat een `DELETE`-`GRANT` die er niet hoort, of de rol is eigenaar van de tabel. Draai de controlequery uit stap 3b en trek het recht in. |
| `AADSTS50011` (redirect URI mismatch) | De redirect-URI in Azure komt niet **exact** overeen. Lokaal: `http://localhost:8792/callback`. Productie: `https://<worker-url>/callback`. Let op http vs https en de poort. |
| `AADSTS7000222` / login werkte en is nu kapot | Het client secret is verlopen. Maak een nieuw secret in Azure en update `.dev.vars` + `wrangler secret put AZURE_CLIENT_SECRET`. |
| `AADSTS50020` (user account does not exist in tenant) | De gebruiker hoort niet bij de tenant — precies wat single-tenant moet doen. |
| "Toegang geweigerd. Het e-mailadres ... is niet bekend" | Het rolnummer staat op 0/NULL, of is een getal dat niet in `ROLLEN` voorkomt. Controleer ook `GEBRUIKERS_TABEL`/`EMAIL_KOLOM` in `rollen.config.ts`. |
| wrangler wacht of kiest het verkeerde account | `account_id` ontbreekt in `wrangler.jsonc`, of `CLOUDFLARE_API_TOKEN` is niet gezet. Zie stap 5b en 5c. |
| Deploy-fout over KV of `VERVANG_MIJ...` | Stap 5e overgeslagen: maak de KV-namespace aan en vul het echte ID in. |
| Fout over Durable Objects / migraties bij deploy | Laat de `migrations`-sectie in `wrangler.jsonc` intact; voeg bij hernoemen een nieuwe tag toe. |
| `nodejs_compat`-foutmeldingen | De vlag `"compatibility_flags": ["nodejs_compat"]` moet in `wrangler.jsonc` blijven staan (nodig voor de OAuth-provider en de Neon-driver). |
| Er komt geen e-mailadres uit het id_token | Voeg de optional claim **email** toe (stap 4, punt 6). |

---

## Projectstructuur

```
├── README.md                    ← dit bestand: de complete setup-gids
├── CLAUDE.md                    ← gids voor AI-agents die aan de code werken
├── .claude/rules/
│   ├── mcp-rechten.md           ← ⭐ bindende regels voor het rechtenmodel
│   └── Bedrijfsapp_MCP_rules.md ← sjabloon voor het rechtenlogboek per klant
├── wrangler.jsonc               ← Worker-configuratie (naam, account-ID, KV-ID)
├── .dev.vars.example            ← voorbeeld van alle secrets
└── src/
    ├── index.ts                 ← entrypoint: MyMCP + OAuthProvider (alleen /mcp)
    ├── rollen.config.ts         ← ⭐ de rollen en hun tabellen (HET config-bestand)
    ├── types.ts                 ← Props (identiteit) en GebruikerRij
    ├── auth/                    ← Entra ID-login, goedkeuringsdialoog, OAuth-handler
    ├── database/                ← verbindingen (auth + per rol), lookup, SQL-vangnet
    ├── tools/                   ← de drie tools + de registry
    └── utils/                   ← uniforme succes-/foutantwoorden
```
