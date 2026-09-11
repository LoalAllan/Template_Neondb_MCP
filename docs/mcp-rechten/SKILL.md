---
name: mcp-rechten
description: Het rechtenmodel van de eigen MCP-server (mcp-server/) en de procedure om het te bewaken. Laad bij elke migratie of schemawijziging (nieuwe tabel, kolom, view, trigger, hernoeming), bij elke wijziging in mcp-server/ (tools, queryanalyse, poort, beschermde lijsten, verbindingen, auth), bij een nieuwe MCP-tool, en bij elke vraag over wat een MCP-rol mag zien of doen, of de MCP iets kan verwijderen, of hoe je toegang geeft of intrekt. Bevat de harde grenzen (nooit DELETE, nooit DDL), het GRANT-recept voor nieuwe tabellen, en de drie parallelle reviewers voor wijzigingen aan de veiligheidslaag.
---

# MCP-rechten

Een remote MCP-server (Cloudflare Worker, Microsoft Entra-login) geeft AI-clients gecontroleerde
SQL-toegang tot de Neon-database van deze app. **Wélke tabellen** een gebruiker ziet, hangt af van
zijn MCP-rol; rollen en rechten beheert Allan op **/instellingen → Rechten**. Dit bestand is
bindend. Wijk er niet van af zonder expliciete toestemming.

## 1. Harde grenzen

| Grens | Waarde |
|---|---|
| Aantal tools | **precies 3**, voor élke rol dezelfde namen: `lijst_tabellen`, `lees_query` (één `SELECT`), `schrijf_query` (één `INSERT` of `UPDATE`) |
| Verwijderen | **nooit**, voor geen enkele rol, in geen enkele vorm |
| Structuur (DDL) | **nooit**, voor geen enkele rol |
| Rollen | onbeperkt — Allan maakt ze zelf aan |

Nooit mogelijk, ongeacht rol of vraag: `DELETE · TRUNCATE · DROP · CREATE · ALTER · GRANT ·
REVOKE · MERGE · COPY · DO · CALL · COMMENT · REINDEX · VACUUM · ANALYZE · CLUSTER · SET · RESET ·
BEGIN · COMMIT · ROLLBACK`. Vraagt iemand toch om verwijderen, ook "eenmalig": het antwoord is
een **soft delete** via `UPDATE` op een statusveld. Echt verwijderen gebeurt in de applicatie.

Lezen is ruim binnen de tabellen van de rol (joins, CTE's, subquery's, vensterfuncties). Twee
grenzen daarbinnen: alleen **ingebouwde functies** uit de allowlist in `analyse.ts`, en een
**WITH-onderdeel mag geen bestaande tabelnaam dragen**. Strandt een legitieme query daarop, breid
dan bewust de allowlist uit; verruim nooit de poort. Parser-beperkingen (geen beleid):
`substring(x FROM 1 FOR 3)` → gebruik `substr(x,1,3)`; `FILTER (…)` samen met `OVER (…)` werkt niet.

## 2. Het model

- Drie standen per rol per tabel: **geen toegang · lezen · schrijven**. Rollen zijn niet
  hiërarchisch.
- **"Geen toegang" is de AFWEZIGHEID van een rij** in `mcp_rechten`. Daardoor is een nieuwe tabel
  automatisch dicht voor elke rol. Bouw daarom **nooit** iets dat nieuwe tabellen automatisch aan
  rollen toevoegt, en voeg **nooit zelf rechten toe** (niet in een migratie, niet in seed-data).
- `tabelnaam` is platte tekst: hernoem je een tabel, dan vervalt het recht. Dat is de gewenste
  richting van falen.
- `schrijven` impliceert `lezen` op diezelfde tabel, nooit iets over andere tabellen.
- Eén rol per gebruiker (`gebruikers.mcp_rol_id`); null = geen toegang, en dat is de standaard.
- Rechten worden bij **élke tool-aanroep** vers gelezen. Nooit cachen, nooit in `Props` of het
  token.

## 3. Waar de afscherming zit

**Wélke tabellen** = applicatiedata (`mcp_rechten`, geklikt in het scherm). **Wélke operaties** =
de database zelf: de MCP-gebruikers hebben geen `DELETE`, geen `TRUNCATE`, geen eigenaarschap,
geen `CREATE`. Geen enkele fout in applicatiecode kan dat veranderen.

| Gebruiker | Mag | Secret |
|---|---|---|
| `mcp_lezer` | uitsluitend `SELECT`, `default_transaction_read_only` | `DATABASE_URL_LEZER` |
| `mcp_schrijver` | `SELECT, INSERT, UPDATE` (SELECT is nodig, zie valkuilen) | `DATABASE_URL_SCHRIJVER` |
| `mcp_service` | rechten lezen, oid binden, teller bijwerken | `DATABASE_URL_SERVICE` |

`neondb_owner` (`DATABASE_URL`) is voor migraties en de Next-app; geen enkele MCP-tool gebruikt hem.
**`docs/mcp-neon-rollen.sql` is de bron van waarheid** voor deze GRANT's en bevat de controlequery.

Vier lagen, in volgorde van belang: (1) de `GRANT`'s; (2) de queryanalyse `analyse.ts` — een echte
parser, regexes zijn hier geen beveiliging; (3) de gehardcodeerde lijsten `beschermd.ts` — in de
broncode, nooit in de database; (4) de rechtentoetsing `poort.ts` — elke tool door dezelfde poort.

Tabellen vallen in vier groepen. De namen staan in de code, kopieer ze niet:

- **Beschermd** (denylist, `mcp-server/src/database/beschermd.ts`): `gebruikers`, `mcp_rollen`,
  `mcp_rechten`, `mcp_schrijfquota`. Nooit leesbaar, nooit schrijfbaar, niet aan te zetten.
- **Lezen mag, schrijven nooit** (`NOOIT_SCHRIJVEN`, zelfde bestand): tabellen waarop de
  applicatie zelf handelt.
- **Toekenbaar**: alle overige bedrijfstabellen.
- **Technisch, verborgen in de atlas** (`src/lib/mcp-beschermd.ts`): machinerie die uit het
  rechtenscherm blijft maar achter de schakelaar "Machinerie" wél toekenbaar is. ⚠ Verborgen ≠
  onmogelijk — verwar deze lijst niet met de denylist.

`src/lib/mcp-beschermd.ts` is de app-kant-kopie van de beschermde lijsten; houd beide identiek.

## 4. Welke baan

| Wat er wijzigt | Baan |
|---|---|
| Schema, migratie, tabel- of modeldefinitie | **A** — licht, seconden, geen subagents |
| Queryanalyse, poort, beschermde lijsten, verbindingen, toolregistratie, auth, publiceer-actie | **B** — drie parallelle reviewers |
| Nieuwe trigger, rule of `SECURITY DEFINER`-functie | **B** — voert SQL uit die de analyse nooit ziet |
| Een view aanmaken of herschrijven | **B** — de definitie bepaalt wat een toegekend recht ontsluit |
| Hernoemen van een beschermde tabel | **B** — de denylist werkt op namen |
| Alleen UI, teksten, opmaak van het rechtenscherm | geen van beide |

Raakt een wijziging beide, doe eerst A en daarna B. **Baan A mag niet uitdijen**: ga bij een
gewone migratie niet de rechtenlaag nalopen en start geen reviewers.

## 5. Baan A — schemawijziging

Kijk naar de diff of de migratie en zoek vier dingen: nieuwe tabellen, nieuwe kolommen, hernoemde
en verwijderde tabellen. Meer niet.

### Nieuwe tabel → dicht, maar de GRANT hoort in de migratie

Meld: *"Nieuwe tabel `x` is standaard voor alle MCP-rollen gesloten. Moet een rol hem kunnen
lezen, dan zet je dat in het rechtenscherm."* Verwar dan deze twee niet:

| | Beantwoordt | Wie |
|---|---|---|
| Een rij in `mcp_rechten` | welke tabel voor welke rol | de beheerder, in het scherm |
| Een `GRANT` | of de tabel überhaupt bereikbaar is | de ontwikkelaar, in de migratie |

Zonder `GRANT` zegt het scherm dat de tabel openstaat, terwijl Postgres hem weigert met "Deze
bewerking is niet toegestaan". Voeg bij een nieuwe **bedrijfstabel** daarom met de hand toe aan de
gegenereerde migratie, naast de `COMMENT ON COLUMN`-regels:

```sql
GRANT SELECT ON <tabel> TO mcp_lezer;
GRANT SELECT, INSERT, UPDATE ON <tabel> TO mcp_schrijver;  -- als schrijven ooit mag
```

Dit is baan A: je verruimt niets aan de poort. Werk in dezelfde wijziging
`docs/mcp-neon-rollen.sql` bij (moet een database vanaf nul kunnen opbouwen) en draai de
controlequery onderaan: nul rijen.

**Drie gevallen waarin je juist níéts grant.** De eerste twee horen bovendien op de beschermde
lijst, want gesloten zijn is niet genoeg: een tabel die nergens op staat, is één klik van openstaan.

- **Identiteitsdragers** (sessies, tokens, API-sleutels, accounts, uitnodigingen,
  wachtwoordherstel): geen enkele `GRANT`, én op de denylist. Schrijfrecht daarop is schrijfrecht
  op iedereen.
- **Tabellen waarop de applicatie zelf handelt** (instellingen, sjablonen, wachtrijen, webhooks):
  wel `SELECT` aan `mcp_lezer`, géén `GRANT` aan `mcp_schrijver`, én op `NOOIT_SCHRIJVEN`. De app
  voert die rijen uit met volledige rechten; schrijfrecht erop is een omweg naar alles.
- **Twijfel**: niets granten. Erbij zetten is later één regel; eraf halen nadat een model er al
  bij kon, is een ander gesprek.

Herken je een van de eerste twee, meld het en vraag bevestiging. De lijst zelf bijwerken is baan B.

**Stel dan twee vragen, elk in één regel:**

- **Machinerie of bedrijfsdata?** Een wachtrij, teller, logboek, voorkeuren: dat hoort op de lijst
  technische tabellen in `src/lib/mcp-beschermd.ts` (gewone lijst, geen beveiligingslijst, dus
  baan A).
- **Bedrijfsdata: welke kamer?** Het connector-canvas werkt met clusters in
  `src/lib/mcp-clusters.ts`; een niet-ingedeelde tabel belandt in "Nog niet ingedeeld" (zichtbaar
  en dicht, maar een wachtkamer). Stel één kamer voor met de reden (wat inhoudelijk samen gelezen
  wordt hoort samen; wat nooit beschrijfbaar is hoort niet in een kamer die je wél bijwerkt),
  geef de op één na beste als tweede optie en "voorlopig niet indelen" als derde, en werk
  `MCP_CLUSTERS` bij na Allans keuze. Zeg erbij dat indelen géén toegang verleent; de kamer
  springt wel op "gedeeltelijk".

### Nieuwe kolom → melden wie meekijkt

Een nieuwe kolom erft de rechten van zijn tabel en is **onmiddellijk leesbaar** voor elke rol die
de tabel al mag lezen. Dit is het enige punt waarop een routinewijziging stil data blootlegt.

1. Zoek op welke rollen leesrecht hebben op die tabel. Kun je `mcp_rechten` niet inzien, zeg dat
   en vraag het; **raad nooit**.
2. Toets de naam aan de heuristiek: geheimen (`wachtwoord`, `password`, `secret`, `token`,
   `api_key`, `hash`, `salt`, `sleutel`, `credential`, `sessie`), identiteit (`rijksregister`,
   `bsn`, `paspoort`, `geboortedatum`), geld aan een persoon (`iban`, `rekening`, `kaartnummer`,
   `salaris`, `loon`), bijzondere persoonsgegevens (`medisch`, `gezondheid`, `diagnose`, `religie`,
   `vakbond`, `strafblad`), en vrije tekst over mensen (`notitie`, `opmerking`, `beoordeling`,
   `evaluatie` — daar staat in de praktijk het gevoeligste in).
3. Meld: *"Kolom `x` in `y` is meteen leesbaar voor de rollen die `y` al mogen lezen (`A`, `B`)."*
   Bij een treffer: *"De naam wijst op gevoelige inhoud. Wil je dat zo, of moet `y` dicht?"* Eén
   vraag; "prima" = klaar. Een treffer is geen blokkade.

### View → kijk wat eronder ligt

Een view is het gereedschap om een rol maar een deel van de kolommen of rijen te laten zien, en
zit in het rechtenmodel alsof het een tabel is. Nieuw = standaard dicht. Meld welke tabellen hij
leest. Ligt er een beschermde tabel onder, dan is de view niet toekenbaar. Een view is **nooit een
schrijfdoel**. Aanmaken of herschrijven is altijd **baan B**: de rechten wijzigen niet, maar wát ze
ontsluiten wél.

### Trigger → baan B

Een trigger, rule of `SECURITY DEFINER`-functie voert SQL uit die de analyse nooit ziet:
schrijfrecht op de ene tabel wordt stil schrijfrecht op alles wat de trigger raakt. Staat er al een
trigger op een tabel die iemand wil openzetten, meld wat die elders doet.

### Hernoemde of verwijderde tabel → toegang vervalt

Meld: *"`oud` is hernoemd naar `nieuw`; de bestaande rechten vervallen. Zet ze opnieuw in het
rechtenscherm als dat de bedoeling is."* Verweesde rijen zijn onschadelijk; ruim ze niet ongevraagd
op. Uitzondering: een beschermde tabel hernoemen is baan B (de denylist werkt op namen).

## 6. Baan B — de veiligheidslaag

Geldt voor wijzigingen aan:

- `mcp-server/src/database/analyse.ts` — parser, allowlists, relatieverzameling
- `mcp-server/src/database/poort.ts` — rechtentoetsing en view-resolutie
- `mcp-server/src/database/beschermd.ts` — de twee gehardcodeerde lijsten (dan óók
  `src/lib/mcp-beschermd.ts` en `docs/mcp-neon-rollen.sql` in dezelfde wijziging)
- `mcp-server/src/database/rechten.ts` — identiteit, oid-binding, vers lezen van rechten
- `mcp-server/src/database/quota.ts` — de cumulatieve schrijfteller
- `mcp-server/src/database/uitvoering.ts` — de omhullingen die begrenzen en terugdraaien
- `mcp-server/src/database/verbinding.ts` — de drie verbindingen (geen terugval!)
- `mcp-server/src/tools/database-tools.ts`, `register-tools.ts` — de toolset
- `mcp-server/src/auth/entra-handler.ts`, `mcp-server/src/index.ts` — identiteitsbepaling
- `src/lib/actions-mcp-rechten.ts` — de publiceer-actie (valideert server-side opnieuw)
- `docs/mcp-neon-rollen.sql` — de GRANT's; draai daarna de controlequery
- Elke **nieuwe MCP-tool die de database raakt**, ook zonder schemawijziging

Verhuist of splitst een bestand, werk deze lijst mee bij.

### De drie reviewers

Start ze **na** de wijziging, vóór oplevering, **in één keer parallel**, elk als apart agent op
een gelijkwaardig sterk model. Geef elk de diff, de gewijzigde bestanden en zijn invalshoek. Ze
zien elkaars uitkomst niet.

**Reviewer 1 — omzeiling.** *"Probeer langs deze rechtencontrole te komen. Schrijf concrete
SQL-queries die worden goedgekeurd terwijl ze een tabel raken waar de rol geen recht op heeft:
schrijvende CTE's, gestapelde statements, `EXPLAIN ANALYZE`, subquery's, `INSERT … SELECT`,
`RETURNING`, `UNION`, commentaar- en hoofdlettervarianten, geciteerde en schema-gekwalificeerde
namen, systeemcatalogi, gevaarlijke functies en casts. Eerder bewezen gaten, controleer opnieuw:
een CTE-naam die een echte tabel schaduwt (CTE-zichtbaarheid is lexicaal, niet globaal);
`FROM ONLY tabel` (parser en Postgres oneens over wát de relatie is); een eigen
`RETURNING … AS mcp_geraakt`-alias die de rijteller vervalst; bequoteerde CTE-namen die de
normalisatie overslaat; niladische sleutelwoorden zonder haakjes (`current_schema`); foutmeldingen
die per tabelnaam verschillen. Geef per gat de exacte query. Vind je niets, zeg dat expliciet."*

**Reviewer 2 — fail-open.** *"Zoek elk pad waarlangs de beveiliging stil verdwijnt: een ontbrekende
omgevingsvariabele, een lege of null-waarde, een databasefout, een opgevangen uitzondering, een
lege rechtenlijst, een gebruiker zonder rol. Elke terugval op ruimere toegang, elke `catch` die
doorgaat, elke standaardwaarde die 'toestaan' betekent, is een bevinding. Eerder bewezen:
sentinel-standaardwaarden (een oid `"onbekend"` gaf impersonatie); een enum op truthiness toetsen
in plaats van op de exacte waarde; een catalogus-lookup met `relkind`-filter die materialized views
en partities ongetoetst laat. De juiste richting van falen is: weigeren, en luid."*

**Reviewer 3 — rechtenescalatie.** *"Kan iemand langs deze wijziging zijn eigen rechten verhogen?
Controleer of `gebruikers`, `mcp_rollen`, `mcp_rechten` en `mcp_schrijfquota` onbereikbaar blijven
via elke tool, of de denylist in de broncode staat en niet in de database, of rechten vers per
aanroep gelezen worden, of `DELETE` en DDL voor élke rol geweigerd worden, en of het beheerscherm
server-side beschermd is bij élke actie, niet alleen bij het renderen. Eerder bewezen: een
schrijfroute naar `mcp_rechten` die de validatie omzeilde (`INSERT … SELECT` bij dupliceren); de
oid-binding die bij elke tool-aanroep draaide in plaats van alleen bij login."*

### De uitkomst

**Unanimiteit is vereist.** Eén bevinding van één reviewer = herstellen en alle drie opnieuw. Geen
meerderheid, geen "dat valt wel mee". Draai daarnaast `pnpm test` in `mcp-server/`:
`test/reviewbevindingen.test.ts` en `test/privileges.db.test.ts` zijn de regressietests van de
eerder gevonden gaten. Vat af in vijf regels: wat gewijzigd, wat bekeken, wat gevonden, wat hersteld.

## 7. Verboden

- ❌ `DELETE`- of `TRUNCATE`-`GRANT` aan welke MCP-gebruiker dan ook; eigenaarschap van tabellen;
  `CREATE` op het schema.
- ❌ `ALTER DEFAULT PRIVILEGES` of `GRANT … ON ALL TABLES` — blanco automatisering die de
  fail-safe sloopt. Een expliciete `GRANT` per tabel is juist wat hoort.
- ❌ Een `GRANT` op de vier beschermde tabellen aan `mcp_lezer` of `mcp_schrijver`.
- ❌ Terugval op een ruimere verbinding als een secret ontbreekt.
- ❌ De denylist in de database in plaats van in de broncode.
- ❌ Connection strings in code, logs of commits — alleen `.dev.vars` en `wrangler secret put`.
- ❌ SSE toevoegen; Streamable HTTP op `/mcp` is het enige transport.

## 8. Valkuilen die al beten

- **Een schrijfrol heeft óók `SELECT` nodig.** Postgres eist het op elke kolom die je leest, ook in
  `UPDATE … WHERE` en `INSERT … RETURNING`. Zonder is geen enkele UPDATE mogelijk en faalt elke
  schrijfactie al bij de quota-reservering. De melding is "Deze bewerking is niet toegestaan": de
  vertaling van *permission denied*, niet een rechtenweigering.
- **De controlequery ziet alleen te ruime rechten.** Een ontbrekend recht is er onzichtbaar voor;
  nul rijen bewijst niet dat schrijven werkt. Test het.
- **Foutmeldingen mogen geen orakel zijn.** Een melding die per tabelnaam verschilt verraadt welke
  tabellen en indexen bestaan. Uniforme weigering, tenzij de rol de tabel toch al mag zien.
- **De cast in de rijbegrenzing moet BINNEN de `CASE`.** Erbuiten vouwt Postgres hem bij het
  plannen uit en faalt de schrijftool altijd (`uitvoering.ts`).
- **`REVOKE EXECUTE … FROM <gebruiker>` doet niets.** Intrekken moet van `PUBLIC`, en alleen in
  `public`, niet in `pg_catalog`.
- **Een view met een eigen functie legt een afhankelijkheid op `pg_proc` vast, niet op een tabel.**
  Zulke views worden geweigerd. Aanvaard restrisico: dynamische SQL via een ingebouwde functie
  (`query_to_xml('select … from gebruikers')`) legt in `pg_depend` niets vast en lijkt schoon.
  Vereist DDL, dus alleen de eigenaar; daarom is élke view baan B.
- **Een cast is geen functie-aanroep** (`'x'::regclass`); de allowlist gaat ook over casts.
- **`pg_catalog` staat impliciet vooraan in het zoekpad**; een vaste `search_path` redt je niet.
- **Dubbele resultaatkolomnamen slaan data plat** ("laatste wint"). Beide querypaden draaien in
  `arrayMode` en lezen op positie. Val nooit terug op objectmodus.
- **De oid bindt alleen bij het inloggen.** Bij elke tool-aanroep binden laat een geldig token stil
  elke vrije rij met hetzelfde e-mailadres claimen.
- **Een rij "ontkoppelen" trekt toegang niet in.** Zolang het e-mailadres op de rij staat, claimt
  dezelfde persoon hem bij de volgende login terug. Wijzig óók het e-mailadres of de rol.
- **De beschermde lijst veroudert stil.** Elke nieuwe identiteits- of stuurtabel die je laat
  passeren is een gat dat pas zichtbaar wordt als iemand hem openzet.
- **`pnpm install` in `mcp-server/` heeft `--ignore-workspace` nodig**; de root heeft een
  `pnpm-workspace.yaml`. En `@modelcontextprotocol/sdk` staat exact op 1.29.0 (`pnpm.overrides`),
  omdat `agents` die versie pint.

## 9. Wat als het niet past

Een vierde tool, `DELETE`, rij-niveau-filtering, een gebruiker die maar een deel van een tabel
mag zien: bouw het **niet** op een omweg. Leg uit welke regel in de weg staat, geef de
dichtstbijzijnde oplossing die wél past, en laat Allan beslissen. Kolom- of rij-afscherming is een
**view** in Neon (baan B) die in het rechtenmodel meegaat als een tabel: onderliggende tabellen
worden server-side transitief getoetst, de view is nooit een schrijfdoel, en de atlas toont welke
tabellen hij leest.
