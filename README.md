# Template: Remote MCP-server met Azure-login en Neon-database

Een kant-en-klare template voor een **remote MCP-server** op **Cloudflare Workers**, met:

- 🔐 **Microsoft Entra ID (Azure AD)** als login — alleen gebruikers uit jouw organisatie (single-tenant);
- 🗄️ **Neon Postgres** als onderliggende database — typisch de database van een bestaande bedrijfsapplicatie (bv. een CRM);
- 👥 **1 tot 3 rolniveaus**, per gebruiker instelbaar **in de database** (en dus beheerbaar vanuit de UI van je applicatie);
- 🚀 **Alleen Streamable HTTP** op `/mcp` — het moderne MCP-transport, geen verouderde SSE;
- 🤖 Een architectuur waarmee een **AI coding agent** later heel eenvoudig tools toevoegt (zie [CLAUDE.md](CLAUDE.md)).

```
MCP-client (bv. Claude)
   │  POST /mcp  (Streamable HTTP, met OAuth-token)
   ▼
Cloudflare Worker
   ├── OAuthProvider ── de voordeur: valideert tokens, regelt de OAuth 2.1-flow
   │      └── EntraHandler ── login via login.microsoftonline.com (jouw tenant)
   └── MyMCP (Durable Object, één per sessie)
          └── init(): rol opzoeken in Neon → juiste tools registreren
                 ▼
          Neon Postgres (de database van jouw applicatie)
```

Deze template bevat **bewust nog geen businesstools** — alleen de complete basis (authenticatie, autorisatie, databasekoppeling) plus één diagnostische tool `wie_ben_ik` om de setup end-to-end te testen.

---

## Hoe werkt de toegangscontrole?

1. De gebruiker logt in met zijn **Microsoft-account van de organisatie** (single-tenant: accounts van buiten je tenant worden door Microsoft zelf al geweigerd).
2. De server zoekt het **e-mailadres** (lowercase) op in de gebruikerstabel van jouw Neon-database.
3. Daar staat per gebruiker een **rolniveau** in de kolom `mcp_rol`:

   | Waarde | Betekenis |
   |---|---|
   | `0` of `NULL` | ❌ Geen toegang tot de MCP-server |
   | `1` | ✅ Niveau 1 (bv. *gebruiker*) |
   | `2` | ✅ Niveau 2 (bv. *beheerder*) — omvat alles van niveau 1 |
   | `3` | ✅ Niveau 3 (bv. *admin*) — omvat alles van niveau 1 en 2 |

4. **Onbekend e-mailadres of niveau 0?** → De login wordt geweigerd met een duidelijke melding. Gebruikers activeer je door hun rolniveau in de database (of via de UI van je applicatie) op 1 of hoger te zetten.
5. Elke tool heeft een **minimaal vereist niveau**. Gebruikers met een te laag niveau krijgen die tool niet eens te zien.
6. Het rolniveau wordt bij **elke nieuwe MCP-sessie vers** uit de database gelezen: een rolwijziging werkt dus door zonder dat de gebruiker opnieuw hoeft in te loggen.

---

## Vereisten

- **Node.js 20+** en **pnpm** (installeer met `corepack enable pnpm` of `npm install -g pnpm`)
  > Liever toch npm? Dat kan: verwijder `pnpm-lock.yaml` en vervang in de commando's `pnpm run` door `npm run`, `pnpm exec` door `npx` en `pnpm dlx` door `npx`.
- Een **Cloudflare-account** (gratis volstaat) met de [wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Een **Azure-tenant** waarin je een App Registration mag aanmaken
- Een **Neon-database** (typisch die van je bestaande applicatie)

---

## 🤖 Snelstart voor AI-agents (en mensen met haast)

Werk deze checklist van boven naar beneden af. Elke stap verwijst naar een detailsectie hieronder.

| # | Actie | Waar | Verificatie |
|---|---|---|---|
| 1 | `pnpm install` | projectmap | geen fouten |
| 2 | Kies de rolniveaus (1, 2 of 3 stuks) | [`src/rollen.config.ts`](src/rollen.config.ts) → zie **Stap 1** | `pnpm run type-check` schoon |
| 3 | Maak of wijzig de gebruikerstabel in Neon | SQL uit **Stap 2** (variant A óf B) | `SELECT` geeft je testgebruiker met `mcp_rol >= 1` |
| 4 | Maak de Azure App Registration | Azure Portal → zie **Stap 3** | je hebt client-ID, tenant-ID en een client secret |
| 5 | Maak de KV-namespace en vul het ID in | `pnpm exec wrangler kv namespace create OAUTH_KV` → ID in [`wrangler.jsonc`](wrangler.jsonc) | geen `VERVANG_MIJ`-placeholder meer |
| 6 | Kies een Worker-naam | `"name"` in [`wrangler.jsonc`](wrangler.jsonc) | — |
| 7 | Kopieer `.dev.vars.example` → `.dev.vars` en vul de 5 waarden in | projectmap → zie **Stap 5** | `pnpm run dev` start zonder fouten |
| 8 | Test lokaal met de MCP Inspector | zie **Stap 5** | `wie_ben_ik` geeft je naam, e-mail en rol terug |
| 9 | Zet de 5 secrets in productie en deploy | `pnpm exec wrangler secret put ...` + `pnpm run deploy` → zie **Stap 6** | — |
| 10 | Voeg de productie-redirect-URI toe in Azure | `https://<jouw-worker>.workers.dev/callback` | login werkt via de gedeployde URL |
| 11 | Verbind je MCP-client | zie **Stap 6** | `wie_ben_ik` werkt in de client |

> **Voor AI-agents:** verzin geen waarden voor secrets, tenant-ID's of KV-ID's — vraag die aan de gebruiker als ze ontbreken. Wijzig niets aan het transport (alleen `/mcp`, geen SSE). Lees [CLAUDE.md](CLAUDE.md) vóór je tools toevoegt.

---

## Stap 1 — Rollen kiezen

Open [`src/rollen.config.ts`](src/rollen.config.ts). Dit is **het enige codebestand dat je hoeft aan te passen** voor de configuratie.

Kies hoeveel niveaus je nodig hebt en geef ze namen:

```ts
// Eén niveau — iedereen die toegang heeft, mag hetzelfde:
export const NIVEAUS: Record<number, string> = {
	1: "gebruiker",
};

// Twee niveaus — bv. lezen vs. alles:
export const NIVEAUS: Record<number, string> = {
	1: "gebruiker",
	2: "admin",
};

// Drie niveaus (de standaard van deze template):
export const NIVEAUS: Record<number, string> = {
	1: "gebruiker",
	2: "beheerder",
	3: "admin",
};
```

Het model is **hiërarchisch**: een hoger niveau omvat alle rechten van de niveaus eronder. De **nummers** staan in de database; de namen zijn beschrijvend (voor meldingen en de `wie_ben_ik`-tool).

In hetzelfde bestand stel je ook in **welke tabel en kolommen** de server gebruikt (zie stap 2):

```ts
export const GEBRUIKERS_TABEL = "gebruikers"; // of bv. "users"
export const EMAIL_KOLOM = "email";
export const ROL_KOLOM = "mcp_rol";
```

---

## Stap 2 — Database voorbereiden

De server heeft één ding nodig in jouw Neon-database: een tabel met per gebruiker een **e-mailadres** en een **rolniveau**. Kies één van de twee varianten.

### Variant A — Nieuwe tabel aanmaken

Gebruik dit als je applicatie nog geen gebruikerstabel heeft (of je de MCP-toegang apart wilt houden):

```sql
-- Gebruikerstabel voor de MCP-toegangscontrole
CREATE TABLE gebruikers (
	id           serial PRIMARY KEY,
	email        text NOT NULL UNIQUE,          -- het Microsoft-e-mailadres van de gebruiker
	naam         text,                          -- optioneel, puur informatief
	mcp_rol      integer NOT NULL DEFAULT 0     -- 0 = geen toegang, 1..3 = rolniveau
	             CHECK (mcp_rol BETWEEN 0 AND 3),
	aangemaakt_op timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitieve matching: de server zoekt altijd op lower(email)
CREATE UNIQUE INDEX gebruikers_email_lower_idx ON gebruikers (lower(email));

-- Voorbeeld: jezelf toevoegen met het hoogste niveau
INSERT INTO gebruikers (email, naam, mcp_rol)
VALUES ('jij@jouwbedrijf.be', 'Jouw Naam', 3);
```

### Variant B — Bestaande gebruikerstabel uitbreiden

Gebruik dit als je applicatie al een gebruikerstabel heeft (bv. `users` met een kolom `email`):

```sql
-- Voeg alleen de rolkolom toe; bestaande gebruikers krijgen 0 (= geen toegang)
ALTER TABLE users
	ADD COLUMN mcp_rol integer NOT NULL DEFAULT 0
	CHECK (mcp_rol BETWEEN 0 AND 3);

-- Activeer daarna wie toegang moet krijgen:
UPDATE users SET mcp_rol = 3 WHERE email = 'jij@jouwbedrijf.be';
```

Pas in dat geval [`src/rollen.config.ts`](src/rollen.config.ts) aan:

```ts
export const GEBRUIKERS_TABEL = "users";
export const EMAIL_KOLOM = "email";
export const ROL_KOLOM = "mcp_rol";
```

> **Tip:** koppel de kolom `mcp_rol` aan een instelling in de beheer-UI van je applicatie (bv. een dropdown "MCP-toegang: geen / gebruiker / beheerder / admin"). Dan beheer je de toegang zonder ooit SQL te hoeven schrijven. Kies je maar 1 of 2 niveaus, pas dan ook de `CHECK`-constraint aan (bv. `BETWEEN 0 AND 1`).

---

## Stap 3 — Azure App Registration

1. Ga naar [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Vul in:
   - **Name**: bv. `MCP-server <jouw applicatie>`;
   - **Supported account types**: ⚠️ **"Accounts in this organizational directory only (Single tenant)"** — dit zorgt ervoor dat alléén accounts uit jouw organisatie kunnen inloggen;
   - **Redirect URI**: platform **Web**, waarde `http://localhost:8792/callback` (voor lokaal ontwikkelen).
3. Klik **Register** en noteer van de **Overview**-pagina:
   - **Application (client) ID** → wordt `AZURE_CLIENT_ID`;
   - **Directory (tenant) ID** → wordt `AZURE_TENANT_ID`.
4. Ga naar **Certificates & secrets** → **New client secret** → kies een verlooptermijn → kopieer **direct** de *Value* (die zie je maar één keer!) → wordt `AZURE_CLIENT_SECRET`.
   > ⏰ Zet een herinnering vóór de verloopdatum: een verlopen secret is de meest voorkomende oorzaak van een plots kapotte login (fout `AADSTS7000222`).
5. Ga naar **API permissions** en controleer dat de *delegated* permissions `openid`, `profile` en `email` aanwezig zijn (Microsoft Graph). `User.Read` mag blijven staan maar is niet vereist.
6. Ga naar **Token configuration** → **Add optional claim** → type **ID** → vink **email** aan → **Add**. (Zo staat het e-mailadres gegarandeerd in het id_token.)
7. Kom je later terug voor productie (stap 6): voeg dan onder **Authentication** → **Web** → **Redirect URIs** ook `https://<jouw-worker>.<jouw-account>.workers.dev/callback` toe.

---

## Stap 4 — Cloudflare instellen

```bash
# Eénmalig inloggen bij Cloudflare
pnpm exec wrangler login

# KV-namespace aanmaken voor de OAuth-opslag (tokens, grants)
pnpm exec wrangler kv namespace create OAUTH_KV
```

Het tweede commando geeft een **ID** terug. Zet dat in [`wrangler.jsonc`](wrangler.jsonc):

```jsonc
"kv_namespaces": [
	{
		"binding": "OAUTH_KV",
		"id": "hier-het-id-uit-het-commando"
	}
]
```

Kies in hetzelfde bestand ook een unieke naam voor je Worker (`"name"`).

---

## Stap 5 — Lokaal ontwikkelen

```bash
# 1. Secrets-bestand aanmaken en invullen (zie de uitleg per veld in het bestand)
cp .dev.vars.example .dev.vars

# 2. Dev-server starten op http://localhost:8792
pnpm run dev
```

In `.dev.vars` vul je de vijf waarden in: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `COOKIE_ENCRYPTION_KEY` (genereer met `openssl rand -hex 32`) en `DATABASE_URL` (je Neon connection string, bij voorkeur de *pooled* variant met `-pooler` in de hostnaam).

### Testen met de MCP Inspector

```bash
pnpm dlx @modelcontextprotocol/inspector
```

1. Open de Inspector in je browser, kies transport **Streamable HTTP** en URL `http://localhost:8792/mcp`.
2. Klik **Connect** → je wordt naar de goedkeuringsdialoog en daarna naar het Microsoft-loginscherm gestuurd.
3. Log in met een account dat in stap 2 een rolniveau ≥ 1 kreeg.
4. Roep onder **Tools** de tool `wie_ben_ik` aan → je ziet je naam, e-mailadres en rolniveau. 🎉

---

## Stap 6 — Deployen en verbinden

```bash
# De 5 secrets in productie zetten (zelfde waarden als .dev.vars, of aparte prod-app-registratie)
pnpm exec wrangler secret put AZURE_CLIENT_ID
pnpm exec wrangler secret put AZURE_CLIENT_SECRET
pnpm exec wrangler secret put AZURE_TENANT_ID
pnpm exec wrangler secret put COOKIE_ENCRYPTION_KEY
pnpm exec wrangler secret put DATABASE_URL

# Deployen
pnpm run deploy
```

Vergeet niet de productie-redirect-URI toe te voegen in Azure (stap 3, punt 7): `https://<jouw-worker>.<jouw-account>.workers.dev/callback`.

### Claude (web/desktop) als client

Voeg in Claude een **custom connector / remote MCP-server** toe met URL:

```
https://<jouw-worker>.<jouw-account>.workers.dev/mcp
```

Claude ontdekt de OAuth-endpoints automatisch en start de Microsoft-login.

### Clients die alleen lokale (stdio) servers ondersteunen

Gebruik [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) als brug, bv. in een `mcp.json` / `claude_desktop_config.json`:

```json
{
	"mcpServers": {
		"mijn-crm": {
			"command": "npx",
			"args": ["mcp-remote", "https://<jouw-worker>.<jouw-account>.workers.dev/mcp"]
		}
	}
}
```

> Hier staat bewust `npx`: deze configuratie draait op de machine van de eindgebruiker, los van deze repo en zijn package manager.

---

## Verifiëren dat alles werkt

1. **`wie_ben_ik`** aanroepen → juiste naam, e-mail en rolniveau.
2. **Rolwijziging testen**: zet in de database `mcp_rol` op een andere waarde, start een **nieuwe** sessie (verbinding verbreken en opnieuw verbinden) → het nieuwe niveau is actief.
3. **Weigering testen**: zet `mcp_rol` op `0` (of verwijder de rij) en log in → je krijgt de melding *"Toegang geweigerd"* met je e-mailadres erbij.
4. **Logs bekijken** tijdens het testen: `pnpm exec wrangler tail` (productie) of de console van `pnpm run dev` (lokaal).

---

## Nieuwe tools toevoegen

Dat is waar deze template voor gemaakt is. Het recept in het kort:

1. Maak `src/tools/<naam>.ts` naar het voorbeeld van [`src/tools/wie-ben-ik.ts`](src/tools/wie-ben-ik.ts);
2. Kies het `MIN_NIVEAU` van de tool;
3. Voeg één regel toe in [`src/tools/register-tools.ts`](src/tools/register-tools.ts);
4. `pnpm run type-check`.

Het volledige recept — inclusief database-toegang, rol-gating en valkuilen — staat in **[CLAUDE.md](CLAUDE.md)**. Geef dat bestand aan je AI coding agent; het is er speciaal voor geschreven.

---

## Beveiligingsnotities

- **Secrets horen nergens in de code of git**: lokaal alleen in `.dev.vars` (staat in `.gitignore`), productie alleen via `wrangler secret put`.
- **Single-tenant is een harde grens**: Microsoft weigert accounts van buiten je tenant, en de server controleert daarbovenop de `tid`-claim van elk id_token.
- **E-mail is de matching-sleutel** (bewuste keuze voor beheergemak). Weet dat een e-mailadres in Azure kan wijzigen: de gebruiker matcht dan niet meer (= geen toegang, veilige kant) tot je de rij in de database bijwerkt. Het onveranderlijke Azure object-ID (`oid`) wordt in de logs meegeschreven voor traceerbaarheid.
- **De MCP-client krijgt nooit Microsoft-tokens te zien**: de OAuth-provider geeft eigen tokens uit en bewaart de identiteit er versleuteld in.
- **Goedkeurings-cookies zijn HMAC-ondertekend** met `COOKIE_ENCRYPTION_KEY`; vervang die sleutel als hij ooit lekt (gebruikers moeten dan éénmalig opnieuw goedkeuren).
- **Schrijf tools altijd met geparametriseerde queries** (zie CLAUDE.md) — nooit gebruikersinvoer in SQL-strings plakken.

---

## Problemen oplossen (FAQ)

| Symptoom | Oorzaak & oplossing |
|---|---|
| `AADSTS50011` (redirect URI mismatch) | De redirect-URI in Azure komt niet **exact** overeen. Lokaal: `http://localhost:8792/callback`. Productie: `https://<worker-url>/callback`. Let op http vs https en de poort. |
| `AADSTS7000222` / login werkte en is nu kapot | Het client secret is verlopen. Maak in Azure een nieuw secret en update `.dev.vars` + `wrangler secret put AZURE_CLIENT_SECRET`. |
| `AADSTS50020` (user account ... does not exist in tenant) | De gebruiker hoort niet bij jouw tenant — dat is precies wat single-tenant moet doen. Gebruik een account uit de eigen organisatie. |
| "Toegang geweigerd. Het e-mailadres ... is niet bekend" | Het e-mailadres staat niet (of met `mcp_rol` 0/NULL) in de gebruikerstabel. Controleer ook of `GEBRUIKERS_TABEL`/`EMAIL_KOLOM` in `rollen.config.ts` kloppen, en of het Azure-e-mailadres exact overeenkomt. |
| Deploy-fout over KV of `VERVANG_MIJ...` | Stap 4 overgeslagen: maak de KV-namespace aan en vul het echte ID in `wrangler.jsonc` in. |
| Fout over Durable Objects / migraties bij deploy | Laat de `migrations`-sectie in `wrangler.jsonc` intact. Hernoem je de klasse `MyMCP`, voeg dan een nieuwe migratie-tag toe in plaats van de oude te bewerken. |
| `nodejs_compat`-foutmeldingen | De vlag `"compatibility_flags": ["nodejs_compat"]` moet in `wrangler.jsonc` blijven staan (nodig voor de OAuth-provider en de Neon-driver). |
| Database-fouten bij elke query | Controleer `DATABASE_URL` (Neon Console → Connection Details; gebruik de pooled string met `-pooler`). Test los met `SELECT 1` via de Neon SQL-editor. |
| Er komt geen e-mailadres uit het id_token | Voeg de optional claim **email** toe (stap 3, punt 6). De server valt terug op `preferred_username`, maar die vangnet-route werkt alleen als het UPN een e-mailadres is. |

---

## Projectstructuur

```
├── README.md               ← dit bestand: de complete setup-gids
├── CLAUDE.md               ← gids voor AI-agents die tools toevoegen
├── wrangler.jsonc          ← Worker-configuratie (naam, KV-ID invullen!)
├── .dev.vars.example       ← voorbeeld van de 5 secrets
└── src/
    ├── index.ts            ← entrypoint: MyMCP + OAuthProvider (alleen /mcp)
    ├── rollen.config.ts    ← ⭐ rolniveaus + database-koppeling (HET config-bestand)
    ├── types.ts            ← Props (identiteit) en GebruikerRij
    ├── auth/               ← Entra ID-login, goedkeuringsdialoog, OAuth-handler
    ├── database/           ← Neon-verbinding en gebruikers-lookup
    ├── tools/              ← tool-registry + voorbeeldtool wie_ben_ik
    └── utils/              ← uniforme succes-/foutantwoorden
```
