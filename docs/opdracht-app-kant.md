# Opdracht — de app-kant van het MCP-rechtenmodel: beheerderspoort, rechtenscherm en publiceer-actie

> **Hoe je dit gebruikt:** plak dit volledige document als opdracht in een nieuwe sessie van je
> coding agent, in de codebase van de applicatie waarin de MCP-server al als `mcp-server/` staat.
> Het document is zelfdragend voor de **werking**: alle context, regels en redeneringen staan erin.
>
> **Plak er `mcp-server/docs/design-brief-connector.md` bij.** Dat tweede document beschrijft hoe
> het beheerscherm eruitziet en aanvoelt, met drie layoutvarianten en drie schermafdrukken als
> referentie. Zonder dat document bouw je een werkend maar gewoon scherm; §9 hier geeft alleen de
> eisen die ongeacht de vormgeving gelden. Waar de twee documenten elkaar tegenspreken, wint dit
> document — beveiliging gaat vóór vorm.
>
> **Voorwaarde:** deel A van `mcp-server/README.md` is afgerond. De server draait, `pnpm test`
> in `mcp-server/` is groen, `mcp-server/src/mcp.config.ts` is ingevuld, en de drie
> databasegebruikers bestaan. Is dat niet zo, doe dát eerst.

---

## 0. Wat je bouwt

De MCP-server in `mcp-server/` geeft een taalmodel gecontroleerde SQL-toegang tot de database van
deze applicatie. **Welke tabellen** een gebruiker mag lezen of schrijven, hangt af van zijn MCP-rol;
die rollen en rechten staan in de database (`mcp_rollen`, `mcp_rechten`) en de server leest ze bij
élke tool-aanroep vers. Wat er nog ontbreekt, is de kant waarop een mens die rechten **instelt**:
in deze applicatie, in haar eigen huisstijl, achter haar eigen login.

Drie standen per tabel: **geen toegang · lezen · schrijven**. Rollen zijn door een beheerder aan te
maken; elke gebruiker draagt precies één rol. Per rol is er één scherm — **Connector** — met het
volledige databaseschema in beeld, ingedeeld in clusters, waar de beheerder per cluster en per tabel
de stand zet.

### Wat de template al levert, en wat jij bouwt

| Geleverd door de server (`mcp-server/`) — niet opnieuw bouwen | Wat jij in deze applicatie bouwt |
|---|---|
| De queryanalyse: een echte parser, allowlists, élke relatie uit élke tak van de boom | **1. De migratie** — `mcp-server/sql/01-mcp-tabellen.sql` in het migratiesysteem van deze codebase, plus de `GRANT`'s uit `02-mcp-neon-rollen.sql` |
| De poort: denylist → nooit-schrijven → catalogus → views → rechten, in vaste volgorde | **2. De beheerderspoort** — wie rechten mag uitdelen (§7) |
| De gehardcodeerde denylist en de lijst "nooit schrijven" | **3. Het rechtenscherm "Connector"** — clusters, standen, proefblad (§8) |
| De rijbegrenzing per statement en de cumulatieve schrijfteller per rol | **4. Rol toewijzen aan gebruikers** (§8.1) |
| De koppeling op de onveranderlijke Entra-`oid`, eenmalig gebonden bij de eerste login | **5. De publiceer-actie** met volledige server-side hervalidatie (§8.3) |
| De drie tools, met beschrijvingen die per rol de toegestane tabellen noemen | **6. De app-kopie van de beschermde lijsten**, identiek aan die van de server (§5) |
| Uniforme foutmeldingen die geen schema verraden | **7. De skill** installeren en de CLAUDE.md-notitie voorstellen (§10, §14) |
| De testmatrix, élke omzeiling en de databasetests (`pnpm test`) | |

**Twee petten.** Het grootste deel van deze opdracht is beveiligingswerk: streng, wantrouwig, bij
twijfel weigeren. Maar op één plek — de indeling van het schema in **clusters** (§8.2) — trek je een
andere pet aan: die van iemand die bedrijfssoftware kent (CRM, ERP, facturatie,
projectadministratie) en al vaker heeft moeten uitleggen wie wat mag zien. Daar denk je niet in
tabellen maar in "Klanten, Orders, Facturen, Projecten", en daar is de gebruiker de enige die je
kan corrigeren — dus daar vráág je. Verwar de twee petten niet: aan de beveiligingskant beslis je
zelf en kies je de striktste optie; aan de clusterkant stel je voor en laat je beslissen.

Lees eerst §1 en §2. Die twee bepalen alles wat daarna komt.

---

## 1. Waarom dit veiligheidskritisch is

Een MCP-server geeft een taalmodel rechtstreeks toegang tot een productiedatabase. Dat maakt van
elk gaatje een deur. Vier scenario's die deze feature moet uitsluiten — ze staan hier omdat je
zonder dit waarom de regels in §2 zult lezen als overdreven strengheid en er uitzonderingen op
zult maken. Doe dat niet.

**Scenario 1 — het overtuigde model.** Een gebruiker vraagt in gewone taal om "de dubbele
klantrijen op te ruimen". Het model schrijft een `DELETE`, die precies doet wat gevraagd is en
onherstelbaar is. Er is geen kwade opzet nodig voor dataverlies; behulpzaamheid volstaat.
→ Afgedekt door regel 3 (`DELETE` bestaat niet).

**Scenario 2 — de stille terugval.** De read-only databaseverbinding is geconfigureerd via een
secret. In een nieuwe omgeving ontbreekt dat secret. De code valt "netjes" terug op de gewone
verbinding en logt een waarschuwing die niemand leest. Vanaf dat moment draaien alle leesqueries
met schrijfrechten, en niets in de UI verraadt dat. Dit is de klassieke fail-open: de beveiliging
verdwijnt zonder dat er iets stukgaat.
→ Afgedekt door regel 5 (geen enkele terugval; weigeren te starten).

**Scenario 3 — de zelfbediening.** De tabel met rollen en rechten staat gewoon in dezelfde
database. Een rol met schrijfrechten op "alle tabellen" kan zichzelf tot de ruimste rol promoveren
met één `UPDATE`. Elk rechtenmodel dat zijn eigen tabellen niet afschermt, is een suggestie in
plaats van een beveiliging.
→ Afgedekt door regel 7 (gehardcodeerde denylist).

**Scenario 4 — het lek via de structuur.** De tabellen-tool geeft alle tabellen en kolommen
terug, ongeacht rechten. De inhoud van een gesloten tabel blijft geheim, maar de kolomnamen
(`salaris`, `bsn`, `medische_notitie`) vertellen het gevoelige verhaal al, en ze vertellen een
aanvaller precies waar hij moet duwen.
→ Afgedekt door regel 1 (deny-by-default geldt ook voor structuur).

---

## 2. Niet-onderhandelbare regels

Deze acht regels gelden voor de hele feature en voor elke latere wijziging eraan. Ze kennen geen
uitzonderingen, geen vlaggen, geen ontwikkelmodus en geen "tijdelijk even". Per regel staat erbij
wat de server al afdwingt en wat de app moet **spiegelen** — want de UI is een bedieningspaneel en
nooit de beveiliging, maar een scherm dat rechten toekent die de server daarna altijd weigert, liegt
over wat er openstaat.

1. **Deny-by-default.** Wat niet expliciet is toegestaan, wordt geweigerd. De afwezigheid van een
   recht is geen fout en geen ontbrekende configuratie: het ís de weigering. Dit geldt voor data
   én voor structuur — een rol ziet in de tabellen-tool alleen de tabellen die hij mag lezen.
   *Server:* afgedwongen. *App:* het schema dat je in het scherm toont, bevat de tabellen van de
   denylist niet — ook hun kolomnamen niet.

2. **DDL is altijd verboden.** `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE`, `COMMENT`,
   `REINDEX`, `VACUUM`, `ANALYZE`, `CLUSTER`, `COPY`, `SET`, `RESET`, `CALL`, `DO`-blokken en elke
   vorm van transactiebesturing. Ook voor de ruimste rol. Schemabeheer hoort in migraties thuis,
   nooit in een MCP-tool.
   *Server:* afgedwongen, in de analyse én door de databasegebruikers zelf. *App:* niets te doen —
   behalve nooit een "beheerdersmodus" verzinnen die dit omzeilt.

3. **`DELETE` bestaat niet.** Het is geen stand in de UI, geen waarde in het datamodel en geen
   toegestane operatie in de server. `MERGE` is in élke vorm verboden, ook zonder delete-tak.
   Schrijven betekent hier uitsluitend: **rijen toevoegen (`INSERT`) en bestaande rijen bijwerken
   (`UPDATE`)**.

   **Een `UPDATE` moet begrensd zijn — en een `WHERE` eisen is daarvoor niet genoeg.**
   `UPDATE klanten SET naam='' WHERE id IS NOT NULL` heeft een `WHERE`, gebruikt een kolom van de
   doeltabel, is niet altijd-waar van vorm — en wist net zo goed de hele tabel als een `DELETE`.
   Elke controle op de vórm van de voorwaarde is te omzeilen met één extra woord. Daarom begrenst
   de server op het **aantal geraakte rijen** (elke `INSERT`/`UPDATE` draait terug boven een
   bovengrens) én op een **cumulatieve teller per rol** in een voortschrijdend tijdvenster, die in
   de database staat en niet in het geheugen. Dat is geïmplementeerd in
   `mcp-server/src/database/uitvoering.ts` en `quota.ts`; de limieten staan in
   `mcp-server/src/mcp.config.ts`. **Verruim ze niet.** Wat de teller níét ziet: een `ON UPDATE
   CASCADE`-relatie of een trigger schrijft duizenden rijen in een kindtabel weg terwijl het
   hoofdstatement er één raakt. Inventariseer daarom in Fase 0 de referentiële acties en triggers,
   en behandel een tabel met cascaderende sleutels of schrijvende triggers als een tabel die niet
   zomaar schrijfrecht krijgt — zie §17.

   *Let op:* het is goed mogelijk dat deze applicatie vandaag ergens leunt op verwijderen via AI.
   Deze opdracht is dan bewust een **aanscherping**. Meld dat expliciet aan de gebruiker. **De
   uitkomst staat vast: `DELETE` komt er niet.** Wat je wél doet, is het alternatief aanbieden: een
   **soft delete**. Een statusveld (`vervallen_op`, `actief`, `status`) dat een rol met
   schrijfrecht met een `UPDATE` bijwerkt. De rij blijft bestaan, de handeling is terug te draaien,
   en de applicatie beslist zelf wat ze met dat veld doet. Echt verwijderen gebeurt in de
   applicatie, door code die daarvoor geschreven en getest is — niet door een AI-client op een
   productiedatabase. Vraagt de gebruiker toch om `DELETE`, weiger dat dan **binnen deze opdracht**.
   Leg uit dat het de kern ervan ondergraaft en een eigen opdracht met een eigen
   veiligheidsafweging vraagt. Bouw het hier niet, in geen enkele vorm.

4. **Handhaving is uitsluitend server-side.** De UI is een bedieningspaneel, nooit de beveiliging.
   Ga ervan uit dat iemand de MCP-server rechtstreeks aanspreekt zonder ooit het scherm te openen,
   en dat iemand de publiceer-actie rechtstreeks aanroept zonder ooit het scherm te openen. Elke
   controle die alleen in de frontend leeft, telt niet mee.
   *Server:* afgedwongen. *App:* de publiceer-actie en élke beheeractie valideren zelf, server-side,
   opnieuw (§7, §8.3).

5. **Geen enkele fail-open terugval.** Ontbreekt een verplichte configuratiewaarde of een
   databaseverbinding, dan weigert de server dienst met een duidelijke foutmelding. Hij schakelt
   nooit terug naar een ruimere verbinding en logt nooit alleen een waarschuwing. Falen is luid en
   dicht, nooit stil en open.
   *Server:* afgedwongen (bij élke aanroep, want een Worker kent geen startmoment). *App:* hetzelfde
   principe voor de beheerderspoort: geen `is_beheerder`-kolom, geen databaseverbinding, geen
   antwoord = geweigerd, nooit "voorlopig toegestaan".

6. **Rechten worden vers gelezen per tool-aanroep.** Niet één keer bij het opzetten van de sessie,
   niet uit het toegangstoken, niet uit een cache. Een ingetrokken recht geldt onmiddellijk.
   *Server:* afgedwongen. *App:* hetzelfde voor beheerderschap — bij elke actie uit de database,
   nooit uit een token of sessie (§7).

7. **De rechten beschermen zichzelf.** De tabellen met rollen, rechten, quota en gebruikers staan
   op een **gehardcodeerde denylist in de broncode van de MCP-server**: nooit leesbaar, nooit
   schrijfbaar, door geen enkele rol, en niet aan te zetten vanuit de UI of vanuit de database.
   De lijst is breder dan alleen rollen en rechten: alles waarmee je je een identiteit kunt
   aanmeten hoort erop — sessies, accounts, tokens, API-sleutels, uitnodigingen, wachtwoordherstel.
   *Server:* `mcp-server/src/database/beschermd.ts`. *App:* een identieke kopie, zodat de
   publiceer-actie weigert wat de server toch nooit zou uitvoeren, en het scherm de verzegelde
   tabellen als verzegeld toont in plaats van als keuze (§5).

8. **Bij twijfel weigeren.** Een tabelnaam die niet ondubbelzinnig te herleiden is, een view die
   niet volledig te ontleden is, een versieteller die ontbreekt: weigeren, met een melding die
   uitlegt wat er niet kon. Een geweigerde legitieme handeling is een klein ongemak; een toegelaten
   schadelijke is niet terug te draaien.
   *Server en app:* beide.

---

## 3. Fase 0 — inventariseer je codebase, en vraag wat je niet vindt

Dit document weet niets over de codebase waarin je werkt. Voordat je één regel schrijft, stel je de
volgende feiten vast. **Vind je iets niet: vraag het aan de gebruiker. Verzin niets, ga nergens
vanuit.**

1. **Hoe is de app opgebouwd?** Welk framework, waar leven server-acties of API-endpoints, hoe
   worden ze beschermd, en welke conventies gelden voor nieuwe. Alles wat je in §7 en §8.3 bouwt,
   volgt die conventies.
2. **Controleer de identiteitsketen.** De MCP-server koppelt gebruikers op de onveranderlijke
   Entra-`oid` (claim `oid`), eenmalig gebonden aan de rij die op e-mail matcht. Stel vast: welke
   claim gebruikt de **app** als sleutel voor de ingelogde persoon? Worden tenant, doelgroep en
   vervaltijd gevalideerd? Gebruiken app én MCP-server **dezelfde** sleutel? Lopen die uiteen, dan
   kan iemand in het ene systeem een andere persoon zijn dan in het andere — en dan is de
   beheerderspoort (§7) op zand gebouwd. Vind je geen per-persoon-login, stop dan en leg het voor;
   zie de stopregel in §7.
3. **Waar staat de gebruikerstabel**, hoe heet ze, welke kolommen heeft ze (id, e-mail,
   `updated_at`)? Dit **moet** overeenkomen met `GEBRUIKERS` in `mcp-server/src/mcp.config.ts`.
   Klopt dat niet, corrigeer dan eerst de config en draai `pnpm test` in `mcp-server/`. Welk
   rechtenveld bestaat er vandaag al, zodat je weet wat je migreert?
4. **Hoe werken migraties** in dit project? De codebase gebruikt Drizzle: vind het schema
   (`schema.ts`), de map met migraties (`drizzle/`), de scripts (`db:generate`, `db:migrate`) en de
   afgesproken werkwijze bij een schemawijziging. Volg die exact. De migratie uit §4 en de
   `GRANT`'s horen daarin thuis. Lees het schema volledig: dat is je bron voor elke tabel- en
   kolomnaam in deze opdracht — niets uit de sjablonen in `mcp-server/sql/` klopt zonder die
   controle.
5. **Welke design-tokens en UI-bouwstenen bestaan er al?** Kleuren, radii, motion-tokens, knoppen,
   kaarten, dialogen, schakelaars, tabellen, lege staten, en of er al een canvas- of graaf-primitive
   is. Je hergebruikt deze; je introduceert geen nieuwe merkkleuren en geen nieuwe primitives als
   er al een geschikte bestaat. Dit bepaalt ook welke layoutvariant uit de design-brief past.
6. **Zijn er projectregels** (een `CLAUDE.md`, `AGENTS.md`, regels- of documentatiemap) die je moet
   volgen? Lees ze vóór je begint en houd je eraan — ze gaan boven de stijlsuggesties in dit document.
7. **Bestaat er testinfrastructuur?** Zo niet, zie §13 voordat je er zelf een introduceert.
8. **Staan er triggers, rules of `SECURITY DEFINER`-functies op de tabellen?** En welke foreign keys
   cascaderen? Dit is veiligheidskritisch en wordt bijna altijd over het hoofd gezien. Meld élke
   tabel met een trigger die buiten zichzelf schrijft; die krijgt in het scherm een voetnoot (§8.2)
   en in §17 een vermelding.
9. **Hoeveel tabellen telt het schema?** Bij enkele honderden heeft het scherm een andere indeling
   nodig dan bij twintig — dat weegt mee in de keuze van de layoutvariant.
10. **Welke tabellen zijn machinerie en welke zijn bedrijfsdata?** Loop het schema langs en stel een
    voorstel op voor de lijst *technische tabellen* uit §8.2 — wachtrijen, activiteitentellers,
    migratieboekhouding, opgeslagen voorkeuren, archiveringsadministratie. **Leg dat voorstel vóór
    aan de gebruiker**; hij kent zijn schema en schrapt of vult aan.
11. **Op welke tabellen handelt de applicatie zelf?** Instellingen, sjablonen, nummerreeksen,
    wachtrijen, webhooks, wettelijke documenten. Die horen in `NOOIT_SCHRIJVEN` in
    `mcp-server/src/mcp.config.ts`. Is die lijst nog leeg, stel hem dan nu op en leg hem voor.
    De app-kopie (§5) moet er identiek aan zijn.
12. **Waar gaat dit bedrijf eigenlijk over?** Je gaat het schema straks indelen in **clusters**
    (§8.2) — Klanten, Orders, Facturen, Projecten — en dat is de enige stap in deze hele opdracht
    waarvoor je domeinkennis nodig hebt in plaats van techniek. Lees daarom niet alleen het schema
    maar ook de UI-routes, de menu-items en de projectdocumentatie: die vertellen je hoe de
    gebruiker over zijn eigen zaak práát. Noteer die woorden — dat worden de clusternamen.
    **Stel het clustervoorstel op en leg het voor** (§8.2). Je bent hier de domeinexpert, en de
    gebruiker is de enige die je kan corrigeren.

Vat je bevindingen in een paar regels samen voor de gebruiker vóór je begint te bouwen, met daarbij
expliciet: wat je aantrof aan bestaande veiligheidsgaranties, en welke daarvan je aanscherpt.

---

## 4. De migratie

Het datamodel is ontworpen en staat als referentie in `mcp-server/sql/01-mcp-tabellen.sql`. Deze
codebase beheert haar schema met **Drizzle**, dus zo komt het erin — niet door dat bestand los te
draaien:

1. Zet de drie tabellen, de enum `mcp_recht_niveau` en de drie kolommen op de gebruikerstabel in het
   Drizzle-schema van deze codebase, in haar eigen conventies (bestandsindeling, `relations`,
   naamgeving van indexen). Neem de vorm over uit `mcp-server/docs/referentie-app/drizzle-schema.ts`.
2. Genereer de migratie zoals deze codebase dat doet (`drizzle-kit generate`), en **vergelijk de
   gegenereerde SQL met `sql/01`**: dezelfde tabellen en kolommen, `ON DELETE CASCADE` op
   `mcp_rechten.rol_id` en `mcp_schrijfquota.rol_id`, `ON DELETE RESTRICT` op `mcp_rol_id`, de
   unieke index op (`rol_id`, `tabelnaam`), `entra_oid` uniek.
3. Voeg de `COMMENT ON`-regels uit `sql/01` met de hand toe aan de gegenereerde migratie; Drizzle
   genereert die niet, en de server en het scherm tonen dat commentaar.
4. Draai de migratie zoals altijd (`db:migrate`), als de eigenaar van de database.

Namen mag je aan de conventies van de codebase aanpassen **behalve** de tabelnamen `mcp_rollen`,
`mcp_rechten`, `mcp_schrijfquota`, de enum `mcp_recht_niveau` en de kolommen `entra_oid`,
`mcp_rol_id`, `is_beheerder`: die kent de MCP-server letterlijk. Alles wat in `sql/` naar
tabellen van het voorbeelddomein verwijst (`klanten`, `projecten`, …) is een sjabloon en moet
vervangen worden door de echte namen uit Fase 0.

Wat het model betekent — lees dit, want elke regel eronder is een beveiligingsbeslissing:

**Rol** (`mcp_rollen`) — een benoemde verzameling rechten: `id`, `naam` (uniek), `omschrijving`,
`versie`, tijdstempels. Rollen zijn door de beheerder aan te maken, te hernoemen en te verwijderen.
Een rol verwijderen kan alleen als er geen gebruikers meer aan hangen (`ON DELETE RESTRICT` op de
gebruikerstabel) — anders zou een gebruiker rechteloos of, erger, onbepaald achterblijven.

**Recht** (`mcp_rechten`) — één rij per (rol × tabel) waar toegang **is** verleend: `rol_id`,
`tabelnaam`, `niveau` (`lezen` of `schrijven`), uniek op (`rol_id`, `tabelnaam`), cascade bij het
verwijderen van de rol.

- **`niveau` kent géén waarde voor "geen toegang".** Geen toegang is de afwezigheid van de rij.
  Dit is niet cosmetisch, het is het mechanisme: een tabel die nog niet bestond toen de rechten
  werden gezet, heeft per definitie geen rij en dus geen toegang. Nieuwe tabellen zijn daardoor
  **gratis fail-safe**, zonder seeding, zonder migratie per tabel, zonder dat iemand eraan moet
  denken.
- **Rechten worden altijd per tabel opgeslagen**, ook al bedient de beheerder clusters (§8.2). Eén
  klik op een cluster schrijft een rij per tabel. Sla nooit een recht op een cluster op: een cluster
  is een redactionele indeling die later kan verschuiven, en dan zou een bestaand recht stilzwijgend
  iets anders gaan betekenen.
- `tabelnaam` is bewust **platte tekst**, geen verwijzing naar een catalogus. Wordt een tabel
  hernoemd, dan wijst het recht nergens meer naar en vervalt de toegang. Dat is de gewenste richting
  van falen.
- `schrijven` impliceert `lezen` op diezelfde tabel — anders kun je niet zien wat je zojuist
  toevoegde. Het impliceert nooit iets over andere tabellen.

**Versieteller** (`mcp_rollen.versie`) — gaat bij elke publicatie met één omhoog. Die heb je nodig
om gelijktijdig bewerken te herkennen (§8.3): omdat "geen toegang" de afwezigheid van een rij is,
laat een ingetrokken recht geen enkel spoor na, en zonder teller kun je niet zien dat iemand anders
je zojuist heeft ingehaald.

**Gebruiker** — drie kolommen erbij op de bestaande gebruikerstabel:

- `entra_oid` — de onveranderlijke Microsoft-sleutel. De MCP-server bindt hem eenmalig bij de eerste
  login aan de rij die op e-mail matcht; daarna is de oid leidend.
- `mcp_rol_id` — precies één rol, of `NULL` = **geen MCP-toegang**. Dat is de standaardwaarde voor
  elke nieuwe gebruiker. Een identiteit die zich aanmeldt maar geen rij heeft, krijgt geen toegang
  en wordt nooit automatisch aangemaakt.
- `is_beheerder` — wie rollen en rechten mag instellen (§7). Een tweede veld, geen waarde van de
  rol: de MCP-rol zegt wat een taalmodel met de data mag, de beheerdersaanduiding zegt wie dat
  instelt.

**Is de gebruikerstabel óók gewone bedrijfsdata** (klantcontacten bijvoorbeeld), dan zou de denylist
uit regel 7 een functionele tabel afsluiten. Splits dan, maar splits volledig: **alles waarmee een
identiteit wordt herkend** — het e-mailadres, de oid, elke sleutel waarop de aanmelding matcht —
verhuist mee naar de beschermde koppeltabel, samen met `mcp_rol_id` en `is_beheerder`. Alleen wat
overblijft (naam, telefoon, functie) mag een gewone, opengezette tabel zijn. Laat de
identiteitskolom nooit in de open tabel staan: één `UPDATE gebruikers SET email = 'ik@…' WHERE id =
<de beheerder>` en de volgende aanmelding komt uit op zijn rij, met zijn rol en zijn beheerderschap.
Pas dan `GEBRUIKERS` in `mcp-server/src/mcp.config.ts` aan en meld deze keuze aan de gebruiker.

**De migratie zet iedereen dicht.**

- Voeg geen enkel recht toe in de migratie. De beheerder bouwt de rechten daarna bewust op via het
  scherm. Tot dat moment werkt de MCP-toegang niet — dat is het bedoelde gedrag, en je meldt het
  duidelijk aan de gebruiker vóór je de migratie draait.
- **Verwijder een oud rechtenveld** op de gebruikerstabel in dezelfde migratie, als dat er is. Twee
  rechtenbronnen naast elkaar laten staan is precies de dubbelzinnigheid die regel 1 moet
  uitsluiten: niemand weet dan nog welke van de twee wint.
- Neem de `COMMENT ON`-regels over: de server toont kolomcommentaar aan het model, het scherm aan
  de beheerder.

**Daarna, buiten de migratie om:** `mcp-server/sql/02-mcp-neon-rollen.sql` als eigenaar in de
Neon-console, met de wachtwoorden in een kopie **buiten** de repo. En `03-controle.sql`: de eerste
query moet nul rijen geven. Is deel A van de README al gedaan, dan is dit al gebeurd — controleer
het dan alleen.

**De regel die daarna altijd geldt:** elke migratie die een bedrijfstabel toevoegt, bevat de
bijbehorende `GRANT`-regels (`GRANT SELECT … TO mcp_lezer`, en als schrijven ooit mag `GRANT SELECT,
INSERT, UPDATE … TO mcp_schrijver`). Zonder `GRANT` zegt het scherm dat een tabel openstaat, terwijl
Postgres hem weigert. De skill (§10) wijst je daar bij elke schemawijziging op.

---

## 5. Wat de server al afdwingt — en wat jij moet spiegelen

**De handhaving heeft twee dimensies, en ze liggen bewust op verschillende plekken.**

- **Wélke tabellen** een rol mag raken, is applicatiedata: het staat in `mcp_rechten` en de
  beheerder klikt het in het scherm. Dat moet wel — een beheerder die rollen aanmaakt, kan geen
  databaserollen en verbindingen aanmaken.
- **Wélke operaties** überhaupt mogelijk zijn, staat in de database zelf: de MCP-gebruikers
  (`mcp_lezer`, `mcp_schrijver`, `mcp_service`) hebben simpelweg geen `DELETE`, geen `TRUNCATE`,
  geen eigenaarschap en geen recht om objecten aan te maken. Geen enkele fout in de applicatiecode
  kan daar iets aan veranderen. Dat is wat de belofte "hier kan niets verdwijnen" overeind houdt,
  ook als de applicatielaag ooit een gat blijkt te hebben.

### 5.1 De poort, in vijf regels

Elke databasetool van de server doorloopt dezelfde poort (`mcp-server/src/database/poort.ts`):

1. identiteit uit het geverifieerde token, rechten **vers** uit `mcp_rechten` via de serviceverbinding;
2. de query wordt **ontleed** tot een syntaxboom; meervoudige statements, onbekende constructies en
   alles wat geen `SELECT`, `INSERT` of `UPDATE` is, wordt geweigerd;
3. **élke** relatie uit **élke** tak van de boom wordt verzameld en opgelost tegen de catalogus;
4. eerst de **denylist**, dan de lijst **nooit schrijven**, dan pas de rechten van de rol — één
   relatie zonder recht en de hele query wordt geweigerd;
5. uitvoeren op de juiste verbinding, begrensd (rijen, omvang, timeout) en bij schrijven
   teruggedraaid boven de grens, met een uniforme weigering voor alles wat dicht is.

De drie tools — `lijst_tabellen`, `lees_query`, `schrijf_query` — zijn voor elke rol dezelfde; een
rol zonder schrijfrecht ziet er twee. Hun beschrijvingen noemen per rol de toegestane tabellen.
`lijst_tabellen` leest `mcp_rechten` vers en combineert dat met de catalogus, inclusief het
kolomcommentaar: het is tegelijk de wegwijzer voor het model en het controle-instrument van de
beheerder. Wil je zien wat de server precies weigert, lees `mcp-server/test/omzeilingen.test.ts` —
één test per omzeiling.

### 5.2 Spiegel 1 — de beschermde lijsten

De server heeft twee gehardcodeerde lijsten: de **denylist** (`mcp-server/src/database/beschermd.ts`:
de gebruikerstabel, `mcp_rollen`, `mcp_rechten`, `mcp_schrijfquota`, plus wat de klant aan sessie-,
token- of sleuteltabellen heeft) en **nooit schrijven** (`NOOIT_SCHRIJVEN` in
`mcp-server/src/mcp.config.ts`). De app heeft ze ook nodig: het scherm toont denylist-tabellen als
verzegeld en biedt op nooit-schrijven-tabellen de stand "schrijven" niet aan, en de publiceer-actie
weigert beide server-side.

Maak daarvoor **één bestand in de app** met een kopie van beide lijsten, plus de derde lijst
*technische tabellen* uit §8.2 (die bestaat alleen app-side). Zie `mcp-server/docs/referentie-app/
mcp-beschermd.ts` voor de vorm. **Houd de kopie identiek aan de server.** Er is geen compile-time
koppeling tussen de twee; de skill (§10) wijst je erop bij elke wijziging. Zet de lijsten **niet** in
de database — dan zijn ze te wijzigen door precies wie ze niet mag wijzigen.

### 5.3 Spiegel 2 — de drie viewregels

Views zijn toegestaan in het rechtenmodel, en ze zijn belangrijker dan ze lijken. Dit model kent geen
rechten op kolom- of rijniveau (§12), en een view is precies het gereedschap dat dat gat vult: een
view die alleen de toegestane kolommen of rijen toont, opgenomen in het rechtenmodel alsof het een
tabel is. Maar in `SELECT * FROM v_klanten` staat alleen de viewnaam — wat eronder ligt, zie je niet.
De server past daarom drie regels toe, en de app past **dezelfde drie** toe in het scherm en in de
publiceer-actie:

1. **Los de onderliggende tabellen op, transitief.** Vraag de catalogus welke tabellen een view
   leest, door geneste views heen, en pas daarop de denylist en de lijst nooit-schrijven toe. Ligt
   er een beschermde tabel onder, dan is de view **niet toekenbaar**. Een view die niet volledig te
   ontleden is (eigen functies in de definitie): niet toekenbaar (regel 8). Let op wat je níét doet:
   je eist géén recht op de onderliggende tabellen — het hele punt is dat iemand de view mag zien
   en de tabel niet.
2. **Views zijn alleen-lezen.** Een view is nooit toekenbaar op "schrijven". Postgres maakt
   eenvoudige views vanzelf bewerkbaar, en een `INSTEAD OF`-trigger is willekeurige SQL die met de
   rechten van de eigenaar draait.
3. **Toon in het scherm bij een view welke tabellen hij leest.** Een beheerder die een view openzet
   zonder te weten wat eronder ligt, opent data die hij niet bedoelde.

De catalogusquery die de bronnen van een view oplost, moet **gelijk blijven** aan die in de server
(`bronnenVanViews` in `mcp-server/src/database/poort.ts`). Loopt hij achter, dan kent het scherm
rechten toe die de server daarna altijd weigert. De query staat uitgeschreven in
`mcp-server/docs/referentie-app/publiceer-validatie.md`.

Twee praktische punten bij het aanmaken van zulke views: gebruik je een view om **rijen** af te
schermen, zet hem dan als *security barrier* op; en verleen `mcp_lezer` `SELECT` op de view (in de
migratie), niet op de tabel eronder.

### 5.4 Wat de database zelf doet: triggers, rules en `SECURITY DEFINER`

De hele analyse kijkt naar de tekst die de aanroeper aanlevert. Wat de database daarná uit zichzelf
doet, ziet ze niet. Een `AFTER INSERT`-trigger op een tabel waar een rol schrijfrecht op heeft,
voert SQL uit die nooit langs de poort komt; draait die functie als `SECURITY DEFINER`, dan met de
rechten van haar eigenaar. Schrijfrecht op één tabel wordt zo schrijfrecht op alles.

De databaserollen trekken `EXECUTE` op eigen functies in van `PUBLIC` (`02-mcp-neon-rollen.sql`).
Wat jij doet: de inventaris uit Fase 0 gebruiken om **elke tabel met een trigger die buiten zichzelf
schrijft** in het scherm van een voetnoot te voorzien vóórdat er schrijfrecht op gezet kan worden.
Ontstaat er later een nieuwe trigger of `SECURITY DEFINER`-functie, dan is dat een wijziging aan de
veiligheidslaag (§11), geen gewone schemawijziging.

---

## 6. (vervallen — de omzeilingen zijn afgedekt en getest in de server)

Zie `mcp-server/test/omzeilingen.test.ts` en `test/reviewbevindingen.test.ts`. Voeg daar niets aan
toe vanuit de app; raakt een app-wijziging de manier waarop de server toetst, dan is dat baan B in
de skill.

---

## 7. De beheerderspoort

Het rechtenscherm is het aantrekkelijkste doelwit in de hele applicatie: wie daar binnenkomt, opent
alles. **Ingelogd zijn is daarom nooit genoeg.** Inloggen zegt *wie je bent*; het rechtenscherm
vraagt daarbovenop een tweede, expliciete controle op *of jij rechten mag uitdelen*. Verwar die twee
niet — dat is de enige denkfout die deze hele sectie moet voorkomen.

**Ga uit van Microsoft OAuth.** Elke app waarin deze opdracht landt, is beveiligd met
Microsoft-authenticatie (Entra ID). Er is dus altijd een per-persoon-login om op voort te bouwen.
Bouw er nooit een tweede inlogweg naast: geen eigen wachtwoorden, geen aparte code voor dit scherm,
geen uitnodigingsflow.

> **Tref je tóch een app zonder per-persoon-login aan** — één gedeeld wachtwoord, of geen login —
> bouw dan **niets** en leg het aan de gebruiker voor. Het rechtenscherm achter een gedeeld geheim
> zetten is een eigen afweging met eigen gevolgen (niet te herleiden wie wat wijzigde, een raadbaar
> geheim voor een scherm dat vrijwel het hele schema toont), geen variant binnen deze opdracht.

**Beheerderschap is één niveau.** Er is geen onderscheid tussen "mag rollen maken" en "mag rollen
toewijzen": een beheerder mag beide, of hij is geen beheerder.

**Beheerderschap staat los van de MCP-rol.** De MCP-rol bepaalt wat een taalmodel met de database
mag, beheerderschap bepaalt wie die rollen instelt. Iemand kan beheerder zijn zonder enige
MCP-toegang, en omgekeerd. Dat is de kolom `is_beheerder` uit de migratie (§4), op de
gebruikerstabel — en die staat op de denylist. **Geen enkele MCP-rol kan zichzelf dus ooit tot
beheerder maken**, en de MCP-server kent de kolom niet eens: `mcp_service` heeft er geen `UPDATE`
op. De app is de enige plek waar beheerderschap verandert. Dat is geen extra maatregel maar een
gratis gevolg van het datamodel, en het is de moeite waard om het zo te houden.

Een beheerder kan per definitie alle rechten zetten, ook die van de rol die hij zelf draagt — dat is
inherent aan beheerder zijn en geen gat. Wat wél moet: **beheerderschap toekennen of afnemen kan
alleen een beheerder**, en **de laatste beheerder kan zichzelf niet degraderen of verwijderen**,
anders sluit je jezelf buiten.

**Zo bouw je de poort:**

- Laat het rechtenscherm alleen zien én werken voor gebruikers met `is_beheerder = true`.
- Controleer dat **server-side bij elke lees- én schrijfactie** van het scherm: rollen ophalen,
  schema ophalen, rol aanmaken, hernoemen, dupliceren, verwijderen, rol toewijzen, publiceren. Niet
  alleen bij het renderen van de pagina. Een verborgen knop is geen beveiliging; ga ervan uit dat
  iemand de server-actie of het endpoint rechtstreeks aanroept. Bouw daarvoor **één** hulpfunctie
  (bijvoorbeeld `eisBeheerder()`) die de ingelogde identiteit op haar `oid` opzoekt in de
  gebruikerstabel en `is_beheerder` leest, en roep die als eerste regel in élke actie aan.
- ⚠ **Zet de beheerdersvlag nooit in het token of de sessie.** Dit is de fail-open die OAuth juist
  uitnodigt: met een token vol claims is het verleidelijk om `isAdmin` erin te bakken. Doe je dat,
  dan blijft iemand beheerder tot dat token verloopt — óók nadat je hem zojuist hebt gedegradeerd,
  en zonder dat er iets stukgaat. De controle **leest de database bij elke actie**, precies zoals
  regel 6 dat aan de MCP-kant eist.
- Zorg dat er altijd minstens één beheerder overblijft en dat niemand zijn eigen beheerderschap kan
  aanzetten.

**De eerste beheerder.** Zonder dit is het scherm na de uitrol voor niemand bereikbaar. Los het op
met de omgevingsvariabele **`MCP_EERSTE_BEHEERDER_OID`** in de app (niet in de Worker). Drie
voorwaarden, geen van alle onderhandelbaar:

- De variabele bevat de **onveranderlijke Entra-`oid`** van precies één account, nooit een
  e-mailadres. Een adres is te wijzigen en opnieuw uit te geven, en dat wil je zeker niet op het
  gevoeligste account van het systeem.
- Ze werkt **alleen zolang er nog geen enkele beheerder is**: bij de eerste beheeractie (of bij het
  inloggen) controleert de app of `SELECT count(*) … WHERE is_beheerder` nul is, en alleen dán zet
  ze `is_beheerder = true` op de rij met die oid. Is er één beheerder, dan doet de variabele niets
  meer. Anders blijft het een permanente achterdeur: wie de deploy-configuratie kan wijzigen (of een
  voorvertoningsomgeving deelt die dezelfde database gebruikt) benoemt zichzelf telkens opnieuw, en
  de regel dat de laatste beheerder niet te verwijderen is, maakt hem onafzetbaar.
- Nooit "de eerste die inlogt", nooit een standaardwachtwoord.

Meld deze eenmalige stap expliciet aan de gebruiker en vraag hem om de oid.

Tot slot: **de MCP-server vertrouwt de app nooit.** De denylist en de rechtentoetsing staan in de
server zelf. Zou het beheerscherm volledig gecompromitteerd raken, dan blijven regel 2, 3 en 7
onverminderd gelden — en juist daarom kun je het hier bij één heldere controle houden.

---

## 8. Het beheerscherm

### 8.1 Structuur

Het scherm heet **Connector**. Niet "Rechten", niet "Permissies", niet "ACL" — het is de stekker
tussen een taalmodel en je database, en dat woord doet twee dingen tegelijk: het zegt wat het is, en
het herinnert eraan dat je hem ook kunt uittrekken. Hoe het eruitziet en hoe het beweegt, staat in
`mcp-server/docs/design-brief-connector.md`; daar kies je in Fase 0 een layoutvariant die bij het
designsysteem van deze app past. Wat hier bindend is, ongeacht de variant:

- **Vaste auto-layout.** Knopen en kaarten worden deterministisch geplaatst. Niets wordt gesleept,
  niets wordt opgeslagen. Een beveiligingsscherm heeft één canonieke toestand: je moet kunnen
  zeggen "het scherm is schoon", en dat kan niet als een deel buiten beeld kan staan.
- **Clusters leven in de broncode** (§8.2), nooit in de database en nooit in een instelscherm.
- **De rolkiezer is het rolbeheer.** Je wisselt van rol op dezelfde plek waar je hem aanmaakt,
  hernoemt, dupliceert en verwijdert (verwijderen alleen als er geen gebruikers aan hangen).
  Dupliceren staat er bewust tussen: het is de snelste weg naar een variant, en het voorkomt dat
  iemand uit gemak een te ruime bestaande rol hergebruikt. Per rol: naam, omschrijving, hoeveel
  gebruikers hem dragen, en een samenvatting ("5 lezen · 4 schrijven").

**Rol toewijzen aan een gebruiker.** Bestaat er al een gebruikersbeheerscherm, breid dat uit met de
rolkeuze; bestaat het niet, voeg de toewijzing dan toe naast de rolkiezer. Waar het ook landt: de
standaardwaarde voor een nieuwe gebruiker is **geen rol**, en het toewijzen van een rol die ergens
schrijfrechten heeft, toont eerst kort wat die rol mag en vraagt bevestiging. Iemand een rol geven
is de handeling waarmee toegang daadwerkelijk ontstaat — dat moment mag niet onopgemerkt
voorbijgaan. Toon erbij of de Entra-oid al gebonden is, en bied "ontkoppelen" aan (de oid leegmaken,
zodat de volgende login opnieuw bindt) — met de waarschuwing dat ontkoppelen géén toegang intrekt
zolang het e-mailadres op de rij staat; wijzig dan óók de rol.

### 8.2 De atlas

Een echt schema heeft al gauw dertig tot vijftig tabellen, waarvan er misschien twaalf betekenis
hebben voor wie rechten uitdeelt. Een tegel per tabel is dan geen overzicht meer maar een muur. Het
scherm doet daarom twee dingen: **verwante tabellen samenvoegen tot één keuze**, en **machinerie uit
het zicht houden**.

#### De eenheid is het cluster, niet de tabel

Eén tegel per **cluster**, en die tegel draagt de stand. Daaronder staan de tabellen die erin
zitten, klein en leesbaar, met per tabel een eigen fijnregeling waar je één tabel bewust kunt laten
afwijken. Een order ís nu eenmaal de order plus zijn regels en zijn leveringen; wie "Orders" openzet,
bedoelt die allemaal.

**Het rechtenmodel blijft per tabel** (§4). Eén klik op een cluster schrijft gewoon een rij per
tabel. Dat is geen omweg maar de kern: de handhaving toetst tabellen, nieuwe tabellen blijven
vanzelf gesloten, en de samenvatting bij het publiceren noemt **de echte tabelnamen**. Het cluster
is een bedieningsgemak, nooit de waarheid.

#### Hoe de clusters ontstaan: jij stelt voor, de gebruiker beslist

Dit is de enige stap in deze opdracht die **domeinkennis** vraagt in plaats van techniek, en het is
de stap die bepaalt of het scherm bruikbaar wordt. Een groepering die je uit sleutels en tabelnamen
afleidt, zet precies de tabellen uit elkaar die inhoudelijk bij elkaar horen — `contactpersonen`
valt dan niet bij `klanten`, omdat de naamstam niet matcht. Het schema weet niet hoe een bedrijf
over zichzelf denkt.

**Neem daarom expliciet de rol aan van iemand die bedrijfssoftware kent** — CRM, ERP, facturatie,
projectadministratie — en die al vaker heeft moeten uitleggen wie wat mag zien. Denk zoals je een
nieuwe collega zou rondleiden: niet "dit is de tabel `factuurregels`", maar "dit zijn de facturen
die we versturen".

**De redeneerregels, in deze volgorde:**

1. **Noem het cluster zoals de gebruiker het noemt.** Klanten, Orders, Facturen, Projecten, Taken,
   Voorraad. Nooit een tabelnaam, nooit een technische term, nooit meervoud-van-een-kolom.
2. **Eén cluster = één beslissing die iemand werkelijk kan nemen.** "Mag deze rol bij de
   boekhouding?" is een beslissing. "Mag deze rol bij `kostcategorieen`?" is er geen.
3. **Splits waar de toegang uiteenloopt, ook als het onderwerp hetzelfde is.** Wettelijke documenten
   die nooit beschrijfbaar zijn, horen niet in één cluster met data die je wél bijwerkt: dan blijft
   elke klik op "schrijven" halverwege steken en staat het cluster permanent op "gedeeltelijk". Dat
   is het duidelijkste signaal dat je één cluster te grof hebt gemaakt.
4. **Houd bij elkaar wat altijd samen wordt gelezen.** Een tabel die zonder zijn buur betekenisloos
   is (regels bij een order, een gebruikersbeheerde kleurenlijst bij de transacties) hoort in
   hetzelfde cluster.
5. **Mik op vijf tot twaalf clusters.** Minder betekent dat je onderwerpen samenperst die niets met
   elkaar te maken hebben; meer betekent dat de beheerder weer aan het puzzelen is. Kom je boven de
   vijftien, dan groepeer je op tabellen in plaats van op betekenis.
6. **Schrijf per cluster één zin uitleg in gewone taal**, en die zin staat straks ook echt in het
   scherm. Kun je die zin niet schrijven zonder tabelnamen te gebruiken, dan is het cluster nog geen
   cluster.
7. **Zet er een waarschuwing bij waar dat nodig is.** Draagt een tabel in dit cluster iets dat de
   beheerder niet verwacht — omzetcijfers in de klantentabel, een e-mailadres in een logboek, een
   trigger die elders schrijft — dan hoort dat als voetnoot op de tegel. Wie een deur opent, hoort te
   weten wat erachter ligt.

**Leg het voorstel vóór aan de gebruiker.** Als tabel: clusternaam · de tabellen · de zin uitleg.
Zeg erbij welke clusters nooit schrijfbaar kunnen zijn en waarom, en welke tabellen je bewust apart
hield. Vraag om bevestiging of correctie. Hij kent zijn zaak; jij kent het patroon. **Bouw pas
verder als hij zich in de indeling herkent.**

**Waar de indeling leeft.** In een gewoon bronbestand naast de rest van de code, met de hand
geschreven — zie `mcp-server/docs/referentie-app/mcp-clusters.ts` voor de vorm, inclusief de
plattegrond-builder en de dev-asserts. **Niet in de database** (dan kan wie er niet bij hoort hem
wijzigen) en **niet in een configuratiescherm** — een rechtenscherm dat eerst ingesteld moet worden,
wordt niet gebruikt. Het is een redactionele laag, geen instelling.

#### Het vangnet: niets valt stilletjes weg

Handmatig indelen betekent dat je iets kunt vergeten, en juist bij rechten mag "vergeten" nooit
"onzichtbaar" betekenen. Daarom, verplicht:

**Elke tabel die in géén cluster zit en niet technisch of verzegeld is, verschijnt in een eigen
tegel "Nog niet ingedeeld" — zichtbaar en dicht**, met de aanwijzing welk bestand iemand moet
bijwerken. Dat is de prijs voor het loslaten van een automatische indeling, en het houdt de
fail-safe uit §4 volledig overeind: de tabel had toch al geen rij, dus geen toegang. Hij is nu
alleen ook niet meer weggemoffeld.

Voeg daar twee goedkope controles bij, die in ontwikkeling falen en niet in productie: één tabel mag
nooit in twee clusters staan, en een cluster mag nooit naar een tabel wijzen die niet bestaat.

**Een voorbeeld van hoe zo'n indeling eruitziet** (generiek, niet van jouw schema — reken die van
jou zelf uit):

| Cluster | Tabellen | Uitleg in het scherm |
|---|---|---|
| Klanten | `klanten`, `contactpersonen`, `klanttypes` | "Wie je klanten zijn en wie je bij hen spreekt." |
| Orders | `orders`, `orderregels`, `leveringen` | "Wat er besteld is en wat ervan verstuurd werd." |
| Facturen | `facturen`, `factuurregels`, `instellingen` | "Wat je factureerde." *Nooit schrijfbaar — de nummerreeks loopt door.* |
| Boekhouding | `transacties`, `kostcategorieen` | "Wat er in- en uitgaat, met de categorie erbij." |
| Projecten | `projecten`, `taken`, `taaknotities` | "Wat er loopt en wat er te doen staat." |

Merk op dat Facturen en Boekhouding **apart** staan hoewel het allebei over geld gaat: het ene is
onaantastbaar, het andere werk je bij. Regel 3 in actie.

#### Machinerie uit het zicht

Elk schema zit vol tabellen die er zijn voor het apparaat, niet voor het bedrijf: een tabel met de
omgevingsnaam, een activiteitenteller per gebruiker, een wachtrij voor achtergrondtaken, de
migratieboekhouding van je ORM, opgeslagen UI-voorkeuren, mail- of archiveringsadministratie. Die
horen niet in een scherm waar iemand nadenkt over wie klantgegevens mag zien.

De **derde lijst** uit Fase 0, *technische tabellen*, leeft in hetzelfde app-bestand als de
beschermde lijsten (§5.2). Die tabellen zijn:

- **standaard verborgen**, achter één knop ("Machinerie");
- **nooit onderdeel van een cluster** en dus nooit meegenomen door een clusterklik;
- **wél toekenbaar** zodra ze zichtbaar zijn — één voor één, bewust.

Verwar deze lijst niet met de denylist uit regel 7. De denylist is *nooit*, gehardcodeerd, niet te
overrulen. Deze lijst is *uit het zicht*, maar mogelijk. Twee verschillende dingen die je niet in één
mechanisme moet persen. Twijfel je over een tabel, zet hem dan bij de technische: hem alsnog tonen
kost één klik, terwijl overbodige tegels het hele scherm kosten.

#### De rest van het gedrag

- **Uitklappen toont de kolommen** van elke tabel in het cluster: naam en type, plus het commentaar
  dat de database draagt. Puur informatief; hier valt niets in te stellen. Dit is de reden dat de
  beheerder een geïnformeerde keuze maakt in plaats van een gok — geef het echte aandacht en maak
  het ook met het toetsenbord bereikbaar. Het schema komt uit de catalogus via de eigen verbinding
  van de app (zie `mcp-server/docs/referentie-app/schema-atlas.sql`); het verbod op systeemcatalogi
  geldt de MCP-querytool, niet de app. Ververs bij het openen van de pagina; cachen mag, maar kort.
- **Elke stand toont zijn gevolg vóór je klikt**, in gewone taal, en elke geblokkeerde keuze toont
  de reden ("Op deze tabel handelt de applicatie zelf; een model mag hem alleen lezen." / "Een view
  is nooit een schrijfdoel.").
- **Gedeeltelijk.** Hebben de tabellen in een cluster niet dezelfde stand — omdat er een tabel
  bijkwam, omdat er één bewust afwijkend gezet is, of omdat er buiten het scherm om iets gezet is —
  toon dan een vierde, aflezende stand "gedeeltelijk", met hoeveel tabellen anders staan. Eén klik
  trekt het cluster weer gelijk. Dit is de zichtbare kant van de fail-safe: een nieuwe tabel in een
  open cluster is gesloten, en dat hoor je te zien in plaats van te moeten vermoeden.
- **Views** zijn herkenbaar als view, met de tabellen die eronder liggen erbij, en zonder de stand
  "schrijven" (§5.3).
- **Zoeken** op tabelnaam en kolomnaam, en het zoeken kijkt óók in verborgen technische tabellen —
  anders zijn ze onvindbaar in plaats van opgeruimd.
- **Tabellen waarop de applicatie zelf handelt** (nooit-schrijven) tonen de stand "schrijven" niet
  als keuze. Dat is presentatie — de server weigert het schrijven en de publiceer-actie weigert het
  recht (§8.3). Zit zo'n tabel in een cluster, dan blijft de clusterklik op "lezen" steken voor die
  tabel, en dat toon je als "gedeeltelijk" in plaats van het stil te laten mislukken.
- **Verzegelde tabellen.** Tabellen op de denylist staan wél in beeld, maar verzegeld en niet
  aanklikbaar, met een korte uitleg waarom ze nooit toegankelijk zijn. Hun kolommen toon je niet —
  er valt niets in te stellen, en de kolomnamen van juist deze tabellen zijn het gevoeligst.
  Verbergen zou de indruk wekken dat ze vergeten zijn; tonen laat zien dat er bewust over is
  nagedacht.
- **Lege staat.** Een verse rol heeft nul rechten. Maak daar geen leeg scherm van maar een
  uitnodiging: leg in één zin uit dat alles standaard gesloten is, en wijs de weg naar de eerste
  handeling.

### 8.3 Publiceren

- **Klikken wijzigt niets in de database.** Alles is voorlopig tot je publiceert. Een knop telt
  mee: "4 wijzigingen…". Verlaat de pagina niet stilletjes met onbewaarde wijzigingen — waarschuw,
  ook bij het wisselen van rol.
- **Publiceren toont eerst een leesbare samenvatting** ("het proefblad"): de **openingen bovenaan**
  (gesloten → lezen, gesloten → schrijven, lezen → schrijven; binnen de openingen de schrijfrechten
  eerst) en de afsluitingen daaronder — in die volgorde, want daar zit het risico. Gegroepeerd per
  cluster, maar met **de echte tabelnamen** eronder: je klikt op een cluster, je publiceert
  tabellen, en de beheerder tekent voor wat er werkelijk opengaat. In gewone taal: "*facturen* gaat
  van gesloten naar **schrijven**". Met een slotregel die de kern herhaalt: "Verwijderen en
  structuurwijzigingen zijn voor élke rol uitgesloten, ook voor tabellen die hierboven op Schrijven
  komen te staan." Pas na bevestiging gaat het live.
- **De publiceer-actie valideert zelf, server-side, opnieuw.** Ga ervan uit dat iemand haar
  rechtstreeks aanroept en niet via het scherm. Per regel, in deze volgorde — de beschermde lijsten
  gaan vóór alles wat met rechten te maken heeft:
  1. is de aanroeper beheerder (§7);
  2. is de tabelnaam een geldige string en is het niveau een geldige waarde (`lezen`, `schrijven`,
     of `null` = intrekken — intrekken mag altijd, dichtzetten kan nooit iets openen);
  3. staat de naam op de **denylist** → weigeren;
  4. is het niveau `schrijven` en staat de naam op **nooit schrijven** → weigeren;
  5. bestaat de naam echt in het toepassingsschema, en is het een gewone tabel of een view
     (`relkind` `r` of `v`) → anders weigeren;
  6. is het een **partitiekind** of een tabel **met overervende kinderen** → weigeren (dezelfde
     achterdeuren als de server weigert);
  7. is het een view: `schrijven` → weigeren; en de bronnen **transitief** oplossen (§5.3) — een
     beschermde tabel eronder of een niet-ontleedbare view → weigeren.

  De volledige uitwerking, inclusief de catalogusquery's die gelijk moeten blijven aan de server,
  staat in `mcp-server/docs/referentie-app/publiceer-validatie.md`. Zonder deze controle is de
  rechtentabel een vrij beschrijfbaar tekstveld en liegt het rollenoverzicht over wat er openstaat.
- **Publiceren gebeurt in één transactie**, inclusief het ophogen van de versieteller. Half
  doorgevoerde rechten zijn erger dan geen.
- **Twee beheerders tegelijk.** De pagina onthoudt `versie` zoals die was toen ze werd geopend, en
  stuurt die mee. Toets hem **niet** door hem eerst te lezen en dan te vergelijken: twee
  gelijktijdige publicaties lezen dan allebei dezelfde waarde, vinden allebei dat het klopt, en
  schrijven allebei. Doe het in één voorwaardelijke stap — `UPDATE mcp_rollen SET versie = versie +
  1 WHERE id = $1 AND versie = $2 RETURNING versie` — en behandel "nul rijen gewijzigd" als het
  conflict. De teller is verplicht: ontbreekt hij in de aanroep, dan weiger je. Bij een conflict:
  toon wat er intussen veranderde en laat opnieuw bevestigen.
- **Dupliceren** van een rol kopieert de rechten rij voor rij door dezelfde validatie — geen
  `INSERT … SELECT`, want dan omzeil je haar.
- Na publiceren: bevestig kort en zichtbaar wat er gewijzigd is.

---

## 9. Ontwerprichting

**De vormgeving staat in `mcp-server/docs/design-brief-connector.md`.** Lees dat vóór je aan het
scherm begint; kies daar in Fase 0 een layoutvariant en leg de keuze voor. Bindend, ongeacht de
variant:

1. **De these:** dit scherm gaat niet over een formulier met instellingen, maar over wat er dicht is
   en wat er open staat — van over de kamer af te lezen. De verbinding ís de stand.
2. **De drieklank:** geen toegang = kleurloos en gestippeld (bewust géén alarmkleur — gesloten is de
   gezonde toestand), lezen = één koele tint, schrijven = het merkaccent, en dat is de énige plek
   waar het accent verschijnt naast een onbewaarde wijziging en de publiceerknop.
3. **Nooit kleur alleen:** elke stand heeft óók een eigen lijnstijl en een eigen teken (`—` · `◦` ·
   `●`, en `◐` voor "gedeeltelijk"). Het scherm is volledig leesbaar in grijstinten.
4. **Eén signatuurmoment**, en verder beweegt er niets uit zichzelf. Bouw met de bestaande tokens en
   bouwstenen van deze codebase; geen nieuw palet, geen nieuwe primitives als er al een geschikte
   bestaat.
5. **Kwaliteitsvloer en woorden:** `prefers-reduced-motion`, volledig toetsenbord, `aria-hidden` op
   alles wat decoratief is met de informatie óók als tekst, contrast voor alle standen, klein scherm.
   Noem de standen bij hun gevolg (Geen toegang · Lezen · Schrijven, nooit `SELECT`/`RW`), hetzelfde
   woord door de hele flow, actieve werkwoorden op knoppen ("Wijzigingen publiceren"), foutmeldingen
   die zeggen wat er misging en wat de volgende stap is.

---

## 10. Fail-safe bij toekomstige schemawijzigingen

- **Een nieuwe tabel is automatisch gesloten** voor élke rol. Dat volgt gratis uit het datamodel
  (§4): geen rij = geen recht. Bouw geen enkele voorziening die nieuwe tabellen automatisch
  toevoegt aan bestaande rollen, hoe handig dat ook lijkt. Wat er wél bij hoort: de `GRANT` in de
  migratie, anders is de tabel onbereikbaar zodra hij wordt opengezet.
- **Een nieuwe kolom erft de rechten van zijn tabel** en is dus meteen zichtbaar voor wie die tabel
  mag lezen. Dat is een bewuste keuze voor eenvoud — en precies daarom moet de ontwikkelaar er
  actief op gewezen worden op het moment dat hij die kolom toevoegt.
- **Installeer daarvoor de skill die met de template meekomt:**
  `mcp-server/docs/mcp-rechten/SKILL.md` → plaats als `.claude/skills/mcp-rechten/SKILL.md` in de
  root van deze repo, vul de placeholders in (de paden naar het app-bestand met de beschermde
  lijsten, het clusterbestand en de publiceer-actie), en verwijder de installatiesectie bovenaan.
  De skill doet bij elke schemawijziging in seconden wat hier staat: nieuwe tabel → gesloten, hoort
  hij op een beschermde lijst, is het machinerie, welk cluster; nieuwe kolom → wie kijkt meteen mee,
  wijst de naam op gevoelige inhoud; view of trigger → de zware controle. En bij elke wijziging aan
  de veiligheidslaag start ze de drie reviewers uit §11.

---

## 11. De zware controle — alleen aan de poort

Wijzigingen aan **de veiligheidslaag zelf** worden na afloop gecontroleerd door **drie parallelle
reviewers** (elk een apart, gelijkwaardig sterk model), elk met een eigen invalshoek:

1. **Omzeiling** — kun je met een slimme aanroep langs de validatie?
2. **Fail-open** — is er een pad waarlangs de beveiliging stilletjes verdwijnt bij een ontbrekende
   configuratie, een fout, een lege waarde of een uitzondering?
3. **Rechtenescalatie** — kan iemand langs deze wijziging zijn eigen rechten of beheerderschap
   verhogen, of de denylist uit regel 7 raken?

Draai ze als drie afzonderlijke subagents, in één keer gestart zodat ze parallel lopen en elkaars
uitkomst niet zien. Geef elk de diff, de gewijzigde bestanden en zijn eigen invalshoek. De precieze
reviewprompts staan in de skill (§10).

**Een afkeuring** is elke concrete bevinding. "Het zou netter kunnen" is geen afkeuring.
**Unanimiteit is vereist.** Eén afkeuring betekent: herstellen en opnieuw laten controleren.

**Wanneer wél:** de publiceer-actie en haar validatie, de beheerderspoort (`eisBeheerder()` en de
eerste-beheerder-bootstrap), de app-kopie van de beschermde lijsten, het aanmaken of herschrijven
van een **view** die in het rechtenmodel zit of kan komen (de definitie bepaalt wat een al toegekend
recht ontsluit), een nieuwe trigger of `SECURITY DEFINER`-functie, en alles in `mcp-server/` dat de
skill als baan B aanwijst.

**Wanneer niet:** een gewone schemawijziging aan tabellen of kolommen, UI-werk aan het scherm dat de
validatie niet raakt, of tekstwijzigingen. Deze controle is bewust smal gehouden: ze moet zwaar zijn
waar het telt en volledig afwezig waar ze alleen maar tijd kost.

---

## 12. Wat je bewust NIET bouwt

Bouw deze dingen niet, ook niet als ze een goed idee lijken. Ze zijn afgewogen en afgewezen; ze
weer invoeren maakt de feature zwaarder zonder dat er om gevraagd is.

- **Geen audit-log.** Bewust afgewezen. Voeg geen tabel toe die wijzigingen of queries bijhoudt.
- **Geen rechten op kolomniveau in het model.** Het kolompaneel toont kolommen, maar je stelt er
  niets in. Moet het toch, dan is een view de weg.
- **Geen rechten op rijniveau in het model.** Ook hier is een view het antwoord.
- **Geen `DELETE`**, in geen enkele vorm en achter geen enkele optie.
- **Geen meerdere rollen per gebruiker.** Precies één, of geen.
- **Geen eigen accountbeheer.** Geen wachtwoorden, geen registratie, geen uitnodigingsflow, geen
  tweede code voor het rechtenscherm. De identiteit komt van Microsoft OAuth (§7).
- **Geen automatische rechten voor nieuwe tabellen**, in geen enkele variant.
- **Geen tijdelijke of vervallende rechten.**
- **Geen rechten op clusterniveau in het datamodel.** Clusters zijn bediening; de opslag blijft per
  tabel (§4).
- **Geen configuratiescherm voor de clusters.** De indeling staat in de broncode en wordt door een
  ontwikkelaar gewijzigd, in overleg met de gebruiker (§8.2).
- **Geen vrije plaatsing van knopen, geen opgeslagen layout per rol, geen "module toevoegen"-
  dropzone, geen slepen dat een recht wijzigt.** De layout is berekend, niet bewaard (§8.1, en de
  design-brief).
- **Geen vierde tool en geen toolnamen die per rol verschillen.** Moet iemand minder kunnen, dan pas
  je zijn rechten aan, niet de toolset.

Wil de gebruiker later een van deze dingen, dan is dat een nieuw, apart besproken stuk werk.

---

## 13. Verificatie

Deze codebase test je niet door de app in een browser open te klikken — dat doet de gebruiker.
Jij levert bewijs op serverniveau.

**De server.** Draai `pnpm test` in `mcp-server/`: de testmatrix en élke omzeiling, zonder
database. Met `MCP_TEST_BRANCH=1` op een **Neon-testbranch** (nooit productie) ook de databasetests:
de controlequery, de beschermde tabellen, read-only, `search_path`, geen `CREATE`, en de cumulatieve
teller. Voeg daar niets aan toe vanuit deze opdracht.

**De publiceer-actie.** Een rechtstreekse aanroep wordt geweigerd bij: een aanroeper zonder
beheerderschap, een tabelnaam van de denylist, schrijfrecht op een nooit-schrijven-tabel, een
onbestaande tabelnaam, een partitiekind of een tabel met kinderen, schrijfrecht op een view, een view
over een beschermde tabel, een niet-ontleedbare view, een ontbrekende of verouderde versieteller.
En: een geldige aanroep schrijft precies de bedoelde rijen en hoogt de versie met één op.

**De beheerderspoort.** Een **ingelogde niet-beheerder** die een beheeractie rechtstreeks aanroept —
buiten het scherm om, met een geldige sessie — wordt geweigerd, bij élke actie. En: iemand van wie
het beheerderschap zojuist is ingetrokken, wordt bij zijn eerstvolgende actie geweigerd **zonder dat
hij opnieuw hoeft in te loggen**. Die tweede test is de belangrijkste: hij bewijst dat de vlag uit de
database komt en niet uit het token. Plus: de laatste beheerder kan zichzelf niet degraderen, en
`MCP_EERSTE_BEHEERDER_OID` doet niets meer zodra er één beheerder is.

**Views.** Een toegekende view levert in `lees_query` gewoon zijn rijen op zonder dat de rol recht
heeft op de tabel eronder; een view over een denylist-tabel is niet toekenbaar.

**Clusters.** De twee dev-asserts (tabel in twee clusters, onbestaande tabel) falen in ontwikkeling.
Een tabel die nergens is ingedeeld, verschijnt in "Nog niet ingedeeld".

**Handmatig, met de MCP Inspector** (`pnpm dlx @modelcontextprotocol/inspector`, Streamable HTTP,
de URL van de Worker): log in als een testgebruiker met een rol, roep `lijst_tabellen` aan, en
vergelijk met wat het scherm zegt dat openstaat. Zet daarna in het scherm een tabel dicht en roep
`lijst_tabellen` opnieuw aan — zonder opnieuw te verbinden. De tabel moet weg zijn.

**Is er geen testinfrastructuur?** Introduceer er niet ongevraagd een — dat is een grote,
zelfstandige beslissing. Vraag het aan de gebruiker. Wil hij geen testframework, lever dan een klein
script dat de gevallen hierboven doorloopt tegen een testdatabase en de uitkomsten afdrukt. Zonder
enige vorm van bewijs opleveren is geen optie: dan weet niemand of de poort dicht is.

Draai daarnaast wat de codebase gebruikelijk draait: typecontrole, linting, build en de
migratiestap. Rapporteer de uitkomsten eerlijk — een falende test meld je met de uitvoer erbij.

---

## 14. Voor je oplevert

- [ ] Fase 0 doorlopen; onduidelijkheden gevraagd in plaats van ingevuld; `GEBRUIKERS` en
      `NOOIT_SCHRIJVEN` in `mcp-server/src/mcp.config.ts` kloppen met deze codebase.
- [ ] Alle acht regels uit §2 nagelopen, één voor één, tegen de daadwerkelijke code.
- [ ] De migratie zet iedereen dicht, verwijdert een oud rechtenveld, en dat is aan de gebruiker
      gemeld vóór ze draaide. `03-controle.sql` geeft nul rijen.
- [ ] De app-kopie van de beschermde lijsten is identiek aan de server.
- [ ] De beheerderspoort controleert bij élke actie de database; de eerste beheerder is aangewezen
      via `MCP_EERSTE_BEHEERDER_OID` en die variabele is daarna inert.
- [ ] De publiceer-actie valideert in de volgorde uit §8.3 en gebruikt de voorwaardelijke versie-bump.
- [ ] De clusterindeling is voorgelegd en bevestigd (§8.2), elke tabel is geplaatst óf zichtbaar in
      "Nog niet ingedeeld", en de twee controles daarop falen in ontwikkeling.
- [ ] De layoutvariant uit de design-brief is gekozen en voorgelegd; niets wordt gesleept of opgeslagen.
- [ ] De tests uit §13 bestaan en slagen; typecontrole, linting en build slagen.
- [ ] De kwaliteitsvloer uit §9 is nagelopen: reduced motion, toetsenbord, contrast, klein scherm,
      plus de opleverchecklist van de design-brief.
- [ ] De skill uit §10 is geïnstalleerd, met ingevulde placeholders.
- [ ] **De CLAUDE.md-notitie is voorgesteld.** Het blok staat in
      `mcp-server/docs/claude-md-notitie.md`. Plak het **niet zelf** in de `CLAUDE.md` (of het
      equivalent) van deze codebase: leg het voor aan de eigenaar en laat hem beslissen waar het komt.
- [ ] Aan de gebruiker gemeld: wat je aanscherpte ten opzichte van het bestaande gedrag, en welke
      beperkingen overblijven (§17 — met name: zonder logboek weet je wél wie het *kon*, niet wie het
      *deed*, en of er point-in-time-herstel op de database staat).

---

## 15. Werkwijze

- Werk in deze volgorde: Fase 0 → migratie + `GRANT`'s → beheerderspoort → publiceer-actie met
  validatie → rol toewijzen → het scherm → skill + notitie → afrondingscheck. De poort en de
  validatie vóór de UI: het scherm mag pas rechten kunnen uitdelen als de server-actie ze al kan
  weigeren.
- Loop je tegen een keuze aan die niet in dit document staat en die het veiligheidsniveau raakt:
  **kies de striktste optie en meld dat je dat gedaan hebt.** Raakt ze het veiligheidsniveau niet,
  kies dan wat past bij de codebase en ga door.
- Verzin geen testdata in een productiedatabase.
- Meld eerlijk wat er niet af is. Half af en benoemd is bruikbaar; half af en stilgehouden is een
  beveiligingsgat.

---

## 16. Beslissingslogboek

Deze keuzes zijn gemaakt en toegelicht. Heropen de discussie niet; wijk er alleen van af als de
gebruiker daar uitdrukkelijk om vraagt.

**Belangrijk: dit geldt niet voor de acht regels uit §2.** Die staan er los van en zijn ook op
verzoek niet te versoepelen — dat is wat "niet-onderhandelbaar" betekent. Vraagt de gebruiker erom,
leg dan uit wat het gevolg is en behandel het als een aparte, expliciete beslissing van hem, niet
als een variant binnen deze opdracht.

| Beslissing | Reden |
|---|---|
| Welke tabellen: in de applicatie. Welke operaties: in de database | De tabeldimensie moet in de applicatie omdat een beheerder geen databaserollen beheert; de operatiedimensie blijft in de database omdat dát de garantie is die geen applicatiefout kan breken |
| Schrijven = INSERT + UPDATE, nooit DELETE | Dataverlies door een goedbedoelend model is het grootste reële risico, en een operatie die niet bestaat kan niet misgaan. Dit dekt maar de helft — een te brede `UPDATE` wist net zo goed; daarom is de rijbegrenzing geen detail maar de andere helft van dezelfde garantie |
| Alles dicht bij de uitrol | De enige manier om zeker te weten dat niets per ongeluk openstaat, is beginnen bij nul |
| Geen toegang = afwezigheid van een rij | Maakt nieuwe tabellen fail-safe zonder dat iemand eraan hoeft te denken |
| Publiceren met een leesbare samenvatting | Voorkomt de fatale misklik en geeft een natuurlijk moment van bezinning |
| Rechtentabellen op een gehardcodeerde denylist, met een app-kopie | Zonder de denylist kan een rol met schrijfrechten zichzelf promoveren; zonder de kopie liegt het scherm over wat er openstaat |
| Geen audit-log | Bewust afgewezen door de opdrachtgever |
| Identiteit altijd via Microsoft OAuth; beheerderschap is een veld in de database | Eén authenticatieweg is minder oppervlak dan twee. En omdat de vlag in de database staat — op een tabel op de denylist — geldt een intrekking onmiddellijk en kan geen enkele MCP-rol zichzelf promoveren |
| De eerste beheerder via een oid in een omgevingsvariabele die daarna inert is | Een e-mail is opnieuw uit te geven; een variabele die blijft werken is een permanente achterdeur |
| Eén rol per gebruiker | "Wat mag deze persoon" moet een blik zijn, geen rekensom — daar ontstaan rechtenfouten |
| Nieuwe kolom erft de tabelrechten | Eenvoud boven fijnmazigheid; het risico wordt afgedekt doordat de skill er actief op wijst |
| Zware controle alleen aan de poort | Streng waar het telt, en volledig afwezig bij routinewerk, zodat de controle serieus genomen blijft |
| Drie tools, voor elke rol dezelfde namen | Meerdere query-tools naast elkaar maken voor de AI-client onverklaarbaar waarom een tabel in de ene wél bestaat en in de andere niet |
| Het cluster is de klikeenheid, de tabel de opslageenheid | Een order is in werkelijkheid vijf tabellen die niemand los denkt; één keuze houdt het scherm bruikbaar, terwijl de opslag per tabel de handhaving en de fail-safe onaangetast laat |
| Clusters worden voorgesteld door de agent en bevestigd door de gebruiker, niet afgeleid uit het schema | Een schema weet niet hoe een bedrijf over zichzelf denkt. Domeinkennis is hier het gereedschap, en de gebruiker is de enige die het kan corrigeren |
| Wat nergens is ingedeeld verschijnt in "Nog niet ingedeeld" | Handmatig indelen betekent dat je iets kunt vergeten; bij rechten mag vergeten nooit onzichtbaar betekenen |
| Technische tabellen standaard verborgen, wel toekenbaar | Machinerie hoort niet in een scherm over wie klantgegevens mag zien; verbergen ruimt op zonder iets onmogelijk te maken, anders dan de denylist |
| Views wél toekenbaar, met transitieve toetsing en alleen-lezen | Ze zijn het enige gereedschap voor kolom- en rijafscherming. De bescherming komt van de server én de publiceer-actie, die de onderliggende tabellen oplossen — niet van de database, want de gedeelde leesgebruiker kent geen onderscheid per rol (§17) |
| Layout is berekend, niet opgeslagen | Een beveiligingsscherm heeft één canonieke toestand; je moet kunnen zeggen "het scherm is schoon", en dat kan niet als een deel buiten beeld kan staan of een sleepactie iets betekent |

---

## 17. Aanvaarde restrisico's

Deze opdracht sluit veel af, maar niet alles. Wat hieronder staat is bewust níét dichtgezet. Meld
deze punten aan de gebruiker bij oplevering, zodat hij weet wat hij heeft — een restrisico dat
benoemd is, is een keuze; een restrisico dat als afgedekt wordt gepresenteerd, is een misleiding.

- **Onherstelbaarheid.** Er is geen logboek (§12) en dit document schrijft geen back-upbeleid voor.
  Gaat er binnen de toegestane grenzen toch iets mis met een `UPDATE`, dan is er geen spoor van wat
  er stond. Vraag de gebruiker of er point-in-time-herstel op de database staat; is dat er niet, dan
  is dat een groter risico dan wat dan ook in dit document.
- **Wat de database zelf doet.** Triggers, rules en referentiële acties schrijven mee zonder dat de
  analyse ze ziet, en het aantal geraakte rijen telt alleen de doeltabel. Het intrekken van
  functierechten helpt hiertegen alleen als het van `PUBLIC` gebeurt — lukt dat niet, dan is dit
  een open risico en geen afgedekt punt.
- **Bestaansorakels via foutgedrag.** Een `INSERT` in een open tabel met een verwijzing naar een
  gesloten tabel slaagt of faalt afhankelijk van wat er in die gesloten tabel staat. Het lekt weinig
  (één bit per poging), maar het lekt.
- **Je weet wie het kón, niet wie het déed.** Met een per-persoon-login staat vast wie er beheerder
  ís, maar zonder logboek blijft achteraf onherleidbaar wie een bepaalde rechtenwijziging heeft
  doorgevoerd. Bij meer dan één beheerder is dat een reële beperking.
- **Een uitgegeven token blijft geldig tot het verloopt.** Iemand het beheerderschap afnemen werkt
  alleen onmiddellijk omdat de controle de database per actie leest (§7). Voor de MCP-sessie geldt
  hetzelfde via regel 6. Zou een van beide ooit terugvallen op een claim uit het token, dan loopt
  een intrekking stil achter op de werkelijkheid.
- **De twee kopieën.** De beschermde lijsten in de app en in de server zijn met de hand gelijk te
  houden; er is geen compile-time koppeling. De skill wijst erop, maar een vergeten update laat het
  scherm rechten aanbieden die de server weigert (de veilige richting) of, bij een nieuwe
  identiteitstabel, een tabel tonen die verzegeld had moeten zijn.
- **Hernoemen plus opnieuw aanmaken.** De server merkt op dat een beschermde tabelnaam verdwenen
  is, maar niet dat er een nieuwe, onschuldige tabel met die naam voor in de plaats is gezet. Dat
  vraagt DDL en dus een ontwikkelaar — een risico van binnenuit, niet via MCP.
- **Eén gedeelde leesgebruiker.** De databaserechten zijn de vereniging over alle rollen: mag één
  rol een tabel lezen, dan heeft de leesgebruiker dat recht. Per rol onderscheiden gebeurt dus
  uitsluitend in de applicatielaag. De database blijft de garantie op het *soort* handeling, niet op
  *welke tabel* voor *welke rol*.
- **Views leunen daardoor op de applicatielaag.** Ligt onder een toegekende view een tabel die een
  ándere rol wél mag lezen, dan is er voor deze rol geen tweede laag. De transitieve denylist en de
  alleen-lezen-regel (§5.3) dekken de ernstigste gevallen af; de rest is applicatielogica.
- **De grens is een grens, geen intentiecontrole.** Iemand met legitiem schrijfrecht kan binnen de
  toegestane omvang schade aanrichten. Rechten uitdelen blijft een vertrouwenshandeling; dit
  systeem maakt alleen zichtbaar en beperkt wát je uitdeelt.
