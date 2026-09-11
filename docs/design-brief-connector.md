# Designbrief — het rechtenscherm "Connector"

> **Hoe je dit gebruikt:** dit document hoort bij `docs/opdracht-app-kant.md` (de functionele
> opdracht) en beschrijft **hoe het beheerscherm eruitziet en aanvoelt**. Plak ze samen in dezelfde
> sessie. De functionele opdracht bepaalt *wat* er gebeurt en wat er veiligheidshalve niet mag; dit
> document bepaalt *hoe het eruitziet*. Waar ze elkaar tegenspreken, wint de functionele opdracht —
> beveiliging gaat vóór vorm.
>
> **Drie referentiebeelden** staan in `docs/voorbeelden/` (vanuit de klantrepo:
> `mcp-server/docs/voorbeelden/mcp-voorbeeld-1.png`, `-2.png`, `-3.png`). Het zijn drie
> **layoutvarianten** van hetzelfde scherm — geen van de drie is leidend. Jij kiest in Fase 0 de
> variant die bij het designsysteem van deze codebase past en legt die keuze voor (deel 3). Wat in
> deel 1 staat, geldt voor élke variant en is niet onderhandelbaar.
>
> **Woordenlijst-brug.** De functionele opdracht noemt dit scherm "de atlas" en de klikeenheid "een
> tegel"; dit document noemt ze **het canvas** en **een clusterkaart** (in variant B en C: **een
> clusterknoop**). Dat is hetzelfde ding — de functionele opdracht is bewust vormgeving-neutraal
> geschreven. Waar dit document concreet wordt, wint het voor de vorm; waar het over rechten en
> veiligheid gaat, wint de functionele opdracht altijd.

---

# Deel 1 — Bindende invarianten

Alles in dit deel geldt voor elke variant uit deel 2. Kies je variant B of C, dan bouw je nog steeds
precies deze kaarten, deze menu's, dit proefblad en deze woorden — alleen de plaatsing verschilt.

## 1.0 Wat je maakt

Eén scherm waarop een beheerder per **rol** instelt wat een AI-model via de MCP-server in de
database mag zien en wijzigen. Drie standen per tabel: **geen toegang · lezen · schrijven**. De
bediening gaat per **cluster** (een groep tabellen met een naam die de gebruiker herkent —
"Relaties", "Boekhouding"), de opslag blijft per tabel.

Het scherm heet **Connector**. Niet "Rechten", niet "Permissies", niet "ACL" — het is de stekker
tussen een taalmodel en je database, en dat woord doet twee dingen tegelijk: het zegt wat het is, en
het herinnert eraan dat je hem ook kunt uittrekken.

**Wat elke variant gemeen heeft, van boven naar beneden:**

1. Een kop **Connector** met daaronder één zin die het scherm verklaart.
2. De instellingen-tabs van de app, zodat het scherm ergens thuishoort.
3. De **rolkiezer** (met de telling "5 lezen · 4 schrijven") en de **standenkiezer**
   (Geen / Lezen / Schrijven), die de aandacht richt.
4. Drie knoppen: **Machinerie**, **Ongedaan maken**, **N wijzigen…** (die laatste in accent — dat is
   de publiceerknop).
5. Het **canvas**: één rolknoop of lichtbron waaruit per cluster één **verbinding** naar een
   clusterkaart loopt. De verbinding draagt de stand.
6. Een **slotregel** die de kern herhaalt.

## 1.1 De these

**Dit scherm gaat niet over een formulier met instellingen. Het gaat over wat er dicht is en wat er
open staat, en dat moet je van over de kamer kunnen aflezen.**

Daaruit volgt de hele opzet: **de verbinding ís de stand.** Je leest de rechten van een rol af aan de
lijnen voordat je één woord gelezen hebt. Vijf accentlijnen tussen negen bleke = deze rol kan op vijf
plekken schrijven, en dat zie je vanuit je ooghoek.

Alles wat daar niet aan bijdraagt, gaat eruit. Dat is streng bedoeld: dit is een scherm dat iemand
een paar keer per jaar opent om een beslissing te nemen die hij niet mag verprutsen.

## 1.2 De drieklank: rust · koel · warm

De drie standen krijgen elk een eigen plek in het palet, en die keuze is niet cosmetisch.

| Stand | Kleur | Waarom |
|---|---|---|
| **Geen toegang** | Kleurloos: de sterke randkleur van je systeem. Gestippelde lijn, gestippelde rand. | Bewust **géén alarmkleur**. Gesloten is de gezónde toestand. Zou je hier rood gebruiken, dan schreeuwt een correct geconfigureerd systeem je toe dat er iets mis is — en leert de beheerder de kleur negeren, precies wanneer ze wél iets zou moeten betekenen. |
| **Lezen** | Eén koele tint (een rustig blauw, of wat je systeem als "informatief" kent). Dunne volle lijn. | Aanwezig maar terughoudend: kijken, niet aanraken. Dit is de énige koele kleur op het scherm — daardoor leest ze meteen als "een andere soort toegang". |
| **Schrijven** | Het merkaccent, met een zachte gloed op de verbinding. | Op de kaarten en verbindingen is dit de **enige** plek waar het accent verschijnt. Dat is geen toeval maar de hele redenering: als schrijfrechten zeldzaam horen te zijn, blijft het accent vanzelf zeldzaam — en valt elke schrijfverbinding onmiddellijk op tussen tien rustige. |

**Nooit kleur alleen.** Elke stand draagt daarnaast:

- **een eigen lijnstijl**: gestippeld (geen) · dun vol (lezen) · dik vol + gloed (schrijven);
- **een eigen teken**: `—` · `◦` · `●`, en `◐` voor de aflezende stand "gedeeltelijk";
- **een eigen woord**, altijd voluit: Geen toegang · Lezen · Schrijven.

Het scherm moet volledig leesbaar zijn in grijstinten. Test dat ook echt: zet een grijsfilter over
een schermafdruk en kijk of je nog kunt zeggen welke clusters openstaan.

> ⚠ **Kleur hoort bij de stand, nooit bij het cluster.** In twee van de drie referentiebeelden
> (variant B en C) hebben de clusters elk een eigen icoonkleur en lopen de verbindingen mee in die
> kleur. Dat is een fout in de mockup, geen ontwerpkeuze: een blauwe lijn moet altijd "lezen"
> betekenen, nooit "Werkbonnen". Neem de layout van die beelden over, niet hun kleurgebruik.

## 1.3 Palet en tokens

Dit document schrijft **geen** kleurwaarden voor. Je gebruikt de tokens van de codebase waarin je
werkt (kleur, radius, schaduw, easing, duur) en introduceert geen nieuw palet. Wat je wél nodig hebt,
uitgedrukt in rollen:

| Rol | Waarvoor |
|---|---|
| `bg` — de paginagrond | de grond onder het canvas |
| `surface` — het lichtste vlak | de clusterkaarten en de drijvende menu's |
| `paper` — een warm tussenvlak | hover-toestanden, uitgeklapte kolompanelen |
| `ink` / `ink-muted` | titels versus uitleg en tabelnamen |
| `border` / `border-strong` | haarlijnen; `border-strong` is óók de kleur van "geen toegang" |
| `accent` (+ een zachte accent-wash) | uitsluitend: schrijven, onbewaarde wijziging, publiceerknop, focus-ring |
| één koele statuskleur | uitsluitend: lezen |

**Eén afregelknop voor het lichtbudget.** Definieer één token voor de sterkte van de gloed rond de
bron of rolknoop, bijvoorbeeld:

```css
--connector-bron: 8%;   /* hoe sterk de waas rond de bron gloeit */
```

De **tint** van die waas komt van de gekozen stand, niet van dit token — een blauwe stip met een
oranje waas eronder klopt niet. Vindt iemand het scherm te warm, dan draai je dit ene getal terug en
klopt het overal.

**Accent als vlák is verboden**; als bron van licht klopt het. Bij 8% blijft het ruim onder de
gebruikelijke "accent < 5% van het scherm"-grens.

**Heeft de codebase geen warm palet?** Vertaal dan de *rollen*, niet de kleuren: de grond mag koel
zijn, zolang "geen toegang" kleurloos blijft, "lezen" één koele tint krijgt en "schrijven" het
merkaccent. Verzin geen tweede accent.

## 1.4 Typografie

Drie families, drie taken, geen overlap.

| Element | Familie | Maat |
|---|---|---|
| Paginakop ("Connector") | serif / display | de grootste kop van je systeem, één per scherm |
| **Clustertitel** ("Relaties.") | **serif**, medium | ~21px, strakke `line-height`, **mét punt** |
| Clusteruitleg | sans | ~13px, `line-height` krap-ruim (≈1.35) |
| Voetnoot op de kaart | sans | ~11px, voorafgegaan door een `!` in accent |
| Standen, tellingen, labels | **mono**, UPPERCASE, `letter-spacing ≈ 0.1em` | 10–12px |
| **Tabelnamen** | **mono**, normale kast | ~11px |
| Kolomnamen en -types | mono | 11px / 10px |
| Kolomcommentaar | sans | 11px |

**De punt achter de clustertitel is merkgrammatica en geen typefout.** "Relaties." leest als een
uitspraak, "Relaties" als een label. Dat verschil is precies wat de kaart van een instellingenrij
onderscheidt. Houd het consequent: elke clustertitel eindigt op een punt. (Kent je designsysteem
geen serif, neem dan de zwaarste display-snede van de sans — de punt blijft.)

**De vuistregel voor mono versus sans:** mono is voor alles wat *letterlijk uit de database* komt of
een *stand* aanduidt. Sans is voor alles wat je in gewone taal tegen een mens zegt. Serif is alleen
voor namen van dingen. Loopt een tabelnaam in sans, dan lijkt het een woord; loopt uitleg in mono,
dan lijkt het een foutmelding.

## 1.5 De kop

Eyebrow in mono, titel in serif-display, en één omschrijving van maximaal twee regels die het scherm
in gewone taal verklaart. Gebruik letterlijk deze strekking:

> *"Wat een AI-model via de MCP-server in deze database mag zien en wijzigen. Per rol, per cluster,
> per tabel — en verwijderen kan nooit."*

Die laatste bijzin doet werk: hij neemt de grootste angst weg vóór iemand één knop aanraakt.

## 1.6 De bedieningsbalk

Eén rij (of in variant C: de kop van de zijbalk plus de werkbalk boven het canvas), `align-items:
end`, met ruime horizontale tussenruimte (≈32px) en wrap op smal.

**De rolkiezer.** Een knop van 44px hoog en ~256px breed: een rond **rolmerk**, de rolnaam, en
daaronder in mono de telling. Klikken opent een drijvend menu met alle rollen, en onderaan de acties
**Hernoemen · Dupliceren · Verwijderen** plus **Nieuwe rol**.

Het rolmerk is 28px rond en draagt het teken van de rúímste stand die de rol ergens heeft: `●` in
accent-wash als hij ergens mag schrijven, `◦` in de koele tint als hij alleen leest, `—` met
gestippelde rand als hij volledig dicht staat. Zo zie je in de kiezer al welke rol gevaarlijk is
voordat je hem opent.

De telling eronder: `5 LEZEN · 4 SCHRIJVEN`, of `VOLLEDIG DICHT` als er niets openstaat.

> **Het rolbeheer zit in de rolkiezer.** Je wisselt van rol op dezelfde plek waar je hem aanmaakt,
> hernoemt, dupliceert en verwijdert — en je blijft ondertussen naar het canvas kijken. In variant C
> mag de rollenlijst permanent in de zijbalk staan; ook dan zitten de acties bij de lijst, niet op
> een apart scherm. **Dupliceren staat er bewust tussen:** het is de snelste weg naar een variant, en
> het voorkomt dat iemand uit gemak een te ruime bestaande rol hergebruikt.

**De standenkiezer.** Een gesegmenteerde schakelaar met drie segmenten (Geen · Lezen · Schrijven) en
een **glijdende** actieve pill. Eyebrow erboven: `RECHTEN KIEZEN`.

> ⚠ **Dit is een FOCUS, geen penseel.** Deze keuze bepaalt welke verbindingen oplichten, niet wat
> er verandert. Een eerdere versie liet je bovenaan een stand "oppakken" en die daarna op clusters
> aanbrengen. Dat werkt sneller, maar een schakelaar die tegelijk **filtert én toekent** is een
> schakelaar waarvan je nooit zeker weet wat je zojuist gedaan hebt — en dit is het scherm waar dat
> het meest kost. **Wijzigen gebeurt op de kaart zelf.** De kiezer bovenaan doet één ding: hij richt
> je aandacht. Verbindingen buiten de focus zakken naar 18% van hun basisdekking, in 400ms.

**Drie knoppen**, in deze volgorde:

1. **Machinerie** — een schakelknop (`aria-pressed`) met een klein tandwiel/schuifjes-icoon. Zet de
   technische tabellen en de verzegelde kaart erbij. Standaard **uit**.
2. **Ongedaan maken** — secundair, uitgeschakeld als er niets gewijzigd is.
3. **De publiceerknop** — accent. Het label telt mee: `4 wijzigen…` bij vier onbewaarde wijzigingen,
   en `Opslaan` (uitgeschakeld) als er niets te doen is. De drie puntjes beloven dat er nog een
   bevestiging komt; die belofte moet je waarmaken (§1.11).

## 1.7 De clusterkaart

Breedte **264px**, minimale hoogte **216px**, radius van je kaart-token, oppervlaktekleur, met een
randlijn en een schaduw plus een witte inset-highlight aan de bovenrand. (In variant B en C is de
kaart de knoop; de maat mag daar kleiner, de inhoud niet.)

```
┌────────────────────────────────┐
│▌ ┌────┐                        │  ▌ = accentstreepje: onbewaarde wijziging
│  │ ◉  │  ← medaillon 44px      │
│  └────┘                        │
│  Relaties.                     │  serif ~21px, mét punt
│                                │
│  Klanten, hun contact-         │  sans 13px, ink-muted
│  personen en de bedrijfstypes  │
│  waarin je ze indeelt.         │
│                                │
│  ! Let op: klanten draagt      │  11px, ! in accent
│    ook de omzetcijfers…        │  (alleen als de kaart NIET dicht staat)
│                                │
│  ┌──────────────────────────┐  │
│  │ ● SCHRIJVEN            ⌄ │  │  de standknop
│  └──────────────────────────┘  │
│         3 TABELLEN ⌄           │  mono, uitklapper
└────────────────────────────────┘
```

**De kaart is bewust bijna leeg.** De verbinding erboven draagt de stand al; de kaart hoeft die niet
nóg eens met een gekleurde rand te herhalen. Daaruit volgt een regel die je consequent moet
volhouden:

> **Kleur op een kaart betekent "hier heb je net aan gezeten", niet "dit staat open".**

Concreet: een kaart met een **onbewaarde wijziging** krijgt een accent-rand op ~45% en een verticaal
accentstreepje van 3×32px tegen de linkerrand, dat binnenkomt met de micro-bevestigingsanimatie van
je systeem. Alle andere kaarten houden de gewone randkleur.

**Het medaillon** is 44px rond met een icoon van 20px:

- kaart **dicht**: gestippelde rand, geen vulling, gedempte inktkleur;
- kaart **open**: geen rand, vulling `color-mix(standkleur 10%, oppervlak)`, icoon in de standkleur.

Zo verkleurt de kaart alleen op dat ene punt mee, en blijft de rest rustig.

**Eén glyph per cluster**, met de hand als inline SVG (mensen · gesprek · map · bank · document ·
verzenden · lijn-omhoog · afvinklijst · megafoon · tandwielen · slot · vraagteken). Geen
icoonlibrary voor twaalf iconen. Een onbekende clustersleutel valt terug op het vraagteken — **een
nieuw cluster mag nooit iconloos blijven.**

**De voetnoot** verschijnt alleen als de kaart níét dicht staat: een waarschuwing over data waar je
niet bij kunt, is ruis.

**De uitklapper** onderaan toont het aantal tabellen in mono met een chevron die 180° draait. Een
cluster met **ongelijke standen klapt zichzelf open** — je moet kunnen zien wélke tabel afwijkt,
anders is "gedeeltelijk" een mededeling zonder uitweg.

## 1.8 De standknop en het standenmenu

**De standknop** toont waar iets nu staat en opent met een chevron een klein drijvend menu. Twee
maten: groot op de kaart (padding 12/10px, mono 12px), klein op een tabelrij (8/4px, mono 10px,
vaste breedte ~116px).

De knop kleurt mee met zijn stand: accent-wash bij schrijven, een lichte koele wash bij lezen, en een
**gestippelde rand zonder vulling** bij geen toegang. Bij "gedeeltelijk": teken `◐`, woord
"Gedeeltelijk", in gedempte inkt — geen eigen kleur, want het is geen eigen stand.

**Het menu** is 288px breed en toont de drie standen elk met **teken, woord én de zin die uitlegt
wat het betekent**:

```
┌────────────────────────────────────────────┐
│ —  GEEN TOEGANG            nu              │
│    Deze rol ziet de tabel niet en kan hem  │
│    niet bevragen.                          │
├────────────────────────────────────────────┤
│ ◦  LEZEN                                   │
│    Deze rol mag de tabel bevragen, maar    │
│    niets toevoegen of wijzigen.            │
├────────────────────────────────────────────┤
│ ●  SCHRIJVEN                               │
│    Deze rol mag lezen, rijen toevoegen en  │
│    bestaande rijen bijwerken. Verwijderen  │
│    kan nooit.                              │
└────────────────────────────────────────────┘
```

> **Je ziet wat je kiest vóór je klikt.** Bij het uitdelen van databasetoegang is dat het verschil
> tussen bediening en gokken. Een drop-down met alleen de woorden "Geen / Lezen / Schrijven" is hier
> niet goed genoeg.

**Is schrijven onmogelijk** (een view, of een tabel waarop de applicatie zelf handelt), dan is die
regel uitgeschakeld op ~45% dekking **en vervangt de reden de uitlegzin**:

- op een cluster: *"Op alles in dit cluster handelt de applicatie zelf. Lezen kan, schrijven nooit."*
- op een view: *"Een view is nooit een schrijfdoel — je schrijft in de tabellen eronder."*
- op een tabel: *"Op deze tabel handelt de applicatie zelf; een model mag hem alleen lezen."*

Een grijze regel zonder uitleg is een dood spoor; een grijze regel mét reden is een antwoord.

**Technisch:** het menu hangt in een **portal** met vaste positionering, 6px onder zijn knop en
altijd binnen het venster geklemd. Dat moet: de kaarten leven in een schuivend of zoomend canvas dat
alles afknipt wat eruit steekt. Het sluit bij Escape, bij een klik ernaast, bij **elke** scroll of
zoom (ook in een voorouder — vandaar de capture-fase) en bij resize. Een menu dat blijft hangen
terwijl het canvas beweegt, komt los van zijn knop te staan.

## 1.9 De tabelrij en de kolommen

Onder een uitgeklapte kaart staat per tabel één rij:

```
┌──────────────────────────────────────────────┐
│ klanten                [◦ LEZEN ⌄]      (i)  │
└──────────────────────────────────────────────┘
```

- **de naam in mono, precies zoals hij in de database heet.** Het cluster praat gewone taal, deze
  regel spreekt de waarheid — en dat is dezelfde naam die het proefblad straks toont;
- **een eigen standknop** (klein). Dit is de fijnregeling: hier zet je één tabel bewust anders, en
  dáárdoor komt het cluster op "gedeeltelijk";
- **een ronde (i)-knop** die de kolommen uitklapt.

Een rij met een onbewaarde wijziging krijgt dezelfde accent-rand als de kaart.

**Het kolompaneel** toont per kolom de naam (mono), het type (mono, gedempt) en — dit is het punt —
**het commentaar dat de database zelf draagt**, in sans eronder. Daarvoor staan die comments er.
Bovenaan een mono-telling (`14 KOLOMMEN`, plus `· view` als het er een is), en bij een view
onderaan achter een scheidslijn: *"Deze view leest: `tabel_a, tabel_b`."*

Dit paneel is de reden dat een beheerder een **geïnformeerde keuze** maakt in plaats van een gok.
Geef het echte aandacht.

## 1.10 De verzegelde kaart en de machinerie

**De verzegelde kaart.** De tabellen die de toegang zélf sturen (gebruikers, rollen, rechten) krijgen
één kaart:

- **gestippelde** rand in de sterke randkleur;
- een diagonale arceervulling: `repeating-linear-gradient(135deg, transparent 0 7px, <randkleur op
  34%> 7px 8px)`;
- een slot-glyph in een medaillon met gewone rand;
- titel **"Verzegeld."**, en daaronder in gewone taal waarom;
- de tabelnamen in mono eronder;
- **geen standknop, geen uitklapper, geen kolommen.**

> **En het belangrijkste: er hangt géén verbinding aan.** Er loopt geen lijn naartoe omdat er nooit
> een lijn naartoe kán lopen. Dat is de hele boodschap van deze kaart — de grens zichtbaar maken in
> plaats van hem te verbergen. Verbergen zou de indruk wekken dat er niet over is nagedacht.

Hun kolommen toon je niet: er valt niets in te stellen, en juist van deze tabellen zijn de
kolomnamen het gevoeligst.

**Machinerie.** Elk schema zit vol tabellen die er zijn voor het apparaat en niet voor het bedrijf:
wachtrijen, migratieboekhouding, webhook-dedup, opgeslagen voorkeuren, singleton-notitieblokken. Die
horen niet in een scherm waar iemand nadenkt over wie klantgegevens mag zien.

**Bundel ze tot één kaart "Machinerie", standaard uit beeld**, samen met de verzegelde kaart,
achter één schakelknop. Aan betekent: beide kaarten komen achteraan het canvas erbij, en de
machineriekaart krijgt een eigen verbinding zoals elk ander cluster.

Verwar dit niet met de verzegelde lijst: machinerie is *uit het zicht* maar **wél toekenbaar**;
verzegeld is *nooit*. Twee verschillende dingen die je niet in één mechanisme moet persen.

## 1.11 Wijzigen en publiceren

**Klikken wijzigt niets in de database.** Alles is voorlopig tot je publiceert. Dat betekent dat het
scherm op elk moment moet kunnen laten zien wat er nog niet echt is:

- gewijzigde kaarten en rijen dragen de accentrand en het streepje (§1.7);
- de publiceerknop telt mee: `4 wijzigen…`;
- **verlaat de pagina niet stilletjes** met onbewaarde wijzigingen — hang er de browserwaarschuwing
  aan;
- **van rol wisselen met onbewaarde wijzigingen** opent eerst een dialoog: *"Eerst deze rol
  afronden?"* met de knoppen **Hier blijven** en **Weggooien en wisselen**, en de telling in de
  tekst. Stilzwijgend weggooien is bij rechten geen optie.

### Het proefblad

Publiceren toont eerst een leesbare samenvatting. Vier regels die niet onderhandelbaar zijn:

1. **Openingen bovenaan**, en binnen de openingen de schrijfrechten eerst — daar zit het risico.
   Sorteervolgorde: naar schrijven (0) · gesloten → lezen (1) · schrijven → lezen (2) · intrekking (3).
2. **Gegroepeerd per cluster, maar met de échte tabelnamen eronder.** Je klikt op een cluster, je
   publiceert tabellen. De beheerder tekent voor wat er werkelijk opengaat, ook als de indeling later
   verschuift.
3. **In gewone taal**: *"`klanten` gaat van gesloten naar **schrijven**"*, met een accent-bolletje
   voor een opening en een neutraal bolletje voor een afsluiting.
4. **Een slotregel** die de belangrijkste garantie herhaalt: *"Verwijderen en structuurwijzigingen
   zijn voor élke rol uitgesloten, ook voor tabellen die hierboven op Schrijven komen te staan."*

Knoppen: **Terug** en **Publiceren**. Pas na bevestiging gaat het live.

## 1.12 Lege staten en fouten

**Nog geen enkele rol:** toon de rolkiezer plus een verzorgde lege staat — *"Een rol bundelt wat een
AI-model in deze database mag zien en wijzigen. Maak er één aan; hij begint volledig dicht."* Een lege
staat is een uitnodiging tot handelen, geen mededeling dat er niets is.

**Een rol zonder rechten:** geen aparte lege staat. Het canvas met alle verbindingen gestippeld ís
het antwoord — je ziet in één blik dat alles dicht staat, en dat is de gezonde toestand.

**Fouten** verschijnen als een strook onder de balk: accent-rand, zachte accent-wash, en een zin die
zegt wat er misging en wat de volgende stap is. Geen excuses, geen vaagheid, geen technische details.

## 1.13 Motion

Er is precies **één signatuurmoment** op dit scherm, en verder beweegt er niets uit zichzelf.
Beweging draagt alleen betekenis als er verder niets beweegt. Wát dat moment is, hangt van de
variant af (deel 2); dát het er maar één is, staat hier.

Richtwaarden, met de zachte huiscurve van je systeem tenzij anders vermeld:

| Wat | Duur | Wanneer |
|---|---|---|
| Het signatuurmoment (verbindingen verschijnen vanuit één oorsprong) | ≈850ms, 120ms vertraging | bij binnenkomst, eenmalig |
| Kaarten komen op (fade + 0.6rem omhoog) | 500ms, start 240ms, 55ms per kaart | bij binnenkomst |
| De bron/rolknoop verkleurt naar de gekozen stand | 250ms | bij standwissel |
| Verbindingen dimmen / lichten op | 400ms | bij standwissel |
| Kaartrand kleurt bij een wijziging | jouw basisduur | bij elke mutatie |
| Het accentstreepje verschijnt | 350ms | bij elke mutatie |
| Het drijvende menu | 200ms | bij openen |
| Tabellen/kolommen klappen uit | 280–300ms | bij uitklappen |
| De actieve pill in de standenkiezer | veer | bij standwissel |

**Wat er níét beweegt:** geen zwevende deeltjes, geen glinsterende randen, geen tilt, geen parallax,
geen hover-animatie op de kaarten behalve de kleurovergang. Kies je variant A, dan zijn de lopende
bolletjes (bijlage A) het enige continue element — geef er geen tweede naast.

## 1.14 Kwaliteitsvloer

- **`prefers-reduced-motion` is verplicht.** Alles continue **stopt volledig** (de animatielus start
  niet eens), het signatuurmoment staat meteen op zijn eindstaat, en alle transities vallen weg. **De
  eindstaat is in alle gevallen het volledige, leesbare canvas** — nooit een half getekend beeld.
  Luister ook naar *veranderingen* in die voorkeur, niet alleen naar de waarde bij het laden.
- **Toetsenbord.** Elke standknop, elke uitklapper, elke pijl- of zoomknop is een echte knop. Het
  canvas is één tabstop en is met de pijltjestoetsen te doorlopen (variant A: schuift de rij;
  variant B en C: springt van knoop naar knoop). De drijvende menu's sluiten met Escape. De
  focus-ring is de accent-outline van je systeem, zichtbaar op elk element.
- **Schermlezers.** De verbindingen zijn puur decoratief (`aria-hidden`) — alle informatie die ze
  dragen staat óók als tekst op de kaart. Een standknop draagt een label als *"Relaties: Schrijven.
  Stand wijzigen"*, en het menu is een `role="menu"` met `menuitem`s. Variant B en C leveren
  daarnaast de lijstweergave als volwaardig alternatief.
- **Contrast** controleren voor alle drie de standen, inclusief de gedempte tekst en de dichte kaart.
- **Klein scherm.** Het canvas scrollt of zoomt sowieso al, dus dat werkt. Zet de bedieningsbalk om
  naar wrap, klap de zijbalk (variant C) in tot een knop, en zet `backdrop-filter` uit als je
  designsysteem dat op smalle schermen voorschrijft.
- **Het canvas mag nooit leeg blijven** door een meetfout: staat de breedte op 0, render dan niets in
  plaats van een half canvas, en meet opnieuw zodra het element een maat heeft (`ResizeObserver`).
- **De layout is deterministisch.** Twee keer laden met dezelfde rechten geeft pixel voor pixel
  hetzelfde beeld. Geen `Math.random()`, geen opgeslagen posities, geen layout die van de vorige
  sessie afhangt.

## 1.15 De woorden

- **Noem de standen bij hun gevolg, niet bij hun techniek.** Geen toegang · Lezen · Schrijven. Niet
  `SELECT`, niet `RW`, niet "niveau 2".
- **Hetzelfde woord door de hele flow.** Staat er "Schrijven" op de kaart, dan staat er "Schrijven"
  in het menu, in het proefblad en in de bevestiging.
- **Actieve werkwoorden op knoppen die zeggen wat er gebeurt.** "Wijzigingen publiceren", niet
  "Opslaan". "Weggooien en wisselen", niet "Doorgaan".
- **Clusteruitleg is één zin in gewone taal, zonder tabelnamen.** Kun je die zin niet schrijven
  zonder een tabelnaam te gebruiken, dan is het cluster nog geen cluster.
- **Een voetnoot waarschuwt concreet.** Niet "bevat gevoelige data" maar *"Let op: klanten draagt
  ook de omzet-, winst- en margecijfers per klant."*
- **De slotregel onder het canvas herhaalt de kern**, want dat is de zin die iemand leest als hij
  twijfelt: *"Een cluster is een bedieningsgemak — het rechtenmodel blijft per tabel, en het
  proefblad noemt de echte tabelnamen."*

## 1.16 Wat je bewust NIET bouwt

Deze zijn afgewogen en afgewezen. Ze weer invoeren maakt het scherm zwaarder zonder dat er om
gevraagd is.

- **Geen vrije plaatsing, geen opgeslagen layout.** Dit is de belangrijkste regel van dit deel:
  **knopen worden deterministisch geplaatst uit de clusterindeling en de rechten; niets wordt
  gesleept, niets wordt opgeslagen.** Zoom en "passend maken" mogen, vrije plaatsing niet. Een
  zijbalk mag als rolkiezer en als clusterlijst-om-naartoe-te-springen, nooit als dropzone; er is
  geen "Module toevoegen". Waarom: een canvas waarop alles overal kan staan heeft geen canonieke
  toestand — je kunt dan nooit zeggen "het scherm is schoon", want een deel kan buiten beeld staan of
  ergens verstopt zijn. Op een beveiligingsscherm is dat een defect. En een sleepgebaar dat iets
  betekent ("op het canvas = toegang") is een gebaar waarvan je nooit zeker weet of je het net
  gedaan hebt — dezelfde reden waarom de standenkiezer geen penseel is. De clusters zelf leven in de
  broncode (functionele opdracht §8.2), niet in een configuratiescherm.
- **Geen 3D, geen WebGL, geen canvas-element.** De verbindingen zijn SVG en de kaarten zijn HTML.
  Een `<canvas>` heeft geen DOM: geen `Tab`, geen focus-ring, geen schermlezer, geen selecteerbare
  tekst — op precies het scherm dat databasetoegang regelt. En het enige dat WebGL kán wat SVG niet
  kan (volumetrisch licht) is exact wat "premium door terughoudendheid" uitsluit.
- **Geen penseel-modus** op de standenkiezer. Zie §1.6.
- **Geen tweede continu bewegend element** naast het signatuurmoment.
- **Geen lijnen tússen clusters.** Verwijzingen tussen clusters staan als **tekst** onder de
  uitgeklapte tabellen (*"Verwijst naar Relaties. Zonder dat cluster blijven het kale id's."*). Een
  lijn tussen twee kaarten suggereert dat toegang zich voortplant, en dat doet ze niet.
- **Geen alarmkleur voor "geen toegang".**
- **Geen icoonlibrary** voor twaalf glyphs.
- **Geen kleur per cluster.** Kleur is van de stand (§1.2).

---

# Deel 2 — Drie layoutvarianten

Alle drie zijn hetzelfde scherm met dezelfde kaarten, menu's, proefblad en woorden uit deel 1. Ze
verschillen in **waar de knopen staan en hoe de verbindingen lopen**. In alle drie geldt:
verbindingskleur = stand (nooit = cluster); de verzegelde kaart hangt aan niets; het proefblad, het
standenmenu en de tabelrij zijn identiek; de layout is deterministisch.

## Variant A — rolknoop met bundels

Referentie: `docs/voorbeelden/mcp-voorbeeld-1.png`.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Connector                                          ┌── infokaart (optioneel) ──┐ │
│  Wat een AI-model via de MCP-server …               └───────────────────────────┘ │
│  ( tabs van de app )                                                              │
│  ROL [● sales ⌄]   RECHTEN KIEZEN [GEEN|LEZEN|SCHRIJVEN]   [Machinerie][Ongedaan][4 wijzigen…] │
│                                                                                   │
│ ┌──── het lichtveld (hoogte 132) ──────────────────────────────────────────────┐  │
│ │                            ◉ rolknoop / bron                                 │  │
│ │                     ╱────╱ │ ╲──╲─────╲                                      │  │
│ │             ●            ●    ○         ○      ← landingspunten              │  │
│ └──────────────────────────────────────────────────────────────────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────                    │
│ ‹│ Relaties.│ │ Contactm…│ │ Projecte…│ │ Boekhoud…│ │ Taken.   ›                 │
│  │ [● SCHR⌄]│ │ [◦ LEZE⌄]│ │ [● SCHR⌄]│ │ [◦ LEZE⌄]│ │ [— GEEN⌄]                  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └────────                    │
│  Een cluster is een bedieningsgemak — …                                            │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Anatomie.** Eén horizontale, schuifbare **kaartenrij** onder een **lichtveld**. Bovenaan het veld
hangt de **rolknoop** (of een kale lichtbron onder het gekozen segment van de standenkiezer); daaruit
waaieren gebogen **bundels** naar beneden, elk naar één kaart, met loodrechte raaklijnen aan beide
uiteinden. De scrollbalk is verborgen; in plaats daarvan een randvervaging alleen aan de kant waar
nog inhoud is, twee ronde pijlknoppen die precies één kolom opschuiven, en pijltjestoetsen als de
rij focus heeft. **Slepen op het lichtveld pant de rij** — daar kan een sleepgebaar nooit met een
knop in de knoop raken (en het verplaatst niets: het schuift alleen het venster).

**Het signatuurmoment:** het licht spreidt zich vanuit de bron naar buiten, en de bundels worden
zichtbaar in de volgorde waarin het licht ze bereikt. Daarna lopen kleine bolletjes over de bundels
van de gekozen focus — het enige continue element.

**Past bij:** een warm, redactioneel designsysteem (serif, papierachtige grond, één merkaccent) met
ruimte voor één signatuurmoment, en een schema met vijf tot twaalf clusters. De minste externe
afhankelijkheden: SVG, HTML, geen bibliotheek.

**Variantspecifiek:** elk getal — veldhoogte, greepfactor, lijndiktes, dekkingen, periode van de
bolletjes, duren — staat in **Bijlage A** en is met de hand afgeregeld. Neem ze letterlijk over. De
Bézier-functies staan kant-en-klaar in `docs/referentie-app/canvas-geometrie.ts`.

## Variant B — radiale graaf

Referentie: `docs/voorbeelden/mcp-voorbeeld-2.png`.

```
┌────────────────────────────────────────────────────┬────────────────────────────┐
│  ROL [sales ⌄]  WEERGAVE [Clusters|Tabellen|Lijst]  │  ● sales                   │
│                                        [− 100% + ⛶] │  5 lezen · 4 schrijven     │
│                                                     │  ──────────────────────── │
│      contactpersonen   klanten   bedrijfstypes      │  Rechten voor dit cluster  │
│              ╲          │          ╱                │  ┌ Projecten. ──────────┐ │
│               ╲  ( Relaties. )  ╱                   │  │ [GEEN|LEZEN|SCHRIJVEN]│ │
│  gesprekken ──( Contactm. )   │   ( Projecten. )── projecten                    │
│  notities ──╱              ╲  │  ╱            ╲── projecttaken                  │
│                         ( ● sales )                │  Tabellen in dit cluster   │
│                        ╱  5L · 4S  ╲               │  projecten     ● Schrijven │
│  werkbonnen ──( Taken. )     │     ( Boekhoud. )── grootboek                    │
│                          ( Facturen. )             │  projecttaken  ◦ Lezen     │
│                         ╱    │    ╲                │  …                         │
│                  facturen  regels  betalingen      │  ⓘ Verwijderen is nooit … │
│  Legenda: ── lezen  ━━ schrijven  ┈┈ geen           │                            │
└────────────────────────────────────────────────────┴────────────────────────────┘
```

**Anatomie.** De **rolknoop** staat centraal. De **clusterknopen** staan in een ring eromheen; de
**tabellen** hangen als bladknopen aan de buitenkant van hun cluster. Rechts een **zijpaneel** dat
voor het geselecteerde cluster de grote standknop toont, de tabelrijen met hun kleine standknoppen
(§1.9) en het kolompaneel. Boven het canvas: zoom-in/uit, een percentage, "passend maken", en een
**weergavewissel** Clusters / Tabellen / Lijst. De lijstweergave is geen luxe: het is de
toegankelijke fallback én het overzicht voor wie snel wil zoeken.

**Plaatsing is deterministisch:** cluster *i* van *n* staat op hoek `i / n × 360°` (te beginnen
bovenaan, met de klok mee, in de volgorde van de clusterindeling in de code), op een vaste straal;
de bladknopen waaieren symmetrisch uit rond de hoek van hun cluster. Geen force-directed layout —
die geeft elke keer een ander beeld. Zoomen en pannen verplaatst het venster, nooit een knoop.

**Verbindingen:** rol → cluster draagt de clusterstand (bij "gedeeltelijk": de dekking van gemengd,
0.55); cluster → tabel draagt de tabelstand. Beide in de lijnstijl van de drieklank. **Let op: in
het referentiebeeld zijn de lijnen per cluster gekleurd en de legenda gebruikt groen en paars. Dat
is fout — één koele tint voor lezen, het accent voor schrijven, gestippeld kleurloos voor geen.**

**Het signatuurmoment:** de ring tekent zich vanuit de rolknoop naar buiten (rol → clusters →
tabellen), in één beweging, ≈850ms.

**Past bij:** een koel, compact designsysteem (sans-display, lichte grijsblauwe grond, een
informatief blauw dat als "lezen" kan dienen) en een schema met veel clusters (acht of meer), waar
een horizontale rij te lang zou worden. Vraagt een zorgvuldige tekstplaatsing rond de bladknopen;
bij meer dan ~40 tabellen toon je de bladknopen alleen voor het geselecteerde cluster.

## Variant C — flow builder

Referentie: `docs/voorbeelden/mcp-voorbeeld-3.png`.

```
┌──────────────────────┬───────────────────────────────────────────────────────────┐
│ Connector            │ [↶ ↷] [− 100% +] [⛶]              [Alle verbindingen tonen] │
│ ROLLEN               │                                                           │
│ ● sales   5L · 4S  ◂ │                  ┌─────────────────────┐                  │
│ ◦ consultant 3L · 1S │                  │ ● sales             │                  │
│ — gast     dicht     │                  │ ROL · 5 LEZEN · 4 SCHRIJVEN │           │
│ [+ Nieuwe rol]       │                  └──────────┬──────────┘                  │
│ ──────────────────── │            ╭─────────╮      │     ╭──────────╮            │
│ CLUSTERS  [zoek…]    │            │         │      │     │          │            │
│ Relaties.        ▸   │   ┌────────┴──┐ ┌────┴─────┴─┐ ┌─┴──────────┐            │
│ Contactmomenten. ▸   │   │ Relaties. │ │ Projecten. │ │ Boekhoud.  │            │
│ Projecten.       ▸   │   │ 3 tabellen│ │ 1 tabel    │ │ 2 tabellen │            │
│ Boekhouding.     ▸   │   │ 2— 1◦ 0●  │ │ 0— 0◦ 1●   │ │ 0— 2◦ 0●   │            │
│ Taken.           ▸   │   │[◐ GEDEELT⌄]│ │[● SCHRIJV⌄]│ │[◦ LEZEN ⌄] │            │
│ ──────────────────── │   └───────────┘ └────────────┘ └────────────┘            │
│ [Machinerie]         │        ┌────────────┐ ┌────────────┐                      │
│ [Ongedaan][4 wijz…]  │        │ Taken.     │ │ Facturen.  │  …                   │
└──────────────────────┴───────────────────────────────────────────────────────────┘
```

**Anatomie.** Links een **zijbalk** met bovenaan de rollenlijst (elke rol met rolmerk en telling;
**Nieuwe rol**, en Hernoemen/Dupliceren/Verwijderen in het contextmenu van een rol) en daaronder de
**clusterlijst met een zoekveld**: klikken op een cluster scrollt en zoomt het canvas naar die
knoop en opent hem. Op het canvas staat de **rolknoop** bovenaan het midden; de **clusterknopen**
staan eronder in rijen (vaste kolombreedte 264px + 24px, zoveel per rij als er passen, in de
volgorde van de clusterindeling), elk met de titel, het aantal tabellen, **drie tellers** `— ◦ ●`
met het aantal tabellen per stand, en de standknop. Een knoop klapt uit naar zijn tabelrijen
(§1.9). De werkbalk boven het canvas: **undo/redo**, zoom-in/uit met percentage, "passend maken",
en een schakelaar "Alle verbindingen tonen" (uit = alleen de verbindingen van de focus op volle
sterkte, precies de standenkiezer uit §1.6 in een andere jas).

**Wat hier uitdrukkelijk níét is:** geen "Module toevoegen", geen dropzone, geen slepen van rollen
of clusters. De zijbalk is navigatie. Undo/redo werkt op de **onbewaarde standwijzigingen** (het is
de "Ongedaan maken"-knop uit §1.6, met een redo erbij), nooit op posities — die bestaan niet.

**Verbindingen:** één per cluster, vanuit de onderrand van de rolknoop naar de bovenrand van de
clusterknoop, als Bézier met loodrechte raaklijnen (dezelfde meetkunde als variant A, bijlage A
§6.1). Kleur en lijnstijl = stand. **Let op: in het referentiebeeld zijn de lijnen gekleurd naar het
icoon van het cluster (groen, rood, blauw, grijs, teal). Dat is fout — de drieklank geldt.** De
tellers in de knoop zijn wél terecht: `2 —  1 ◦  0 ●` leest in één blik wat "gedeeltelijk" betekent.

**Het signatuurmoment:** de verbindingen tekenen zich vanuit de rolknoop naar beneden (stroke-dash
van 0 naar volle lengte, ≈850ms, gestaffeld per kolom).

**Past bij:** een app die al een node/graaf-bibliotheek, een zoombaar canvas of vergelijkbare
primitives heeft (en dus zoom/fit en toetsenbordnavigatie over knopen gratis krijgt), een neutraal
tot koel designsysteem, en beheerders die het patroon "builder" al kennen uit andere schermen van
de app. Gebruik je zo'n bibliotheek, zet dan haar drag-and-drop **uit** en verifieer dat een
`dragend` geen positie opslaat.

---

# Deel 3 — Keuzeprocedure

Je kiest de variant in **Fase 0** van de functionele opdracht, samen met de inventarisatie van
tokens en bouwstenen. Weeg in deze volgorde:

1. **Designtokens en palet.** Warm, serif, papier → variant A. Koel, sans, compact → variant B of C.
   Is er geen koele tint voor "lezen" beschikbaar, kies er dan één uit de statuskleuren van het
   systeem en meld dat.
2. **Bestaande primitives.** Is er al een dialoog, een segmented control en een popover/portal? Dan
   kan elke variant. Is er al een graaf- of canvasbibliotheek in gebruik? Dan is C (of B) de
   natuurlijke keuze — mits slepen uitgezet kan worden. Is er niets van dat alles: A, want die vraagt
   het minst.
3. **Schermruimte en aantal clusters.** Tot twaalf clusters: elke variant. Meer dan twaalf, of veel
   tabellen per cluster: B of C, want een horizontale rij wordt dan een lange wandeling.
4. **Toegankelijkheid.** B en C hebben de lijstweergave als volwaardig alternatief nodig; A moet met
   de pijltjestoetsen door de rij kunnen. Kun je een van die eisen in deze codebase niet waarmaken,
   dan valt die variant af.

**Leg de keuze voor aan de eigenaar vóór je bouwt**, in één zin met de motivatie, met het
referentiebeeld erbij: *"Ik stel variant B voor, omdat het designsysteem koel en compact is en het
schema elf clusters telt."* Bij twijfel: **variant A** — de minste afhankelijkheden en het meest
uitgewerkt (bijlage A).

Daarna bouw je met de tokens van de codebase. Je introduceert geen palet, geen tweede accent en geen
nieuwe primitives als er al een geschikte bestaat.

---

# Deel 4 — Voor je oplevert

- [ ] De drieklank klopt: kleurloos · koel · warm, elk met eigen lijnstijl én eigen teken.
- [ ] **Verbindingskleur = stand**, nooit = cluster (ook al doen twee referentiebeelden het anders).
- [ ] Het scherm is leesbaar in grijstinten (echt getest, niet aangenomen).
- [ ] Het accent komt alleen voor bij: schrijven, onbewaarde wijziging, publiceerknop, focus.
- [ ] **De layout is deterministisch**: twee keer laden met dezelfde rechten geeft hetzelfde beeld.
- [ ] **Niets wordt opgeslagen** behalve rechten: geen posities, geen zoomstand, geen volgorde.
- [ ] Niets is te slepen; een eventuele graafbibliotheek heeft drag-and-drop uit.
- [ ] De verbindingen vertrekken en landen loodrecht, en volgen het venster bij schuiven of zoomen.
- [ ] Bij `prefers-reduced-motion` staat het volledige canvas er meteen, zonder beweging.
- [ ] Elke standkeuze toont zijn uitlegzin vóór je klikt, en elke geblokkeerde keuze toont zijn reden.
- [ ] De verzegelde kaart hangt aan geen enkele verbinding.
- [ ] Het proefblad groepeert per cluster en noemt de echte tabelnamen, openingen bovenaan.
- [ ] Onbewaarde wijzigingen waarschuwen bij het verlaten van de pagina én bij rolwissel.
- [ ] Het hele scherm is met het toetsenbord te bedienen, inclusief het canvas (en in B/C: de
      lijstweergave als alternatief).
- [ ] De gekozen variant is voorgelegd en bevestigd, met de motivatie erbij.
- [ ] Koos je variant A: geen enkel getal uit bijlage A is "ongeveer" overgenomen zonder reden.

---

# Bijlage A — De lichtwaaier van variant A, getal voor getal

Dit is het ene element waar variant A om onthouden wordt. Bouw het precies zoals hieronder; **elk
getal is met de hand afgeregeld** en de meeste hebben een reden. De Bézier-functies (`bundelPad`,
`puntOpBundel`, `bolletjeFase`) staan kant-en-klaar in `docs/referentie-app/canvas-geometrie.ts`.

## A.1 Het lichtveld

Een strook van **132px hoog** over de volle breedte van de contentkolom, tussen de balk en de
kaarten. Daarin:

- een **radiale waas** achter de bron: 224px doorsnede, ~24px boven de veldrand, gecentreerd op de
  bron-x, met de kleur van de gekozen stand op `--connector-bron` sterkte;
- een **vervagend hulpraster** over het hele canvas op ~60% dekking — datzelfde raster dat je
  systeem elders decoratief gebruikt. Het geeft het canvas een bodem zonder een tweede
  achtergrondtoon te introduceren;
- de **SVG met de bundels** (A.3).

Het veld is leeg oppervlak, en dat is functioneel: **slepen op het lichtveld pant de kaartenrij.**
Daar kan een sleepgebaar nooit met een knop in de knoop raken.

## A.2 De kaartenrij

Horizontaal scrollende rij, kaarten van **264px** breed met **24px** ertussen, uitgelijnd op
`align-items: start` (kaarten met uitgeklapte tabellen groeien naar beneden, niet naar het midden).

De scrollbalk is verborgen. In plaats daarvan:

- een **maskering** aan de randen: een `linear-gradient` die de eerste en laatste 3rem laat vervagen
  — maar **alleen aan de kant waar nog inhoud is**. Staat de rij helemaal links, dan vervaagt links
  niets. Zo is de vervaging een *aanwijzing* dat er meer is, niet een decoratie;
- twee **ronde pijlknoppen** (36px) die halverwege de kaarthoogte zweven, óók alleen aan de kant waar
  nog inhoud is. Ze schuiven precies één kolom op (264 + 24 = 288px), met `behavior: "smooth"`;
- **pijltjestoetsen** doen hetzelfde wanneer de rij focus heeft. De rij is één tabstop met
  `role="group"` en een `aria-label` die dat uitlegt.

## A.3 De lichtwaaier

### A.3.1 De meetkunde

Alles rekent in **overlay-coördinaten**: `(0,0)` is de linkerbovenhoek van het lichtveld, en `x`
loopt mee met het **venster** — niet met de geschoven kaartenrij.

```
VELD_HOOGTE = 132        hoogte van de strook
BRON_Y      = 8          de bron hangt net onder de standenkiezer
LANDING_Y   = 127        (VELD_HOOGTE − 5)
```

De landing zit vijf pixels bóven de onderrand, zodat het aanknopingspunt volledig in beeld staat en
niet door de SVG-rand wordt doorgesneden. Visueel raakt het precies de bovenkant van de kaart.

Per cluster één **kubische Bézier** van de bron naar de landing, met **loodrechte raaklijnen aan
beide uiteinden**:

```
greep = max(28, (y1 − y0) × 0.62)

p0 = (x0, y0)
p1 = (x0, y0 + greep)      ← verticaal omlaag uit de bron
p2 = (x1, y1 − greep)      ← verticaal omhoog vanuit de kaart
p3 = (x1, y1)

d = `M x0 y0 C p1x p1y, p2x p2y, p3x p3y`
```

**Waarom loodrecht aan beide kanten:** daardoor bundelen de lijnen samen bij de bron (één
herkenbare oorsprong, geen spinnenweb) en staan ze recht op de kaart, hoe ver die ook naar links of
rechts ligt. Dat is het verschil tussen "licht dat ergens vandaan komt" en "lijnen die naar elkaar
wijzen".

**De greepfactor 0.62 is afgeregeld, niet gekozen.** Korter en de bocht knikt; langer en verre
clusters krijgen een slappe buik die onder de kaarten door lijkt te zakken. De ondergrens van 28px
voorkomt dat een kaart recht onder de bron een rechte streep wordt.

### A.3.2 Hoe een bundel eruitziet

Per bundel bepaal je één **kleursleutel** uit de standen die in dat cluster voorkomen: staat er
ergens `schrijven`, dan schrijven; anders `lezen` als dat voorkomt; anders `geen`. Een cluster met
méér dan één stand heet **gemengd**.

| | Geen (en niet gemengd) | Lezen | Schrijven |
|---|---|---|---|
| Lijndikte | 1 | 1.5 | 2 |
| Lijnstijl | `stroke-dasharray: 2 6` | vol | vol |
| Basisdekking | 0.34 | 0.9 | 0.9 |
| Extra | — | — | een tweede pad eronder: dikte 7, dekking 0.14 |

Een **gemengde** bundel krijgt basisdekking 0.55 — zichtbaar aanwezig, maar niet zo stellig als een
cluster dat één ding is.

De **gloed onder een schrijfbundel** is er om één reden: het is de enige stand waarbij er iets de
database ín kan, en dat mag je zien.

**Het landingspunt** is een cirkel van r=3.5 op de kaart, met een rand van 1.5. Bij een gemengd
cluster is hij **hol** (gevuld met de oppervlaktekleur): half beloofd, half niet.

**De bron** bestaat uit twee cirkels op dezelfde plek: r=13 op 10% dekking (de halo) en r=4 vol (het
punt). Beide dragen de kleur van de gekozen stand, met een kleurtransitie van 250ms.

### A.3.3 De focus — en waarom het géén penseel is

De standenkiezer bepaalt welke bundels **op volle sterkte** staan. Alle andere zakken naar **18%**
van hun basisdekking, met een overgang van 400ms.

> **Waarom geen penseel?** Een eerdere versie liet je bovenaan een stand "oppakken" en die daarna op
> clusters aanbrengen. Dat werkt sneller, maar een schakelaar die tegelijk **filtert én toekent** is
> een schakelaar waarvan je nooit zeker weet wat je zojuist gedaan hebt — en dit is het scherm waar
> dat het meest kost. **Wijzigen gebeurt op de kaart zelf.** De kiezer bovenaan doet één ding: hij
> richt je aandacht.

Bij focus **Geen** lichten de dichte bundels wél op, maar er loopt niets overheen (zie A.3.4). Er
stroomt immers niets.

### A.3.4 De lopende bolletjes

Over elke bundel die de gekozen stand bevat, loopt een klein bolletje in de kleur van die stand:
r=3.5 bij schrijven, r=3 bij lezen. **Nooit bij "geen"** — een bolletje op een dichte lijn zou liegen
over wat er gebeurt.

```
PERIODE = 5.2 s per rondje          ← traag is de bedoeling
fase(i) = (i × 0.6180339887) mod 1  ← het gulden getal
vervagen: t < 0.10  → t / 0.10
          t > 0.88  → (1 − t) / 0.12
          anders    → 1
```

**De gulden fase in plaats van willekeur:** zonder faseverschuiving lopen alle bolletjes in gelid en
leest de waaier als een metronoom. Met een irrationele stap spreiden ze zich zonder ooit te
hergroeperen. **Geen `Math.random()`** — dezelfde kaart moet er bij elke render hetzelfde uitzien.

**Het uitdoven aan de uiteinden** zorgt dat een bolletje niet uit het niets bij de bron verschijnt en
niet abrupt in de kaart verdwijnt.

**Zet de bolletjes per frame met de hand op hun plek** (bereken het punt op de Bézier en zet
`cx`/`cy`), in plaats van met een pad-volgende animatie. Zo'n animatie herstart namelijk bij elke
padwijziging — en het pad wijzigt bij élke pixel die de kaartenrij opschuift. Laat de animatielus de
laatste stand uit een referentie lezen, niet uit de closure, anders start hij opnieuw bij elke
scrollpixel.

### A.3.5 De entree: het licht spreidt zich

Bij binnenkomst tekenen de bundels zich **niet** los van elkaar. Er is één gebaar: een SVG-masker
met een cirkel op de bron, waarvan de straal van 0 naar 2400px groeit in **0.85s** met de zachte
huiscurve en **120ms** vertraging.

Het licht spreidt zich dus vanuit de bron naar buiten, en de bundels worden zichtbaar in de volgorde
waarin het licht ze bereikt: eerst de clusters dicht bij de bron, dan de verre. Eén oorsprong, één
beweging.

> Zet de straal **óók als attribuut** in de opmaak, niet alleen in CSS. Kent een browser `r` niet
> als animeerbare CSS-eigenschap, dan blijft die waarde staan en is de waaier gewoon meteen
> zichtbaar — nooit onzichtbaar. Bij `prefers-reduced-motion` doet de blanket-regel hetzelfde: de
> eindstaat staat er direct.

De bron zelf ligt **buiten** het masker: het licht komt daar vandaan, dus dat punt is er als eerste.

### A.3.6 De bron glijdt, hij springt niet

Wissel je van stand, dan verplaatst de bron zich naar het midden van het gekozen segment — in
**320ms**, met een cubic ease-out (`1 − (1 − t)³`, dat benadert de huiscurve). Alle bundels zwenken
mee, omdat hun startpunt meebeweegt. (Kies je de rolknoop als vaste bron in plaats van een
glijdend punt onder de standenkiezer, dan vervalt deze paragraaf; de bron verkleurt dan alleen.)

Twee details die het verschil maken tussen elegant en rommelig:

- **De eerste meting is geen beweging maar een beginstand.** Bij het opstarten moet de bron meteen
  op zijn plaats staan; hem van links laten aanschuiven ziet er goedkoop uit.
- **Onderbreek je een lopende tween, dan vertrek je vanaf de huidige positie**, niet vanaf de vorige
  eindwaarde. Anders schokt de bron bij snel klikken.

### A.3.7 De waaier volgt het venster, niet de inhoud

Dit is de subtielste eigenschap van het scherm, en de reden dat het levend aanvoelt:

**De bron hangt aan het venster. De landingen hangen aan de kaarten.** Schuif je de kaartenrij
horizontaal, dan blijft de bron staan en **zwenken de bundels mee** — als schijnwerpers die een
optocht volgen. Meet daarvoor bij elke scroll opnieuw (via `requestAnimationFrame`, niet per
scroll-event) waar het midden van elke kaart zich bevindt ten opzichte van het veld.

## A.4 Motion-inventaris van variant A

Alles wat beweegt, en niets anders:

| Wat | Duur | Curve | Wanneer |
|---|---|---|---|
| Het licht spreidt zich vanuit de bron | 850ms, 120ms vertraging | zachte huiscurve | bij binnenkomst, eenmalig |
| Kaarten komen op (fade + 0.6rem omhoog) | 500ms, start 240ms, **55ms per kaart** | zachte huiscurve | bij binnenkomst |
| De bron glijdt naar het gekozen segment | 320ms | cubic ease-out | bij standwissel |
| Bundels dimmen / lichten op | 400ms | zachte huiscurve | bij standwissel |
| De bron verkleurt | 250ms | zachte huiscurve | bij standwissel |
| De bolletjes lopen | 5.2s per rondje | lineair | continu, alleen op de bundels van de focus |
| Kaartrand kleurt bij een wijziging | jouw basisduur | zachte huiscurve | bij elke mutatie |
| Het accentstreepje verschijnt | 350ms | zachte huiscurve | bij elke mutatie |
| Het drijvende menu | 200ms | zachte huiscurve | bij openen |
| Tabellen/kolommen klappen uit | 280–300ms | zachte huiscurve | bij uitklappen |
| De actieve pill in de standenkiezer | veer | — | bij standwissel |

**Wat er níét beweegt:** geen zwevende deeltjes, geen glinsterende randen, geen tilt, geen parallax,
geen hover-animatie op de kaarten behalve de kleurovergang. De bolletjes zijn het enige continue
element op het scherm — geef er geen tweede naast, want dan verliezen ze hun betekenis.
