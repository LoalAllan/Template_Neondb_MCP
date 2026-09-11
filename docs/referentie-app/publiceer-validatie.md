# De publiceer-actie — server-side validatie, stap voor stap

De publiceer-actie is de enige weg waarlangs rechten in `mcp_rechten` komen. Ga ervan uit dat
iemand haar **rechtstreeks** aanroept, buiten het scherm om. Ze valideert daarom alles opnieuw,
server-side, vóór er één rij geschreven wordt. Zonder deze controle is de rechtentabel een vrij
beschrijfbaar tekstveld en liegt het scherm over wat er openstaat.

Onderstaande volgorde is niet vrijblijvend: **de beschermde lijsten gaan vóór alles wat met
rechten te maken heeft.** Herschrijf dit in het framework van de klant (server-actie, API-route,
RPC), maar houd de stappen en de SQL.

## 0. Wie roept aan?

Vóór alles: lees `is_beheerder` van de aanroeper **uit de database**, op basis van de identiteit
uit de geverifieerde sessie van de app. Nooit uit een token-claim of een cookie-veld. Geen
beheerder → weigeren. Dit geldt voor élke lees- en schrijfactie van het scherm, ook `getRollen()`.

## 1. De invoer

```ts
interface RechtWijziging {
  tabelnaam: string;
  /** null = intrekken (de rij verdwijnt; "geen toegang" is geen waarde). */
  niveau: "lezen" | "schrijven" | null;
}

publiceer(rolId: string, verwachteVersie: number, wijzigingen: RechtWijziging[]): Promise<{ versie: number }>
```

- `verwachteVersie` is **verplicht** en moet een geheel getal zijn; ontbreekt hij → weigeren
  ("herlaad de pagina").
- `wijzigingen` niet leeg, en begrensd (richtwaarde 500 per aanroep).
- **Valideer élke regel vóór de transactie opent.** Half doorgevoerde rechten zijn erger dan geen.

## 2. Per regel: `valideerRegel(w)`

1. `tabelnaam` is een string, niet leeg, hooguit 63 tekens → anders "Ongeldige tabelnaam."
2. `niveau` is `"lezen"`, `"schrijven"` of `null` → anders "Ongeldige stand."
3. **`niveau === null` → klaar.** Intrekken mag altijd; dichtzetten kan nooit iets openen.
4. Staat de naam op de **denylist** (`mcp-beschermd.ts`) → "kan nooit toegankelijk worden gemaakt."
5. `niveau === "schrijven"` en de naam staat in **NOOIT_SCHRIJVEN** → "hierop handelt de applicatie
   zelf; schrijven is daar uitgesloten."
6. **Bestaat de naam, en is het een gewone tabel of een view?** Plus de twee achterdeuren die de
   server óók weigert (`poort.ts` → `toetsRelaties`): een partitiekind is technisch een gewone
   tabel, dus zonder deze controle is een afgesloten moeder stuk voor stuk toe te kennen; en een
   tabel met overervende kinderen geeft bij een `SELECT` ook de rijen van die kinderen terug.

   ```sql
   SELECT c.relkind::text AS soort,
          EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid  = c.oid) AS is_partitiekind,
          EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhparent = c.oid) AS heeft_kinderen
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind IN ('r', 'v')
    LIMIT 1
   ```

   Geen rij → "bestaat niet in het schema." `is_partitiekind` of `heeft_kinderen` → "maakt deel uit
   van een overervings- of partitieketen en is niet toekenbaar."
7. **Is het een view** (`soort = 'v'`):
   - `niveau === "schrijven"` → weigeren: "is een view; daar kan niet in geschreven worden."
     Postgres maakt eenvoudige views vanzelf bewerkbaar, en een `INSTEAD OF`-trigger is
     willekeurige SQL die met de rechten van de eigenaar draait.
   - Los de onderliggende objecten **transitief** op en pas de denylist erop toe. Deze query
     **moet gelijk blijven aan `bronnenVanViews` in `mcp-server/src/database/poort.ts`**. Loopt hij
     achter, dan kent het scherm rechten toe die de server daarna altijd weigert. Twee dingen die
     tellen: door geneste views heen kijken, én afhankelijkheden op **functies** herkennen — een
     view die een eigen functie aanroept legt geen tabel-afhankelijkheid vast, en die functie kan
     onder water elke tabel lezen.

   ```sql
   WITH RECURSIVE keten AS (
     SELECT v.oid AS start_oid, d.refclassid AS soortklasse, d.refobjid AS doel_oid
       FROM pg_class v
       JOIN pg_namespace n ON n.oid = v.relnamespace AND n.nspname = 'public'
       JOIN pg_rewrite rw  ON rw.ev_class = v.oid
       JOIN pg_depend d    ON d.objid = rw.oid AND d.classid = 'pg_rewrite'::regclass
      WHERE v.relname = $1 AND d.refobjid <> v.oid
      UNION
     SELECT k.start_oid, d2.refclassid, d2.refobjid
       FROM keten k
       JOIN pg_class v2    ON v2.oid = k.doel_oid AND v2.relkind = 'v'
                          AND k.soortklasse = 'pg_class'::regclass
       JOIN pg_rewrite rw2 ON rw2.ev_class = v2.oid
       JOIN pg_depend d2   ON d2.objid = rw2.oid AND d2.classid = 'pg_rewrite'::regclass
      WHERE d2.refobjid <> v2.oid
   )
   SELECT k.soortklasse = 'pg_class'::regclass AS is_relatie,
          c.relname AS bron, c.relkind::text AS soort, cn.nspname AS schema,
          p.proname AS functie, pn.nspname AS functieschema, t.typtype::text AS typtype
     FROM keten k
     LEFT JOIN pg_class c       ON c.oid = k.doel_oid AND k.soortklasse = 'pg_class'::regclass
     LEFT JOIN pg_namespace cn  ON cn.oid = c.relnamespace
     LEFT JOIN pg_proc p        ON p.oid = k.doel_oid AND k.soortklasse = 'pg_proc'::regclass
     LEFT JOIN pg_namespace pn  ON pn.oid = p.pronamespace
     LEFT JOIN pg_type t        ON t.oid = k.doel_oid AND k.soortklasse = 'pg_type'::regclass
   ```

   Per rij:
   - `is_relatie = false` → **default = weigeren** ("niet volledig te ontleden"). Twee
     uitzonderingen: een functie in `pg_catalog`, en een `pg_type`-rij met `typtype = 'e'` (voor
     élke constante in een view-definitie legt Postgres een afhankelijkheid op het datatype vast;
     enums dragen geen gebruikerscode — domeinen en samengestelde types blijven geweigerd).
     Operatoren (`pg_operator`) glippen niet door: default is weigeren.
   - `is_relatie = true` maar geen `bron`, ander schema, of `soort` niet `r`/`v` → weigeren.
   - `bron` op de denylist → "leest een beschermde tabel en is niet toekenbaar."

## 3. De transactie

```sql
-- Voorwaardelijke versie-bump. NIET eerst lezen en dan vergelijken: twee
-- gelijktijdige publicaties lezen dan allebei dezelfde waarde, vinden allebei
-- dat het klopt, en schrijven allebei. Nul rijen = conflict.
UPDATE mcp_rollen
   SET versie = versie + 1, updated_at = now()
 WHERE id = $1 AND versie = $2
RETURNING versie;
```

Nul rijen → transactie afbreken met "Iemand anders heeft deze rol intussen gewijzigd. Herlaad de
pagina om te zien wat er nu openstaat en bevestig opnieuw." Stilzwijgend overschrijven is bij
rechten geen optie.

Daarna, per wijziging, in dezelfde transactie:

```sql
-- niveau === null
DELETE FROM mcp_rechten WHERE rol_id = $1 AND tabelnaam = $2;

-- niveau === 'lezen' | 'schrijven'
INSERT INTO mcp_rechten (rol_id, tabelnaam, niveau, updated_at)
VALUES ($1, $2, $3::mcp_recht_niveau, now())
ON CONFLICT (rol_id, tabelnaam)
DO UPDATE SET niveau = EXCLUDED.niveau, updated_at = now();
```

Eén transactie, alle wijzigingen samen, inclusief de teller. Geef `{ versie }` terug; het scherm
onthoudt die voor de volgende publicatie.

> Let op: de `DELETE` hier is de app die met haar eigen, volledige rechten een rechten-rij
> intrekt. Dat is geen `DELETE` via de MCP-server en valt niet onder de harde grens — die gaat over
> aangeleverde queries van een AI-client.

## 4. Rol-CRUD, met dezelfde discipline

- **Aanmaken**: naam verplicht en uniek; de rol begint met nul rechten.
- **Hernoemen**: alleen de naam en omschrijving.
- **Verwijderen**: alleen als geen enkele gebruiker de rol draagt (`mcp_rol_id` → `ON DELETE
  RESTRICT` dwingt dat af; geef een nette melding). De rechten verdwijnen mee (cascade).
- **Dupliceren**: kopieer de rechten **regel voor regel door `valideerRegel`**, niet met
  `INSERT … SELECT`. Een eerder toegekend recht kan intussen ongeldig zijn geworden (een tabel op
  een beschermde lijst, een hernoemde view); een kopie zonder validatie is een schrijfroute naar
  `mcp_rechten` die de poort omzeilt. Geef terug welke regels zijn overgeslagen.

## 5. Rol toewijzen aan een gebruiker

`setGebruikerRol(gebruikerId, rolId | null)`: beheerderscontrole (stap 0), rol bestaat, dan
`UPDATE <gebruikerstabel> SET mcp_rol_id = $2 WHERE id = $1`. Standaard voor een nieuwe gebruiker:
`NULL`. Heeft de doelrol ergens schrijfrecht, toon dan eerst wat die rol mag — iemand een rol
geven is de handeling waarmee toegang daadwerkelijk ontstaat.

`ontkoppelEntra(gebruikerId)`: zet `entra_oid` op `NULL` zodat de volgende login opnieuw bindt.
Let op de valkuil: zolang het e-mailadres op de rij staat, claimt dezelfde persoon hem bij de
volgende login terug. Wil je toegang intrekken, wijzig dan óók de rol (of het e-mailadres).

## 6. Beheerderschap toekennen

`setBeheerder(gebruikerId, aan: boolean)`: alleen een beheerder mag dit, en **de laatste
beheerder kan zichzelf niet degraderen** (tel de beheerders in dezelfde transactie; wordt het
nul, weiger). De eerste beheerder komt uit de eenmalige bootstrap (opdracht §7,
`MCP_EERSTE_BEHEERDER_OID`), die niets meer doet zodra er één beheerder is.
