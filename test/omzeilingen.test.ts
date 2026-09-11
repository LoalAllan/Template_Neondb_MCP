/**
 * Eén testgeval per rij uit de omzeilingstabel (§6).
 *
 * Elk van deze constructies ziet er onschuldig uit voor een oppervlakkige
 * controle. Als er ooit één van deze tests omslaat naar "toegestaan", is dat
 * geen falende test maar een gat.
 */

import { describe, expect, it } from "vitest";
import { analyseer } from "../src/database/analyse";
import { toets } from "../src/database/poort";
import {
	bouwLeesStatement,
	bouwSchrijfStatement,
	controleerUpdateVorm,
} from "../src/database/uitvoering";
import { catalogus, rol } from "./helpers";

/** Een royale rol: alles wat legitiem is, mag. Zo bewijst een weigering iets. */
const royaal = rol({
	klanten: "schrijven",
	contactpersonen: "schrijven",
	transacties: "schrijven",
	v_klanten: "lezen",
	v_gebruikers: "lezen",
	v_onontleedbaar: "lezen",
	partitie_kind: "lezen",
	moeder_met_kinderen: "lezen",
	instellingen: "schrijven",
});

async function geweigerd(sql: string, gewenst: "lezen" | "schrijven" = "lezen") {
	const r = await toets(catalogus, royaal, sql, gewenst);
	expect(r.ok, `Deze query kwam erdoorheen: ${sql}`).toBe(false);
	return r.ok ? "" : r.melding;
}

async function toegestaan(sql: string, gewenst: "lezen" | "schrijven" = "lezen") {
	const r = await toets(catalogus, royaal, sql, gewenst);
	expect(r.ok, `Deze query werd onterecht geweigerd: ${sql} — ${r.ok ? "" : r.melding}`).toBe(true);
	return r;
}

describe("§6 — omzeilingen", () => {
	it("schrijvende CTE: begint met WITH, maar schrijft", async () => {
		await geweigerd(
			"WITH x AS (INSERT INTO klanten (name) VALUES ('a') RETURNING *) SELECT * FROM x",
			"lezen",
		);
		await geweigerd(
			"WITH x AS (INSERT INTO klanten (name) VALUES ('a') RETURNING *) SELECT * FROM x",
			"schrijven",
		);
	});

	it("gestapelde statements", async () => {
		await geweigerd("SELECT 1; UPDATE klanten SET name = 'x'");
	});

	it("EXPLAIN ANALYZE voert de query écht uit", async () => {
		await geweigerd("EXPLAIN ANALYZE UPDATE klanten SET name = 'x' WHERE id = '1'");
	});

	it("tabel verstopt in een afgeleide tabel", async () => {
		await geweigerd("SELECT * FROM (SELECT id FROM contactmomenten) t");
	});

	it("data overhevelen uit een gesloten tabel", async () => {
		await geweigerd("INSERT INTO klanten (name) SELECT name FROM contactmomenten", "schrijven");
	});

	it("lek via een subquery in SET", async () => {
		await geweigerd(
			"UPDATE klanten SET name = (SELECT id FROM contactmomenten) WHERE id = '1'",
			"schrijven",
		);
	});

	it("SELECT … INTO maakt een tabel aan", async () => {
		await geweigerd("SELECT * INTO nieuwe_tabel FROM klanten");
	});

	it("commentaar rond sleutelwoorden breekt naïeve tekstcontroles", async () => {
		// De parser negeert commentaar; de boom blijft correct — dus dit is
		// gewoon een geldige SELECT op een toegestane tabel.
		await toegestaan("SELECT /* x */ id FROM klanten -- einde");
		// En het verstopt niets: de gesloten tabel wordt alsnog gezien.
		await geweigerd("SELECT id FROM /* verstopt */ contactmomenten");
		// De klassieker die de oude regexcontrole doorliet.
		await geweigerd("-- onschuldig\nDROP TABLE klanten");
	});

	it("hoofdlettertrucs", async () => {
		await toegestaan("sElEcT id FrOm klanten");
		await geweigerd("DeLeTe FrOm klanten WHERE id = '1'", "schrijven");
	});

	it("dezelfde tabel in een andere schrijfwijze", async () => {
		await toegestaan("SELECT id FROM public.klanten");
		// Bequoteerd met hoofdletters is niet ondubbelzinnig te herleiden.
		await geweigerd('SELECT id FROM "Companies"');
	});

	it("systeemcatalogi", async () => {
		await geweigerd("SELECT * FROM pg_catalog.pg_tables");
		await geweigerd("SELECT * FROM information_schema.columns");
		// Ook ongekwalificeerd: pg_catalog staat impliciet vooraan in het zoekpad.
		await geweigerd("SELECT relname FROM pg_class");
	});

	it("bestandssysteem, externe verbindingen en serverinstellingen", async () => {
		for (const fn of [
			"pg_read_file('/etc/passwd')",
			"pg_ls_dir('/')",
			"lo_import('/etc/passwd')",
			"dblink('x', 'y')",
			"pg_stat_file('/etc/passwd')",
			"query_to_xml('SELECT 1', true, true, '')",
			"set_config('search_path', 'evil', false)",
			"pg_terminate_backend(1)",
		]) {
			await geweigerd(`SELECT ${fn} FROM klanten`);
		}
	});

	it("uitputting via pg_sleep", async () => {
		await geweigerd("SELECT pg_sleep(3600) FROM klanten");
	});

	it("UPDATE zonder WHERE", async () => {
		expect(controleerUpdateVorm("UPDATE klanten SET name = 'x'")).toMatch(/zonder WHERE/i);
	});

	it("MERGE met een DELETE-tak", async () => {
		await geweigerd(
			"MERGE INTO klanten USING contactpersonen ON true WHEN MATCHED THEN DELETE",
			"schrijven",
		);
	});

	it("query op de rechten- of gebruikerstabel", async () => {
		await geweigerd("SELECT * FROM gebruikers");
		await geweigerd("SELECT * FROM mcp_rechten");
	});

	it("tabel verstopt in een RETURNING-subquery", async () => {
		await geweigerd(
			"INSERT INTO klanten (name) VALUES ('x') RETURNING (SELECT id FROM gebruikers)",
			"schrijven",
		);
	});

	it("schrijven op een tabel waarop de applicatie zelf handelt", async () => {
		await geweigerd(
			"UPDATE instellingen SET factuur_prefix = 'X' WHERE id = '1'",
			"schrijven",
		);
	});

	it("een view waarop deze rol geen recht heeft", async () => {
		const kaal = rol({ klanten: "lezen" });
		const r = await toets(catalogus, kaal, "SELECT * FROM v_klanten", "lezen");
		expect(r.ok).toBe(false);
	});

	it("een view over een beschermde tabel — de denylist geldt transitief", async () => {
		await geweigerd("SELECT * FROM v_gebruikers");
	});

	it("een view die niet volledig te ontleden is", async () => {
		await geweigerd("SELECT * FROM v_onontleedbaar");
	});

	it("een bewerkbare view als schrijfdoel", async () => {
		const schrijfbaarView = rol({ v_klanten: "schrijven", klanten: "lezen" });
		const r = await toets(
			catalogus,
			schrijfbaarView,
			"UPDATE v_klanten SET name = 'x' WHERE id = '1'",
			"schrijven",
		);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.melding).toMatch(/kan niet geschreven worden/i);
	});

	it("een door de gebruiker gedefinieerde functie", async () => {
		await geweigerd("SELECT mijn_functie() FROM klanten");
		await geweigerd("SELECT public.mijn_functie(id) FROM klanten");
	});

	it("altijd-ware voorwaarde", async () => {
		expect(controleerUpdateVorm("UPDATE klanten SET name = 'x' WHERE true")).toMatch(
			/elke rij/i,
		);
		expect(controleerUpdateVorm("UPDATE klanten SET name = 'x' WHERE 1=1")).toMatch(/elke rij/i);
	});

	it("een WHERE die élke vormcontrole doorstaat en toch alles raakt", async () => {
		// Deze komt bewust WEL door de vormcontrole — dat is precies het punt:
		// de vorm stopt hem niet, de rijbegrenzing wel.
		const sql = "UPDATE klanten SET name = '' WHERE id IS NOT NULL";
		expect(controleerUpdateVorm(sql)).toBeNull();
		const r = await toegestaan(sql, "schrijven");
		// De cast staat BINNEN de CASE — anders vouwt Postgres hem bij het plannen
		// uit en faalt de bewaking altijd, ook bij één rij.
		expect(r.ok && bouwSchrijfStatement(r.sql, r.heeftReturning, 100)).toContain(
			"CAST(CASE WHEN n > 100 THEN 'te breed' ELSE '0' END AS int)",
		);
	});

	it("een tabel verdubbelen met INSERT … SELECT uit zichzelf", async () => {
		const r = await toegestaan("INSERT INTO klanten (name) SELECT name FROM klanten", "schrijven");
		// Toegestaan qua rechten, maar wél begrensd op het aantal rijen.
		expect(r.ok && bouwSchrijfStatement(r.sql, r.heeftReturning, 100)).toContain("mcp_n");
	});

	it("upsert gedraagt zich als een UPDATE en telt als schrijven", async () => {
		const gelezen = analyseer(
			"INSERT INTO klanten (id, name) VALUES ('1','x') ON CONFLICT (id) DO UPDATE SET name = 'y'",
		);
		expect(gelezen.ok && gelezen.operatie).toBe("schrijven");
	});

	it("introspectiefuncties lezen het schema zonder één tabel aan te raken", async () => {
		await geweigerd("SELECT to_regclass('gebruikers')");
		await geweigerd("SELECT pg_get_viewdef('v_gebruikers')");
		await geweigerd("SELECT obj_description('klanten'::regclass)");
		await geweigerd("SELECT has_table_privilege('gebruikers', 'SELECT')");
		await geweigerd("SELECT current_setting('search_path')");
	});

	it("namen aftasten levert altijd dezelfde weigering op", async () => {
		const bestaatNiet = await geweigerd("SELECT * FROM bestaat_echt_niet");
		const gesloten = await geweigerd("SELECT * FROM contactmomenten");
		const opDenylist = await geweigerd("SELECT * FROM gebruikers");
		const partitiekind = await geweigerd("SELECT * FROM partitie_kind");
		const metKinderen = await geweigerd("SELECT * FROM moeder_met_kinderen");

		// Alleen de naam die de aanroeper zelf noemde verschilt; de vorm is gelijk.
		const vorm = (m: string) => m.replace(/`?[a-z_]+`?\.$/, "X.");
		expect(vorm(gesloten)).toBe(vorm(bestaatNiet));
		expect(vorm(opDenylist)).toBe(vorm(bestaatNiet));
		expect(vorm(partitiekind)).toBe(vorm(bestaatNiet));
		expect(vorm(metKinderen)).toBe(vorm(bestaatNiet));
	});

	it("een cast is geen functie-aanroep", async () => {
		await geweigerd("SELECT 'gebruikers'::regclass");
		await geweigerd("SELECT tableoid::regclass FROM klanten");
		await geweigerd("SELECT 1::regtype");
	});

	it("honderd rijen, gigabytes data", async () => {
		await geweigerd(
			"INSERT INTO klanten (note) SELECT repeat('x', 200000000) FROM generate_series(1,100)",
			"schrijven",
		);
		await geweigerd("SELECT lpad('x', 200000000) FROM klanten");
	});
});

describe("de omhullingen breken niet", () => {
	it("de bewaking is niet constant en wordt dus niet weggevouwen", () => {
		// Dit is de val waar dit ontwerp op stukging: een constante cast wordt
		// bij het PLANNEN uitgevoerd, ongeacht de CASE-tak, en dan faalt élke
		// schrijfactie. De operand moet van n afhangen.
		const uit = bouwSchrijfStatement("UPDATE t SET a = 1 WHERE id = '1'", false, 100);
		expect(uit).not.toContain("THEN CAST(");
		expect(uit).toContain("CAST(CASE WHEN n >");
	});

	it("een afsluitend regelcommentaar commentarieert het sluithaakje niet weg", () => {
		const uit = bouwLeesStatement("SELECT 1 -- einde");
		expect(uit).toContain("\n) AS mcp_begrensd");
		// De newline moet vóór het haakje staan, anders valt het in het commentaar.
		expect(uit.split("-- einde")[1].startsWith("\n")).toBe(true);
	});

	it("een afsluitende puntkomma wordt afgestrookt vóór het omhullen", () => {
		const a = analyseer("SELECT id FROM klanten;");
		expect(a.ok && a.genormaliseerd.endsWith(";")).toBe(false);
	});

	it("vraagt één rij méér op dan hij teruggeeft, zodat afkappen zichtbaar is", () => {
		expect(bouwLeesStatement("SELECT 1")).toMatch(/LIMIT 201$/);
	});
});
