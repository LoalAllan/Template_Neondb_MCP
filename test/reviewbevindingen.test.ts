/**
 * Regressietests voor de bevindingen van de drie reviewers (§11).
 *
 * Elk van deze gevallen kwam er ooit doorheen. Slaat er hier één om naar
 * "toegestaan", dan is dat geen falende test maar een heropend gat.
 */

import { describe, expect, it } from "vitest";
import { analyseer } from "../src/database/analyse";
import { toets, type Catalogus } from "../src/database/poort";
import { bouwSchrijfStatement, controleerUpdateVorm } from "../src/database/uitvoering";
import { catalogus, rol } from "./helpers";

/** Een rol met precies één leesrecht — zo bewijst elke doorlaat iets. */
const minimaal = rol({ klanten: "lezen" });

async function geweigerd(sql: string, gewenst: "lezen" | "schrijven" = "lezen") {
	const r = await toets(catalogus, minimaal, sql, gewenst);
	expect(r.ok, `Deze query kwam erdoorheen: ${sql}`).toBe(false);
	return r.ok ? "" : r.melding;
}

describe("CTE-namen schaduwen geen echte tabellen meer", () => {
	/*
	 * De kern van de fout: CTE-zichtbaarheid is in Postgres LEXICAAL. Een CTE
	 * die in een subquery staat, schaduwt een gelijknamige tabel op het
	 * hoofdniveau niet, en `public.tabel` leest sowieso altijd de echte tabel.
	 * De analyse schrapte CTE-namen echter GLOBAAL uit de relatielijst — en
	 * wiste daarmee ook de vangnetbron van de parser.
	 */

	it("schema-gekwalificeerd naast een gelijknamige CTE", async () => {
		await geweigerd(
			"WITH transacties AS (SELECT 1 AS x) SELECT * FROM klanten, public.transacties",
		);
	});

	it("een CTE die de beschermde gebruikerstabel probeert weg te schaduwen", async () => {
		await geweigerd(
			"WITH gebruikers AS (SELECT 1 AS x), y AS (SELECT * FROM public.gebruikers) SELECT * FROM y, klanten",
		);
	});

	it("een CTE in een SUBQUERY-scope, zonder schema-prefix — de gevaarlijkste vorm", async () => {
		await geweigerd(
			`SELECT t.* FROM transacties t, klanten c
              WHERE c.id IN (SELECT x FROM (WITH transacties AS (SELECT 1 AS x) SELECT x FROM transacties) q)`,
		);
	});

	it("een ongebruikte CTE-definitie is al genoeg als gif", async () => {
		await geweigerd(
			`SELECT a.id FROM contactmomenten a CROSS JOIN klanten c
              WHERE c.id IN (SELECT 1 FROM (WITH contactmomenten AS (SELECT 0) SELECT 0) s)`,
		);
	});

	it("maar een gewone CTE met een eigen naam werkt gewoon", async () => {
		const r = await toets(
			catalogus,
			minimaal,
			"WITH warm AS (SELECT id FROM klanten) SELECT * FROM warm",
			"lezen",
		);
		expect(r.ok, r.ok ? "" : r.melding).toBe(true);
	});
});

describe("niladische sleutelwoorden glippen niet langs de functie-allowlist", () => {
	// Zonder haakjes ontleedt de parser deze als kolomverwijzing, niet als
	// functie — en dan zegt de allowlist er niets over.
	for (const woord of ["current_schema", "current_catalog", "current_user", "session_user"]) {
		it(`weigert ${woord} zonder haakjes`, async () => {
			await geweigerd(`SELECT ${woord} FROM klanten`);
		});
	}
});

describe("de UPDATE-vormcontrole is niet uit te zetten", () => {
	// De oude tekstversie keek naar de rauwe SQL en eiste dat die met "update"
	// begon. Een voorafgaand blokcommentaar sloeg de hele check dus over, en
	// het woord "where" in een stringliteral deed hem denken dat er een WHERE was.

	it("een voorafgaand blokcommentaar slaat de check niet meer over", () => {
		expect(controleerUpdateVorm("/* c */ UPDATE klanten SET name = 'x'")).toMatch(
			/zonder WHERE/i,
		);
	});

	it("het woord where in een stringliteral telt niet als WHERE", () => {
		expect(controleerUpdateVorm("UPDATE klanten SET name = 'where dit'")).toMatch(
			/zonder WHERE/i,
		);
	});

	it("en de boom weigert hem sowieso, ongeacht de tekstvorm", () => {
		for (const sql of [
			"UPDATE klanten SET name = 'x'",
			"/* c */ UPDATE klanten SET name = 'x'",
			"UPDATE klanten SET name = 'where dit'",
			"UPDATE klanten SET name = 'x' WHERE true",
			"UPDATE klanten SET name = 'x' WHERE 1 = 1",
		]) {
			const a = analyseer(sql);
			expect(a.ok, `kwam erdoorheen: ${sql}`).toBe(false);
		}
	});

	it("maar een UPDATE met een echte WHERE mag gewoon", () => {
		const a = analyseer("UPDATE klanten SET name = 'x' WHERE id = '1'");
		expect(a.ok).toBe(true);
	});
});

describe("foutmeldingen zijn geen orakel", () => {
	/*
	 * Of een naam niet bestaat, een view is, of een tabel is waarop de
	 * applicatie zelf handelt: zolang de rol er geen recht op heeft, hoort het
	 * antwoord identiek te zijn. Anders leidt iemand door namen af te tasten
	 * het hele schema af.
	 */
	it("geeft dezelfde weigering voor bestaat-niet, view en applicatietabel", async () => {
		const bestaatNiet = await geweigerd("INSERT INTO bestaat_niet_xyz (a) VALUES (1)", "schrijven");
		const gesloten = await geweigerd("INSERT INTO transacties (a) VALUES (1)", "schrijven");
		const applicatie = await geweigerd("INSERT INTO facturen (a) VALUES (1)", "schrijven");
		const view = await geweigerd("INSERT INTO v_klanten (a) VALUES (1)", "schrijven");

		const vorm = (m: string) => m.replace(/[a-z_]+\.$/, "X.");
		expect(vorm(gesloten)).toBe(vorm(bestaatNiet));
		expect(vorm(applicatie)).toBe(vorm(bestaatNiet));
		expect(vorm(view)).toBe(vorm(bestaatNiet));
	});

	it("maar wie de tabel wél mag zien, krijgt een bruikbare uitleg", async () => {
		const mag = rol({ facturen: "lezen", v_klanten: "lezen" });
		const a = await toets(catalogus, mag, "INSERT INTO facturen (a) VALUES (1)", "schrijven");
		expect(a.ok).toBe(false);
		if (!a.ok) expect(a.melding).toMatch(/handelt de applicatie zelf/i);

		const b = await toets(catalogus, mag, "INSERT INTO v_klanten (a) VALUES (1)", "schrijven");
		expect(b.ok).toBe(false);
		if (!b.ok) expect(b.melding).toMatch(/kan niet geschreven worden/i);
	});
});

describe("een onbekende stand geeft geen toegang", () => {
	it("weigert een niveau dat niet lezen of schrijven is", async () => {
		// Zou er ooit een derde waarde in de enum komen, dan mag die niet
		// stilzwijgend als toegang gelden puur omdat de string niet leeg is.
		const raar = rol({ klanten: "beheren" as unknown as "lezen" });
		const r = await toets(catalogus, raar, "SELECT * FROM klanten", "lezen");
		expect(r.ok).toBe(false);
	});
});

/* ══════════════════════════════════════════════════════════════════ *
 * Tweede ronde van de zware controle
 * ══════════════════════════════════════════════════════════════════ */

describe("gereserveerde woorden zijn geen tabelnamen", () => {
	/*
	 * `SELECT * FROM only transacties` wordt door de parser ontleed als tabel
	 * `only` met alias `transacties`: het sleutelwoord wordt de relatie en de
	 * échte tabel verdwijnt uit élke tak. Postgres leest daar gewoon
	 * `transacties`. Zodra parser en Postgres het oneens zijn over wát de
	 * relatie is, klopt onze hele boom niet.
	 */
	it("weigert ONLY als relatie, ook met een gelijknamige CTE ernaast", async () => {
		await geweigerd("SELECT * FROM only transacties");
		await geweigerd('WITH "only" AS (SELECT 1 AS x) SELECT * FROM only transacties');
		await geweigerd(
			'WITH "only" AS (SELECT 1) SELECT * FROM klanten WHERE id IN (SELECT id FROM only transacties)',
		);
		await geweigerd(
			'WITH "only" AS (SELECT 1) SELECT (SELECT count(*) FROM only transacties) AS n FROM klanten',
		);
		await geweigerd('WITH "only" AS (SELECT 1) SELECT * FROM only v_gebruikers');
	});
});

describe("een CTE mag ook niets schaduwen dat geen tabel of view is", () => {
	// De botsingscontrole leunde op een catalogus-query die op relkind 'r'/'v'
	// filtert. Een materialized view, partitiemoeder of foreign table kwam daar
	// niet in terug, "botste" dus niet, en viel ongetoetst uit de lijst.
	for (const naam of ["mv_omzet", "part_moeder", "ft_extern"]) {
		it(`weigert een CTE die ${naam} schaduwt`, async () => {
			await geweigerd(
				`SELECT * FROM (WITH ${naam} AS (SELECT 1 AS x) SELECT x FROM ${naam}) q, ${naam}`,
			);
		});
	}

	it("weigert een query die na het schrappen van CTE-namen niets meer raakt", async () => {
		await geweigerd("WITH x AS (SELECT 1) SELECT * FROM x");
	});
});

describe("de rijteller is niet te vervalsen via een eigen RETURNING-alias", () => {
	/*
	 * De omhulling zet mcp_geraakt vooraan en de RETURNING-kolommen van de
	 * aanroeper erachter. Postgres staat dubbele kolomnamen toe en de driver
	 * bouwt zijn rij-objecten met "laatste wint" — dus
	 * `RETURNING 0 AS mcp_geraakt` overschreef onze telling, kreeg de hele
	 * reservering terug en zette daarmee het uurplafond uit.
	 *
	 * De tool leest de telling nu op POSITIE (index 0). Deze test bewaakt dat
	 * de omhulling die volgorde ook echt aanhoudt.
	 */
	it("zet de eigen kolommen gegarandeerd vooraan", () => {
		const uit = bouwSchrijfStatement(
			"UPDATE klanten SET name = 'x' WHERE id > '0' RETURNING 0 AS mcp_geraakt",
			true,
			100,
		);
		const select = uit.slice(uit.indexOf("SELECT (SELECT n FROM mcp_n)"));
		expect(select.indexOf("AS mcp_geraakt")).toBeLessThan(select.indexOf("mcp_doel.*"));
		expect(select.indexOf("AS mcp_bewaking")).toBeLessThan(select.indexOf("mcp_doel.*"));
	});
});

/* ══════════════════════════════════════════════════════════════════ *
 * Derde ronde van de zware controle
 * ══════════════════════════════════════════════════════════════════ */

describe("een ontbrekend antwoord is nooit 'niets aan de hand'", () => {
	/*
	 * De view-controle liep over de teruggegeven map in plaats van over de
	 * gevraagde views. Ontbrak er één, dan werd zijn transitieve
	 * denylist-controle volledig overgeslagen — precies de fail-open-vorm die
	 * dit bestand moet uitsluiten.
	 */
	it("weigert een view waarvoor de catalogus niets teruggeeft", async () => {
		const stille: Catalogus = {
			...catalogus,
			async viewBronnen() {
				return new Map(); // niets terug, zonder fout
			},
		};
		const r = await toets(
			stille,
			rol({ v_gebruikers: "lezen" }),
			"SELECT * FROM v_gebruikers",
			"lezen",
		);
		expect(r.ok, "een view zonder antwoord kwam erdoorheen").toBe(false);
	});

	it("weigert ook als de catalogus-lookup stil leeg terugkomt", async () => {
		// Er is bewust nog maar ÉÉN lookup: twee aparte bronnen konden
		// onafhankelijk leeg terugkomen, en dan werkte de CTE-truc weer.
		const stille: Catalogus = {
			...catalogus,
			async relaties() {
				return new Map();
			},
		};
		// Zonder de leeg-check zou de CTE-truc hier weer werken.
		const r = await toets(
			stille,
			rol({ klanten: "lezen" }),
			`SELECT * FROM transacties, klanten
              WHERE klanten.id IN (SELECT x FROM (WITH transacties AS (SELECT 1 AS x) SELECT x FROM transacties) q)`,
			"lezen",
		);
		expect(r.ok, "de CTE-truc kwam erdoorheen bij een lege bestaanscontrole").toBe(false);
	});
});

describe("views blijven bruikbaar voor afscherming", () => {
	/*
	 * Postgres legt voor élke constante in een view-definitie een
	 * afhankelijkheid vast op het DATATYPE. Een gewone afschermende view als
	 * `WHERE spanco <> 'order'` levert dus een pg_type-rij op de enum op
	 * (empirisch bevestigd tegen de echte database). Zou de weiger-default óók
	 * daarop slaan, dan was de view — het enige gereedschap voor kolom- en
	 * rij-afscherming dat dit model kent — praktisch onbruikbaar.
	 */
	it("een view die alleen een enum aanraakt is gewoon toekenbaar", async () => {
		const metEnum: Catalogus = {
			...catalogus,
			async viewBronnen() {
				// Zoals `bronnenVanViews` hem oplevert nadat de enum-tak is
				// doorgelaten: alleen de onderliggende tabel blijft over.
				return new Map([["v_klanten", ["klanten"]]]);
			},
		};
		const r = await toets(
			metEnum,
			rol({ v_klanten: "lezen" }),
			"SELECT * FROM v_klanten",
			"lezen",
		);
		expect(r.ok, r.ok ? "" : r.melding).toBe(true);
	});
});

/* ══════════════════════════════════════════════════════════════════ *
 * Slotronde — bruikbaarheid en de laatste randjes
 * ══════════════════════════════════════════════════════════════════ */

describe("gewone, nuttige query's worden niet geweigerd", () => {
	/*
	 * Na zoveel aanscherpingen is de reële vraag niet alleen "zit er een gat",
	 * maar ook: doet de legitieme weg het nog? De opdracht noemt subquery's,
	 * aggregaties en vensterfuncties uitdrukkelijk als gewenst.
	 *
	 * Deze vier kwamen er ooit NIET door — met als absurditeit dat `NOT EXISTS`
	 * wél mocht en het gewone `EXISTS` niet.
	 */
	const lezer = rol({ klanten: "lezen", contactpersonen: "lezen", contactmomenten: "lezen" });

	const moetLukken: [string, string][] = [
		[
			"EXISTS",
			`SELECT c.name FROM klanten c
              WHERE EXISTS (SELECT 1 FROM contactmomenten a WHERE a.company_id = c.id)`,
		],
		[
			"NOT EXISTS",
			`SELECT c.name FROM klanten c
              WHERE NOT EXISTS (SELECT 1 FROM contactmomenten a WHERE a.company_id = c.id)`,
		],
		[
			"DISTINCT ON",
			`SELECT DISTINCT ON (a.company_id) a.company_id, a.occurred_at
               FROM contactmomenten a ORDER BY a.company_id, a.occurred_at DESC`,
		],
		["= ANY (subquery)", "SELECT * FROM klanten WHERE id = ANY (SELECT company_id FROM contactmomenten)"],
		["ROLLUP", "SELECT spanco, count(*) FROM klanten GROUP BY ROLLUP (spanco)"],
		[
			"join + aggregatie + venster",
			`SELECT c.name, count(a.id) AS n,
                    row_number() OVER (ORDER BY count(a.id) DESC) AS plek
               FROM klanten c
               LEFT JOIN contactmomenten a ON a.company_id = c.id
              GROUP BY c.name HAVING count(a.id) > 0
              ORDER BY n DESC NULLS LAST LIMIT 10`,
		],
		[
			"CTE-keten met datumrekenwerk",
			`WITH recent AS (
                 SELECT company_id, max(occurred_at) AS laatst FROM contactmomenten
                  WHERE occurred_at > now() - interval '90 days' GROUP BY company_id
             ), verrijkt AS (
                 SELECT r.*, c.name FROM recent r JOIN klanten c ON c.id = r.company_id
             ) SELECT date_trunc('month', laatst) AS maand, count(*) FROM verrijkt GROUP BY 1`,
		],
		["FILTER", "SELECT count(*) FILTER (WHERE reached) AS bereikt FROM contactmomenten"],
		["casts en tekst", "SELECT upper(name), id::text FROM klanten WHERE name ILIKE '%bv%'"],
		["UNION ALL", "SELECT id FROM klanten UNION ALL SELECT company_id FROM contactpersonen"],
	];

	for (const [naam, sql] of moetLukken) {
		it(`laat ${naam} door`, async () => {
			const r = await toets(catalogus, lezer, sql, "lezen");
			expect(r.ok, r.ok ? "" : `onterecht geweigerd: ${r.melding}`).toBe(true);
		});
	}
});

describe("de CTE-botsing zegt wat er echt aan de hand is", () => {
	it("meldt dat de naam botst, niet dat de tabel dicht is", async () => {
		// "Deze rol heeft geen toegang tot klanten" zou liegen tegen iemand
		// die klanten wél mag lezen — en een AI-client stopt daarop.
		const r = await toets(
			catalogus,
			rol({ klanten: "lezen" }),
			"WITH klanten AS (SELECT 1 AS x) SELECT * FROM klanten",
			"lezen",
		);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.melding).toMatch(/andere naam/i);
	});

	it("maar verraadt niet of een onbekende naam bestaat", async () => {
		// Beide gevallen moeten dezelfde weigering geven, anders is één query
		// per naam genoeg om het hele schema af te tasten.
		const bestaat = await toets(
			catalogus,
			rol({}),
			"WITH mv_omzet AS (SELECT 1 AS x) SELECT x FROM mv_omzet",
			"lezen",
		);
		const bestaatNiet = await toets(
			catalogus,
			rol({}),
			"WITH zoiets_bestaat_niet AS (SELECT 1 AS x) SELECT x FROM zoiets_bestaat_niet",
			"lezen",
		);
		expect(bestaat.ok).toBe(false);
		expect(bestaatNiet.ok).toBe(false);
		const vorm = (m: string) => m.replace(/[a-z_0-9]+\.$/, "X.");
		if (!bestaat.ok && !bestaatNiet.ok) {
			expect(vorm(bestaat.melding)).toBe(vorm(bestaatNiet.melding));
		}
	});
});
