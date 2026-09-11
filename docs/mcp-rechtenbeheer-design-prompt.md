# Ontwerpopdracht — het rechtenscherm als connector-canvas

> **Hoe je dit gebruikt:** dit document hoort bij `mcp-rechtenbeheer-prompt.md` (de
> functionele opdracht) en beschrijft **hoe het beheerscherm eruitziet en aanvoelt**. Plak ze
> samen in dezelfde sessie. De functionele prompt bepaalt *wat* er gebeurt en wat er
> veiligheidshalve niet mag; dit document bepaalt *hoe het eruitziet*. Waar ze elkaar
> tegenspreken, wint de functionele prompt — beveiliging gaat vóór vorm.
>
> **Referentiebeeld:** `docs/Voorbeeld_MCP_Design.png`. Dat is een schermafdruk van het
> werkende scherm. Elk getal in dit document komt uit die implementatie en is met de hand
> afgeregeld; neem ze letterlijk over tenzij je designsysteem iets anders eist.

---

## 0. Wat je maakt

Eén scherm waarop een beheerder per **rol** instelt wat een AI-model via de MCP-server in de
database mag zien en wijzigen. Drie standen per tabel: **geen toegang · lezen · schrijven**.
De bediening gaat per **cluster** (een groep tabellen met een naam die de gebruiker herkent —
"Relaties", "Boekhouding"), de opslag blijft per tabel.

Het scherm heet **Connector**. Niet "Rechten", niet "Permissies", niet "ACL" — het is de
stekker tussen een taalmodel en je database, en dat woord doet twee dingen tegelijk: het
zegt wat het is, en het herinnert eraan dat je hem ook kunt uittrekken.

> **Woordenlijst-brug.** De functionele prompt noemt dit scherm "de atlas" en de klikeenheid
> "een tegel"; dit document noemt ze **het canvas** en **een clusterkaart**. Dat is hetzelfde
> ding — de functionele prompt is bewust vormgeving-neutraal geschreven. Waar dit document
> concreet wordt, wint het voor de vorm; waar het over rechten en veiligheid gaat, wint de
> functionele prompt altijd.

**Wat je op het referentiebeeld ziet, van boven naar beneden:**

1. Een serif-kop **Connector** met daaronder één zin die het scherm verklaart.
2. De drie instellingen-tabs (Gebruikers · Connector · Facturatie) als pill-schakelaar.
3. Links de **rolkiezer** ("sales · 5 lezen · 4 schrijven"), ernaast de **standenkiezer**
   ("Rechten kiezen: Geen / Lezen / Schrijven").
4. Rechts daaronder drie knoppen: **Machinerie**, **Ongedaan maken**, **4 wijzigen…**
   (die laatste in accent — dat is de publiceerknop).
5. Daaronder **het lichtveld**: één lichtbron vlak onder de standenkiezer, waaruit gebogen
   bundels naar beneden waaieren, elk naar één clusterkaart.
6. Daaronder de **kaartenrij**, horizontaal schuifbaar, met ronde pijlknoppen links en rechts.

---

## 1. De these

**Dit scherm gaat niet over een formulier met instellingen. Het gaat over wat er dicht is en
wat er open staat, en dat moet je van over de kamer kunnen aflezen.**

Daaruit volgt de hele opzet: **de bundel ís de stand.** Je leest de rechten van een rol af aan
het licht voordat je één woord gelezen hebt. Vijf oranje bundels tussen negen bleke = deze rol
kan op vijf plekken schrijven, en dat zie je vanuit je ooghoek.

Alles wat daar niet aan bijdraagt, gaat eruit. Dat is streng bedoeld: dit is een scherm dat
iemand een paar keer per jaar opent om een beslissing te nemen die hij niet mag verprutsen.

---

## 2. De drieklank: rust · koel · warm

De drie standen krijgen elk een eigen plek in het palet, en die keuze is niet cosmetisch.

| Stand | Kleur | Waarom |
|---|---|---|
| **Geen toegang** | Kleurloos: de sterke randkleur van je systeem. Gestippelde lijn, gestippelde rand. | Bewust **géén alarmkleur**. Gesloten is de gezónde toestand. Zou je hier rood gebruiken, dan schreeuwt een correct geconfigureerd systeem je toe dat er iets mis is — en leert de beheerder de kleur negeren, precies wanneer ze wél iets zou moeten betekenen. |
| **Lezen** | Eén koele tint (in het referentiebeeld een rustig blauw). Dunne volle lijn. | Aanwezig maar terughoudend: kijken, niet aanraken. Dit is de énige koele kleur op het scherm — daardoor leest ze meteen als "een andere soort toegang". |
| **Schrijven** | Het merkaccent, met een zachte gloed op de bundel. | Op de kaarten en bundels is dit de **enige** plek waar het accent verschijnt. Dat is geen toeval maar de hele redenering: als schrijfrechten zeldzaam horen te zijn, blijft het accent vanzelf zeldzaam — en valt elke schrijfbundel onmiddellijk op tussen tien rustige. |

**Nooit kleur alleen.** Elke stand draagt daarnaast:

- **een eigen lijnstijl**: gestippeld (geen) · dun vol (lezen) · dik vol + gloed (schrijven);
- **een eigen teken**: `—` · `◦` · `●`, en `◐` voor de aflezende stand "gedeeltelijk";
- **een eigen woord**, altijd voluit: Geen toegang · Lezen · Schrijven.

Het scherm moet volledig leesbaar zijn in grijstinten. Test dat ook echt: zet een
grijsfilter over de schermafdruk en kijk of je nog kunt zeggen welke clusters openstaan.

---

## 3. Palet en tokens

Dit document schrijft **geen** kleurwaarden voor. Je gebruikt de tokens van de codebase waarin
je werkt (kleur, radius, schaduw, easing, duur) en introduceert geen nieuw palet. Wat je wél
nodig hebt, uitgedrukt in rollen:

| Rol | Waarvoor |
|---|---|
| `bg` — de paginagrond | de grond onder het canvas |
| `surface` — het lichtste vlak | de clusterkaarten en de drijvende menu's |
| `paper` — een warm tussenvlak | hover-toestanden, uitgeklapte kolompanelen |
| `ink` / `ink-muted` | titels versus uitleg en tabelnamen |
| `border` / `border-strong` | haarlijnen; `border-strong` is óók de kleur van "geen toegang" |
| `accent` (+ een zachte accent-wash) | uitsluitend: schrijven, onbewaarde wijziging, publiceerknop, focus-ring |
| één koele statuskleur | uitsluitend: lezen |

**Eén afregelknop voor het lichtbudget.** Definieer één token voor de sterkte van de
lichtbron, bijvoorbeeld:

```css
--connector-bron: 8%;   /* hoe sterk de waas onder de standenkiezer gloeit */
```

De **tint** van die waas komt van de gekozen stand, niet van dit token — een blauwe stip met
een oranje waas eronder klopt niet. Vindt iemand het scherm te warm, dan draai je dit ene
getal terug en klopt het overal.

**Accent als vlák is verboden**; als bron van licht klopt het. Bij 8% blijft het ruim onder de
gebruikelijke "accent < 5% van het scherm"-grens.

**Heeft de codebase geen warm palet?** Vertaal dan de *rollen*, niet de kleuren: de grond mag
koel zijn, zolang "geen toegang" kleurloos blijft, "lezen" één koele tint krijgt en "schrijven"
het merkaccent. Verzin geen tweede accent.

---

## 4. Typografie

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

**De punt achter de clustertitel is merkgrammatica en geen typefout.** "Relaties." leest als
een uitspraak, "Relaties" als een label. Dat verschil is precies wat de kaart van een
instellingenrij onderscheidt. Houd het consequent: elke clustertitel eindigt op een punt.

**De vuistregel voor mono versus sans:** mono is voor alles wat *letterlijk uit de database*
komt of een *stand* aanduidt. Sans is voor alles wat je in gewone taal tegen een mens zegt.
Serif is alleen voor namen van dingen. Loopt een tabelnaam in sans, dan lijkt het een woord;
loopt uitleg in mono, dan lijkt het een foutmelding.

---

## 5. De anatomie van het scherm

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  INSTELLINGEN                                                                    │  eyebrow, mono
│  Connector                                                                       │  serif display
│  Wat een AI-model via de MCP-server in deze database mag zien en wijzigen.       │  sans, max ~2 regels
│  Per rol, per cluster, per tabel — en verwijderen kan nooit.                     │
│                                                                                  │
│  ( GEBRUIKERS │ CONNECTOR │ FACTURATIE )                                         │  pill-tabs
│                                                                                  │
│  ROL                        RECHTEN KIEZEN                                       │  mono eyebrows
│  ┌───────────────────┐      ┌──────────────────────────────┐                     │
│  │ ● sales        ⌄  │      │  GEEN   LEZEN  [ SCHRIJVEN ] │                     │  glijdende pill
│  │   5 LEZEN · 4 SCHR│      └──────────────────────────────┘                     │
│  └───────────────────┘                                                           │
│                                    ┌─────────────┐┌───────────────┐┌───────────┐ │
│                                    │ ⚙ MACHINERIE││Ongedaan maken ││4 wijzigen…│ │  rechts uitgelijnd
│                                    └─────────────┘└───────────────┘└───────────┘ │
│                                                          ▲ secundair    ▲ accent │
│ ┌──── HET LICHTVELD (hoogte 132) ───────────────────────────────────────────────┐│
│ │                              ◉  ← de bron, onder het gekozen segment          ││
│ │                            ╱ │ ╲╲                                             ││
│ │                      ╱────╱  │  ╲──╲───────╲                                  ││
│ │              ╱──────╱        │      ╲        ╲──────────                       ││
│ │            ●                 ●       ○         ○            ← landingspunten  ││
│ └───────────────────────────────────────────────────────────────────────────────┘│
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────    │
│ ‹│ ◉  Relaties.│ │ ◉ Contactmo…│ │ ◉ Projecten.│ │ ◉ Boekhoud… │ │ ◉ Eigen fa…  ›│
│  │ uitleg…     │ │ uitleg…     │ │ uitleg…     │ │ uitleg…     │ │ uitleg…       │
│  │ [● SCHRIJVEN⌄]│ │[◦ LEZEN  ⌄]│ │[● SCHRIJVEN⌄]│ │[◦ LEZEN ⌄] │ │[— GEEN    ⌄] │
│  │  3 TABELLEN ⌄│ │ 1 TABEL   ⌄ │ │ 1 TABEL   ⌄ │ │ 2 TABELLEN⌄│ │ 3 TABELLEN ⌄ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └───────────    │
│                                                                                  │
│  Een cluster is een bedieningsgemak — het rechtenmodel blijft per tabel, en het   │  slotregel, klein
│  proefblad noemt de echte tabelnamen. …                                          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 De kop

Eyebrow in mono, titel in serif-display, en één omschrijving van maximaal twee regels die het
scherm in gewone taal verklaart. Gebruik letterlijk deze strekking:

> *"Wat een AI-model via de MCP-server in deze database mag zien en wijzigen. Per rol, per
> cluster, per tabel — en verwijderen kan nooit."*

Die laatste bijzin doet werk: hij neemt de grootste angst weg vóór iemand één knop aanraakt.

### 5.2 De bedieningsbalk

Eén rij, `align-items: end`, met ruime horizontale tussenruimte (≈32px) en wrap op smal.

**Links — de rolkiezer.** Een knop van 44px hoog en ~256px breed: een rond **rolmerk**, de
rolnaam, en daaronder in mono de telling. Klikken opent een drijvend menu met alle rollen, en
onderaan de acties **Hernoemen · Dupliceren · Verwijderen** plus **Nieuwe rol**.

Het rolmerk is 28px rond en draagt het teken van de rúímste stand die de rol ergens heeft:
`●` in accent-wash als hij ergens mag schrijven, `◦` in de koele tint als hij alleen leest,
`—` met gestippelde rand als hij volledig dicht staat. Zo zie je in de kiezer al welke rol
gevaarlijk is voordat je hem opent.

De telling eronder: `5 LEZEN · 4 SCHRIJVEN`, of `VOLLEDIG DICHT` als er niets openstaat.

> **Er is geen apart rollenoverzicht.** Je wisselt van rol op dezelfde plek waar je hem
> aanmaakt, hernoemt, dupliceert en verwijdert — en je blijft ondertussen naar het canvas
> kijken. Dat scheelt een heel scherm en een navigatiestap. **Dupliceren staat er bewust
> tussen:** het is de snelste weg naar een variant, en het voorkomt dat iemand uit gemak een
> te ruime bestaande rol hergebruikt.

**Midden — de standenkiezer.** Een gesegmenteerde schakelaar met drie segmenten
(Geen · Lezen · Schrijven) en een **glijdende** actieve pill. Eyebrow erboven: `RECHTEN KIEZEN`.

> ⚠ **Dit is een FOCUS, geen penseel.** Zie §6.3. Deze keuze bepaalt welke bundels oplichten,
> niet wat er verandert.

**Rechts — drie knoppen**, in deze volgorde:

1. **Machinerie** — een schakelknop (`aria-pressed`) met een klein tandwiel/schuifjes-icoon.
   Zet de technische tabellen en de verzegelde kaart erbij. Standaard **uit**.
2. **Ongedaan maken** — secundair, uitgeschakeld als er niets gewijzigd is.
3. **De publiceerknop** — accent. Het label telt mee: `4 wijzigen…` bij vier onbewaarde
   wijzigingen, en `Opslaan` (uitgeschakeld) als er niets te doen is. De drie puntjes beloven
   dat er nog een bevestiging komt; die belofte moet je waarmaken (§9).

### 5.3 Het lichtveld

Een strook van **132px hoog** over de volle breedte van de contentkolom, tussen de balk en de
kaarten. Daarin:

- een **radiale waas** achter de bron: 224px doorsnede, ~24px boven de veldrand, gecentreerd
  op de bron-x, met de kleur van de gekozen stand op `--connector-bron` sterkte;
- een **vervagend hulpraster** over het hele canvas op ~60% dekking — datzelfde raster dat je
  systeem elders decoratief gebruikt. Het geeft het canvas een bodem zonder een tweede
  achtergrondtoon te introduceren;
- de **SVG met de bundels** (§6).

Het veld is leeg oppervlak, en dat is functioneel: **slepen op het lichtveld pant de
kaartenrij.** Daar kan een sleepgebaar nooit met een knop in de knoop raken.

### 5.4 De kaartenrij

Horizontaal scrollende rij, kaarten van **264px** breed met **24px** ertussen, uitgelijnd op
`align-items: start` (kaarten met uitgeklapte tabellen groeien naar beneden, niet naar het
midden).

De scrollbalk is verborgen. In plaats daarvan:

- een **maskering** aan de randen: een `linear-gradient` die de eerste en laatste 3rem laat
  vervagen — maar **alleen aan de kant waar nog inhoud is**. Staat de rij helemaal links, dan
  vervaagt links niets. Zo is de vervaging een *aanwijzing* dat er meer is, niet een decoratie;
- twee **ronde pijlknoppen** (36px) die halverwege de kaarthoogte zweven, óók alleen aan de
  kant waar nog inhoud is. Ze schuiven precies één kolom op (264 + 24 = 288px), met
  `behavior: "smooth"`;
- **pijltjestoetsen** doen hetzelfde wanneer de rij focus heeft. De rij is één tabstop met
  `role="group"` en een `aria-label` die dat uitlegt.

---

## 6. De lichtwaaier — de signatuur

Dit is het ene element waar het scherm om onthouden wordt. Bouw het precies zoals hieronder;
elk getal is met de hand afgeregeld en de meeste hebben een reden.

### 6.1 De meetkunde

Alles rekent in **overlay-coördinaten**: `(0,0)` is de linkerbovenhoek van het lichtveld, en
`x` loopt mee met het **venster** — niet met de geschoven kaartenrij.

```
VELD_HOOGTE = 132        hoogte van de strook
BRON_Y      = 8          de bron hangt net onder de standenkiezer
LANDING_Y   = 127        (VELD_HOOGTE − 5)
```

De landing zit vijf pixels bóven de onderrand, zodat het aanknopingspunt volledig in beeld
staat en niet door de SVG-rand wordt doorgesneden. Visueel raakt het precies de bovenkant van
de kaart.

Per cluster één **kubische Bézier** van de bron naar de landing, met **loodrechte raaklijnen
aan beide uiteinden**:

```
greep = max(28, (y1 − y0) × 0.62)

p0 = (x0, y0)
p1 = (x0, y0 + greep)      ← verticaal omlaag uit de bron
p2 = (x1, y1 − greep)      ← verticaal omhoog vanuit de kaart
p3 = (x1, y1)

d = `M x0 y0 C p1x p1y, p2x p2y, p3x p3y`
```

**Waarom loodrecht aan beide kanten:** daardoor bundelen de lijnen samen bij de bron (één
herkenbare oorsprong, geen spinnenweb) en staan ze recht op de kaart, hoe ver die ook naar
links of rechts ligt. Dat is het verschil tussen "licht dat ergens vandaan komt" en "lijnen die
naar elkaar wijzen".

**De greepfactor 0.62 is afgeregeld, niet gekozen.** Korter en de bocht knikt; langer en verre
clusters krijgen een slappe buik die onder de kaarten door lijkt te zakken. De ondergrens van
28px voorkomt dat een kaart recht onder de bron een rechte streep wordt.

### 6.2 Hoe een bundel eruitziet

Per bundel bepaal je één **kleursleutel** uit de standen die in dat cluster voorkomen: staat er
ergens `schrijven`, dan schrijven; anders `lezen` als dat voorkomt; anders `geen`. Een cluster
met méér dan één stand heet **gemengd**.

| | Geen (en niet gemengd) | Lezen | Schrijven |
|---|---|---|---|
| Lijndikte | 1 | 1.5 | 2 |
| Lijnstijl | `stroke-dasharray: 2 6` | vol | vol |
| Basisdekking | 0.34 | 0.9 | 0.9 |
| Extra | — | — | een tweede pad eronder: dikte 7, dekking 0.14 |

Een **gemengde** bundel krijgt basisdekking 0.55 — zichtbaar aanwezig, maar niet zo stellig als
een cluster dat één ding is.

De **gloed onder een schrijfbundel** is er om één reden: het is de enige stand waarbij er iets
de database ín kan, en dat mag je zien.

**Het landingspunt** is een cirkel van r=3.5 op de kaart, met een rand van 1.5. Bij een gemengd
cluster is hij **hol** (gevuld met de oppervlaktekleur): half beloofd, half niet.

**De bron** bestaat uit twee cirkels op dezelfde plek: r=13 op 10% dekking (de halo) en r=4 vol
(het punt). Beide dragen de kleur van de gekozen stand, met een kleurtransitie van 250ms.

### 6.3 De focus — en waarom het géén penseel is

De standenkiezer bepaalt welke bundels **op volle sterkte** staan. Alle andere zakken naar
**18%** van hun basisdekking, met een overgang van 400ms.

> **Waarom geen penseel?** Een eerdere versie liet je bovenaan een stand "oppakken" en die
> daarna op clusters aanbrengen. Dat werkt sneller, maar een schakelaar die tegelijk **filtert
> én toekent** is een schakelaar waarvan je nooit zeker weet wat je zojuist gedaan hebt — en dit
> is het scherm waar dat het meest kost. **Wijzigen gebeurt op de kaart zelf.** De kiezer
> bovenaan doet één ding: hij richt je aandacht.

Bij focus **Geen** lichten de dichte bundels wél op, maar er loopt niets overheen (zie 6.4).
Er stroomt immers niets.

### 6.4 De lopende bolletjes

Over elke bundel die de gekozen stand bevat, loopt een klein bolletje in de kleur van die
stand: r=3.5 bij schrijven, r=3 bij lezen. **Nooit bij "geen"** — een bolletje op een dichte
lijn zou liegen over wat er gebeurt.

```
PERIODE = 5.2 s per rondje          ← traag is de bedoeling
fase(i) = (i × 0.6180339887) mod 1  ← het gulden getal
vervagen: t < 0.10  → t / 0.10
          t > 0.88  → (1 − t) / 0.12
          anders    → 1
```

**De gulden fase in plaats van willekeur:** zonder faseverschuiving lopen alle bolletjes in
gelid en leest de waaier als een metronoom. Met een irrationele stap spreiden ze zich zonder
ooit te hergroeperen. **Geen `Math.random()`** — dezelfde kaart moet er bij elke render
hetzelfde uitzien.

**Het uitdoven aan de uiteinden** zorgt dat een bolletje niet uit het niets bij de bron
verschijnt en niet abrupt in de kaart verdwijnt.

**Zet de bolletjes per frame met de hand op hun plek** (bereken het punt op de Bézier en zet
`cx`/`cy`), in plaats van met een pad-volgende animatie. Zo'n animatie herstart namelijk bij
elke padwijziging — en het pad wijzigt bij élke pixel die de kaartenrij opschuift. Laat de
animatielus de laatste stand uit een referentie lezen, niet uit de closure, anders start hij
opnieuw bij elke scrollpixel.

### 6.5 De entree: het licht spreidt zich

Bij binnenkomst tekenen de bundels zich **niet** los van elkaar. Er is één gebaar: een
SVG-masker met een cirkel op de bron, waarvan de straal van 0 naar 2400px groeit in **0.85s**
met de zachte huiscurve en **120ms** vertraging.

Het licht spreidt zich dus vanuit de bron naar buiten, en de bundels worden zichtbaar in de
volgorde waarin het licht ze bereikt: eerst de clusters dicht bij de bron, dan de verre. Eén
oorsprong, één beweging.

> Zet de straal **óók als attribuut** in de opmaak, niet alleen in CSS. Kent een browser `r`
> niet als animeerbare CSS-eigenschap, dan blijft die waarde staan en is de waaier gewoon
> meteen zichtbaar — nooit onzichtbaar. Bij `prefers-reduced-motion` doet de blanket-regel
> hetzelfde: de eindstaat staat er direct.

De bron zelf ligt **buiten** het masker: het licht komt daar vandaan, dus dat punt is er als
eerste.

### 6.6 De bron glijdt, hij springt niet

Wissel je van stand, dan verplaatst de bron zich naar het midden van het gekozen segment — in
**320ms**, met een cubic ease-out (`1 − (1 − t)³`, dat benadert de huiscurve). Alle bundels
zwenken mee, omdat hun startpunt meebeweegt.

Twee details die het verschil maken tussen elegant en rommelig:

- **De eerste meting is geen beweging maar een beginstand.** Bij het opstarten moet de bron
  meteen op zijn plaats staan; hem van links laten aanschuiven ziet er goedkoop uit.
- **Onderbreek je een lopende tween, dan vertrek je vanaf de huidige positie**, niet vanaf de
  vorige eindwaarde. Anders schokt de bron bij snel klikken.

### 6.7 De waaier volgt het venster, niet de inhoud

Dit is de subtielste eigenschap van het scherm, en de reden dat het levend aanvoelt:

**De bron hangt aan het venster. De landingen hangen aan de kaarten.** Schuif je de kaartenrij
horizontaal, dan blijft de bron staan en **zwenken de bundels mee** — als schijnwerpers die een
optocht volgen. Meet daarvoor bij elke scroll opnieuw (via `requestAnimationFrame`, niet per
scroll-event) waar het midden van elke kaart zich bevindt ten opzichte van het veld.

---

## 7. De clusterkaart

Breedte **264px**, minimale hoogte **216px**, radius van je kaart-token, oppervlaktekleur, met
een randlijn en een schaduw plus een witte inset-highlight aan de bovenrand.

```
┌────────────────────────────────┐
│▌ ┌────┐                        │  ▌ = accentstreepje: onbewaarde wijziging
│  │ ◉  │  ← medaillon 44px      │
│  └────┘                        │
│  Relaties.                     │  serif ~21px, mét punt
│                                │
│  Bedrijven, hun contact-       │  sans 13px, ink-muted
│  personen en de bedrijfstypes  │
│  waarin je ze indeelt.         │
│                                │
│  ! Let op: companies draagt    │  11px, ! in accent
│    ook de omzetcijfers…        │  (alleen als de kaart NIET dicht staat)
│                                │
│  ┌──────────────────────────┐  │
│  │ ● SCHRIJVEN            ⌄ │  │  de standknop
│  └──────────────────────────┘  │
│         3 TABELLEN ⌄           │  mono, uitklapper
└────────────────────────────────┘
```

**De kaart is bewust bijna leeg.** De bundel erboven draagt de stand al; de kaart hoeft die niet
nóg eens met een gekleurde rand te herhalen. Daaruit volgt een regel die je consequent moet
volhouden:

> **Kleur op een kaart betekent "hier heb je net aan gezeten", niet "dit staat open".**

Concreet: een kaart met een **onbewaarde wijziging** krijgt een accent-rand op ~45% en een
verticaal accentstreepje van 3×32px tegen de linkerrand, dat binnenkomt met de
micro-bevestigingsanimatie van je systeem. Alle andere kaarten houden de gewone randkleur.

**Het medaillon** is 44px rond met een icoon van 20px:

- kaart **dicht**: gestippelde rand, geen vulling, gedempte inktkleur;
- kaart **open**: geen rand, vulling `color-mix(standkleur 10%, oppervlak)`, icoon in de
  standkleur.

Zo verkleurt de kaart alleen op dat ene punt mee, en blijft de rest rustig.

**Eén glyph per cluster**, met de hand als inline SVG (mensen · gesprek · map · bank · document ·
verzenden · lijn-omhoog · afvinklijst · megafoon · tandwielen · slot · vraagteken). Geen
icoonlibrary voor twaalf iconen. Een onbekende clustersleutel valt terug op het vraagteken —
**een nieuw cluster mag nooit iconloos blijven.**

**De voetnoot** verschijnt alleen als de kaart níét dicht staat: een waarschuwing over data
waar je niet bij kunt, is ruis.

**De uitklapper** onderaan toont het aantal tabellen in mono met een chevron die 180° draait.
Een cluster met **ongelijke standen klapt zichzelf open** — je moet kunnen zien wélke tabel
afwijkt, anders is "gedeeltelijk" een mededeling zonder uitweg.

---

## 8. De standknop en het standenmenu

**De standknop** toont waar iets nu staat en opent met een chevron een klein drijvend menu.
Twee maten: groot op de kaart (padding 12/10px, mono 12px), klein op een tabelrij (8/4px,
mono 10px, vaste breedte ~116px).

De knop kleurt mee met zijn stand: accent-wash bij schrijven, een lichte koele wash bij lezen,
en een **gestippelde rand zonder vulling** bij geen toegang. Bij "gedeeltelijk": teken `◐`,
woord "Gedeeltelijk", in gedempte inkt — geen eigen kleur, want het is geen eigen stand.

**Het menu** is 288px breed en toont de drie standen elk met **teken, woord én de zin die
uitlegt wat het betekent**:

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

> **Je ziet wat je kiest vóór je klikt.** Bij het uitdelen van databasetoegang is dat het
> verschil tussen bediening en gokken. Een drop-down met alleen de woorden "Geen / Lezen /
> Schrijven" is hier niet goed genoeg.

**Is schrijven onmogelijk** (een view, of een tabel waarop de applicatie zelf handelt), dan is
die regel uitgeschakeld op ~45% dekking **en vervangt de reden de uitlegzin**:

- op een cluster: *"Op alles in dit cluster handelt de applicatie zelf. Lezen kan, schrijven
  nooit."*
- op een view: *"Een view is nooit een schrijfdoel — je schrijft in de tabellen eronder."*
- op een tabel: *"Op deze tabel handelt de applicatie zelf; een model mag hem alleen lezen."*

Een grijze regel zonder uitleg is een dood spoor; een grijze regel mét reden is een antwoord.

**Technisch:** het menu hangt in een **portal** met vaste positionering, 6px onder zijn knop en
altijd binnen het venster geklemd. Dat moet: de kaarten leven in een horizontaal schuivende rij
die alles afknipt wat eruit steekt. Het sluit bij Escape, bij een klik ernaast, bij **elke**
scroll (ook in een voorouder — vandaar de capture-fase) en bij resize. Een menu dat blijft
hangen terwijl de rij schuift, komt los van zijn knop te staan.

---

## 9. De tabelrij en de kolommen

Onder een uitgeklapte kaart staat per tabel één rij:

```
┌──────────────────────────────────────────────┐
│ companies              [◦ LEZEN ⌄]      (i)  │
└──────────────────────────────────────────────┘
```

- **de naam in mono, precies zoals hij in de database heet.** Het cluster praat gewone taal,
  deze regel spreekt de waarheid — en dat is dezelfde naam die het proefblad straks toont;
- **een eigen standknop** (klein). Dit is de fijnregeling: hier zet je één tabel bewust anders,
  en dáárdoor komt het cluster op "gedeeltelijk";
- **een ronde (i)-knop** die de kolommen uitklapt.

Een rij met een onbewaarde wijziging krijgt dezelfde accent-rand als de kaart.

**Het kolompaneel** toont per kolom de naam (mono), het type (mono, gedempt) en — dit is het
punt — **het commentaar dat de database zelf draagt**, in sans eronder. Daarvoor staan die
comments er. Bovenaan een mono-telling (`14 KOLOMMEN`, plus `· view` als het er een is), en bij
een view onderaan achter een scheidslijn: *"Deze view leest: `tabel_a, tabel_b`."*

Dit paneel is de reden dat een beheerder een **geïnformeerde keuze** maakt in plaats van een
gok. Geef het echte aandacht.

---

## 10. De verzegelde kaart

De tabellen die de toegang zélf sturen (gebruikers, rollen, rechten) krijgen één kaart:

- **gestippelde** rand in de sterke randkleur;
- een diagonale arceervulling: `repeating-linear-gradient(135deg, transparent 0 7px,
  <randkleur op 34%> 7px 8px)`;
- een slot-glyph in een medaillon met gewone rand;
- titel **"Verzegeld."**, en daaronder in gewone taal waarom;
- de tabelnamen in mono eronder;
- **geen standknop, geen uitklapper, geen kolommen.**

> **En het belangrijkste: er hangt géén bundel aan.** Er loopt geen lijn naartoe omdat er nooit
> een lijn naartoe kán lopen. Dat is de hele boodschap van deze kaart — de grens zichtbaar
> maken in plaats van hem te verbergen. Verbergen zou de indruk wekken dat er niet over is
> nagedacht.

Hun kolommen toon je niet: er valt niets in te stellen, en juist van deze tabellen zijn de
kolomnamen het gevoeligst.

---

## 11. Machinerie

Elk schema zit vol tabellen die er zijn voor het apparaat en niet voor het bedrijf: wachtrijen,
migratieboekhouding, webhook-dedup, opgeslagen voorkeuren, singleton-notitieblokken. Die horen
niet in een scherm waar iemand nadenkt over wie klantgegevens mag zien.

**Bundel ze tot één kaart "Machinerie", standaard uit beeld**, samen met de verzegelde kaart,
achter één schakelknop rechtsboven. Aan betekent: beide kaarten schuiven achteraan de rij aan,
en de machineriekaart krijgt een eigen bundel zoals elk ander cluster.

Verwar dit niet met de verzegelde lijst: machinerie is *uit het zicht* maar **wél toekenbaar**;
verzegeld is *nooit*. Twee verschillende dingen die je niet in één mechanisme moet persen.

---

## 12. Wijzigen en publiceren

**Klikken wijzigt niets in de database.** Alles is voorlopig tot je publiceert. Dat betekent
dat het scherm op elk moment moet kunnen laten zien wat er nog niet echt is:

- gewijzigde kaarten en rijen dragen de accentrand en het streepje (§7);
- de publiceerknop telt mee: `4 wijzigen…`;
- **verlaat de pagina niet stilletjes** met onbewaarde wijzigingen — hang er de
  browserwaarschuwing aan;
- **van rol wisselen met onbewaarde wijzigingen** opent eerst een dialoog: *"Eerst deze rol
  afronden?"* met de knoppen **Hier blijven** en **Weggooien en wisselen**, en de telling in de
  tekst. Stilzwijgend weggooien is bij rechten geen optie.

### Het proefblad

Publiceren toont eerst een leesbare samenvatting. Vier regels die niet onderhandelbaar zijn:

1. **Openingen bovenaan**, en binnen de openingen de schrijfrechten eerst — daar zit het risico.
   Sorteervolgorde: naar schrijven (0) · gesloten → lezen (1) · schrijven → lezen (2) ·
   intrekking (3).
2. **Gegroepeerd per cluster, maar met de échte tabelnamen eronder.** Je klikt op een cluster,
   je publiceert tabellen. De beheerder tekent voor wat er werkelijk opengaat, ook als de
   indeling later verschuift.
3. **In gewone taal**: *"`companies` gaat van gesloten naar **schrijven**"*, met een accent-bolletje
   voor een opening en een neutraal bolletje voor een afsluiting.
4. **Een slotregel** die de belangrijkste garantie herhaalt: *"Verwijderen en
   structuurwijzigingen zijn voor élke rol uitgesloten, ook voor tabellen die hierboven op
   Schrijven komen te staan."*

Knoppen: **Terug** en **Publiceren**. Pas na bevestiging gaat het live.

---

## 13. Lege staten en fouten

**Nog geen enkele rol:** toon de rolkiezer plus een verzorgde lege staat —
*"Een rol bundelt wat een AI-model in deze database mag zien en wijzigen. Maak er één aan; hij
begint volledig dicht."* Een lege staat is een uitnodiging tot handelen, geen mededeling dat er
niets is.

**Een rol zonder rechten:** geen aparte lege staat. Het canvas met alle bundels gestippeld ís
het antwoord — je ziet in één blik dat alles dicht staat, en dat is de gezonde toestand.

**Fouten** verschijnen als een strook onder de balk: accent-rand, zachte accent-wash, en een
zin die zegt wat er misging en wat de volgende stap is. Geen excuses, geen vaagheid, geen
technische details.

---

## 14. Motion-inventaris

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

**Wat er níét beweegt:** geen zwevende deeltjes, geen glinsterende randen, geen tilt, geen
parallax, geen hover-animatie op de kaarten behalve de kleurovergang. De bolletjes zijn het
enige continue element op het scherm — geef er geen tweede naast, want dan verliezen ze hun
betekenis.

---

## 15. Kwaliteitsvloer

- **`prefers-reduced-motion` is verplicht.** De bolletjes **stoppen volledig** (de rAF-lus start
  niet eens), het spreidingsmasker staat meteen op zijn eindstraal, de bron staat meteen op zijn
  plek, en alle transities vallen weg. **De eindstaat is in alle gevallen de volledige,
  leesbare waaier** — nooit een half getekend beeld. Luister ook naar *veranderingen* in die
  voorkeur, niet alleen naar de waarde bij het laden.
- **Toetsenbord.** Elke standknop, elke uitklapper, elke pijlknop is een echte knop. De
  kaartenrij is één tabstop en schuift met ← en →. De drijvende menu's sluiten met Escape.
  De focus-ring is de accent-outline van je systeem, zichtbaar op elk element.
- **Schermlezers.** De bundels zijn puur decoratief (`aria-hidden`) — alle informatie die ze
  dragen staat óók als tekst op de kaart. Een standknop draagt een label als
  *"Relaties: Schrijven. Stand wijzigen"*, en het menu is een `role="menu"` met `menuitem`s.
- **Contrast** controleren voor alle drie de standen, inclusief de gedempte tekst en de dichte
  kaart.
- **Klein scherm.** De kaartenrij scrollt sowieso al horizontaal, dus die werkt. Zet de
  bedieningsbalk om naar wrap, en zet `backdrop-filter` uit als je designsysteem dat op smalle
  schermen voorschrijft.
- **Het canvas mag nooit leeg blijven** door een meetfout: staat de breedte op 0, render dan
  niets in plaats van een halve waaier, en meet opnieuw zodra het element een maat heeft
  (`ResizeObserver`).

---

## 16. De woorden

- **Noem de standen bij hun gevolg, niet bij hun techniek.** Geen toegang · Lezen · Schrijven.
  Niet `SELECT`, niet `RW`, niet "niveau 2".
- **Hetzelfde woord door de hele flow.** Staat er "Schrijven" op de kaart, dan staat er
  "Schrijven" in het menu, in het proefblad en in de bevestiging.
- **Actieve werkwoorden op knoppen die zeggen wat er gebeurt.** "Wijzigingen publiceren", niet
  "Opslaan". "Weggooien en wisselen", niet "Doorgaan".
- **Clusteruitleg is één zin in gewone taal, zonder tabelnamen.** Kun je die zin niet schrijven
  zonder een tabelnaam te gebruiken, dan is het cluster nog geen cluster.
- **Een voetnoot waarschuwt concreet.** Niet "bevat gevoelige data" maar *"Let op: companies
  draagt ook de omzet-, winst- en margecijfers per klant (2023–2025)."*
- **De slotregel onder het canvas herhaalt de kern**, want dat is de zin die iemand leest als
  hij twijfelt: *"Een cluster is een bedieningsgemak — het rechtenmodel blijft per tabel, en het
  proefblad noemt de echte tabelnamen."*

---

## 17. Wat je bewust NIET bouwt

Deze zijn afgewogen en afgewezen. Ze weer invoeren maakt het scherm zwaarder zonder dat er om
gevraagd is.

- **Geen 3D, geen WebGL, geen canvas-element.** De waaier is SVG en de kaarten zijn HTML. Een
  `<canvas>` heeft geen DOM: geen `Tab`, geen focus-ring, geen schermlezer, geen selecteerbare
  tekst — op precies het scherm dat databasetoegang regelt. En het enige dat WebGL kán wat SVG
  niet kan (volumetrisch licht) is exact wat "premium door terughoudendheid" uitsluit.
- **Geen penseel-modus** op de standenkiezer. Zie §6.3.
- **Geen tweede continu bewegend element** naast de bolletjes.
- **Geen pan/zoom-canvas met vrije plaatsing.** De kaarten staan in één rij, in één volgorde,
  altijd. Een viewport die alle kanten op kan schuiven heeft geen canonieke toestand — je kunt
  dan nooit zeggen "het scherm is schoon", want een deel kan buiten beeld staan. Op een
  beveiligingsscherm is dat een defect.
- **Geen lijnen tússen clusters.** Verwijzingen tussen clusters staan als **tekst** onder de
  uitgeklapte tabellen (*"Verwijst naar Relaties. Zonder die clusters blijven het kale id's."*).
  Een lijn tussen twee kaarten suggereert dat toegang zich voortplant, en dat doet ze niet.
- **Geen apart rollenoverzicht.** De rolkiezer is het rolbeheer.
- **Geen alarmkleur voor "geen toegang".**
- **Geen icoonlibrary** voor twaalf glyphs.

---

## 18. Voor je oplevert

- [ ] De drieklank klopt: kleurloos · koel · warm, elk met eigen lijnstijl én eigen teken.
- [ ] Het scherm is leesbaar in grijstinten (echt getest, niet aangenomen).
- [ ] Het accent komt alleen voor bij: schrijven, onbewaarde wijziging, publiceerknop, focus.
- [ ] De bundels vertrekken en landen loodrecht, en zwenken mee als je de rij schuift.
- [ ] De bolletjes lopen niet op dichte bundels en niet bij focus "Geen".
- [ ] Bij `prefers-reduced-motion` staat de volledige waaier er meteen, zonder beweging.
- [ ] Elke standkeuze toont zijn uitlegzin vóór je klikt, en elke geblokkeerde keuze toont
      zijn reden.
- [ ] De verzegelde kaart hangt aan geen enkele bundel.
- [ ] Het proefblad groepeert per cluster en noemt de echte tabelnamen, openingen bovenaan.
- [ ] Onbewaarde wijzigingen waarschuwen bij het verlaten van de pagina én bij rolwissel.
- [ ] Het hele scherm is met het toetsenbord te bedienen, inclusief de kaartenrij.
- [ ] Geen enkel getal uit dit document is "ongeveer" overgenomen zonder reden.
