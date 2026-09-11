# Opdracht — visueel MCP-rechtenbeheer per rol en per tabel

> **Hoe je dit gebruikt:** plak dit volledige document als opdracht in een nieuwe sessie van je
> coding agent, in de codebase waar de feature moet komen. Het document is zelfdragend voor de
> **werking**: alle context, regels en redeneringen staan erin.
>
> **Plak er `mcp-rechtenbeheer-design-prompt.md` bij.** Dat tweede document beschrijft hoe het
> beheerscherm eruitziet en aanvoelt — het canvas, de lichtwaaier, de kaarten, waar elke knop
> staat — met een schermafdruk als referentie. Zonder dat document bouw je een werkend maar
> gewoon scherm; §9 hier geeft alleen de eisen die ongeacht de vormgeving gelden.

---

## 0. Wat je bouwt

Een beheerscherm waarmee een beheerder **per MCP-rol instelt welke databasetabellen die rol mag
lezen of schrijven**, plus de handhaving daarvan in de MCP-server.

Drie standen per tabel: **geen toegang · lezen · schrijven**. Rollen zijn door de beheerder aan te
maken; elke gebruiker draagt precies één rol. Per rol is er één pagina met het volledige
databaseschema in beeld, waar hij per tabel de stand zet.

De feature bestaat uit vier delen:

1. **Datamodel** — rollen, rechten per rol × tabel, en de koppeling gebruiker → rol.
2. **Handhaving** in de MCP-server — elke SQL wordt ontleed en getoetst vóór uitvoering.
3. **Beheerscherm** — de schema-atlas met de drie standen.
4. **Fail-safe voor de toekomst** — nieuwe tabellen zijn automatisch gesloten, en een skill wijst
   de ontwikkelaar bij elke schemawijziging op de gevolgen.

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
→ Afgedekt door regel 3 (DELETE bestaat niet).

**Scenario 2 — de stille terugval.** De read-only databaseverbinding is geconfigureerd via een
secret. In een nieuwe omgeving ontbreekt dat secret. De code valt "netjes" terug op de gewone
verbinding en logt een waarschuwing die niemand leest. Vanaf dat moment draaien alle leesqueries
met schrijfrechten, en niets in de UI verraadt dat. Dit is de klassieke fail-open: de beveiliging
verdwijnt zonder dat er iets stukgaat.
→ Afgedekt door regel 5 (geen enkele terugval; weigeren te starten).

**Scenario 3 — de zelfbediening.** De tabel met rollen en rechten staat gewoon in dezelfde
database. Een rol met schrijfrechten op "alle tabellen" kan zichzelf tot de hoogste rol promoveren
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
uitzonderingen, geen vlaggen, geen ontwikkelmodus en geen "tijdelijk even".

1. **Deny-by-default.** Wat niet expliciet is toegestaan, wordt geweigerd. De afwezigheid van een
   recht is geen fout en geen ontbrekende configuratie: het ís de weigering. Dit geldt voor data
   én voor structuur — een rol ziet in de tabellen-tool alleen de tabellen die hij mag lezen.

2. **DDL is altijd verboden.** `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE`, `COMMENT`,
   `REINDEX`, `VACUUM`, `ANALYZE`, `CLUSTER`, `COPY`, `SET`, `RESET`, `CALL`, `DO`-blokken en elke
   vorm van transactiebesturing (`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`). Ook voor de hoogste
   rol. Schemabeheer hoort in migraties thuis, nooit in een MCP-tool.

   *Reikwijdte:* deze regel gaat over de query die de aanroeper aanlevert. Wat de server er zélf
   omheen zet om veilig uit te voeren — een read-only transactie openen, een statement-timeout
   zetten — valt hier niet onder. Dat is geen uitzondering op de regel, dat ís de handhaving.

3. **`DELETE` bestaat niet.** Het is geen stand in de UI, geen waarde in het datamodel en geen
   toegestane operatie in de server. `MERGE` is in élke vorm verboden, ook zonder delete-tak.
   Schrijven betekent hier uitsluitend: **rijen toevoegen (`INSERT`) en bestaande rijen bijwerken
   (`UPDATE`)**.

   **Een `UPDATE` moet begrensd zijn — en een `WHERE` eisen is daarvoor niet genoeg.** Dit is de
   belangrijkste val in deze hele opdracht. `UPDATE klanten SET naam='' WHERE id IS NOT NULL` heeft
   een `WHERE`, gebruikt een kolom van de doeltabel, is niet altijd-waar van vorm — en wist net zo
   goed de hele tabel als een `DELETE`. Elke controle op de vórm van de voorwaarde is te omzeilen
   met één extra woord.

   Begrens daarom op het **aantal geraakte rijen**, niet op de vorm:

   - Voer elke `INSERT` en `UPDATE` uit in een transactie, kijk naar het aantal geraakte rijen, en
     **draai terug** zodra dat een bovengrens overschrijdt (richtwaarde: honderd rijen). Meld dat de
     bewerking te breed was — en schrijf er **niet** bij dat het in kleinere stappen wél kan. Dat is
     precies de aanwijzing die een model nodig heeft om de grens te omzeilen.
   - **Een grens per statement is niet genoeg.** Honderd rijen per keer, tweehonderd keer herhaald,
     wist een tabel net zo grondig — en een model dat een weigering krijgt, probeert vanzelf een
     kleinere batch. Houd daarom per rol ook een **cumulatieve teller** bij van gewijzigde rijen
     binnen een voortschrijdend tijdvenster (richtwaarde: duizend rijen per uur) en weiger zodra die
     vol is; de teller loopt weer leeg met de tijd. Dit is geen logboek en botst niet met §12: je
     bewaart een getal, geen queries en geen geschiedenis.
   - **De teller moet in de database staan, niet in het geheugen.** Draait de server per aanroep of
     over meerdere processen, dan is een teller in het geheugen bij elke aanroep weer nul en is de
     hele grens een illusie: honderd rijen per keer, tweehonderd keer, en de tabel is leeg. Werk hem
     atomair bij (ophogen en teruglezen in één statement) en **in dezelfde transactie als het
     schrijven**, anders telt een teruggedraaide poging mee of juist niet.
   - **Zet die tellertabel op de beschermde lijst uit regel 7.** Anders verschijnt hij als gewone
     tegel in de atlas en zet één `UPDATE quota SET n = 0` de begrenzing uit. Dat de schrijfgebruiker
     de server hem wél moet kunnen bijwerken is geen tegenspraak: de beschermde lijst weert
     *aangeleverde* queries, terwijl de server zijn eigen boekhouding met zijn eigen code doet. Dat
     gaat via de aparte serviceverbinding uit §5.4 — niet via de schrijfgebruiker, die op geen enkele
     beschermde tabel rechten heeft.
   - Kan de runtime geen transacties (sommige HTTP-drivers niet), dan geldt een strenger regime,
     want terugdraaien kan dan niet: eis bij `UPDATE` dat de `WHERE` de primaire sleutel gelijkstelt
     of opsomt met **letterlijke waarden** (`WHERE id = 'x'`, `WHERE id IN ('a','b')`, hooguit de
     bovengrens aan waarden). Een subquery is daar verboden: `WHERE id IN (SELECT id FROM klanten)`
     voldoet aan de letter van "somt de primaire sleutel op" en raakt toch de hele tabel — en zonder
     transactie is er niets dat het terugdraait. Sta bij
     `INSERT` **alleen letterlijke rijen** toe (`VALUES (…), (…)`, geteld en begrensd). `INSERT …
     SELECT` is in dat geval verboden: zonder transactie is er niets dat hem begrenst, en
     `INSERT INTO t SELECT * FROM t` verdubbelt een tabel per aanroep. De cumulatieve teller geldt
     onverkort.
   - Haalt de terugval het beoogde niveau niet, **meld dat dan aan de gebruiker** en laat hem
     beslissen of hij zo wil bouwen. Stilzwijgend zwakker opleveren is de ene fout die je hier niet
     mag maken.
   - Weiger daarnaast nog steeds een ontbrekende `WHERE` en een altijd-ware voorwaarde — dat is
     goedkoop en vangt de domme gevallen vroeg af.
   - Dezelfde bovengrens geldt voor `INSERT`. Zonder die grens is `INSERT INTO t SELECT * FROM t`
     of een `INSERT` uit een reeksgenerator een manier om de database vol te schrijven — en omdat
     `DELETE` niet bestaat, is die rommel via MCP niet meer op te ruimen.
   - `INSERT … ON CONFLICT DO UPDATE` (upsert) telt als schrijven en valt onder dezelfde grens; de
     `DO UPDATE`-tak wordt behandeld als een `UPDATE`.
   - **Weet wat de teller níét ziet:** het aantal geraakte rijen slaat op de doeltabel. Een
     `ON UPDATE CASCADE`- of `SET NULL`-relatie schrijft duizenden rijen in een kindtabel weg terwijl
     het hoofdstatement er één raakt, en een trigger doet hetzelfde (§5.6). Inventariseer daarom bij
     Fase 0 ook de referentiële acties, en behandel een tabel met cascaderende sleutels of
     schrijvende triggers als een tabel die niet zomaar schrijfrecht krijgt — zie de restrisico's
     in §17.

   *Let op:* het is goed mogelijk dat de bestaande MCP-server in deze codebase `DELETE` vandaag wél
   toestaat. Deze opdracht is dan bewust een **aanscherping**, geen behoud van het bestaande gedrag.
   Meld dat expliciet aan de gebruiker als je het aantreft. **De uitkomst staat vast: `DELETE`
   komt er niet.** Wat je wél doet, is in kaart brengen wat er vandaag op leunt en het alternatief
   aanbieden: een **soft delete**. Een statusveld (`vervallen_op`, `actief`, `status`) dat een rol
   met schrijfrecht met een `UPDATE` bijwerkt. De rij blijft bestaan, de handeling is terug te
   draaien, en de applicatie beslist zelf wat ze met dat veld doet. Echt verwijderen gebeurt in de
   applicatie, door code die daarvoor geschreven en getest is — niet door een AI-client op een
   productiedatabase.
   Vraagt de gebruiker toch om `DELETE` in de MCP-server, weiger dat dan **binnen deze opdracht**.
   Leg uit dat het de kern ervan ondergraaft en dat het een eigen opdracht met een eigen
   veiligheidsafweging vraagt. Bouw het hier niet, in geen enkele vorm — ook niet "als hoofdgerecht".

4. **Handhaving is uitsluitend server-side.** De UI is een bedieningspaneel, nooit de beveiliging.
   Ga ervan uit dat iemand de MCP-server rechtstreeks aanspreekt zonder ooit het scherm te openen.
   Elke controle die alleen in de frontend of alleen in een server action leeft, telt niet mee.

5. **Geen enkele fail-open terugval.** Ontbreekt de read-only verbinding, een verplichte
   configuratiewaarde of de rechtentabel, dan **weigert de server te starten** met een duidelijke
   foutmelding. Hij schakelt nooit terug naar een ruimere verbinding, laat nooit "voorlopig alles
   toe" en logt nooit alleen een waarschuwing. Falen is luid en dicht, nooit stil en open.
   Kent de runtime geen startmoment (serverless, per aanroep opgestart), dan geldt hetzelfde bij
   élke aanroep: weigeren zolang de configuratie onvolledig is.

6. **Rechten worden vers gelezen per tool-aanroep.** Niet één keer bij het opzetten van de sessie,
   niet uit het toegangstoken, niet uit een cache met een lange levensduur. Een ingetrokken recht
   geldt onmiddellijk en dus bij de eerstvolgende aanroep. Cache dit niet. Eén kleine, geïndexeerde
   query per aanroep is goedkoper dan de vraag of een ingetrokken recht al is aangekomen.

7. **De rechten beschermen zichzelf.** De tabellen met rollen, rechten en gebruikers staan op een
   **gehardcodeerde denylist in de broncode van de MCP-server**: nooit leesbaar, nooit schrijfbaar,
   door geen enkele rol, en niet aan te zetten vanuit de UI of vanuit de database. Zet dezelfde
   lijst niet in de database zelf — dan is ze te wijzigen door wie hem juist niet mag wijzigen.

   **De lijst is breder dan alleen rollen en rechten.** Alles waarmee je je een identiteit kunt
   aanmeten hoort erop: sessies, accounts, tokens, API-sleutels, uitnodigingen, wachtwoordherstel.
   Schrijfrecht op een sessietabel is schrijfrecht op iedereen. Loop bij Fase 0 het schema langs op
   dit soort tabellen en zet ze er allemaal op.

   *Reikwijdte:* dit gaat over queries die van buiten binnenkomen. De server leest de rechtentabel
   uiteraard zelf, via zijn eigen code — dat is geen aangeleverde query en valt hier niet onder.

8. **Bij twijfel weigeren.** Een query die niet met zekerheid te ontleden is, een constructie die de
   analyse niet kent, een tabelnaam die niet ondubbelzinnig te herleiden is: weigeren, met een
   melding die uitlegt wat er niet kon. Nooit "waarschijnlijk veilig", nooit "waarschijnlijk alleen
   lezen". Een geweigerde legitieme query is een klein ongemak; een toegelaten schadelijke query is
   niet terug te draaien.

---

## 3. Fase 0 — inventariseer je codebase, en vraag wat je niet vindt

Dit document weet niets over de codebase waarin je werkt. Voordat je één regel schrijft, stel je de
volgende feiten vast. **Vind je iets niet: vraag het aan de gebruiker. Verzin niets, ga nergens
vanuit.**

1. **Waar leeft de MCP-server?** Een aparte map of project, of onderdeel van de app? Hoe worden
   tools geregistreerd, en welke tools bestaan er nu? Welke daarvan raken de database?
2. **Hoe wordt een MCP-gebruiker geïdentificeerd?** Welke claim of sleutel komt er uit de login, en
   hoe wordt die aan een rij in de database gekoppeld?
3. **Waar staat de gebruikerstabel**, hoe heet ze, en welk rechtenveld bestaat er vandaag? Hoe ziet
   het huidige rolmodel eruit, zodat je weet wat je migreert?
4. **Wat is de huidige SQL-veiligheidslaag?** Zoek de plek waar queries gevalideerd worden en lees
   die volledig. Noteer wat er vandaag doorheen komt — met name of `DELETE` toegestaan is en of er
   ergens een terugval op een ruimere databaseverbinding zit (zie regel 5).
5. **Controleer de identiteitsketen.** Ga ervan uit dat de app met Microsoft OAuth beveiligd is
   (§7) en stel vast: welke claim is de onveranderlijke sleutel, worden tenant, doelgroep en
   vervaltijd gevalideerd, en gebruiken de app én de MCP-server **dezelfde** sleutel? Lopen die
   uiteen, dan kan iemand in het ene systeem een andere persoon zijn dan in het andere. Vind je
   geen per-persoon-login, stop dan en leg het voor — zie de stopregel in §7.
6. **Bestaat er al een read-only databaseverbinding** of een least-privilege databasegebruiker?
7. **Hoe werken migraties** in dit project, en wat is de afgesproken werkwijze bij een
   schemawijziging? Volg die exact.
8. **Welke design-tokens en UI-bouwstenen bestaan er al?** Kleuren, radii, motion-tokens, knoppen,
   kaarten, dialogen, schakelaars, tabellen, lege staten. Je hergebruikt deze; je introduceert geen
   nieuwe merkkleuren en geen nieuwe primitives als er al een geschikte bestaat.
9. **Zijn er projectregels** (een `CLAUDE.md`, `AGENTS.md`, regels- of documentatiemap) die je moet
   volgen? Lees ze vóór je begint en houd je eraan — ze gaan boven de stijlsuggesties in dit document.
10. **Welke runtime draait de MCP-server?** Daarvan hangt af of er een SQL-parser in past (§5.2) en
    of transacties beschikbaar zijn (regel 3). Zoek dit uit vóór je aan de handhaving begint.
11. **Mag je databasegebruikers aanmaken** bij deze hostingpartij, en zo ja hoe? §5.4 leunt op vier
    gescheiden gebruikers. Kan het niet, dan bestaat de operatiedimensie uit §5 niet en is de
    applicatielaag je enige poort. Bouw dan niet stilzwijgend door: leg aan de gebruiker uit wat er
    wegvalt (de garantie dat er nooit iets verwijderd kan worden, ook niet bij een fout in de code)
    en laat hem beslissen of hij zo wil beginnen.
12. **Bestaat er testinfrastructuur?** Zo niet, zie §13 voordat je er zelf een introduceert.
13. **Staan er triggers, rules of `SECURITY DEFINER`-functies op de tabellen?** Dit is
    veiligheidskritisch en wordt bijna altijd over het hoofd gezien — zie §5.6.
14. **Hoeveel tabellen telt het schema?** Bij enkele honderden heeft de atlas een andere indeling
    nodig dan bij twintig.
15. **Welke tabellen zijn machinerie en welke zijn bedrijfsdata?** Loop het schema langs en stel een
    voorstel op voor de lijst *technische tabellen* uit §8.2 — wachtrijen, activiteitentellers,
    migratieboekhouding, opgeslagen voorkeuren, archiveringsadministratie. **Leg dat voorstel vóór
    aan de gebruiker**; hij kent zijn schema en schrapt of vult aan. Dit bepaalt wat de beheerder
    straks in beeld krijgt, dus doe het niet op gevoel alleen.
16. **Waar gaat dit bedrijf eigenlijk over?** Je gaat het schema straks indelen in **clusters**
    (§8.2) — Klanten, Orders, Facturen, Projecten — en dat is de enige stap in deze hele opdracht
    waarvoor je domeinkennis nodig hebt in plaats van techniek. Lees daarom niet alleen het schema
    maar ook de UI-routes, de menu-items en de projectdocumentatie: die vertellen je hoe de
    gebruiker over zijn eigen zaak práát. Noteer die woorden — dat worden de clusternamen.
    **Stel het clustervoorstel op en leg het voor** (§8.2). Doe dat niet op gevoel: je bent hier de
    domeinexpert, en de gebruiker is de enige die je kan corrigeren.

Vat je bevindingen in een paar regels samen voor de gebruiker vóór je begint te bouwen, met daarbij
expliciet: wat je aantrof aan bestaande veiligheidsgaranties, en welke daarvan je aanscherpt.

---

## 4. Datamodel

Drie entiteiten. Namen mag je aanpassen aan de conventies van de codebase; de betekenis niet.

**Rol** — een benoemde verzameling rechten.
- `id`, `naam` (uniek), `omschrijving` (vrije tekst: waarvoor deze rol dient), tijdstempels.
- Rollen zijn door de beheerder aan te maken, te hernoemen en te verwijderen. Een rol verwijderen
  kan alleen als er geen gebruikers meer aan hangen — anders zou een gebruiker rechteloos of, erger,
  onbepaald achterblijven.

**Recht** — één regel per (rol × tabel) waar toegang is verleend.
- `rol_id`, `tabelnaam` (platte tekst), `niveau` (`lezen` of `schrijven`), tijdstempels.
- Uniek op (`rol_id`, `tabelnaam`). Verwijder je een rol, dan verdwijnen zijn rechten mee
  (cascade) — een verweesd recht mag nooit blijven staan.
- **Rechten worden altijd per tabel opgeslagen**, ook al bedient de beheerder clusters (§8.2). Eén
  klik op een cluster schrijft een rij per tabel. Sla nooit een recht op een cluster op: een cluster
  is een redactionele indeling die later kan verschuiven, en dan zou een bestaand recht stilzwijgend
  iets anders gaan betekenen.
- **`niveau` kent géén waarde voor "geen toegang".** Geen toegang is de afwezigheid van de rij.
  Dit is niet cosmetisch, het is het mechanisme: een tabel die nog niet bestond toen de rechten
  werden gezet, heeft per definitie geen rij en dus geen toegang. Nieuwe tabellen zijn daardoor
  **gratis fail-safe**, zonder seeding, zonder migratie per tabel, zonder dat iemand eraan moet
  denken.
- `tabelnaam` is bewust **geen** verwijzing naar een catalogus. Wordt een tabel hernoemd, dan wijst
  het recht nergens meer naar en vervalt de toegang. Dat is de gewenste richting van falen.
- `schrijven` impliceert `lezen` op diezelfde tabel — anders kun je niet zien wat je zojuist
  toevoegde of bijwerkte. Het impliceert nooit iets over andere tabellen.

**Versieteller op de rol.** Geef elke rol een teller die bij elke publicatie met één omhoog gaat.
Die heb je nodig om gelijktijdig bewerken te herkennen (§8.3): omdat "geen toegang" de afwezigheid
van een rij is, laat een ingetrokken recht geen enkel spoor na, en zonder teller kun je niet zien
dat iemand anders je zojuist heeft ingehaald.

**Beheerderschap** — een aparte aanduiding op de gebruiker, los van de MCP-rol (zie §7). Het is een
tweede veld, geen waarde van de rol: de MCP-rol zegt wat een taalmodel met de data mag, de
beheerdersaanduiding zegt wie dat instelt.

**Gebruiker → rol** — een verwijzing van de gebruiker naar precies één rol.
- Null of een lege verwijzing betekent: **geen MCP-toegang**. Dat is de standaardwaarde voor elke
  nieuwe gebruiker.
- Eén rol per gebruiker, bewust. Zie het beslissingslogboek in §16.
- Een identiteit die zich aanmeldt maar geen rij in de gebruikerstabel heeft, krijgt geen toegang.
  Maak zo iemand nooit automatisch aan.
- **Is de gebruikerstabel óók gewone bedrijfsdata** (klantcontacten bijvoorbeeld), dan zou de
  denylist uit regel 7 een functionele tabel afsluiten. Splits dan, maar splits volledig: **alles
  waarmee een identiteit wordt herkend** — het e-mailadres, de subject-claim, elke sleutel waarop de
  aanmelding matcht — verhuist mee naar de beschermde koppeltabel, samen met de rolverwijzing en de
  beheerdersaanduiding. Alleen wat overblijft (naam, telefoon, functie) mag een gewone, opengezette
  tabel zijn.

  Laat de identiteitskolom nooit in de open tabel staan. Eén `UPDATE gebruikers SET email = 'ik@…'
  WHERE id = <de beheerder>` en de volgende aanmelding komt uit op zijn rij, met zijn rol en zijn
  beheerderschap — zonder dat de beschermde tabel ooit is aangeraakt. De denylist beschermt dan de
  verkeerde helft. Meld deze keuze en de reden aan de gebruiker.

**Migratie.** Zet iedereen dicht:
- Maak de nieuwe tabellen aan.
- Zet elke bestaande gebruiker op "geen rol" of migreer bestaande rollen naar nieuwe rollen
  **zonder enig recht**.
- Voeg geen enkel recht toe in de migratie. De beheerder bouwt de rechten daarna bewust op via het
  scherm. Tot dat moment werkt de MCP-toegang niet — dat is het bedoelde gedrag, en je meldt het
  duidelijk aan de gebruiker vóór je de migratie draait.
- **Verwijder het oude rechtenveld** op de gebruikerstabel in dezelfde migratie. Twee rechtenbronnen
  naast elkaar laten staan is precies de dubbelzinnigheid die regel 1 moet uitsluiten: niemand weet
  dan nog welke van de twee wint.
- Volgt de codebase de gewoonte om kolommen van commentaar te voorzien, doe dat dan ook hier.

**De denylist mag niet stilletjes verlopen.** De denylist uit regel 7 werkt op tabelnamen. Wordt een
beschermde tabel hernoemd, dan matcht de lijst niet meer en verandert de rechtentabel in een gewone
tabel die iemand kan openzetten — dezelfde eigenschap die hierboven een voordeel is, werkt hier
tegen je. Bouw daarom een controle bij het opstarten (of, in een serverless runtime, bij de eerste
aanroep): **bestaat elke naam op de denylist ook echt in de database?** Zo niet, dan weigert de
server dienst met een duidelijke melding (regel 5). Zo kan een hernoeming de beveiliging nooit
ongemerkt uitschakelen.

---

## 5. Handhaving in de MCP-server

**De handhaving heeft twee dimensies, en ze liggen bewust op verschillende plekken.**

- **Wélke tabellen** een rol mag raken, is applicatiedata: het staat in de rechtentabel en de
  beheerder klikt het in het scherm. Dat moet wel — een beheerder die rollen aanmaakt, kan geen
  databaserollen en verbindingen aanmaken.
- **Wélke operaties** überhaupt mogelijk zijn, staat in de database zelf: de MCP-databasegebruikers
  hebben simpelweg geen `DELETE`, geen `TRUNCATE`, geen eigenaarschap en geen recht om objecten aan
  te maken (§5.4). Geen enkele fout in de applicatiecode kan daar iets aan veranderen.

Die splitsing is een bewuste ruil. Een model waarin élke rol een eigen databaserol met eigen
`GRANT`'s per tabel heeft, is sterker — de database weigert dan zelf, zonder één regel
applicatiecode — maar dat schaalt niet naar rollen die een beheerder zelf aanmaakt: elke klik zou
een `CREATE ROLE`, een `GRANT` en een nieuwe verbinding vragen. De tabeldimensie verhuist daarom
naar de applicatie, met deny-by-default, verse rechten per aanroep, een gehardcodeerde denylist en
een testmatrix als tegenwicht. **De operatiedimensie blijft in de database, en die is niet
onderhandelbaar** — dat is wat de belofte "hier kan niets verdwijnen" overeind houdt, ook als de
applicatielaag ooit een gat blijkt te hebben.

### 5.1 De volgorde

Elke databasetool doorloopt dezelfde poort. Niet één stap overslaan, niet één stap van volgorde
wisselen.

1. **Bepaal de identiteit** van de aanroeper — en stel vast dat die bepaling deugt. Het hele model
   rust hierop: is de identiteit te sturen, dan is al het bovenstaande decoratie. Ze moet komen uit
   een bron die de aanroeper niet kan beïnvloeden (een geverifieerd token van de identiteitsprovider,
   gecontroleerd op handtekening of herkomst, op doelgroep, op tenant en op vervaltijd), **nooit**
   uit een header, een parameter of een veld dat de client zelf meestuurt. Klopt dat vandaag niet in
   deze codebase, dan is dát het eerste wat je repareert — vóór de rest.

   **Koppel bovendien op een onveranderlijke sleutel.** Een e-mailadres is bij de meeste
   identiteitsproviders te wijzigen en opnieuw uit te geven: wie het adres van een vertrokken
   beheerder toegewezen krijgt, erft diens rol. Match dus op de stabiele identiteitssleutel van de
   provider en niet op e-mail. Zet een uniciteitsregel op die kolom en weiger bij nul of meer dan
   één treffer (regel 8) — het hele model rust op "precies één rij".

   **Koppel op (tenant, sleutel), niet op de sleutel alleen.** Bij Entra is de `oid` uniek *binnen
   een tenant*, niet wereldwijd. Staat een app ooit multi-tenant, dan matcht een `oid` uit een
   vreemde tenant op jouw rij. Valideer dus `tid`, `aud` en `exp`, en neem de tenant mee in de
   koppeling.

   **En autoriseer nooit op de e-mailclaim.** Microsoft levert `email` niet gegarandeerd
   geverifieerd, en een gastaccount (B2B) in je eigen tenant draagt gewoon jóúw `tid`. Gebruik je
   e-mail toch om een identiteit de eerste keer aan een rij te koppelen, benoem dat dan expliciet
   als trust-on-first-use, laat het alleen op het login-pad gebeuren, en nooit op een rij die al
   gekoppeld is.
2. **Lees de rechten vers uit de database** (regel 6). Geen gebruiker of geen rol → weigeren. Wel
   een rol maar nul rechten → de datatools weigeren; de tabellen-tool geeft een lege lijst (§5.5).
3. **Normaliseer de query.** Weiger lege invoer en absurd lange invoer (stel een harde bovengrens
   aan de lengte).
4. **Ontleed de query tot een boomstructuur.** Zie §5.2 — dit is het hart.
5. **Weiger meervoudige statements.** Levert het ontleden meer dan één statement op: weigeren.
6. **Bepaal álle operaties in de boom**, niet alleen die van de wortel. Een statement dat met
   `WITH` of `SELECT` begint kan verderop schrijven; dat telt dan als schrijven. Komt er ook maar
   één operatie in voor die geen `SELECT`, `INSERT` of `UPDATE` is: weigeren (regel 2 en 3).
7. **Verzamel élke geraakte relatie**, niet alleen de eerste. Zie §5.3.
8. **Toets de twee gehardcodeerde lijsten.** Eerst de denylist (regel 7): staat er een tabel van
   tussen, dan stopt het hier, ongeacht wat de rechtentabel zegt. Daarna de lijst van tabellen
   waarop de applicatie zelf handelt (§8.2): daar is schrijven uitgesloten, ook als de rechtentabel
   anders beweert. Beide gaan vóór alles wat met rechten te maken heeft.
9. **Toets elke relatie afzonderlijk** tegen de rechten van de rol. Eén relatie zonder recht =
   de hele query wordt geweigerd.
10. **Voer uit** met de juiste verbinding en de juiste beperkingen (§5.4).

### 5.2 Ontleden, niet raden

**Gebruik een echte parser die een syntaxboom teruggeeft** voor het Postgres-dialect, en neem je
beslissingen op die boom. Reguliere expressies zijn hier geen beveiliging: ze kunnen commentaar,
string-literals, geneste constructies en hoofdlettervarianten niet betrouwbaar uit elkaar houden.
Een regexcontrole mag ernaast staan als extra vangnet, maar nooit als de poort.

Kun je in de gekozen runtime geen parser draaien, dan is de enige aanvaardbare terugval een
**strikte allowlist-grammatica**: je accepteert alleen queryvormen die je volledig kunt beschrijven
en herkennen, en weigert al het andere. Niet andersom een lijst van verboden vormen — die lijst is
per definitie nooit volledig.

Sla die weg alleen in als je hebt vastgesteld dat er werkelijk geen parser past, meld dat aan de
gebruiker vóórdat je hem inslaat, en leg de toegelaten grammatica expliciet vast in code én in
tests. Twijfel je of je grammatica volledig is, dan is ze dat niet.

Komt de parser een knooptype tegen dat je analyse niet kent: **weigeren** (regel 8). Groei de
ondersteuning bewust, niet door alles wat onbekend is door te laten.

### 5.3 Welke relaties tellen mee

**Loop de héle boom af en verzamel élke relatieverwijzing, ongeacht waar ze staat.** Onderstaande
opsomming is een illustratie, geen implementatie — net als bij de functie-allowlist is de regel
bindend en de lijst niet. Bouw je alleen de genoemde takken, dan mis je gegarandeerd iets:
`INSERT INTO open VALUES (1) RETURNING (SELECT token FROM sessies)` haalt data uit een tabel die
nooit in je verzameling belandt. Neem dus élke tak mee, ook die hier niet staan:

- `FROM` en elke `JOIN`, op elk nestniveau
- subquery's in `SELECT`, `WHERE`, `HAVING`, `FROM` (afgeleide tabellen) en `IN`/`EXISTS`
- alle `WITH`-onderdelen (CTE's), inclusief recursieve — en let op: een CTE-naam is géén tabel,
  maar de tabellen ín die CTE tellen wél mee
- het doel van een `INSERT` en van een `UPDATE`
- de bron van een `INSERT … SELECT` (dat vraagt leesrecht op de bron én schrijfrecht op het doel)
- `UPDATE … FROM` (leesrecht op elke bijkomende tabel)
- `RETURNING`, inclusief álles wat erin genest zit (de eigen kolommen vallen onder het impliciete
  leesrecht bij schrijven; een subquery erin absoluut niet)
- de `SET`-tak van een `UPDATE`, de `DO UPDATE SET`- en `DO UPDATE WHERE`-tak van een upsert, en de
  `VALUES`-lijst van een `INSERT`
- `ORDER BY`, `GROUP BY`, `HAVING`, `LIMIT`/`OFFSET`, `LATERAL`, vensterfuncties en `CASE`-takken
- `UNION`, `INTERSECT`, `EXCEPT` — beide zijden
- verwijzingen via een schemanaam (`schema.tabel`) en tussen aanhalingstekens (`"Tabel"`)

**Los namen op tegen de catalogus** — strip geen aanhalingstekens. In Postgres kunnen `tabel` en
`"Tabel"` naast elkaar bestaan als twee verschillende tabellen; wie de aanhalingstekens weghaalt,
laat ze op één sleutel vallen en opent met een recht op de ene ook de andere. Zoek de naam dus op in
de catalogus volgens de regels van Postgres (onbequoteerd = kleine letters, bequoteerd = letterlijk)
en toets op de identiteit die je terugkrijgt. Levert dat geen eenduidige tabel op: weigeren
(regel 8). Los aliassen op naar de echte tabelnaam.

**Welke relaties in het model passen.** Gewone tabellen uiteraard. En **views**, maar alleen onder
de drie voorwaarden hieronder. Foreign tables horen er niet in (ze wijzen naar een ander
systeem, dat buiten dit model valt). Partitiemoeders ook niet.

Let bij tabellen op twee achterdeuren: een **partitiekind** is technisch een gewone tabel, dus zonder
extra controle is de afgesloten moeder alsnog stuk voor stuk te lezen; en een tabel met **overervende
kinderen** geeft bij een gewone `SELECT` ook de rijen van die kinderen terug, zonder dat het kind ooit
getoetst wordt. Weiger daarom partitiekinderen, en weiger een tabel die kinderen heeft via overerving.

**Views zijn toegestaan — en ze zijn belangrijker dan ze lijken.** Dit model kent geen rechten op
kolom- of rijniveau (§12), en een view is precies het gereedschap dat dat gat vult: maak in de
database een view die alleen de toegestane kolommen of rijen toont, en neem die op in het
rechtenmodel alsof het een tabel is. Zo krijgt een rol "klanten zonder de financiële kolommen"
zonder dat het rechtenmodel ingewikkelder wordt.

Maar een view is ook een gat in je analyse, want in `SELECT * FROM v_klanten` staat alleen de
viewnaam — wat eronder ligt, zie je niet. Zonder de drie regels hieronder is elke view een
achterdeur.

**1. Los de onderliggende tabellen op, server-side.** Vraag de catalogus welke tabellen een view
leest, ook door geneste views heen, en pas daarop **de denylist (regel 7) en de lijst van tabellen
waarop de applicatie zelf handelt (§8.2) transitief toe**. Ligt er een beschermde tabel onder, dan is
de view niet toekenbaar en wordt elke query erop geweigerd. Zonder deze regel maakt één view over de
gebruikers- of sessietabel de hele denylist waardeloos. Kun je een view niet volledig ontleden
(functies in de definitie, constructies die je niet kent): **weigeren** (regel 8).

Let op wat je hier níét doet: je eist géén recht op de onderliggende tabellen. Dat zou de view
zinloos maken — het hele punt is dat iemand de view mag zien en de tabel niet.

**2. Views zijn alleen-lezen.** Een view is nooit toekenbaar op "schrijven", en een `INSERT` of
`UPDATE` met een view als doel wordt altijd geweigerd. Postgres maakt eenvoudige views namelijk
vanzelf bewerkbaar, en een `INSTEAD OF`-trigger op een view is willekeurige SQL die met de rechten
van de eigenaar draait. Zonder deze regel is een view de kortste weg naar schrijven op een tabel die
voor iedereen gesloten is.

**3. Toon in de atlas bij een view welke tabellen hij leest.** Een beheerder die een view openzet
zonder te weten wat eronder ligt, opent data die hij niet bedoelde. Dit is geen luxe: het is de
reden dat hij een geïnformeerde keuze kan maken.

Twee praktische punten bij het aanmaken van zulke views:

- Gebruik je een view om **rijen** af te schermen, zet hem dan als *security barrier* op. Anders kan
  de database goedkope voorwaarden onder het filter van de view duwen, en lekt foutgedrag (een
  deling door nul, een mislukte conversie) informatie over rijen die verborgen hadden moeten zijn.
- Verleen de leesgebruiker `SELECT` op de view. Ligt er een tabel onder die géén enkele rol mag
  lezen, verleen daar dan niets op — dan weigert de database ook zelf. Mag een ándere rol die tabel
  wél lezen, dan heeft de gedeelde leesgebruiker dat recht en biedt de database hier geen tweede
  laag: voor deze rol is de applicatielaag dan de enige poort. Dat is geen fout in de opzet maar de
  consequentie van één gedeelde leesgebruiker (§5), en het staat als zodanig in §17.
- Een view die met *security invoker* is aangemaakt draait met de rechten van de aanroeper. De
  constructie hierboven werkt dan niet en de query faalt gewoon. Veilig, maar verwarrend —
  controleer het bij het opzetten.

**Functies: een allowlist, geen denylist.** Sta alleen ingebouwde functies toe die je kent en die
geen data of catalogus raken (rekenen, tekst, datum, aggregatie). Weiger al het andere. Élke door de
gebruiker gedefinieerde functie is verboden: die kan onder water elke tabel lezen of schrijven en is
van buitenaf niet te beoordelen (regel 8).

Verboden zijn ook de introspectiefuncties, die er onschuldig uitzien maar het schema prijsgeven:
`to_regclass` (bestaat deze tabel?), `pg_get_viewdef` (de volledige definitie van een view,
inclusief kolomnamen van gesloten tabellen), `obj_description` en `col_description` (juist de
databasecommentaren), `pg_relation_size`, `has_table_privilege`, `current_setting`. Deze opsomming
is een illustratie, geen implementatie: **bindend is de allowlist**, en wat daar niet in staat, gaat
er niet door. De tabel in §6 werkt op dezelfde manier.

**Let op: een cast is geen functie-aanroep.** `SELECT 'geheime_tabel'::regclass` doet precies wat
`to_regclass` doet — vaststellen of een tabel bestaat, zonder er één aan te raken — maar staat als
een heel ander knooppunt in de boom en glipt langs elke controle die op functienámen werkt. Laat je
allowlist daarom ook over casts en operatoren gaan, en verbied de hele `reg*`-familie
(`regclass`, `regtype`, `regproc`, …) als doeltype. Hetzelfde geldt voor `tableoid::regclass` op een
tabel die je wél mag lezen.

**Eén schema.** Het rechtenmodel werkt binnen één schema — doorgaans `public`. Leg vast welk schema
dat is en weiger elke verwijzing naar een ander schema. Daardoor is `tabelnaam` in de rechtentabel
niet schema-gekwalificeerd. Vergelijk namen in de schrijfwijze waarin de database ze opslaat: kleine
letters, tenzij een tabel met aanhalingstekens in hoofdletters is aangemaakt — dan exact zoals ze in
de catalogus staat.

**Weiger elke verwijzing buiten het toepassingsschema**, in het bijzonder de systeemcatalogi
(`pg_catalog`, `information_schema`, `pg_*`). De tabellen-tool (§5.5) heeft daar een eigen route
voor: die stelt zijn catalogusquery zélf samen, met de toegestane namen als vaste parameters, en
geeft nooit iets terug over een naam die er niet in staat. De aanroeper levert daar dus geen SQL
aan — de vrije query-tool komt er nooit.

### 5.4 Uitvoeren

Deze paragraaf bevat de instructies die het vaakst *lijken* te werken maar niets doen. Lees ze
letterlijk en controleer na afloop of ze daadwerkelijk effect hebben — een afgevinkte maatregel die
niets afdwingt, is schadelijker dan een ontbrekende.

**De databasegebruikers**

- **Vier gescheiden gebruikers.** Een **leesgebruiker** die uitsluitend `SELECT` mag; een
  **schrijfgebruiker** die uitsluitend `INSERT` en `UPDATE` mag — geen `DELETE`, geen DDL; een
  **serviceverbinding** waarmee de server zijn eigen huishouding doet; en de **volledige gebruiker**,
  die bij migraties en de applicatie hoort en door geen enkele MCP-tool wordt gebruikt. Zonder die
  scheiding is de queryanalyse het enige slot op precies de gevaarlijkste operatie.
- **De serviceverbinding lost een knoop op die anders onoplosbaar is.** De server moet bij élke
  aanroep de rechten lezen (regel 6), bij het opstarten de beschermde namen controleren (§4) en de
  cumulatieve teller bijwerken (regel 3) — allemaal op tabellen die voor lees- en schrijfgebruiker
  volledig gesloten zijn. Geef deze vierde gebruiker daarom precies dat en niets meer: `SELECT` op
  de rollen-, rechten- en gebruikerstabellen, en `INSERT`/`UPDATE` op uitsluitend de tellertabel.
  Er draait nooit een aangeleverde query op deze verbinding; hij is alleen bereikbaar vanuit de
  eigen code van de server.
- **Maak ze kaal aan:** geen superuser, geen `CREATEDB`, geen `CREATEROLE`, geen `BYPASSRLS`, geen
  lidmaatschap van andere rollen. Laat ze van geen enkel object eigenaar zijn — niet omdat een
  eigenaar rechten "houdt" (die kun je intrekken), maar omdat hij ze zichzelf altijd opnieuw kan
  geven en `DROP`/`ALTER` sowieso uit eigenaarschap volgt, buiten elke `GRANT` om.
- **Trek `CREATE` op het schema in** (`REVOKE CREATE ON SCHEMA <schema> FROM <gebruiker>`). Zonder
  dat kan de gebruiker eigen tabellen aanmaken, is hij van díé tabellen eigenaar, en daarmee
  almachtig binnen zijn eigen hoekje — inclusief `DROP` en `ALTER`. Dit is de derde poot onder de
  belofte dat er niets kan verdwijnen: geen `DELETE`-recht, geen eigenaarschap, geen `CREATE`.
- **Gebruik geen `ALTER DEFAULT PRIVILEGES` om tabelrechten te verlenen.** Daarmee krijgt een
  gebruiker automatisch rechten op tabellen die later worden aangemaakt, en dat ondergraaft de
  fail-safe uit §4 waar de hele opzet op rust: een nieuwe tabel hoort dicht te zijn, in de
  applicatielaag én in de database. Rechten worden per tabel expliciet toegekend. (Dit staat los van
  het intrekken van functierechten hierboven — daar is het juist wél op zijn plaats.)
- **Verlenen doe je gericht.** "Rechten per schema verlenen" bestaat niet in Postgres: op een schema
  geef je alleen `USAGE`. Dus: `GRANT USAGE ON SCHEMA <schema>` (zonder dit werkt geen enkele query),
  daarna `SELECT` respectievelijk `INSERT, UPDATE` **per tabel**. Gebruik geen `ON ALL TABLES` —
  dat verleent ook op de beschermde tabellen uit regel 7 en het is een momentopname die nieuwe
  tabellen niet dekt. Verleen aan de lees- en schrijfgebruiker **niets** op de beschermde tabellen;
  zij zijn de enige echte tweede laag onder de analyse. De serviceverbinding hierboven is de enige
  uitzondering, en die is bewust smal.
- **Zet `search_path` vast** op precies het toepassingsschema (`ALTER ROLE <gebruiker> SET
  search_path = <schema>, pg_temp`). Zonder dit lost Postgres een ongekwalificeerde naam bij de
  uitvoering op via het zoekpad — niet via de catalogus-opzoeking die jij deed. Een tweede schema
  vóór het jouwe in dat pad betekent: je keurt de ene tabel goed en de database leest een andere.
- **Sequences:** een `INSERT` in een tabel met een `serial`-achtige standaardwaarde vereist `USAGE`
  op de bijbehorende sequence. Bij `GENERATED … AS IDENTITY` of een uuid-standaard is dat niet nodig.
  Controleer het per tabel in plaats van het overal te verlenen.

**De valkuil bij functierechten (lees dit vóór je §5.6 uitvoert)**

- Postgres verleent `EXECUTE` op functies standaard aan **`PUBLIC`**. `REVOKE EXECUTE … FROM
  <gebruiker>` haalt daarom niets weg: het recht loopt via `PUBLIC` en blijft gewoon bestaan. Wie
  die vorm opschrijft en afvinkt, levert een systeem waarin elke `SECURITY DEFINER`-functie nog
  uitvoerbaar is.
- De werkende vorm is intrekken **van `PUBLIC`**, en dan uitsluitend in het toepassingsschema —
  niet in `pg_catalog`, want daar leven de operatoren en casts waar élke query op steunt. Geef
  daarna gericht terug aan wie het nodig heeft, zoals de applicatie.
- `ALTER DEFAULT PRIVILEGES` geldt **alleen voor objecten die gemaakt worden door de rol die dat
  commando uitvoerde**. Draaien je migraties onder een andere gebruiker, dan krijgen nieuwe functies
  opnieuw `EXECUTE` aan `PUBLIC` en is de maatregel stilletjes verlopen. Stel het dus in voor de rol
  die de migraties draait.
- Kun of wil je dit niet doen — het raakt meer dan de MCP-server — dan **bestaat het slot tegen
  `SECURITY DEFINER`-functies niet**. Zet het dan in §17 als open risico. Niet afvinken.

**Begrenzen**

- **Statement-timeout hoort op de rol, niet op de sessie.** `SET LOCAL` buiten een transactie doet
  niets (alleen een waarschuwing), en een gewone `SET` op een gepoolde verbinding lekt naar de
  volgende gebruiker ervan. Gebruik `ALTER ROLE <gebruiker> SET statement_timeout = '10s'` (dertig
  seconden voor de schrijfgebruiker). Dan geldt hij ook in runtimes zonder sessiestatus.
- **Lezen read-only, ook zonder transacties.** Draai leesqueries in een expliciete read-only
  transactie waar dat kan, en zet daarnáást `ALTER ROLE <leesgebruiker> SET
  default_transaction_read_only = on`. Die tweede vorm werkt altijd; de eerste valt in een
  HTTP-driver zonder transacties geruisloos weg, en dan is dit je enige slot.
- **Begrens wat er terugkomt.** Omhul een goedgekeurde `SELECT`: `SELECT * FROM (<query>\n) AS
  begrensd LIMIT <n>`, richtwaarde enkele honderden rijen. Let op drie dingen die dit stilletjes
  breken: een afsluitende puntkomma, een regelcommentaar aan het einde (zonder nieuwe regel
  commentarieert het je sluithaakje weg — vandaar de newline), en een schrijvende CTE, die van
  Postgres op het hoogste niveau moet staan en dus **niet** omhuld mag worden. Kun je niet veilig
  omhullen, begrens dan via de driver in plaats daarvan. Dit begrenst het antwoord, niet het werk:
  een aggregatie of cartesisch product draait binnenin volledig — daar is de timeout je enige rem.
- **Meld het als een resultaat is afgekapt.** Een model dat tweehonderd van vijfduizend rijen krijgt
  zonder dat te weten, trekt conclusies over data die het nooit gezien heeft.
- **Begrens ook de omvang, niet alleen het aantal rijen.** Honderd rijen kunnen gigabytes zijn:
  `INSERT INTO t (notitie) SELECT repeat('x', 200000000) FROM generate_series(1,100)` past binnen
  elke rijgrens en schrijft je database vol — en zonder `DELETE` krijg je het er niet meer uit.
  Houd daarom `repeat`, `lpad`, `rpad` en `generate_series` **buiten de functie-allowlist**, en zet
  een grens op de omvang van wat één statement wegschrijft.
- **Voor `INSERT` en `UPDATE` gelden de grenzen uit regel 3** — de rijbegrenzing per statement én de
  cumulatieve teller per rol. Weet daarbij dat een rijaantal het effect kan onderschatten
  (`ON CONFLICT DO NOTHING`, een `BEFORE`-trigger die rijen onderdrukt) en dat terugdraaien pas ná
  uitvoering gebeurt: een `UPDATE` die miljoenen rijen aanraakt en dan terugrolt, heeft je database
  al belast. De timeout is daar de echte rem.
- **Begrens de lengte van de aangeleverde query** — richtwaarde tienduizend tekens.

**Foutmeldingen**

- **Verberg technische details.** Nooit verbindingsgegevens, wachtwoorden of volledige databasefouten.
  Wel een begrijpelijke reden, zodat de gebruiker weet wat hij aan de beheerder moet vragen. Je mag
  de tabelnaam noemen die de aanroeper zélf in zijn query zette; noem nooit tabellen die hij niet
  noemde.
- **Eén en dezelfde weigering voor alle gesloten gevallen.** Of iets niet bestaat, buiten het model
  valt (een foreign table, een partitiekind), gesloten is voor deze rol, of op de denylist staat: de
  melding is telkens identiek ("deze rol heeft geen toegang tot `x`"). Verschil je erin, dan kan iemand namen aftasten en uit de reactieverschillen
  het hele schema afleiden — precies scenario 4, maar dan via de foutafhandeling.

### 5.5 De toolset: drie tools, voor iedereen dezelfde

Dit is wat de gebruiker daadwerkelijk ziet wanneer hij de MCP-server koppelt aan zijn AI-client.
Hier landt het rechtenmodel voor hem — en het is de plek waar de meeste implementaties het verpesten.

**De vaste set is drie tools**, en die set groeit niet:

| Tool | Wat hij doet | Annotatie voor de client |
|---|---|---|
| tabellen tonen | Welke tabellen en kolommen deze rol mag benaderen, met per tabel of toevoegen en bijwerken mogen | alleen-lezen |
| leesquery | Voert één `SELECT` uit | alleen-lezen |
| schrijfquery | Voert één `INSERT` of `UPDATE` uit | ingrijpend |

Zet die annotaties ook echt: AI-clients gebruiken ze om te bepalen of ze iets zonder tussenkomst
uitvoeren of eerst bevestiging vragen. Een schrijftool die zich voordoet als alleen-lezen, ontneemt
de gebruiker precies het moment waarop hij nog kan ingrijpen.

**Elke rol krijgt dezelfde toolnamen.** Nooit varianten per rol of per domein, zoals een aparte
leesquery-tool per tabelgroep. Zodra een gebruiker twee query-tools naast elkaar ziet, kan zijn
AI-client niet meer verklaren waarom een tabel in de ene wél bestaat en in de andere niet — en gaat
hij gokken. Moet iemand minder kunnen, dan haal je tabellen uit zijn rol of zet je zijn niveau
lager. **Je schrijft nooit een beperktere tool.**

De enige toegestane variatie: **een rol die nergens schrijfrecht heeft, krijgt de schrijftool niet
geregistreerd** en ziet er dus twee. Dat is geen beveiliging maar netheid — de toetsing bij de
aanroep is het echte slot. Wijzigen de rechten midden in een sessie, dan blijft een al
geregistreerde tool bestaan; de verse toetsing (regel 6) weigert hem alsnog.

#### De tools worden per rol beschreven

Dit is het stuk dat het verschil maakt tussen een MCP die prettig werkt en een die de gebruiker
tegen een muur laat lopen. **Stel de toolbeschrijvingen samen uit de rechten van de rol**, op het
moment dat de sessie begint:

- Noem in de leesquery-beschrijving **de tabellen die deze rol mag lezen**, bij naam.
- Noem in de schrijfquery-beschrijving **de tabellen waarop hij mag schrijven**, en zeg erbij dat
  toevoegen en bijwerken mogen en verwijderen niet.
- Zeg expliciet wat er niet kan, in gewone taal: geen verwijderen, geen structuurwijzigingen.

**Filter die opsomming langs dezelfde lijsten als de rest.** Een naam die op de denylist staat of op
de lijst uit §8.2, noem je niet — ook niet als er nog een oude rechten-rij voor bestaat. Dat gebeurt
namelijk vanzelf: de beschermde lijst groeit mee met het schema (§10), en een recht dat vóór die
groei is toegekend, blijft gewoon staan. De toetsing weigert de query dan keurig, maar een
ongefilterde beschrijving heeft de tabelnaam al aan het model verteld — precies het structuurlek uit
scenario 4, langs de enige route die het filter anders mist. Weiger bij het publiceren en bij het
opstarten daarom ook rechten-rijen die naar een beschermde naam wijzen, en ruim ze op.

Een model kiest zijn acties op basis van die beschrijving. Krijgt het te horen "je mag de database
bevragen", dan schrijft het queries tegen tabellen die niet mogen, krijgt het weigeringen terug,
probeert het varianten, en verbrandt het de tijd en het geduld van de gebruiker. Krijgt het te horen
welke tabellen er zijn, dan blijft het vanzelf binnen de lijnen. **De beschrijving is een wegwijzer,
nooit de beveiliging** — de toetsing uit §5.1 draait onverkort, ook als de beschrijving verouderd is.

#### De tabellen-tool is het controle-instrument

Laat die tool geen apart geconfigureerd lijstje herhalen, maar **de rechtentabel vers uitlezen**
(dezelfde bron en hetzelfde moment als de toetsing, regel 6) en die combineren met de kolommen uit
de catalogus. Terug komt: welke tabellen, welke kolommen, en per tabel of toevoegen en bijwerken
zijn toegestaan. Lees hiervoor **niet** de databaserechten uit — die zijn de vereniging over alle
rollen (§5) en zouden tabellen van andere rollen prijsgeven. Zo is hij tegelijk de wegwijzer voor het model én de manier waarop een beheerder
controleert of het rechtenscherm en de werkelijkheid nog overeenkomen. Twee bronnen die elkaar
kunnen tegenspreken zijn een bron te veel.

Markeer een view als view en noem erbij welke tabellen hij leest, zodat het model begrijpt waarom
een kolom die het elders zag hier ontbreekt. Vermeld bij een view ook dat schrijven er niet kan.

Tabellen op de denylist verschijnen hier nooit, ook niet als naam (regel 1 en scenario 4). Een rol
die bestaat maar nog nul rechten heeft, krijgt een lege lijst met een korte uitleg — een leeg
antwoord is informatiever dan een fout en lekt niets.

#### Lezen mag ruim zijn

Let op dat je niet doorschiet. Binnen de tabellen van de rol is lezen **onbeperkt en gewenst**:
joins, CTE's, subquery's, vensterfuncties, aggregaties, berekende kolommen — allemaal prima. Daar
zit de hele waarde van een MCP-koppeling. De beperking gaat over wát er verdwijnt of verandert, en
over wélke tabellen bereikbaar zijn, niet over hoe slim iemand mag lezen.

#### Elke andere tool

Een vierde tool hoort niet bij deze opdracht (§12) en bouw je hier dus niet. Maar bouw de toetsing
uit §5.1 wél als **één gedeelde functie die elke tool aanroept**, zodat een tool die er later toch
bij komt niet per ongeluk buiten de poort om kan werken. Zo'n toevoeging is later een wijziging aan
de veiligheidslaag (§11), geen gewone uitbreiding.

### 5.6 Wat de database zelf doet: triggers, rules en `SECURITY DEFINER`

De hele analyse kijkt naar de tekst die de aanroeper aanlevert. Wat de database daarná uit zichzelf
doet, ziet ze niet — en dat is een blinde vlek die groot genoeg is om het hele model te omzeilen.

Een `AFTER INSERT`-trigger op een tabel waar een rol schrijfrecht op heeft, voert SQL uit die nooit
langs de poort komt. Draait die triggerfunctie als `SECURITY DEFINER`, dan draait ze bovendien met
de rechten van haar eigenaar en niet met die van de beperkte MCP-gebruiker: `DELETE`, DDL of een
`UPDATE` op de rechtentabel zijn dan alsnog mogelijk. Schrijfrecht op één tabel wordt zo
schrijfrecht op alles. Hetzelfde geldt voor `RULE`s.

Wat je doet:

1. **Inventariseer** bij Fase 0 alle triggers, rules en `SECURITY DEFINER`-functies, en welke
   tabellen ze raken.
2. **Trek `EXECUTE` in van `PUBLIC`** in het toepassingsschema, op de manier die in §5.4 staat
   beschreven — intrekken bij de gebruikers zélf doet niets, want het recht loopt via `PUBLIC`.
   Lukt dat niet, dan is er géén structureel slot en hoort dat in §17, niet op de checklist.
3. **Meld elke tabel met een trigger die buiten zichzelf schrijft** aan de gebruiker vóórdat er
   schrijfrecht op gezet kan worden. Zo'n tabel openzetten is een grotere handeling dan het lijkt.
4. Ontstaat er later een nieuwe trigger of `SECURITY DEFINER`-functie, dan is dat een wijziging aan
   de veiligheidslaag (§11), niet een gewone schemawijziging.

---

## 6. Omzeilingen die je expliciet moet afdekken

Elk van deze constructies ziet er onschuldig uit voor een oppervlakkige controle. Bouw voor elk een
testgeval (§13).

| Constructie | Waarom gevaarlijk | Verwachte afhandeling |
|---|---|---|
| `WITH x AS (INSERT INTO … RETURNING *) SELECT * FROM x` | Schrijvende CTE: het statement begint met `WITH`, maar schrijft | Weigeren tenzij schrijfrecht op de doeltabel; de operatie is schrijven, niet lezen |
| `SELECT 1; UPDATE …` | Gestapelde statements | Weigeren: meer dan één statement |
| `EXPLAIN ANALYZE UPDATE …` | `ANALYZE` voert de query écht uit | Weigeren: `EXPLAIN` staat niet in de toegestane operaties |
| `SELECT * FROM (SELECT … FROM gesloten_tabel) t` | Tabel verstopt in een afgeleide tabel | Weigeren: de geneste tabel telt mee |
| `INSERT INTO open_tabel SELECT * FROM gesloten_tabel` | Data overhevelen naar een tabel die je wél mag lezen | Weigeren: leesrecht op de bron ontbreekt |
| `UPDATE open_tabel SET x = (SELECT y FROM gesloten_tabel)` | Lek via een subquery in `SET` | Weigeren: idem |
| `SELECT … INTO nieuwe_tabel` | Maakt een tabel aan; dat is DDL | Weigeren |
| `-- commentaar` / `/* … */` rond sleutelwoorden | Breekt naïeve tekstcontroles | Parser negeert commentaar; de boom blijft correct |
| `sElEcT` / `SeLeCt` | Hoofdlettertrucs | Parser is hoofdletterongevoelig; tekstcontroles nooit vertrouwen |
| `"Tabel"` en `public.tabel` | Zelfde tabel, andere schrijfwijze | Normaliseren vóór toetsing |
| `pg_catalog.pg_tables`, `information_schema.columns` | Schema uitlezen buiten de rechten om | Weigeren: buiten het toepassingsschema |
| `pg_read_file`, `pg_ls_dir`, `lo_import`, `lo_export`, `dblink`, `pg_stat_file`, `query_to_xml`, `set_config`, `pg_terminate_backend` | Bestandssysteem, externe verbindingen, serverinstellingen | Weigeren: functiedenylist, en de least-privilege gebruiker mag ze sowieso niet |
| `pg_sleep(3600)` of een cartesisch product | Uitputting van verbindingen | Statement-timeout vangt dit af |
| Een `UPDATE` zonder `WHERE` | Overschrijft de hele tabel; feitelijk dataverlies | Weigeren: `UPDATE` vereist een `WHERE` |
| `MERGE` met een `WHEN MATCHED THEN DELETE`-tak | Verwijderen langs een omweg | Weigeren: `MERGE` staat niet in de toegestane operaties |
| Een query op de rechten- of gebruikerstabel | Rechtenescalatie (scenario 3) | Weigeren op de gehardcodeerde denylist, vóór elke rechtencontrole |
| `INSERT INTO open VALUES (1) RETURNING (SELECT token FROM sessies)` | De tabel zit in een tak die een naïeve verzamelaar niet afloopt | Weigeren: élke tak van de boom telt mee (§5.3) |
| `UPDATE` op een instellingen-, wachtrij- of webhooktabel | De applicatie voert die rijen uit met haar volledige rechten | Weigeren: schrijven is daar gehardcodeerd uitgesloten (§8.2) |
| `SELECT * FROM een_view` waarop deze rol geen recht heeft | Views zijn toekenbaar, dus dit is een gewone rechtentoets | Weigeren op de rechtentabel |
| Een view die over de gebruikers-, sessie- of rechtentabel ligt | De analyse ziet alleen de viewnaam; de denylist zou volledig omzeild worden | Weigeren: de onderliggende tabellen worden opgelost en de denylist geldt transitief (§5.3) |
| `UPDATE v_klanten SET …` op een bewerkbare view | Postgres schrijft door naar de tabel eronder, met de rechten van de eigenaar van de view | Weigeren: views zijn alleen-lezen en nooit een schrijfdoel (§5.3) |
| Een view met een `INSTEAD OF`-trigger | Willekeurige SQL die als eigenaar draait, zonder ooit schrijfrecht op een echte tabel | Zelfde regel: een view is nooit een schrijfdoel |
| `SELECT mijn_functie()` waarbij die functie zelf tabellen leest | Toegang verstopt in een door de gebruiker gedefinieerde functie | Weigeren: alleen bekende ingebouwde functies zijn toegestaan |
| `UPDATE tabel SET x = 1 WHERE true` | Voldoet aan de `WHERE`-eis en overschrijft toch alles | Weigeren: altijd-ware voorwaarde (regel 3) |
| `UPDATE tabel SET x = '' WHERE id IS NOT NULL` | Voldoet aan élke vormcontrole en wist toch de hele tabel | Terugdraaien op het aantal geraakte rijen (regel 3) — vormcontrole alléén stopt dit niet |
| `INSERT INTO t SELECT * FROM t`, herhaald | Verdubbelt de tabel per aanroep; niet op te ruimen zonder `DELETE` | Zelfde rijbegrenzing als bij `UPDATE` |
| `INSERT … ON CONFLICT DO UPDATE` | Ziet eruit als een `INSERT`, gedraagt zich als een `UPDATE` | Behandelen als schrijven; de `DO UPDATE`-tak valt onder de `UPDATE`-regels |
| Een trigger op een open tabel die elders schrijft | De analyse ziet die SQL nooit | `EXECUTE` ingetrokken (§5.4) en trigger-tabellen gemeld vóór openzetten (§5.6) |
| `to_regclass('gesloten_tabel')`, `pg_get_viewdef(…)`, `obj_description(…)` | Lezen het schema uit zonder één tabel aan te raken | Weigeren: staan niet in de functie-allowlist (§5.3) |
| Namen aftasten om uit het verschil in foutmeldingen af te leiden wat bestaat | Structuurlek via de foutafhandeling | Eén en dezelfde weigering voor alle gevallen (§5.4) |
| `SELECT 'gesloten_tabel'::regclass` | Een cast is geen functie-aanroep en glipt langs een allowlist op functienamen | Weigeren: de `reg*`-familie is als doeltype verboden (§5.3) |
| `INSERT INTO t (notitie) SELECT repeat('x', 200000000) FROM generate_series(1,100)` | Honderd rijen, gigabytes data, niet op te ruimen zonder `DELETE` | Weigeren: die functies staan niet in de allowlist, plus een omvangsgrens per statement (§5.4) |
| Honderd rijen per keer, tweehonderd keer herhaald | Blijft binnen elke grens per statement | De cumulatieve teller per rol grijpt in (regel 3) — en die staat in de database, niet in het geheugen |
| De beschermde rechtentabel is hernoemd | De denylist matcht niet meer en de bescherming valt weg | Opstartcontrole weigert dienst zolang een denylist-naam niet bestaat (§4) |

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
toewijzen": een beheerder mag beide, of hij is geen beheerder. Meer niveaus maken het model
moeilijker uit te leggen zonder dat ze een reëel scenario afdekken.

**Beheerderschap staat los van de MCP-rol.** Het zijn twee verschillende dingen: de MCP-rol bepaalt
wat een taalmodel met de database mag, beheerderschap bepaalt wie die rollen instelt. Iemand kan
beheerder zijn zonder enige MCP-toegang, en omgekeerd. Houd ze dus in aparte velden en meng ze niet.

Die aanduiding staat op de gebruikerstabel, en die staat op de denylist uit regel 7. **Geen enkele
MCP-rol kan zichzelf dus ooit tot beheerder maken** — dat is geen extra maatregel maar een gratis
gevolg van het datamodel, en het is de moeite waard om het zo te houden.

Een beheerder kan per definitie alle rechten zetten, ook die van de rol die hij zelf draagt — dat is
inherent aan beheerder zijn en geen gat. Wat wél moet: **beheerderschap toekennen of afnemen kan
alleen een beheerder**, en **de laatste beheerder kan zichzelf niet degraderen of verwijderen**,
anders sluit je jezelf buiten.

**Zo bouw je de poort:**

- Voeg een beheerdersaanduiding toe aan de gebruiker en laat het rechtenscherm alleen zien en werken
  voor aangeduide beheerders.
- Controleer dat **server-side bij elke lees- én schrijfactie** van het scherm, niet alleen bij het
  renderen van de pagina. Een verborgen knop is geen beveiliging; ga ervan uit dat iemand de
  server-actie rechtstreeks aanroept.
- ⚠ **Zet de beheerdersvlag nooit in het token of de sessie.** Dit is de fail-open die OAuth juist
  uitnodigt: met een token vol claims is het verleidelijk om `isAdmin` erin te bakken. Doe je dat,
  dan blijft iemand beheerder tot dat token verloopt — óók nadat je hem zojuist hebt gedegradeerd,
  en zonder dat er iets stukgaat. De controle **leest de database bij elke actie**, precies zoals
  regel 6 dat aan de MCP-kant eist.
- Zorg dat er altijd minstens één beheerder overblijft en dat niemand zijn eigen rechten kan
  verhogen.

**De eerste beheerder.** Zonder dit is het scherm na de uitrol voor niemand bereikbaar. Los het op
met een eenmalige stap die je expliciet aan de gebruiker meldt: een aanwijzing in de migratie op
basis van een door hem opgegeven identiteit, of een omgevingsvariabele die precies één account tot
beheerder maakt. Drie voorwaarden:

- De variabele bevat de **onveranderlijke identiteitssleutel** (de `oid`), nooit een e-mailadres.
  Een adres is te wijzigen en opnieuw uit te geven, en dat wil je zeker niet op het gevoeligste
  account van het systeem.
- Ze werkt **alleen zolang er nog geen enkele beheerder is** — is er er één, dan doet ze niets meer.
  Anders blijft het een permanente achterdeur: wie de deploy-configuratie kan wijzigen (of een
  voorvertoningsomgeving deelt die dezelfde database gebruikt) benoemt zichzelf telkens opnieuw, en
  de regel dat de laatste beheerder niet te verwijderen is, maakt hem onafzetbaar.
- Nooit "de eerste die inlogt", nooit een standaardwachtwoord.

Tot slot: **de MCP-server vertrouwt de app nooit.** De denylist en de rechtentoetsing staan in de
server zelf. Zou het beheerscherm volledig gecompromitteerd raken, dan blijven regel 2, 3 en 7
onverminderd gelden — en juist daarom kun je het hier bij één heldere controle houden.

---

## 8. Het beheerscherm

### 8.1 Structuur

Twee niveaus:

**Rollenoverzicht** — de lijst met rollen. Per rol: naam, omschrijving, hoeveel gebruikers hem
dragen, en een beknopte samenvatting van de rechten ("12 tabellen lezen · 2 schrijven"). Acties:
rol aanmaken, hernoemen, verwijderen (alleen als er geen gebruikers aan hangen), en dupliceren —
dupliceren is de snelste weg naar een variant, en voorkomt dat iemand uit gemak een te ruime rol
hergebruikt.

**Rolpagina — de schema-atlas.** Per rol één pagina met het volledige schema in één beeld.

**Rol toewijzen aan een gebruiker.** Bestaat er al een gebruikersbeheerscherm, breid dat uit met de
rolkeuze; bestaat het niet, voeg de toewijzing dan toe aan het rollenoverzicht. Waar het ook landt:
de standaardwaarde voor een nieuwe gebruiker is **geen rol**, en het toewijzen van een rol die
ergens schrijfrechten heeft, toont eerst kort wat die rol mag. Iemand een rol geven is de handeling
waarmee toegang daadwerkelijk ontstaat — dat moment mag niet onopgemerkt voorbijgaan.

### 8.2 De atlas

Een echt schema heeft al gauw dertig tot vijftig tabellen, waarvan er misschien twaalf betekenis
hebben voor wie rechten uitdeelt. Een tegel per tabel is dan geen overzicht meer maar een muur. De
atlas doet daarom twee dingen: **verwante tabellen samenvoegen tot één keuze**, en **machinerie uit
het zicht houden**.

#### De eenheid is het cluster, niet de tabel

Eén tegel per **cluster**, en die tegel draagt de stand. Daaronder staan de tabellen die erin
zitten, klein en leesbaar, maar **niet afzonderlijk aanklikbaar** — behalve in het uitklappaneel,
waar je één tabel bewust kunt laten afwijken. Een order ís nu eenmaal de order plus zijn regels,
zijn pakketten en zijn interventies; wie "Orders" openzet, bedoelt die allemaal. Eén ding om aan te
vinken, met daaronder zichtbaar wat eronder valt.

**Het rechtenmodel blijft per tabel** (§4). Eén klik op een cluster schrijft gewoon een rij per
tabel. Dat is geen omweg maar de kern: de handhaving toetst tabellen, nieuwe tabellen blijven
vanzelf gesloten, en de samenvatting bij het publiceren noemt **de echte tabelnamen**. Het cluster
is een bedieningsgemak, nooit de waarheid.

#### Hoe de clusters ontstaan: jij stelt voor, de gebruiker beslist

Dit is de enige stap in deze opdracht die **domeinkennis** vraagt in plaats van techniek, en het is
de stap die bepaalt of het scherm bruikbaar wordt. Een tegel per tabel is bij dertig tabellen geen
overzicht maar een muur; en een groepering die je uit sleutels en tabelnamen afleidt, zet precies
de tabellen uit elkaar die inhoudelijk bij elkaar horen — `contacts` valt dan niet bij `companies`,
omdat de naamstam niet matcht. Het schema weet niet hoe een bedrijf over zichzelf denkt.

**Neem daarom expliciet de rol aan van iemand die bedrijfssoftware kent** — CRM, ERP, facturatie,
projectadministratie — en die al vaker heeft moeten uitleggen wie wat mag zien. Denk zoals je een
nieuwe collega zou rondleiden: niet "dit is de tabel `sales_invoice_lines`", maar "dit zijn de
facturen die we versturen".

**De redeneerregels, in deze volgorde:**

1. **Noem het cluster zoals de gebruiker het noemt.** Klanten, Orders, Facturen, Projecten, Taken,
   Voorraad. Nooit een tabelnaam, nooit een technische term, nooit meervoud-van-een-kolom.
2. **Eén cluster = één beslissing die iemand werkelijk kan nemen.** "Mag deze rol bij de
   boekhouding?" is een beslissing. "Mag deze rol bij `cost_categories`?" is er geen.
3. **Splits waar de toegang uiteenloopt, ook als het onderwerp hetzelfde is.** Wettelijke
   documenten die nooit beschrijfbaar zijn, horen niet in één cluster met data die je wél bijwerkt:
   dan blijft elke klik op "schrijven" halverwege steken en staat het cluster permanent op
   "gedeeltelijk". Dat is het duidelijkste signaal dat je één cluster te grof hebt gemaakt.
4. **Houd bij elkaar wat altijd samen wordt gelezen.** Een tabel die zonder zijn buur betekenisloos
   is (regels bij een order, een gebruikersbeheerde kleurenlijst bij de transacties) hoort in
   hetzelfde cluster.
5. **Mik op vijf tot twaalf clusters.** Minder betekent dat je onderwerpen samenperst die niets met
   elkaar te maken hebben; meer betekent dat de beheerder weer aan het puzzelen is. Kom je boven de
   vijftien, dan groepeer je op tabellen in plaats van op betekenis.
6. **Schrijf per cluster één zin uitleg in gewone taal**, en die zin staat straks ook echt in het
   scherm (§8.2, "De rest van het gedrag"). Kun je die zin niet schrijven zonder tabelnamen te
   gebruiken, dan is het cluster nog geen cluster.
7. **Zet er een waarschuwing bij waar dat nodig is.** Draagt een tabel in dit cluster iets dat de
   beheerder niet verwacht — omzetcijfers in de klantentabel, een e-mailadres in een logboek — dan
   hoort dat als voetnoot op de tegel. Wie een deur opent, hoort te weten wat erachter ligt.

**Leg het voorstel vóór aan de gebruiker.** Als tabel: clusternaam · de tabellen · de zin uitleg.
Zeg erbij welke clusters nooit schrijfbaar kunnen zijn en waarom, en welke tabellen je bewust apart
hield. Vraag om bevestiging of correctie. Hij kent zijn zaak; jij kent het patroon. **Bouw pas
verder als hij zich in de indeling herkent** — een indeling die niet klopt met zijn hoofd, kost
hem elke keer dat hij dit scherm opent opnieuw tijd.

**Waar de indeling leeft.** In een gewoon bronbestand naast de rest van de code, met de hand
geschreven. **Niet in de database** (dan kan wie er niet bij hoort hem wijzigen) en **niet in een
configuratiescherm** — een rechtenscherm dat eerst ingesteld moet worden, wordt niet gebruikt. Het
is een redactionele laag, geen instelling.

#### Het vangnet: niets valt stilletjes weg

Handmatig indelen betekent dat je iets kunt vergeten, en juist bij rechten mag "vergeten" nooit
"onzichtbaar" betekenen. Daarom, verplicht:

**Elke tabel die in géén cluster zit en niet technisch of beschermd is, verschijnt in een eigen
tegel "Nog niet ingedeeld" — zichtbaar en dicht**, met de aanwijzing dat iemand hem hoort in te
delen. Dat is de prijs voor het loslaten van een automatische indeling, en het houdt de fail-safe
uit §4 volledig overeind: de tabel had toch al geen rij, dus geen toegang. Hij is nu alleen ook
niet meer weggemoffeld.

Voeg daar twee goedkope controles bij, die in ontwikkeling falen en niet in productie:
één tabel mag nooit in twee clusters staan, en een cluster mag nooit naar een tabel wijzen die niet
bestaat.

**Een voorbeeld van hoe zo'n indeling eruitziet** (generiek, niet van jouw schema — reken die van
jou zelf uit):

| Cluster | Tabellen | Uitleg in het scherm |
|---|---|---|
| Klanten | `customers`, `contacts`, `customer_types` | "Wie je klanten zijn en wie je bij hen spreekt." |
| Orders | `orders`, `order_lines`, `shipments` | "Wat er besteld is en wat ervan verstuurd werd." |
| Facturen | `invoices`, `invoice_lines`, `company_profile` | "Wat je factureerde." *Nooit schrijfbaar — de nummerreeks loopt door.* |
| Boekhouding | `transactions`, `cost_categories` | "Wat er in- en uitgaat, met de categorie erbij." |
| Projecten | `projects`, `tasks`, `task_notes` | "Wat er loopt en wat er te doen staat." |

Merk op dat Facturen en Boekhouding **apart** staan hoewel het allebei over geld gaat: het ene is
onaantastbaar, het andere werk je bij. Regel 3 in actie.

#### Machinerie uit het zicht

Elk schema zit vol tabellen die er zijn voor het apparaat, niet voor het bedrijf: een tabel met de
omgevingsnaam, een activiteitenteller per gebruiker, een wachtrij voor achtergrondtaken, de
migratieboekhouding van je ORM, opgeslagen UI-voorkeuren, mail- of archiveringsadministratie. Die
horen niet in een scherm waar iemand nadenkt over wie klantgegevens mag zien.

Stel bij Fase 0 een **derde lijst** samen: *technische tabellen*. Die zijn:

- **standaard verborgen in de atlas**, achter één knop ("Toon technische tabellen");
- **nooit onderdeel van een cluster** en dus nooit meegenomen door een clusterklik;
- **wél toekenbaar** zodra ze zichtbaar zijn — één voor één, bewust.

Verwar deze lijst niet met de denylist uit regel 7. De denylist is *nooit*, gehardcodeerd, niet te
overrulen. Deze lijst is *uit het zicht*, maar mogelijk. Twee verschillende dingen die je niet in één
mechanisme moet persen.

Aanwijzingen om zo'n tabel te herkennen: hij wordt door geen enkele bedrijfstabel aangewezen; hij
verwijst alleen naar de gebruikerstabel; zijn naam gaat over boekhouding van het systeem
(migratie, omgeving, activiteit, wachtrij, taak, log, archief, status, cache, sjabloon, voorkeur).
**Stel voor, beslis niet.** Leg de lijst aan de gebruiker voor en laat hem schrappen en aanvullen —
hij kent zijn eigen schema. Twijfel je over een tabel, zet hem dan bij de technische: hem alsnog
tonen kost één klik, terwijl overbodige tegels het hele scherm kosten.

#### De rest van het gedrag

- **Uitklappen toont de kolommen** van elke tabel in het cluster: naam en type, plus het commentaar op
  de kolom als de database dat heeft. Puur informatief; hier valt niets in te stellen. Dit is de
  reden dat de beheerder een geïnformeerde keuze maakt in plaats van een gok — geef het echte
  aandacht en maak het ook met het toetsenbord bereikbaar.
- **Klikken cyclet de stand**: geen toegang → lezen → schrijven → geen toegang. Eén klik, geen menu.
  Geef de drie standen ook rechtstreeks kiesbaar voor wie dat wil (bijvoorbeeld met de toetsen 1/2/3
  wanneer een tegel focus heeft).
- **Gedeeltelijk.** Hebben de tabellen in een cluster niet dezelfde stand — omdat er een tabel
  bijkwam, omdat er één bewust afwijkend gezet is, of omdat er buiten het scherm om iets gezet is —
  toon dan een vierde, aflezende stand "gedeeltelijk", met hoeveel tabellen anders staan. Eén klik
  trekt het cluster weer gelijk. Dit is de zichtbare kant van de fail-safe: een nieuwe tabel in een
  open cluster is gesloten, en dat hoor je te zien in plaats van te moeten vermoeden.
- **Views** krijgen een eigen tegel, herkenbaar als view, met de tabellen die eronder liggen erbij.
  Bij een view ontbreekt de stand "schrijven" — die bestaat niet (§5.3).
- **Zoeken** op tabelnaam en kolomnaam, en het zoeken kijkt óók in verborgen technische tabellen —
  anders zijn ze onvindbaar in plaats van opgeruimd. Zoeken op kolomnaam is het krachtigst: zo vind
  je in één keer elke tabel met een e-mailadres of een bedrag erin.
- **Tabellen waarop de applicatie zelf handelt, krijgen geen schrijfrecht.** Een instellingen-,
  sjabloon-, wachtrij- of webhooktabel is in de praktijk veel meer dan één tabel: de applicatie leest
  die rijen en voert ze uit met haar eigen, volledige rechten — inclusief verwijderen. Schrijfrecht
  daarop is dus een omweg naar precies wat deze hele opdracht uitsluit.

  Merk zulke tabellen aan bij Fase 0 en leg ze vast als **tweede gehardcodeerde lijst in de
  MCP-server**, naast de denylist: lezen mag, schrijven nooit. De atlas toont de stand "schrijven"
  daar niet als keuze, maar dat is presentatie — de server weigert het schrijven en de
  publiceer-actie weigert het recht (§8.3). Zit zo'n tabel in een cluster, dan blijft de clusterklik op
  "lezen" steken voor die tabel, en dat toon je als "gedeeltelijk" in plaats van het stil te laten
  mislukken. Zou je het alleen in de UI regelen, dan lag de beveiliging bij de aandacht van een mens,
  en regel 4 zegt precies dat de UI de beveiliging niet is.
- **Verzegelde tegels.** Tabellen op de denylist staan wél in beeld, maar verzegeld en niet
  aanklikbaar, met een korte uitleg waarom ze nooit toegankelijk zijn. Hun kolommen toon je niet —
  er valt niets in te stellen, en de kolomnamen van juist deze tabellen zijn het gevoeligst.
  Verbergen zou de indruk wekken dat ze vergeten zijn; tonen laat zien dat er bewust over is
  nagedacht.
- **Waar het schema vandaan komt:** de app leest tabellen, kolommen en sleutels zelf uit de database,
  via zijn eigen verbinding. Het verbod op systeemcatalogi uit §5.3 geldt de MCP-querytool, niet de
  app — die moet het schema juist kunnen tonen, inclusief de kolommen en hun commentaar.
  Ververs bij het openen van de pagina; cachen mag, maar kort, zodat een verse migratie meteen
  zichtbaar is.
- **Lege staat.** Een verse rol heeft nul rechten. Maak daar geen leeg scherm van maar een
  uitnodiging: leg in één zin uit dat alles standaard gesloten is, en wijs de weg naar de eerste
  handeling.

### 8.3 Publiceren

- Klikken wijzigt niets in de database. Onderaan telt een balk mee: "7 wijzigingen".
- **Wat telt als opening** (en dus bovenaan staat): gesloten → lezen, gesloten → schrijven, en
  lezen → schrijven. Sorteer binnen de openingen de schrijfrechten eerst. Elke tabel is één regel,
  ook bij een sprong van gesloten naar schrijven.
- **Twee beheerders tegelijk.** De pagina onthoudt de versieteller van de rol (§4) zoals die was
  toen ze werd geopend, en stuurt die mee bij het publiceren. Toets hem **niet** door hem eerst te
  lezen en dan te vergelijken: twee gelijktijdige publicaties lezen dan allebei dezelfde waarde,
  vinden allebei dat het klopt, en schrijven allebei. Doe het in één voorwaardelijke stap — hoog de
  teller op mét de verwachte waarde als voorwaarde, en behandel "nul rijen gewijzigd" als het
  conflict. De teller is bovendien verplicht: ontbreekt hij in de aanroep, dan weiger je.
  Bij een conflict: toon wat er intussen veranderde en laat opnieuw bevestigen. Stilzwijgend overschrijven
  is bij rechten geen optie. Een teller is hier nodig omdat "geen toegang" de afwezigheid van een
  rij is — een ingetrokken recht laat zelf geen spoor na.
- **Publiceren gebeurt in één transactie**, inclusief het ophogen van de teller. Half doorgevoerde
  rechten zijn erger dan geen.
- **De publiceer-actie valideert zelf, server-side.** Ga ervan uit dat iemand haar rechtstreeks
  aanroept en niet via het scherm. Ze controleert daarom opnieuw: is de aanroeper beheerder, bestaat
  de naam echt en is het een gewone tabel of een toegelaten view, staat hij niet op de denylist,
  staat hij niet op de lijst van tabellen waarop de applicatie zelf handelt (dan is "schrijven"
  uitgesloten, §8.2), en is het niveau een geldige waarde. **Gaat het om een view, dan gelden de drie
  viewregels uit §5.3 hier opnieuw**: de onderliggende tabellen worden opgelost en tegen beide
  beschermde lijsten gehouden, en het niveau "schrijven" wordt geweigerd. Een view die niet volledig
  te ontleden is, wordt niet toegekend. Zonder die controle is de rechtentabel een vrij beschrijfbaar tekstveld en liegt
  het rollenoverzicht over wat er openstaat.
- **De samenvatting noemt tabellen, niet alleen clusters.** Je klikt op "Orders", maar je publiceert
  vijf tabellen. Toon het cluster als kop en de tabelnamen eronder, zodat de beheerder tekent voor
  wat er werkelijk opengaat — ook als de indeling later verschuift.
- **Publiceren toont eerst een leesbare samenvatting**, met de **openingen bovenaan** en de
  afsluitingen daaronder — in die volgorde, want daar zit het risico. Geschreven in gewone taal:
  "*facturen* gaat van gesloten naar **schrijven**".
- Pas na bevestiging gaat het live. Eén server-actie, alle wijzigingen samen.
- **Verlaat de pagina niet stilletjes met onbewaarde wijzigingen** — waarschuw.
- Na publiceren: bevestig kort en zichtbaar wat er gewijzigd is, en laat de betrokken tegels
  even bezinken (zie §9).

---

## 9. Ontwerprichting

**De vormgeving staat in een apart document: `mcp-rechtenbeheer-design-prompt.md`.** Daar staan
het canvas, de lichtwaaier, de clusterkaarten, de standenmenu's, de plaats van elke knop en een
schermafdruk als referentie. Lees dat vóór je aan het scherm begint.

Hieronder alleen wat **bindend** is, ongeacht welke vormgeving je kiest. Bouw met de bestaande
design-tokens en bouwstenen van de codebase (zie Fase 0, punt 8); introduceer geen nieuw
kleurenpalet en geen nieuwe primitieven als er al een geschikte bestaat.

### 9.1 De these van het scherm

Dit scherm gaat niet over een formulier met instellingen. Het gaat over **wat er dicht is en wat
er open staat**, en die verhouding moet je in één oogopslag kunnen aflezen van over de kamer.

### 9.2 De drieklank: rust · koel · warm

- **Geen toegang = rust.** Kleurloos, gedempt, gestippeld. Bewust géén alarmkleur: gesloten is
  de gezonde toestand, niet een fout. Zou je hier rood gebruiken, dan schreeuwt een correct
  geconfigureerd systeem je toe dat er iets mis is — en leert de beheerder de kleur negeren,
  precies wanneer ze wél iets zou moeten betekenen.
- **Lezen = koel.** Eén koele tint uit de bestaande tokens, dun en vol. Aanwezig maar
  terughoudend: kijken, niet aanraken.
- **Schrijven = warm.** Het merkaccent, met een zachte gloed. Dit is de énige plek waar het
  accent verschijnt naast een onbewaarde wijziging en de publiceerknop. Dat is geen toeval maar
  de hele redenering: als schrijfrechten zeldzaam horen te zijn, blijft het accent vanzelf
  zeldzaam — en valt elke schrijfrecht-drager onmiddellijk op.

**Nooit kleur alleen.** Elke stand heeft daarnaast een eigen lijn- of randbehandeling en een
eigen teken (`—` · `◦` · `●`, plus `◐` voor de aflezende stand "gedeeltelijk"). Het scherm moet
volledig leesbaar zijn in grijstinten.

### 9.3 Eén orkestreerd moment, en verder ingetogen

Er is precies één signatuur-moment op dit scherm, en verder beweegt er niets uit zichzelf. Wát
dat moment is, bepaalt het designdocument; dát het er maar één is, staat hier — beweging draagt
alleen betekenis als er verder niets beweegt.

Klikken wijzigt nog niets in de database (§8.3); dat verdient een lichte, onmiddellijke
reactie. Het zware moment is het **publiceren**, en dat gaat altijd langs een bevestiging.

### 9.4 Kwaliteitsvloer

- `prefers-reduced-motion` respecteren: de eindstaat is dan onmiddellijk zichtbaar en volledig
  leesbaar — nooit een half getekend beeld.
- Zichtbare toetsenbordfocus; het hele scherm is met het toetsenbord te bedienen, inclusief het
  kolompaneel.
- Werkt tot op kleine schermen, met hetzelfde gedrag en dezelfde standen.
- Contrast controleren voor alle drie de standen, ook voor de gedempte.
- Alles wat een decoratieve laag draagt (lijnen, glyphs, gloed) is `aria-hidden`; alle
  informatie die daarin zit, staat óók als tekst.

### 9.5 De woorden

- Noem de standen bij hun gevolg, niet bij hun techniek: **Geen toegang · Lezen · Schrijven**.
  Niet `SELECT`, niet `RW`, niet `niveau 2`.
- Hetzelfde woord door de hele flow: staat er "Schrijven" op de kaart, dan staat er "Schrijven"
  in het menu, in de samenvatting en in de bevestiging.
- Actieve werkwoorden op knoppen die zeggen wat er gebeurt: "Wijzigingen publiceren", niet
  "Opslaan".
- Elke stand toont zijn gevolg in gewone taal vóórdat je hem kiest, en elke geblokkeerde keuze
  toont de reden. Een grijze regel zonder uitleg is een dood spoor.
- Foutmeldingen zeggen wat er misging en wat de volgende stap is, zonder excuses en zonder
  vaagheid.
- Een lege staat is een uitnodiging tot handelen, geen mededeling dat er niets is.

---

## 10. Fail-safe bij toekomstige schemawijzigingen

- **Een nieuwe tabel is automatisch gesloten** voor élke rol. Dat volgt gratis uit het datamodel
  (§4): geen rij = geen recht. Bouw geen enkele voorziening die nieuwe tabellen automatisch
  toevoegt aan bestaande rollen, hoe handig dat ook lijkt.
- **Een nieuwe kolom erft de rechten van zijn tabel** en is dus meteen zichtbaar voor wie die tabel
  mag lezen. Dat is een bewuste keuze voor eenvoud — en precies daarom moet de ontwikkelaar er
  actief op gewezen worden op het moment dat hij die kolom toevoegt.
- **Installeer daarvoor een skill** die bij elke schemawijziging automatisch meedenkt. Die skill
  hoort als tweede document naast dit document geleverd te worden; vraag de gebruiker ernaar als je
  hem niet hebt. Krijg je hem niet, bouw hem dan zelf volgens onderstaande omschrijving, in het
  skill-formaat dat deze codebase gebruikt (zie Fase 0, punt 9):

  > Bij elke wijziging aan het databaseschema stelt de skill vast wat er wijzigt. Een nieuwe of
  > gewijzigde view: melden welke tabellen hij leest, en dat het herschrijven van een bestaande view
  > verandert wat een al toegekend recht ontsluit. Een nieuwe tabel:
  > kort melden dat hij standaard voor iedereen gesloten is, en — belangrijker — vaststellen of hij
  > op de beschermde lijst uit regel 7 hoort. Alles waarmee je je een identiteit kunt aanmeten
  > (sessies, sleutels, uitnodigingen) en alles waarop de applicatie zelf handelt, hoort daar. Zonder
  > deze stap veroudert die lijst stilletjes: de tabel is dan wel gesloten, maar hij is ook gewoon
  > één klik in de atlas van openstaan.
  > Is het gewone bedrijfsdata, dan **stelt de skill een cluster voor** (§8.2), legt uit waarom, en
  > **laat de gebruiker kiezen** — inclusief de optie "voorlopig niet indelen". Na die keuze werkt ze
  > de clusterindeling in de broncode bij. Zeg er altijd bij dat indelen géén toegang verleent: de
  > tabel blijft dicht en het cluster komt daardoor op "gedeeltelijk" te staan. Zonder deze stap
  > verdwijnt elke nieuwe tabel in "Nog niet ingedeeld" en verliest de indeling zijn waarde.
  > Een nieuwe kolom in een tabel waar al rechten op staan: melden **welke rollen die kolom
  > daardoor meteen kunnen lezen**, en waarschuwen wanneer de kolomnaam op gevoelige inhoud wijst.
  > Dit moet in seconden gebeuren, zonder extra agents — een ontwikkelaar mag hier geen tijd aan
  > verliezen bij routinewerk.

---

## 11. De zware controle — alleen aan de poort

Wijzigingen aan **de veiligheidslaag zelf** worden na afloop gecontroleerd door **drie parallelle
reviewers** (elk een apart, gelijkwaardig sterk model), elk met een eigen invalshoek:

1. **Omzeiling** — kun je met een slimme query langs de analyse uit §5 en §6?
2. **Fail-open** — is er een pad waarlangs de beveiliging stilletjes verdwijnt bij een ontbrekende
   configuratie, een fout, een lege waarde of een uitzondering?
3. **Rechtenescalatie** — kan iemand langs deze wijziging zijn eigen rechten verhogen, of de
   denylist uit regel 7 raken?

Draai ze als drie afzonderlijke subagents, in één keer gestart zodat ze parallel lopen en elkaars
uitkomst niet zien. Geef elk de diff, de gewijzigde bestanden en zijn eigen invalshoek. Is er maar
één model beschikbaar, draai dan drie onafhankelijke doorgangen met deze drie invalshoeken en meld
aan de gebruiker dat ze niet echt onafhankelijk waren.

**Een afkeuring** is elke concrete bevinding: een query die erdoorheen komt, een pad dat fail-open
is, een route naar hogere rechten. "Het zou netter kunnen" is geen afkeuring.

**Unanimiteit is vereist.** Eén afkeuring betekent: herstellen en opnieuw laten controleren.

**Wanneer wél:** wijzigingen aan de queryanalyse, de rechtentoetsing, de denylist, de
databaseverbindingen, de toolregistratie of de beheerderspoort.

**Ook wél:** het aanmaken of wijzigen van een **view** die in het rechtenmodel zit of kan komen. De
definitie van een view bepaalt welke data een reeds toegekend recht ontsluit — hem herschrijven
verandert dus stilzwijgend wat er openstaat, zonder dat er één recht wijzigt. Dat is een wijziging
aan de poort, geen schemawijziging.

**Wanneer niet:** een gewone schemawijziging aan tabellen of kolommen, UI-werk aan het atlasscherm
dat de handhaving niet raakt, of tekstwijzigingen. Deze controle is bewust smal gehouden: ze moet zwaar zijn waar het telt
en volledig afwezig waar ze alleen maar tijd kost.

---

## 12. Wat je bewust NIET bouwt

Bouw deze dingen niet, ook niet als ze een goed idee lijken. Ze zijn afgewogen en afgewezen; ze
weer invoeren maakt de feature zwaarder zonder dat er om gevraagd is.

- **Geen audit-log.** Bewust afgewezen. Voeg geen tabel toe die wijzigingen of queries bijhoudt.
- **Geen rechten op kolomniveau in het model.** Het hover-paneel toont kolommen, maar je stelt er
  niets in. Moet het toch, dan is een view de weg.
- **Geen rechten op rijniveau in het model.** Geen filters per gebruiker, geen "alleen eigen
  klanten" in de rechtentabel. Ook hier is een view het antwoord.
- **Geen `DELETE`**, in geen enkele vorm en achter geen enkele optie.
- **Geen meerdere rollen per gebruiker.** Precies één, of geen.
- **Geen eigen accountbeheer.** Geen wachtwoorden, geen registratie, geen uitnodigingsflow, geen
  tweede code voor het rechtenscherm. De identiteit komt van Microsoft OAuth (§7); een tweede
  inlogweg is alleen maar extra oppervlak om te verdedigen.
- **Geen automatische rechten voor nieuwe tabellen**, in geen enkele variant.
- **Geen tijdelijke of vervallende rechten.**
- **Geen rechten op clusterniveau in het datamodel.** Clusters zijn bediening; de opslag blijft per
  tabel (§4).
- **Geen configuratiescherm voor de clusters.** De indeling staat in de broncode en wordt door een
  ontwikkelaar gewijzigd, in overleg met de gebruiker (§8.2). Een rechtenscherm dat eerst ingesteld
  moet worden, wordt niet gebruikt.
- **Geen vierde tool en geen toolnamen die per rol verschillen** (§5.5). Moet iemand minder kunnen,
  dan pas je zijn rechten aan, niet de toolset.

Wil de gebruiker later een van deze dingen, dan is dat een nieuw, apart besproken stuk werk.

---

## 13. Verificatie

Deze codebase test je niet door de app in een browser open te klikken — dat doet de gebruiker.
Jij levert bewijs op serverniveau.

**Testmatrix.** Voor elke combinatie van rol-stand (geen toegang / lezen / schrijven) en operatie
(`SELECT`, `INSERT`, `UPDATE`) hoort er een testgeval te zijn met het verwachte resultaat. In het
bijzonder:

- geen toegang → alle drie de operaties geweigerd
- lezen → `SELECT` toegestaan, `INSERT` en `UPDATE` geweigerd
- schrijven → alle drie toegestaan; `DELETE`, `MERGE` en DDL worden apart getest en zijn **altijd**
  geweigerd, ongeacht de stand
- een tabel op de denylist → geweigerd, ongeacht de rol en ongeacht wat er in de rechtentabel staat
- een tabel zonder rij in de rechtentabel → geweigerd (het fail-safe-pad)
- een recht dat tijdens een lopende sessie wordt ingetrokken → de eerstvolgende aanroep wordt
  geweigerd (regel 6)

**Omzeilingstests.** Eén testgeval per rij uit de tabel in §6.

**Begrenzingstests.** Een `UPDATE` met een geldige maar te brede `WHERE` (bijvoorbeeld
`WHERE id IS NOT NULL`) wordt teruggedraaid en niet uitgevoerd; een `INSERT` die de bovengrens
overschrijdt eveneens. En de belangrijkste: **herhaalde kleine schrijfacties lopen tegen de
cumulatieve teller aan** en worden geweigerd — anders is de grens een vertraging in plaats van een
slot. Dit is de belangrijkste test in de hele set: hij bewijst dat de belofte
"MCP kan geen data wissen" ook opgaat voor overschrijven.

**De controlequery.** Eén query die na élke wijziging aan de databaserechten nul rijen moet
teruggeven: vraag de catalogus welke rechten de MCP-gebruikers hebben en filter op `DELETE`,
`TRUNCATE`, `REFERENCES` en `TRIGGER`. Staat daar iets, dan is er een `GRANT` te ruim gezet. Neem
deze query op in de documentatie én in de tests — hij is in twee seconden te draaien en hij is het
enige dat bewijst dat de belofte "hier kan niets verdwijnen" nog geldt.

**Privilegetests.** De lees- en schrijfgebruiker kunnen de beschermde tabellen niet lezen of schrijven,
ook niet met een rechtstreekse query buiten de analyse om, en kunnen **geen door de gebruiker
gedefinieerde functie in het toepassingsschema** uitvoeren (§5.4 — ingebouwde functies en operatoren
moeten wél blijven werken, anders draait geen enkele query). Deze test controleert de
rechten in de database, niet de applicatiecode. Test ook dat `search_path` vaststaat, dat de
leesgebruiker standaard read-only draait, en dat de serviceverbinding niets méér kan dan de rechten
lezen en de teller bijwerken — geen leesrecht op bedrijfsdata, geen schrijfrecht buiten de teller.

**Publiceer-actie.** Een rechtstreekse aanroep van de publiceer-actie wordt geweigerd bij: een
tabelnaam van de denylist, schrijfrecht op een tabel waarop de applicatie zelf handelt, een
onbestaande tabelnaam, een ontbrekende of verouderde versieteller, en een aanroeper zonder
beheerdersrechten.

**Beheerderspoort.** Een **ingelogde niet-beheerder** die een beheer-actie rechtstreeks aanroept —
dus buiten het scherm om, met een geldige sessie — wordt geweigerd. En: iemand van wie het
beheerderschap zojuist is ingetrokken, wordt bij zijn eerstvolgende actie geweigerd **zonder dat hij
opnieuw hoeft in te loggen**. Die tweede test is de belangrijkste van de twee: hij bewijst dat de
vlag uit de database komt en niet uit het token.

**Viewtests.** Een view over een tabel van de denylist is niet toekenbaar en elke query erop wordt
geweigerd; een `UPDATE` met een view als doel wordt geweigerd; een view die niet volledig te
ontleden is, wordt geweigerd; en een toegekende view levert wél gewoon zijn rijen op zonder dat de
rol recht heeft op de tabel eronder.

**Foutmeldingen.** Een onbestaande tabel, een foreign table, een gesloten tabel en een
denylist-tabel leveren exact dezelfde melding op.

**Startgedrag.** Een test die aantoont dat de server weigert te starten wanneer de read-only
verbinding of een verplichte configuratiewaarde ontbreekt (regel 5).

**Tabellen-tool.** Een test die aantoont dat een rol met beperkte rechten alleen zijn eigen
tabellen terugkrijgt, en dat denylist-tabellen ook niet als naam verschijnen.

**Is er geen testinfrastructuur?** Introduceer er niet ongevraagd een — dat is een grote,
zelfstandige beslissing. Vraag het aan de gebruiker. Wil hij geen testframework, lever dan een klein
script dat de matrix hierboven doorloopt tegen een testdatabase en de uitkomsten afdrukt. Zonder
enige vorm van bewijs opleveren is geen optie: dan weet niemand of de poort dicht is.

Draai daarnaast wat de codebase gebruikelijk draait: typecontrole, linting, build en de
migratiestap. Rapporteer de uitkomsten eerlijk — een falende test meld je met de uitvoer erbij.

---

## 14. Voor je oplevert

- [ ] Fase 0 doorlopen; onduidelijkheden gevraagd in plaats van ingevuld.
- [ ] Alle acht regels uit §2 nagelopen, één voor één, tegen de daadwerkelijke code.
- [ ] Geen enkel pad waarlangs de beveiliging stilletjes verdwijnt.
- [ ] De denylist staat in de broncode van de MCP-server, niet in de database.
- [ ] Rechten worden per tool-aanroep vers gelezen.
- [ ] De migratie zet iedereen dicht, en dat is aan de gebruiker gemeld vóór ze draaide.
- [ ] De clusterindeling is voorgelegd en bevestigd (§8.2), elke tabel is geplaatst óf zichtbaar in
      "Nog niet ingedeeld", en de twee controles daarop falen in ontwikkeling.
- [ ] Testmatrix en omzeilingstests bestaan en slagen.
- [ ] Typecontrole, linting en build slagen.
- [ ] De kwaliteitsvloer uit §9.4 is nagelopen: reduced motion, toetsenbord, contrast, klein
      scherm. Is het designdocument meegeleverd, dan óók zijn eigen opleverchecklist.
- [ ] De skill uit §10 is geïnstalleerd of gebouwd.
- [ ] **Aan `CLAUDE.md` (of het equivalent in deze codebase) is een korte notitie toegevoegd.**
      Gebruik deze tekst, aangepast aan de namen in de codebase:

      **MCP-rechten per rol** — welke databasetabellen een MCP-rol mag lezen of schrijven, wordt
      beheerd in de app en afgedwongen in de MCP-server (deny-by-default; nooit DELETE, nooit DDL).
      Nieuwe tabellen zijn automatisch gesloten. Activeer bij **elke** schemawijziging de skill
      `<naam>`: die bepaalt wat er met de nieuwe tabellen of kolommen moet gebeuren. Dit raakt
      dataveiligheid — wijzig hier niets zonder de regels in dat onderdeel te lezen.

- [ ] Aan de gebruiker gemeld: wat je aanscherpte ten opzichte van het bestaande gedrag, en welke
      beperkingen overblijven (zie §17 — met name: zonder logboek weet je wél wie het *kon*, niet
      wie het *deed*, en of er point-in-time-herstel op de database staat).

---

## 15. Werkwijze

- Werk in de volgorde: Fase 0 → datamodel en migratie → handhaving in de server → tests →
  beheerscherm → skill → afrondingscheck. De handhaving vóór de UI: het scherm mag pas rechten
  kunnen uitdelen als de server ze al kan afdwingen.
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
| Welke tabellen: in de applicatie. Welke operaties: in de database | Zie §5. De tabeldimensie moet in de applicatie omdat een beheerder geen databaserollen beheert; de operatiedimensie blijft in de database omdat dát de garantie is die geen applicatiefout kan breken |
| Schrijven = INSERT + UPDATE, nooit DELETE | Dataverlies door een goedbedoelend model is het grootste reële risico, en een operatie die niet bestaat kan niet misgaan. Let op: dit dekt maar de helft — een te brede `UPDATE` wist net zo goed. Daarom is de rijbegrenzing uit regel 3 geen detail maar de andere helft van dezelfde garantie |
| Alles dicht bij de uitrol | De enige manier om zeker te weten dat niets per ongeluk openstaat, is beginnen bij nul |
| Geen toegang = afwezigheid van een rij | Maakt nieuwe tabellen fail-safe zonder dat iemand eraan hoeft te denken |
| Publiceren met een leesbare samenvatting | Voorkomt de fatale misklik en geeft een natuurlijk moment van bezinning |
| Rechtentabellen op een gehardcodeerde denylist | Zonder dit kan een rol met schrijfrechten zichzelf promoveren |
| Geen audit-log | Bewust afgewezen door de opdrachtgever |
| Identiteit altijd via Microsoft OAuth; beheerderschap is een veld in de database | Eén authenticatieweg is minder oppervlak om te verdedigen dan twee. En omdat de vlag in de database staat — op een tabel die op de denylist staat — geldt een intrekking onmiddellijk en kan geen enkele MCP-rol zichzelf promoveren |
| Eén rol per gebruiker | "Wat mag deze persoon" moet een blik zijn, geen rekensom — daar ontstaan rechtenfouten |
| Nieuwe kolom erft de tabelrechten | Eenvoud boven fijnmazigheid; het risico wordt afgedekt doordat de skill er actief op wijst |
| Zware controle alleen aan de poort | Streng waar het telt, en volledig afwezig bij routinewerk, zodat de controle serieus genomen blijft |
| Drie tools, voor elke rol dezelfde namen | Meerdere query-tools naast elkaar maken voor de AI-client onverklaarbaar waarom een tabel in de ene wél bestaat en in de andere niet; dan gaat hij gokken |
| Toolbeschrijvingen samengesteld uit de rechten van de rol | Een model kiest zijn acties op basis van de beschrijving; noem je de tabellen niet, dan loopt het tegen weigeringen aan die het niet kon zien aankomen |
| Het cluster is de klikeenheid, de tabel de opslageenheid | Een order is in werkelijkheid vijf tabellen die niemand los denkt; één keuze houdt het scherm bruikbaar, terwijl de opslag per tabel de handhaving en de fail-safe onaangetast laat |
| Clusters worden voorgesteld door de agent en bevestigd door de gebruiker, niet afgeleid uit het schema | Een schema weet niet hoe een bedrijf over zichzelf denkt: een indeling op sleutels en naamstammen zet juist de tabellen uit elkaar die inhoudelijk bij elkaar horen. Domeinkennis is hier het gereedschap, en de gebruiker is de enige die het kan corrigeren |
| Wat nergens is ingedeeld verschijnt in "Nog niet ingedeeld" | Handmatig indelen betekent dat je iets kunt vergeten; bij rechten mag vergeten nooit onzichtbaar betekenen |
| Technische tabellen standaard verborgen, wel toekenbaar | Machinerie hoort niet in een scherm over wie klantgegevens mag zien; verbergen ruimt op zonder iets onmogelijk te maken, anders dan de denylist |
| Views wél toekenbaar, met transitieve toetsing en alleen-lezen | Ze zijn het enige gereedschap voor kolom- en rijafscherming. De bescherming komt van de server, die de onderliggende tabellen oplost en de beschermde lijsten transitief toepast (§5.3) — niet van de database, want de gedeelde leesgebruiker kent geen onderscheid per rol (§17) |

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
  analyse ze ziet, en het aantal geraakte rijen telt alleen de doeltabel (§5.6 en regel 3). Het
  intrekken van functierechten helpt hiertegen alleen als het van `PUBLIC` gebeurt (§5.4) — lukt dat
  niet, dan is dit een open risico en geen afgedekt punt.
- **Bestaansorakels via foutgedrag.** Een `INSERT` in een open tabel met een verwijzing naar een
  gesloten tabel slaagt of faalt afhankelijk van wat er in die gesloten tabel staat. Dat verschil is
  niet te verbergen zonder de schrijffunctie zelf onbruikbaar te maken. Het lekt weinig (één bit per
  poging), maar het lekt.
- **Je weet wie het kón, niet wie het déed.** Met een per-persoon-login staat vast wie er beheerder
  ís, maar zonder logboek (§12) blijft achteraf onherleidbaar wie een bepaalde rechtenwijziging
  heeft doorgevoerd. Bij meer dan één beheerder is dat een reële beperking.
- **Een uitgegeven token blijft geldig tot het verloopt.** Iemand het beheerderschap afnemen werkt
  alleen onmiddellijk omdat de controle de database per actie leest (§7). Voor de MCP-sessie geldt
  hetzelfde via regel 6. Zou een van beide ooit terugvallen op een claim uit het token, dan loopt
  een intrekking stil achter op de werkelijkheid.
- **Hernoemen plus opnieuw aanmaken.** De opstartcontrole (§4) merkt op dat een beschermde tabelnaam
  verdwenen is, maar niet dat er een nieuwe, onschuldige tabel met die naam voor in de plaats is
  gezet. Dat vraagt DDL en dus een ontwikkelaar — het is een risico van binnenuit, niet via MCP.
- **Eén gedeelde leesgebruiker.** De databaserechten zijn de vereniging over alle rollen: mag één
  rol een tabel lezen, dan heeft de leesgebruiker dat recht. Per rol onderscheiden gebeurt dus
  uitsluitend in de applicatielaag. De database blijft de garantie op het *soort* handeling (nooit
  verwijderen, nooit structuurwijzigingen), niet op *welke tabel* voor *welke rol*.
- **Views leunen daardoor op de applicatielaag.** Ligt onder een toegekende view een tabel die een
  ándere rol wél mag lezen, dan is er voor deze rol geen tweede laag. De transitieve denylist en de
  alleen-lezen-regel (§5.3) dekken de ernstigste gevallen af; de rest is applicatielogica.
- **De grens is een grens, geen intentiecontrole.** Iemand met legitiem schrijfrecht kan binnen de
  toegestane omvang schade aanrichten. Rechten uitdelen blijft een vertrouwenshandeling; dit systeem
  maakt alleen zichtbaar en beperkt wát je uitdeelt.
