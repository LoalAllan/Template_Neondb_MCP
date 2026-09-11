/**
 * Het database-deel van het bewijs (§13).
 *
 * Dit is wat NIET in de applicatiecode te testen valt: de GRANT's zelf, de
 * search_path, het read-only draaien, en de cumulatieve teller. Precies de
 * laag die geen enkele fout in de applicatiecode kan breken — en dus ook de
 * laag waarvan je zeker wilt weten dat hij er echt staat.
 *
 * ══════════════════════════════════════════════════════════════════
 * DRAAIT ALLEEN OP EEN TESTBRANCH.
 *
 * Deze tests schrijven en tellen. Ze slaan zichzelf over tenzij je expliciet
 * MCP_TEST_BRANCH=1 zet — dat is de rem tegen "even snel tegen productie".
 *
 *   1. Maak een branch van de Neon-database.
 *   2. Draai sql/01-mcp-tabellen.sql en sql/02-mcp-neon-rollen.sql daarop.
 *   3. Zet de drie connection strings in .dev.vars, plus MCP_TEST_EIGENAAR_URL
 *      (de eigenaar van de testbranch) voor het begrenzingenblok.
 *   4. MCP_TEST_BRANCH=1 pnpm test
 *
 * De tests kennen het schema van de klant niet: ze zoeken zelf een tabel op
 * waarop de lezer mag lezen en de schrijver mag schrijven.
 * ══════════════════════════════════════════════════════════════════
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DENYLIST } from "../src/database/beschermd";
import { MAX_RIJEN_PER_STATEMENT, MAX_RIJEN_PER_VENSTER } from "../src/database/quota";
import { SCHEMA } from "../src/mcp.config";

/** Leest .dev.vars (KEY=waarde) zonder extra dependency. */
function laadDevVars(): void {
	const pad = join(process.cwd(), ".dev.vars");
	if (!existsSync(pad)) return;
	for (const regel of readFileSync(pad, "utf-8").split("\n")) {
		const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(regel);
		if (!m) continue;
		const waarde = m[2].trim().replace(/^["']|["']$/g, "");
		if (!process.env[m[1]]) process.env[m[1]] = waarde;
	}
}
laadDevVars();

const AAN = process.env.MCP_TEST_BRANCH === "1";
const urls = {
	lezer: process.env.DATABASE_URL_LEZER,
	schrijver: process.env.DATABASE_URL_SCHRIJVER,
	service: process.env.DATABASE_URL_SERVICE,
	/** Alleen voor de opzet van het begrenzingenblok: de eigenaar van de TESTBRANCH. */
	eigenaar: process.env.MCP_TEST_EIGENAAR_URL,
};
const compleet = AAN && Boolean(urls.lezer && urls.schrijver && urls.service);

describe.skipIf(!compleet)("databaserechten", () => {
	const lezer = () => neon(urls.lezer!);
	const schrijver = () => neon(urls.schrijver!);
	const service = () => neon(urls.service!);

	/** Een bedrijfstabel waarop de gegeven verbinding het gegeven recht heeft, of null. */
	async function tabelMet(sql: ReturnType<typeof neon>, recht: string): Promise<string | null> {
		const rijen = (await sql.query(
			`SELECT table_name
               FROM information_schema.role_table_grants
              WHERE grantee = current_user AND table_schema = $1 AND privilege_type = $2
                AND table_name NOT LIKE 'mcp\\_%'
              ORDER BY table_name LIMIT 1`,
			[SCHEMA, recht],
		)) as { table_name: string }[];
		return rijen[0]?.table_name ?? null;
	}

	/** De eerste kolom van een tabel. */
	async function eersteKolom(sql: ReturnType<typeof neon>, tabel: string): Promise<string> {
		const rijen = (await sql.query(
			`SELECT a.attname FROM pg_attribute a
               JOIN pg_class c ON c.oid = a.attrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
              ORDER BY a.attnum LIMIT 1`,
			[SCHEMA, tabel],
		)) as { attname: string }[];
		return rijen[0].attname;
	}

	let leesTabel: string | null;
	let schrijfTabel: string | null;
	beforeAll(async () => {
		leesTabel = await tabelMet(lezer(), "SELECT");
		schrijfTabel = await tabelMet(schrijver(), "UPDATE");
	});

	/** Draait een query en zegt of hij slaagde. */
	async function lukt(sql: ReturnType<typeof neon>, tekst: string): Promise<boolean> {
		try {
			await sql.query(tekst, []);
			return true;
		} catch {
			return false;
		}
	}

	it("de controlequery geeft nul rijen — nergens DELETE, TRUNCATE, REFERENCES of TRIGGER", async () => {
		const rijen = (await service().query(
			`SELECT grantee, table_name, privilege_type
               FROM information_schema.role_table_grants
              WHERE grantee LIKE 'mcp\\_%'
                AND privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')`,
			[],
		)) as unknown[];
		expect(rijen, `te ruime GRANT gevonden: ${JSON.stringify(rijen)}`).toHaveLength(0);
	});

	it("lezer en schrijver kunnen de beschermde tabellen niet benaderen", async () => {
		for (const tabel of DENYLIST) {
			expect(await lukt(lezer(), `SELECT 1 FROM ${tabel} LIMIT 1`), `lezer las ${tabel}`).toBe(
				false,
			);
			expect(
				await lukt(schrijver(), `SELECT 1 FROM ${tabel} LIMIT 1`),
				`schrijver las ${tabel}`,
			).toBe(false);
		}
	});

	it("de lezer draait read-only", async () => {
		const rijen = (await lezer().query("SHOW default_transaction_read_only", [])) as Record<
			string,
			string
		>[];
		expect(Object.values(rijen[0])[0]).toBe("on");
	});

	it("de search_path staat vast op het toepassingsschema", async () => {
		for (const maak of [lezer, schrijver, service]) {
			const rijen = (await maak().query("SHOW search_path", [])) as Record<string, string>[];
			expect(Object.values(rijen[0])[0]).toMatch(new RegExp(`^${SCHEMA}(, pg_temp)?$`));
		}
	});

	it("niemand kan objecten aanmaken in het schema", async () => {
		for (const maak of [lezer, schrijver, service]) {
			expect(await lukt(maak(), "CREATE TABLE mcp_probeersel (id int)")).toBe(false);
		}
	});

	it("de schrijver kan niets verwijderen of aan de structuur wijzigen", async () => {
		expect(schrijfTabel, "geen tabel met UPDATE-recht voor mcp_schrijver gevonden").not.toBeNull();
		expect(await lukt(schrijver(), `DELETE FROM ${schrijfTabel} WHERE false`)).toBe(false);
		expect(await lukt(schrijver(), `TRUNCATE ${schrijfTabel}`)).toBe(false);
		expect(await lukt(schrijver(), `DROP TABLE ${schrijfTabel}`)).toBe(false);
		expect(await lukt(schrijver(), `ALTER TABLE ${schrijfTabel} ADD COLUMN mcp_probeersel int`)).toBe(false);
	});

	it("de serviceverbinding kan niets buiten haar eigen huishouding", async () => {
		// Wel: de rechten lezen.
		expect(await lukt(service(), "SELECT 1 FROM mcp_rechten LIMIT 1")).toBe(true);
		// Niet: bedrijfsdata lezen of schrijven.
		expect(leesTabel, "geen tabel met SELECT-recht voor mcp_lezer gevonden").not.toBeNull();
		expect(await lukt(service(), `SELECT 1 FROM ${leesTabel} LIMIT 1`)).toBe(false);
		expect(await lukt(service(), `UPDATE ${leesTabel} SET ${await eersteKolom(lezer(), leesTabel!)} = NULL WHERE false`)).toBe(false);
		// Niet: rollen of rechten wijzigen — anders kon de server zichzelf promoveren.
		expect(await lukt(service(), "UPDATE mcp_rechten SET niveau = 'schrijven'")).toBe(false);
		expect(await lukt(service(), "INSERT INTO mcp_rollen (naam) VALUES ('x')")).toBe(false);
	});

	/*
	 * Deze drie zijn er omdat het één keer misging: mcp_schrijver had INSERT en
	 * UPDATE maar geen SELECT, en mcp_service geen SELECT op de tellertabel.
	 * Postgres eist SELECT op élke kolom die je leest — ook in een WHERE, een
	 * RETURNING of de reserveringsquery. Gevolg: geen enkele schrijfactie werkte,
	 * met als melding "permission denied" die als "niet toegestaan" bij de
	 * gebruiker aankwam. De controlequery hierboven zag daar niets van, want die
	 * zoekt alleen naar TE RUIME rechten.
	 */
	it("de schrijver kan een UPDATE met een WHERE uitvoeren", async () => {
		// De poort EIST een WHERE, en een WHERE op een kolom vereist SELECT.
		// Raakt nul rijen, dus er verandert niets.
		expect(schrijfTabel, "geen tabel met UPDATE-recht voor mcp_schrijver gevonden").not.toBeNull();
		const kolom = await eersteKolom(schrijver(), schrijfTabel!);
		expect(await lukt(schrijver(), `UPDATE ${schrijfTabel} SET ${kolom} = ${kolom} WHERE false`)).toBe(true);
	});

	it("de schrijver kan lezen wat hij mag schrijven", async () => {
		expect(await lukt(schrijver(), `SELECT 1 FROM ${schrijfTabel} LIMIT 1`)).toBe(true);
		// Maar niet de beschermde tabellen.
		for (const tabel of DENYLIST) {
			expect(await lukt(schrijver(), `SELECT 1 FROM ${tabel} LIMIT 1`)).toBe(false);
		}
	});

	it("de serviceverbinding kan haar eigen teller teruglezen", async () => {
		// De reserveringsquery leest `rijen` in haar WHERE-tak en met RETURNING.
		expect(await lukt(service(), "SELECT rijen FROM mcp_schrijfquota LIMIT 1")).toBe(true);
	});

	it("ingebouwde functies blijven werken (anders draait geen enkele query)", async () => {
		expect(await lukt(lezer(), `SELECT lower('A'), now(), count(*) FROM ${leesTabel}`)).toBe(true);
	});
});

/* ══════════════════════════════════════════════════════════════════ *
 * De begrenzingen — het belangrijkste stuk van de hele set.
 *
 * Deze tests bewijzen dat de belofte "via MCP kan geen data verdwijnen" ook
 * opgaat voor OVERSCHRIJVEN. Zonder deze twee is de rijgrens een vertraging
 * in plaats van een slot.
 * ══════════════════════════════════════════════════════════════════ */

describe.skipIf(!compleet || !urls.eigenaar)("begrenzingen", () => {
	// De testrol aanmaken vraagt INSERT op mcp_rollen, en dat heeft de
	// serviceverbinding terecht niet. Daarvoor de eigenaar van de TESTBRANCH.
	const sql = () => neon(urls.eigenaar!);
	let rolId: string;

	beforeAll(async () => {
		const rijen = (await sql().query(
			`INSERT INTO mcp_rollen (naam, omschrijving)
             VALUES ('__test_begrenzing', 'Tijdelijk, aangemaakt door de testset')
             ON CONFLICT (naam) DO UPDATE SET omschrijving = EXCLUDED.omschrijving
          RETURNING id`,
			[],
		)) as { id: string }[];
		rolId = rijen[0].id;
		await sql().query("DELETE FROM mcp_schrijfquota WHERE rol_id = $1", [rolId]);
	});

	afterAll(async () => {
		await sql().query("DELETE FROM mcp_rollen WHERE id = $1", [rolId]);
	});

	it("herhaalde kleine schrijfacties lopen tegen de cumulatieve teller aan", async () => {
		const { reserveer } = await import("../src/database/quota");
		const env = { DATABASE_URL_SERVICE: urls.service } as unknown as Env;

		const past = Math.floor(MAX_RIJEN_PER_VENSTER / MAX_RIJEN_PER_STATEMENT);
		let toegestaan = 0;
		for (let i = 0; i < past + 5; i++) {
			if (await reserveer(env, rolId, MAX_RIJEN_PER_STATEMENT)) toegestaan++;
		}
		// Honderd rijen per keer, tweehonderd keer herhaald, wist een tabel net
		// zo grondig. Precies daarom stopt het zodra het venster vol is.
		expect(toegestaan).toBe(past);
	});

	it("een verlopen venster laat de teller weer leeglopen", async () => {
		const { reserveer } = await import("../src/database/quota");
		const env = { DATABASE_URL_SERVICE: urls.service } as unknown as Env;
		await sql().query(
			"UPDATE mcp_schrijfquota SET venster_start = now() - INTERVAL '2 hours' WHERE rol_id = $1",
			[rolId],
		);
		expect(await reserveer(env, rolId, MAX_RIJEN_PER_STATEMENT)).toBe(true);
	});
});

describe.skipIf(compleet)("databaserechten (overgeslagen)", () => {
	it("draait pas met MCP_TEST_BRANCH=1 en de drie connection strings", () => {
		expect(true).toBe(true);
	});
});
