/**
 * De poort — één gedeelde functie die ELKE databasetool doorloopt.
 *
 * ⚠ VEILIGHEIDSKRITISCH. Elke wijziging hier valt onder de zware controle
 * (drie parallelle reviewers, unanimiteit).
 *
 * Komt er ooit een vierde tool bij, dan moet ook die hierlangs. Daarom staat
 * de volgorde hier één keer en niet in elke tool apart: een tool die er later
 * bij komt kan dan niet per ongeluk buiten de poort om werken.
 *
 * De volgorde uit §5.1 is niet vrijblijvend. Geen stap overslaan, geen stap
 * van volgorde wisselen — met name: de beschermde lijsten gaan VÓÓR alles wat
 * met rechten te maken heeft.
 */

import { SCHEMA } from "../mcp.config";
import { analyseer, type Operatie } from "./analyse";
import { magNooitSchrijven, staatOpDenylist } from "./beschermd";
import type { RolContext } from "./rechten";
import { withDatabase } from "./verbinding";

/**
 * De catalogus als injecteerbare bron.
 *
 * Waarom: zonder deze scheiding is de poort alleen te testen mét een echte
 * database, en dan wordt de testmatrix uit §13 een integratietest die niemand
 * bij elke wijziging draait. Nu draait de hele matrix — inclusief élke
 * omzeiling uit §6 — in milliseconden op een nagebootste catalogus, en blijft
 * er voor de database alleen over wat daar écht thuishoort: de GRANT's.
 */
export interface CatalogusRij {
	naam: string;
	/**
	 * De relkind uit Postgres: 'r' = gewone tabel, 'v' = view, 'm' =
	 * materialized view, 'p' = partitiemoeder, 'f' = foreign table, …
	 *
	 * ⚠ De lookup filtert hier bewust NIET op: alleen wat écht in de catalogus
	 * staat, mag als "bestaat niet" gelden. Filterde de query zelf op 'r'/'v',
	 * dan zou een materialized view of een partitiemoeder als onbestaand
	 * terugkomen — en dat maakt de CTE-botsingscontrole blind.
	 */
	soort: string;
	is_partitiekind: boolean;
	heeft_kinderen: boolean;
}

export interface Catalogus {
	relaties(namen: string[]): Promise<Map<string, CatalogusRij>>;
	/** Per view de tabellen die hij transitief leest; null = niet te ontleden. */
	viewBronnen(views: string[]): Promise<Map<string, string[] | null>>;
}

/**
 * ÉÉN en dezelfde weigering voor alle gesloten gevallen.
 *
 * Of iets niet bestaat, buiten het model valt (een foreign table, een
 * partitiekind), gesloten is voor deze rol, of op de denylist staat: de
 * melding is telkens identiek. Verschil je erin, dan kan iemand namen
 * aftasten en uit de reactieverschillen het hele schema afleiden — precies
 * het structuurlek, maar dan via de foutafhandeling.
 *
 * We noemen alleen de naam die de aanroeper ZELF in zijn query zette; nooit
 * een tabel die hij niet noemde.
 */
function geenToegang(naam: string): string {
	return `Deze rol heeft geen toegang tot ${naam}.`;
}

export type Poortoordeel =
	| {
			ok: true;
			operatie: Operatie;
			relaties: string[];
			doel: string | null;
			/** De query zoals hij uitgevoerd mag worden (getrimd, geen puntkomma). */
			sql: string;
			heeftReturning: boolean;
	  }
	| { ok: false; melding: string };

/**
 * Lost de relaties op tegen de catalogus en past de twee beschermde lijsten
 * toe — voor views transitief, op alles wat eronder ligt.
 */
async function toetsRelaties(
	catalogus: Catalogus,
	relaties: string[],
	cteNamen: string[],
	operatie: Operatie,
	doel: string | null,
	rechten: RolContext["rechten"],
): Promise<{ ok: true } | { ok: false; melding: string }> {
	// 1. De denylist stopt alles, ongeacht wat de rechtentabel zegt. Ook een
	//    CTE die zo heet als een beschermde tabel: die naam hoort hier niet
	//    voor te komen, in welke rol dan ook.
	for (const naam of [...relaties, ...cteNamen]) {
		if (staatOpDenylist(naam)) return { ok: false, melding: geenToegang(naam) };
	}

	// 2. Bestaat elke relatie, en past ze in het model?
	//
	// Twee achterdeuren bij tabellen: een PARTITIEKIND is technisch een gewone
	// tabel, dus zonder deze controle is een afgesloten moeder alsnog stuk voor
	// stuk te lezen. En een tabel met OVERERVENDE KINDEREN geeft bij een gewone
	// SELECT ook de rijen van die kinderen terug, zonder dat het kind ooit
	// getoetst wordt. Beide weigeren we.
	//
	// Foreign tables, materialized views en partitiemoeders komen wél uit de
	// catalogus (de lookup filtert niet op relkind, zodat de botsingscontrole
	// ze ziet) maar vallen hieronder af op hun soort.
	// ÉÉN lookup voor alles: relaties én CTE-namen, alle relkinds. Twee aparte
	// bronnen zouden onafhankelijk van elkaar leeg kunnen terugkomen, en een
	// stil leeg antwoord is hier een volledige fail-open.
	const perNaam = await catalogus.relaties([...new Set([...relaties, ...cteNamen])]);

	/*
	 * 2a. Valt een CTE-naam samen met een BESTAANDE relatie, dan weigeren we de
	 *     hele query.
	 *
	 * Dit is de reparatie van een echt gat. CTE-zichtbaarheid is in Postgres
	 * lexicaal: een CTE in een subquery schaduwt een gelijknamige tabel op het
	 * hoofdniveau NIET, en `public.tabel` leest sowieso altijd de echte tabel.
	 * Wie CTE-namen globaal uit de relatielijst schrapt, laat daarmee
	 *
	 *     SELECT * FROM transactions, companies
	 *      WHERE id IN (SELECT x FROM (WITH transactions AS (SELECT 1 AS x) SELECT x FROM transactions) q)
	 *
	 * ongezien passeren — de rol leest dan elke tabel die de gedeelde
	 * leesgebruiker mag zien.
	 *
	 * Scope-bewust matchen zou preciezer zijn, maar "bij twijfel weigeren" is
	 * hier goedkoper én veiliger: een CTE die heet als een bestaande tabel is
	 * per definitie niet ondubbelzinnig te herleiden.
	 */
	for (const cte of cteNamen) {
		if (!perNaam.has(cte)) continue;
		/*
		 * Twee doelen die elkaar hier bijten. Een uitleg ("je CTE botst met een
		 * tabelnaam") scheelt de aanroeper een doodlopende weg — maar diezelfde
		 * uitleg verklapt dát die naam bestaat, en dan is één query per naam
		 * genoeg om het schema af te tasten.
		 *
		 * Dezelfde oplossing als bij de schrijfdoelen: uitleggen mag alleen als
		 * de rol die tabel sowieso al mag zien. Voor al het andere de uniforme
		 * weigering.
		 */
		return {
			ok: false,
			melding: rechten.has(cte)
				? `Een WITH-onderdeel mag niet dezelfde naam dragen als een bestaande tabel (${cte}). Geef het een andere naam.`
				: geenToegang(cte),
		};
	}

	// Pas nu mogen de CTE-namen eruit: ze wijzen gegarandeerd naar niets echts.
	const teToetsen = relaties.filter((n) => !cteNamen.includes(n));

	/*
	 * Blijft er niets over, dan raakt de query geen enkele tabel. Dat is geen
	 * geldige aanroep — en het voorkomt dat iemand een query "leeg" maakt door
	 * hem vol CTE-namen te zetten.
	 *
	 * De melding is bewust dezelfde uniforme weigering. Een eigen tekst maakte
	 * hier een bestaansorakel: `WITH x AS (SELECT 1) SELECT 1 FROM x` gaf een
	 * ándere melding naargelang `x` in het schema voorkwam — en sinds de lookup
	 * niet meer op relkind filtert, dekt dat élke rij in pg_class, inclusief de
	 * indexnamen (die kolomnamen verraden).
	 */
	if (teToetsen.length === 0) {
		return { ok: false, melding: geenToegang(cteNamen[0] ?? "die tabel") };
	}

	for (const naam of teToetsen) {
		const rij = perNaam.get(naam);
		// Alles wat geen gewone tabel of view is — een materialized view, een
		// partitiemoeder, een foreign table — valt hier af, net als een naam die
		// de catalogus helemaal niet kent.
		if (!rij || !["r", "v"].includes(rij.soort)) {
			return { ok: false, melding: geenToegang(naam) };
		}
		if (rij.is_partitiekind || rij.heeft_kinderen) {
			return { ok: false, melding: geenToegang(naam) };
		}
	}

	// 3. Views: los op wat eronder ligt en pas de beschermde lijsten TRANSITIEF
	//    toe. Zonder deze stap maakt één view over de gebruikerstabel de hele
	//    denylist waardeloos — de analyse ziet immers alleen de viewnaam.
	//
	//    Let op wat we hier NIET doen: we eisen géén recht op de onderliggende
	//    tabellen. Dat zou de view zinloos maken — het hele punt is dat iemand
	//    de view mag zien en de tabel niet.
	const views = teToetsen.filter((n) => perNaam.get(n)?.soort === "v");
	if (views.length > 0) {
		const onder = await catalogus.viewBronnen(views);
		// Over de GEVRAAGDE views lopen, niet over de teruggegeven map: ontbreekt
		// er een, dan zou zijn transitieve controle anders volledig overgeslagen
		// worden — een ontbrekend antwoord mag nooit als "niets aan de hand"
		// gelezen worden.
		for (const view of views) {
			const bronnen = onder.get(view);
			if (bronnen === undefined || bronnen === null) {
				return { ok: false, melding: geenToegang(view) };
			}
			for (const bron of bronnen) {
				if (staatOpDenylist(bron)) return { ok: false, melding: geenToegang(view) };
			}
		}
	}

	// 4. Schrijven: het doel moet een gewone tabel zijn waarop de applicatie
	//    niet zelf handelt.
	if (operatie === "schrijven") {
		if (doel === null) return { ok: false, melding: "Deze schrijfactie is niet toegestaan." };

		/*
		 * Een specifieke melding mag ALLEEN als de rol de tabel sowieso al mag
		 * zien. Anders is het verschil tussen "bestaat niet", "is een view" en
		 * "daar handelt de applicatie op" een orakel: door namen af te tasten
		 * leidt iemand uit de reactieverschillen het hele schema af — precies
		 * het structuurlek, maar dan via de foutafhandeling.
		 */
		const magZien = rechten.has(doel);

		// Een view is nooit een schrijfdoel. Postgres maakt eenvoudige views
		// vanzelf bewerkbaar, en een INSTEAD OF-trigger op een view is
		// willekeurige SQL die met de rechten van de EIGENAAR draait — de
		// kortste weg naar schrijven op een tabel die voor iedereen dicht is.
		if (perNaam.get(doel)?.soort === "v") {
			return {
				ok: false,
				melding: magZien ? `In ${doel} kan niet geschreven worden.` : geenToegang(doel),
			};
		}
		if (magNooitSchrijven(doel)) {
			return {
				ok: false,
				melding: magZien
					? `Op ${doel} handelt de applicatie zelf; daar kan niet in geschreven worden.`
					: geenToegang(doel),
			};
		}
	}

	// 5. Pas nu de rechten van de rol, per relatie afzonderlijk. Eén relatie
	//    zonder recht = de héle query wordt geweigerd.
	for (const naam of teToetsen) {
		const niveau = rechten.get(naam);
		// Expliciet tegen de twee toegestane waarden toetsen, niet op
		// truthiness: komt er ooit een derde waarde in de enum, dan zou die
		// stilzwijgend leesrecht verlenen zonder dat er iets stukgaat.
		if (niveau !== "lezen" && niveau !== "schrijven") {
			return { ok: false, melding: geenToegang(naam) };
		}
		// Schrijven impliceert lezen op diezelfde tabel; lezen impliceert nooit
		// schrijven.
		if (operatie === "schrijven" && naam === doel && niveau !== "schrijven") {
			return { ok: false, melding: geenToegang(naam) };
		}
	}

	return { ok: true };
}

/**
 * De catalogus zoals hij in productie werkt: rechtstreeks uit Neon, via de
 * smalle serviceverbinding.
 */
export function neonCatalogus(env: Env): Catalogus {
	return {
		async relaties(namen) {
			const rijen = (await withDatabase(env, "service", async (sql) =>
				sql.query(
					`SELECT c.relname AS naam,
                            c.relkind::text AS soort,
                            EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid  = c.oid) AS is_partitiekind,
                            EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhparent = c.oid) AS heeft_kinderen
                       FROM pg_class c
                       JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = $2
                        AND c.relname = ANY($1)`,
					[namen, SCHEMA],
				),
			)) as CatalogusRij[];
			return new Map(rijen.map((r) => [r.naam, r]));
		},
		viewBronnen: (views) => bronnenVanViews(env, views),
	};
}

/**
 * De tabellen die elke view leest, transitief (ook door geneste views heen).
 * `null` betekent: niet volledig te ontleden → weigeren (regel 8).
 */
async function bronnenVanViews(
	env: Env,
	views: string[],
): Promise<Map<string, string[] | null>> {
	/*
	 * We volgen de herschrijfregel van de view naar álles waarvan hij afhangt —
	 * niet alleen naar tabellen.
	 *
	 * Dat onderscheid is het hele punt. Roept een view een eigen functie aan,
	 * dan legt Postgres een afhankelijkheid vast op pg_proc, niet op pg_class.
	 * Een query die alleen naar pg_class joint, ziet die functie dus niet en
	 * concludeert dat de view "niets leest" — terwijl die functie onder water
	 * elke tabel kan lezen, desnoods als SECURITY DEFINER. Zo'n view is niet te
	 * beoordelen, dus geven we null terug en weigeren we hem.
	 */
	const rijen = (await withDatabase(env, "service", async (sql) =>
		sql.query(
			`WITH RECURSIVE keten AS (
                 SELECT v.oid AS start_oid, v.relname AS start_naam,
                        d.refclassid AS soortklasse, d.refobjid AS doel_oid
                   FROM pg_class v
                   JOIN pg_namespace n  ON n.oid = v.relnamespace AND n.nspname = $2
                   JOIN pg_rewrite rw   ON rw.ev_class = v.oid
                   JOIN pg_depend d     ON d.objid = rw.oid AND d.classid = 'pg_rewrite'::regclass
                  WHERE v.relname = ANY($1) AND d.refobjid <> v.oid
                  UNION
                 SELECT k.start_oid, k.start_naam, d2.refclassid, d2.refobjid
                   FROM keten k
                   JOIN pg_class v2     ON v2.oid = k.doel_oid
                                       AND v2.relkind = 'v'
                                       AND k.soortklasse = 'pg_class'::regclass
                   JOIN pg_rewrite rw2  ON rw2.ev_class = v2.oid
                   JOIN pg_depend d2    ON d2.objid = rw2.oid AND d2.classid = 'pg_rewrite'::regclass
                  WHERE d2.refobjid <> v2.oid
             )
             SELECT k.start_naam                       AS view,
                    k.soortklasse = 'pg_class'::regclass AS is_relatie,
                    c.relname                          AS bron,
                    c.relkind::text                    AS soort,
                    cn.nspname                         AS schema,
                    p.proname                          AS functie,
                    pn.nspname                         AS functieschema,
                    t.typtype::text                    AS typtype
               FROM keten k
          LEFT JOIN pg_class c      ON c.oid = k.doel_oid AND k.soortklasse = 'pg_class'::regclass
          LEFT JOIN pg_namespace cn ON cn.oid = c.relnamespace
          LEFT JOIN pg_proc p       ON p.oid = k.doel_oid AND k.soortklasse = 'pg_proc'::regclass
          LEFT JOIN pg_namespace pn ON pn.oid = p.pronamespace
          LEFT JOIN pg_type t       ON t.oid = k.doel_oid AND k.soortklasse = 'pg_type'::regclass`,
			[views, SCHEMA],
		),
	)) as {
		view: string;
		is_relatie: boolean;
		bron: string | null;
		soort: string | null;
		schema: string | null;
		functie: string | null;
		functieschema: string | null;
		typtype: string | null;
	}[];

	const uit = new Map<string, string[] | null>();
	for (const v of views) uit.set(v, []);

	for (const r of rijen) {
		if (uit.get(r.view) === null) continue; // al afgekeurd

		if (!r.is_relatie) {
			/*
			 * Een afhankelijkheid op iets anders dan een relatie.
			 *
			 * ⚠ DE DEFAULT IS WEIGEREN, niet doorlaten. Eerder werd élke klasse
			 * die we niet als functie herkenden stilzwijgend onschuldig
			 * bevonden — maar Postgres legt voor een operator in een
			 * view-definitie een afhankelijkheid vast op `pg_operator`, niet op
			 * de functie eronder. Een view met een eigen operator waarvan de
			 * implementatie SECURITY DEFINER is, kwam er zo doorheen: precies
			 * het lek waar de functiecontrole voor bedoeld is, langs een klasse
			 * die niemand controleerde. Hetzelfde geldt voor een eigen type met
			 * een CHECK die een functie aanroept.
			 *
			 * ÉÉN uitzondering, empirisch vastgesteld: Postgres legt voor élke
			 * constante in een view-definitie een afhankelijkheid vast op het
			 * DATATYPE van die constante. Een gewone afschermende view als
			 * `WHERE spanco <> 'order'` levert dus een pg_type-rij op de enum op.
			 * Zonder deze uitzondering zou vrijwel élke zinnige view geweigerd
			 * worden — en de view is nu net het enige gereedschap voor kolom- en
			 * rij-afscherming dat dit model kent.
			 *
			 * Een enum draagt geen gebruikerscode, dus die is veilig. Domeinen
			 * (typtype 'd', een CHECK kan een functie aanroepen), samengestelde
			 * en range-types blijven geweigerd.
			 */
			if (r.functie && r.functieschema === "pg_catalog") continue;
			if (r.typtype === "e") continue;
			uit.set(r.view, null);
			continue;
		}

		// Een view die iets leest buiten public, of iets dat geen tabel of view
		// is (een foreign table bijvoorbeeld), kunnen we niet beoordelen.
		if (!r.bron || r.schema !== SCHEMA || !["r", "v"].includes(r.soort ?? "")) {
			uit.set(r.view, null);
			continue;
		}
		uit.get(r.view)!.push(r.bron);
	}
	return uit;
}

/**
 * De volledige poort. Geeft terug of deze query mag draaien.
 *
 * @param gewenst De operatie die de aanroepende tool ondersteunt. De leestool
 *   geeft "lezen" en weigert dus elke schrijfquery; de schrijftool geeft
 *   "schrijven" en weigert een pure leesquery (die hoort in de andere tool).
 */
export async function toets(
	catalogus: Catalogus,
	context: RolContext,
	ruweSql: string,
	gewenst: Operatie,
): Promise<Poortoordeel> {
	const analyse = analyseer(ruweSql);
	if (!analyse.ok) return { ok: false, melding: analyse.reden };

	if (analyse.operatie !== gewenst) {
		return {
			ok: false,
			melding:
				gewenst === "lezen"
					? "Deze tool voert alleen leesquery's uit."
					: "Deze tool voert alleen toevoegingen en wijzigingen uit.",
		};
	}

	if (analyse.relaties.length === 0) {
		return { ok: false, melding: "Deze query raakt geen enkele tabel." };
	}

	const oordeel = await toetsRelaties(
		catalogus,
		analyse.relaties,
		analyse.cteNamen,
		analyse.operatie,
		analyse.doel,
		context.rechten,
	);
	if (!oordeel.ok) return oordeel;

	return {
		ok: true,
		operatie: analyse.operatie,
		relaties: analyse.relaties,
		doel: analyse.doel,
		sql: analyse.genormaliseerd,
		heeftReturning: analyse.heeftReturning,
	};
}
