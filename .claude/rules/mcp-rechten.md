# Regels voor het rechtenmodel van de MCP-server

> **Voor AI-coding agents.** Dit bestand is bindend. Het beschrijft hoe de MCP-server in `mcp-server/` toegang geeft tot de Neon-database van deze applicatie, en welke grenzen daarbij gelden. Wijk hier niet van af zonder expliciete toestemming van de eigenaar van het project.
>
> Kopieer dit bestand ongewijzigd mee naar `.claude/rules/` van elke klantrepo waarin deze MCP-template landt. De klantspecifieke invulling hoort in het logboek — zie [Verplicht loggen](#verplicht-loggen).

---

## 1. Wat deze server is

Een remote MCP-server die gebruikers van deze bedrijfsapplicatie via hun Microsoft-account laat praten met de Neon-database die achter de applicatie ligt. Welke gegevens iemand ziet, hangt af van zijn rol in de applicatie.

De server is geen tweede applicatie: hij voegt geen businesslogica toe. Hij geeft een AI-client gecontroleerde SQL-toegang tot een afgebakend deel van de database.

---

## 2. De harde grenzen

Deze drie grenzen zijn absoluut. Loop je ertegenaan, **stop dan en vraag de eigenaar om een beslissing** — overschrijd ze niet op eigen initiatief en los het ook niet creatief op.

| Grens | Waarde |
|---|---|
| Aantal tools per rol | **maximaal 3** |
| Aantal rollen | **maximaal 4** |
| Verwijderen en structuurwijzigingen | **nooit, voor geen enkele rol** |

De drie tools liggen vast en staan in `mcp-server/src/tools/sql-tools.ts`:

| Tool | Doel | Annotatie |
|---|---|---|
| `lijst_tabellen` | toont welke tabellen en kolommen deze rol mag benaderen | `readOnlyHint` |
| `lees_query` | voert een `SELECT` uit | `readOnlyHint` |
| `voer_sql_uit` | voegt rijen toe (`INSERT`), en bij `wijzigen` ook `UPDATE` | `destructiveHint` |

Een rol met `rechten: "lezen"` krijgt `voer_sql_uit` niet geregistreerd en ziet dus **2** tools. Dat is de enige toegestane variatie in de toolset.

### Wat er nooit mogelijk is

Ongeacht de rol, ongeacht de configuratie, ongeacht wat er gevraagd wordt:

```
DELETE · TRUNCATE · DROP · CREATE · ALTER · GRANT · REVOKE · MERGE · COPY · DO · CALL
```

Er kan via deze MCP-server **geen data verdwijnen** en **niets aan de databasestructuur veranderen** — ook geen tijdelijke tabellen. Voor tussenresultaten bij analyse gebruik je een CTE (`WITH ...`) of een subquery.

Lezen is daarentegen **onbeperkt** binnen de tabellen van de rol: joins, CTE's, subqueries, window-functies, aggregaties en berekende kolommen zijn allemaal toegestaan en gewenst. De bedoeling is dat de agent veel vrijheid heeft om data op te halen en te combineren — de beperking zit alleen op wat er wéggaat of verandert.

### De drie rechtenwaarden

`RolConfig.rechten` in `mcp-server/src/rollen.config.ts`:

| Waarde | Wat de rol met data mag | `GRANT` in Neon |
|---|---|---|
| `lezen` | alleen uitlezen en analyseren | `SELECT` |
| `toevoegen` | + nieuwe rijen toevoegen | `SELECT, INSERT` |
| `wijzigen` | + bestaande rijen bijwerken | `SELECT, INSERT, UPDATE` |

`DELETE` en `TRUNCATE` staan in geen enkele rij. Dat is geen vergetelheid.

---

## 3. Het rolmodel: scopes, geen niveaus

**Rollen zijn niet hiërarchisch.** Rol 2 is niet "meer" dan rol 1. Elke rol is een eigen, afgesloten scope. Rechten tellen nooit op.

Elke rol krijgt **dezelfde toolnamen**. Nooit varianten als `lees_query_klanten` of `lees_query_projecten`. Zodra een gebruiker meerdere query-tools naast elkaar ziet, kan de AI-client niet meer verklaren waarom een tabel in de ene tool wél en in de andere niet bestaat — precies de verwarring die dit model moet voorkomen.

Het verschil tussen rollen zit **uitsluitend** in welke tabellen zichtbaar zijn en in de `rechten`-waarde:

```
rol 1  projectmedewerker   lezen       lijst_tabellen, lees_query                 → projecten, taken
rol 2  accountmanager      toevoegen   lijst_tabellen, lees_query, voer_sql_uit   → + klanten, contactpersonen
rol 3  beheerder           wijzigen    lijst_tabellen, lees_query, voer_sql_uit   → + facturen
```

`lees_query` en `voer_sql_uit` zijn de zwaarste tools die bestaan. Moet een gebruiker minder kunnen, dan **haal je tabellen uit zijn allowlist** of **zet je zijn `rechten` lager** — je schrijft geen beperktere tool.

---

## 4. Waar de afscherming echt zit

Niet in de applicatiecode. Elke MCP-rol heeft in Neon een **eigen Postgres-rol** met `GRANT`'s op precies de toegestane tabellen, en dus een eigen connection string als Worker-secret.

```sql
-- De MCP-rol mag NOOIT eigenaar zijn: een eigenaar kan altijd DROP en ALTER,
-- ongeacht welke GRANT's je geeft. Dus een losse rol, niet neondb_owner.
CREATE ROLE mcp_rol2 LOGIN PASSWORD '<sterk-wachtwoord>';

-- Alleen USAGE op het schema — géén CREATE, anders maakt de rol eigen tabellen
-- aan waar hij vervolgens eigenaar (en dus almachtig) van is.
GRANT USAGE ON SCHEMA public TO mcp_rol2;
REVOKE CREATE ON SCHEMA public FROM mcp_rol2;

-- Nooit DELETE, nooit TRUNCATE. Alleen wat bij de rechten-waarde hoort:
GRANT SELECT, INSERT ON klanten, projecten, taken TO mcp_rol2;
GRANT USAGE ON SEQUENCE klanten_id_seq, projecten_id_seq, taken_id_seq TO mcp_rol2;

-- facturen en gebruikers: geen GRANT = bestaan niet voor deze rol
```

Vraagt een tool iets buiten die scope, dan weigert **Postgres** dat — er komt geen regel applicatiecode aan te pas. De code kan er dus ook niet naast zitten.

Drie eigenschappen van de rol maken verwijderen en structuurwijzigingen samen onmogelijk:

1. **geen `DELETE`/`TRUNCATE`-recht** — er kan niets verdwijnen;
2. **geen eigenaarschap** — een eigenaar kan altijd `DROP` en `ALTER`;
3. **geen `CREATE` op het schema** — anders maakt de rol eigen tabellen waar hij eigenaar van is.

De lijst `tabellen` in `rollen.config.ts` is **beschrijvend**: hij vult de tool-beschrijvingen zodat de AI-client weet waar hij mag zoeken. De `GRANT`'s zijn de waarheid. Twijfel je? Roep `lijst_tabellen` aan — die leest de werkelijke rechten uit `information_schema` en toont per tabel `mag_toevoegen` en `mag_wijzigen`.

Twee extra lagen, in deze volgorde van belang:

1. `lees_query` draait in een **`READ ONLY`-transactie**, zodat ook een rol mét schrijfrechten er niets mee kan wijzigen.
2. De **allowlist** in `mcp-server/src/database/veiligheid.ts` laat alleen `SELECT`, `WITH`, `INSERT` en (bij `wijzigen`) `UPDATE` door, en weigert al de rest op naam mét uitleg. Hij strookt commentaar en stringliterals eerst weg, zodat `-- x⏎DELETE FROM ...` niet doorglipt en een onschuldige `WHERE tekst = 'graag verwijderen'` geen vals alarm geeft. Dit is een vangnet dat een verkeerd gezette `GRANT` niet meteen fataal maakt — de `GRANT`'s blijven de echte grens.

### Gebruik geen `ALTER DEFAULT PRIVILEGES`

Daarmee krijgt een rol automatisch rechten op tabellen die later worden aangemaakt. Dat maakt de allowlist waardeloos. Rechten worden per tabel expliciet toegekend.

### Controlequery na elke wijziging

Moet nul rijen teruggeven:

```sql
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee LIKE 'mcp\_%'
  AND privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');
```

---

## 5. Verboden

- ❌ **Een `DELETE`- of `TRUNCATE`-`GRANT`** aan welke MCP-rol dan ook. Er verdwijnt via deze server nooit data.
- ❌ **Eigenaarschap van tabellen** bij een MCP-rol, en **`CREATE` op het schema**. Beide omzeilen elke `GRANT`.
- ❌ **De allowlist in `veiligheid.ts` verruimen** met DDL- of `DELETE`-statements.
- ❌ **Een `GRANT` op de gebruikers-/rollentabel** aan welke MCP-rol dan ook. Een rol met schrijfrechten zou daarmee zijn eigen rolniveau kunnen ophogen. Alleen de aparte auth-verbinding (`DATABASE_URL`) leest die tabel.
- ❌ **Een vierde tool** of **een vijfde rol**.
- ❌ **Toolnamen die per rol verschillen.**
- ❌ **Rechten afdwingen in toolcode** (een lijstje geblokkeerde tabelnamen in TypeScript, een regex over de aangeleverde SQL). Rechten horen in `GRANT`'s.
- ❌ **`ALTER DEFAULT PRIVILEGES`** voor een MCP-rol.
- ❌ **Het rolnummer in `Props` stoppen** of uit het token lezen. De rol komt bij elke nieuwe sessie vers uit de database, anders werken rolwijzigingen niet door.
- ❌ **Connection strings in code, logs of commits.** Alleen `.dev.vars` (lokaal) en `wrangler secret put` (productie).
- ❌ **SSE toevoegen.** Streamable HTTP op `/mcp` is het enige transport.
- ❌ **Rechten wijzigen zonder het te loggen** — zie hieronder.

---

## 6. Procedure: een rol toevoegen of wijzigen

Werk deze stappen in deze volgorde af. De wijziging is pas af als stap 5 gedaan is.

1. **Scope bepalen.** Welke tabellen mag deze rol zien, en welke `rechten` (`lezen`/`toevoegen`/`wijzigen`)? Leg dit voor aan de eigenaar als het niet expliciet is opgedragen.
2. **Postgres-rol maken of aanpassen in Neon.** `CREATE ROLE` (niet als eigenaar) + `GRANT USAGE` + `REVOKE CREATE ON SCHEMA` + de `GRANT`'s die bij de `rechten` horen, of `REVOKE` bij intrekken. Noteer de exact uitgevoerde SQL — die gaat mee in het logboek.
3. **Connection string als secret zetten:** `pnpm exec wrangler secret put DATABASE_URL_ROL_<n>` (en lokaal in `.dev.vars`).
4. **`ROLLEN` bijwerken** in `mcp-server/src/rollen.config.ts`: `naam`, `secretNaam`, `rechten`, `tabellen`. Daarna `pnpm run type-check`.
5. **Loggen** in het logboekbestand (zie hieronder). Zonder deze stap is de wijziging niet af.
6. **Verifiëren.** Verbind met een testgebruiker die deze rol heeft en roep `lijst_tabellen` aan. De tabellen moeten overeenkomen met de allowlist, en `mag_toevoegen`/`mag_wijzigen` met de `rechten`. Draai daarna de controlequery hierboven: nul rijen.

Een rol intrekken gaat andersom: `REVOKE` in Neon → gebruikers in de applicatie naar een andere rol → secret verwijderen → entry uit `ROLLEN` → loggen.

---

## 7. Verplicht loggen

**Elke wijziging aan het rechtenmodel wordt vastgelegd in `.claude/rules/<Bedrijfsapp>_MCP_rules.md`**, waarbij `<Bedrijfsapp>` de naam van deze applicatie is (bijvoorbeeld `Memoran_MCP_rules.md`).

Onder "wijziging aan het rechtenmodel" valt:

- een rol toevoegen, hernoemen of verwijderen;
- een tabel toevoegen aan of verwijderen uit de allowlist van een rol;
- de `rechten` van een rol wijzigen (`lezen` ↔ `toevoegen` ↔ `wijzigen`);
- een `GRANT` of `REVOKE` in Neon;
- een rol-secret toevoegen, vervangen of verwijderen.

Het logboek heeft twee vaste secties, beide verplicht bij te werken:

**A. Actuele rechtenmatrix** — de stand van nu: één regel per rol met rolnummer, naam, Postgres-rol, secretnaam, lezen/schrijven, en de toegestane tabellen. Vermeld er expliciet bij wat er *niet* in zit ten opzichte van de volledige tabellijst, zodat in één oogopslag zichtbaar is wat een rol mist.

**B. Changelog** — append-only. Nieuwe regels komen bovenaan; bestaande regels worden nooit aangepast of verwijderd. Per regel: datum, wie, welke rol, wat er wijzigde, waarom, en de daadwerkelijk uitgevoerde SQL.

Ontbreekt het logboekbestand nog, maak het dan aan op basis van het sjabloon dat met de template meekomt.

---

## 8. Wat als het niet past

Krijg je een opdracht die binnen deze regels niet kan — een vijfde rol, een vierde tool, rij-niveau-filtering, een gebruiker die maar een deel van een tabel mag zien — dan:

1. bouw je het **niet** alsnog op een omweg;
2. leg je uit welke regel in de weg staat;
3. geef je de dichtstbijzijnde oplossing die wél binnen de regels past (meestal: een tabel of een view aan de allowlist van een bestaande rol toevoegen, of twee rollen samenvoegen om ruimte te maken);
4. laat je de eigenaar beslissen.

Kolom- of rij-niveau-afscherming los je op met een **view** in Neon die alleen de toegestane kolommen of rijen toont; die view neem je op in de allowlist alsof het een tabel is. De onderliggende tabel krijgt dan géén `GRANT`.

### "Kan de MCP dan echt niets verwijderen?"

Nee, en dat verzoek wordt niet ingewilligd — ook niet "eenmalig" of "voor deze ene tabel". Het antwoord is een **soft delete**: een statusveld (`vervallen_op`, `actief`, `status`) dat een rol met `rechten: "wijzigen"` bijwerkt met een `UPDATE`. De rij blijft dan bestaan, de actie is terug te draaien, en de applicatie beslist zelf wat ze met dat veld doet.

Echt verwijderen gebeurt in de applicatie, door code die daarvoor geschreven en getest is — niet door een AI-client op een productiedatabase.
