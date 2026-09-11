/**
 * De testmatrix uit §13: elke combinatie van rol-stand en operatie.
 *
 * Dit is het bewijs dat de poort dicht is. Zonder deze set weet niemand of de
 * belofte nog geldt.
 */

import { describe, expect, it } from "vitest";
import { toets } from "../src/database/poort";
import { catalogus, rol } from "./helpers";

const GEEN_TOEGANG = /geen toegang tot/i;

async function lees(context: ReturnType<typeof rol>, sql: string) {
	return toets(catalogus, context, sql, "lezen");
}
async function schrijf(context: ReturnType<typeof rol>, sql: string) {
	return toets(catalogus, context, sql, "schrijven");
}

describe("stand: geen toegang (geen rij in de rechtentabel)", () => {
	const geen = rol({});

	it("weigert SELECT", async () => {
		const r = await lees(geen, "SELECT * FROM klanten");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.melding).toMatch(GEEN_TOEGANG);
	});

	it("weigert INSERT", async () => {
		const r = await schrijf(geen, "INSERT INTO klanten (name) VALUES ('x')");
		expect(r.ok).toBe(false);
	});

	it("weigert UPDATE", async () => {
		const r = await schrijf(geen, "UPDATE klanten SET name = 'x' WHERE id = '1'");
		expect(r.ok).toBe(false);
	});
});

describe("stand: lezen", () => {
	const lezer = rol({ klanten: "lezen", contactpersonen: "lezen" });

	it("staat SELECT toe", async () => {
		const r = await lees(lezer, "SELECT * FROM klanten");
		expect(r.ok).toBe(true);
	});

	it("staat een rijke SELECT toe — lezen mag ruim zijn", async () => {
		const r = await lees(
			lezer,
			`WITH warm AS (SELECT id, name FROM klanten WHERE name IS NOT NULL)
             SELECT w.name, count(c.id) AS n,
                    row_number() OVER (ORDER BY count(c.id) DESC) AS plek
               FROM warm w
               LEFT JOIN contactpersonen c ON c.company_id = w.id
              GROUP BY w.name
             HAVING count(c.id) > 0
              ORDER BY n DESC
              LIMIT 10`,
		);
		expect(r.ok).toBe(true);
	});

	it("weigert INSERT", async () => {
		const r = await schrijf(lezer, "INSERT INTO klanten (name) VALUES ('x')");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.melding).toMatch(GEEN_TOEGANG);
	});

	it("weigert UPDATE", async () => {
		const r = await schrijf(lezer, "UPDATE klanten SET name = 'x' WHERE id = '1'");
		expect(r.ok).toBe(false);
	});

	it("weigert een tabel waarop deze rol geen rij heeft", async () => {
		const r = await lees(lezer, "SELECT * FROM transacties");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.melding).toMatch(GEEN_TOEGANG);
	});
});

describe("stand: schrijven", () => {
	const schrijver = rol({ klanten: "schrijven", contactpersonen: "lezen" });

	it("staat SELECT toe — schrijven impliceert lezen", async () => {
		const r = await lees(schrijver, "SELECT * FROM klanten");
		expect(r.ok).toBe(true);
	});

	it("staat INSERT toe", async () => {
		const r = await schrijf(schrijver, "INSERT INTO klanten (name) VALUES ('x')");
		expect(r.ok).toBe(true);
	});

	it("staat UPDATE toe", async () => {
		const r = await schrijf(schrijver, "UPDATE klanten SET name = 'x' WHERE id = '1'");
		expect(r.ok).toBe(true);
	});

	it("impliceert niets over andere tabellen", async () => {
		const r = await schrijf(schrijver, "UPDATE contactpersonen SET first_name = 'x' WHERE id = '1'");
		expect(r.ok).toBe(false);
	});
});

describe("altijd geweigerd, ongeacht de stand", () => {
	// Deze rol heeft schrijfrecht op alles wat in de tests voorkomt.
	const alles = rol({
		klanten: "schrijven",
		contactpersonen: "schrijven",
		transacties: "schrijven",
	});

	const verboden: [string, string][] = [
		["DELETE", "DELETE FROM klanten WHERE id = '1'"],
		["DELETE zonder WHERE", "DELETE FROM klanten"],
		["TRUNCATE", "TRUNCATE klanten"],
		["DROP", "DROP TABLE klanten"],
		["DROP met voorloopspatie", "   DROP TABLE klanten"],
		["CREATE", "CREATE TABLE nieuw (id int)"],
		["ALTER", "ALTER TABLE klanten ADD COLUMN x int"],
		["GRANT", "GRANT SELECT ON klanten TO iemand"],
		["REVOKE", "REVOKE SELECT ON klanten FROM iemand"],
		["MERGE", "MERGE INTO klanten USING contactpersonen ON true WHEN MATCHED THEN DELETE"],
		["COPY", "COPY klanten FROM '/etc/passwd'"],
		["DO-blok", "DO $$ BEGIN PERFORM 1; END $$"],
		["CALL", "CALL iets()"],
		["SET", "SET search_path = evil"],
		["BEGIN", "BEGIN"],
		["COMMIT", "COMMIT"],
		["VACUUM", "VACUUM klanten"],
		["SELECT INTO", "SELECT * INTO nieuwe_tabel FROM klanten"],
	];

	for (const [naam, sql] of verboden) {
		it(`weigert ${naam}`, async () => {
			const lezend = await toets(catalogus, alles, sql, "lezen");
			const schrijvend = await toets(catalogus, alles, sql, "schrijven");
			expect(lezend.ok, `${naam} kwam door de leestool`).toBe(false);
			expect(schrijvend.ok, `${naam} kwam door de schrijftool`).toBe(false);
		});
	}
});

describe("de denylist gaat vóór de rechtentabel", () => {
	// Zelfs als er — door welke fout dan ook — een recht op een beschermde
	// tabel in de database zou staan.
	const besmet = rol({
		gebruikers: "schrijven",
		mcp_rollen: "schrijven",
		mcp_rechten: "schrijven",
		mcp_schrijfquota: "schrijven",
		klanten: "lezen",
	});

	for (const tabel of ["gebruikers", "mcp_rollen", "mcp_rechten", "mcp_schrijfquota"]) {
		it(`weigert lezen van ${tabel}`, async () => {
			const r = await toets(catalogus, besmet, `SELECT * FROM ${tabel}`, "lezen");
			expect(r.ok).toBe(false);
		});
		it(`weigert schrijven in ${tabel}`, async () => {
			const r = await toets(
				catalogus,
				besmet,
				`UPDATE ${tabel} SET x = 1 WHERE id = '1'`,
				"schrijven",
			);
			expect(r.ok).toBe(false);
		});
	}

	it("weigert de rechtenescalatie uit scenario 3", async () => {
		const r = await toets(
			catalogus,
			besmet,
			"UPDATE gebruikers SET mcp_rol_id = 'de-hoogste' WHERE email = 'ik@x.be'",
			"schrijven",
		);
		expect(r.ok).toBe(false);
	});
});

describe("tabellen waarop de applicatie zelf handelt", () => {
	const ruim = rol({
		instellingen: "schrijven",
		facturen: "schrijven",
		sync_logboek: "schrijven",
	});

	it("laat lezen toe", async () => {
		const r = await toets(catalogus, ruim, "SELECT * FROM instellingen", "lezen");
		expect(r.ok).toBe(true);
	});

	for (const tabel of ["instellingen", "facturen", "sync_logboek"]) {
		it(`weigert schrijven in ${tabel}, ook al staat het recht er`, async () => {
			const r = await toets(
				catalogus,
				ruim,
				`UPDATE ${tabel} SET naam = 'x' WHERE id = '1'`,
				"schrijven",
			);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.melding).toMatch(/handelt de applicatie zelf/i);
		});
	}
});

describe("het fail-safe-pad: een nieuwe tabel is dicht", () => {
	it("weigert een tabel die niet in de rechtentabel staat", async () => {
		const r = await toets(catalogus, rol({ klanten: "lezen" }), "SELECT * FROM contactmomenten", "lezen");
		expect(r.ok).toBe(false);
	});
});
