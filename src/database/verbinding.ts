/**
 * Databaseverbindingen met Neon Postgres.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ER ZIJN TWEE SOORTEN VERBINDINGEN — HOU ZE STRIKT GESCHEIDEN:
 *
 *   1. DE AUTH-VERBINDING (secret DATABASE_URL)
 *      Wordt UITSLUITEND gebruikt door database/gebruikers.ts om op te zoeken
 *      welke rol een ingelogde gebruiker heeft. Dit is de enige verbinding die
 *      de gebruikerstabel mag lezen. Tools raken hem nooit aan.
 *      → getDb() / withDatabase()
 *
 *   2. DE ROL-VERBINDINGEN (secrets DATABASE_URL_ROL_1, _2, ...)
 *      Elke MCP-rol heeft in Neon een eigen Postgres-rol met GRANT's op
 *      precies de tabellen die bij die rol horen. De tools draaien op die
 *      verbinding. Vraagt een tool iets buiten de scope, dan weigert Postgres
 *      dat zelf — daar komt geen regel applicatiecode aan te pas.
 *      → getRolDb() / withRolDatabase()
 *
 * Waarom die scheiding? Zou een MCP-rol de gebruikerstabel kunnen schrijven,
 * dan kon iemand met schrijfrechten zijn eigen rolniveau ophogen.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * We gebruiken de HTTP-modus van @neondatabase/serverless: elke query is één
 * HTTPS-request naar Neon. Er is dus geen connectie-pool, niets om open te
 * houden en niets om te sluiten — ideaal voor Cloudflare Workers.
 *
 * BEWUST ONTWERP: we cachen de `neon()`-instantie NIET op de Durable
 * Object-instantie. De functie is stateless en spotgoedkoop om aan te maken;
 * per aanroep instantiëren is het aanbevolen patroon en voorkomt verrassingen
 * bij hibernation van het Durable Object.
 */

import { neon } from "@neondatabase/serverless";
import { rolConfig, rolNaam } from "../rollen.config";

/** Het type van de query-functie die `neon()` teruggeeft. */
export type NeonSql = ReturnType<typeof neon>;

// ═══════════════════════════════════════════════════════════════════════════
// 1. De auth-verbinding — alleen voor de gebruikers-lookup
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Geeft een verse query-functie op de AUTH-verbinding (DATABASE_URL).
 *
 * Gebruik dit NIET in tools — die horen op een rol-verbinding te draaien.
 */
export function getDb(env: Env): NeonSql {
	if (!env.DATABASE_URL) {
		throw new Error("Het secret DATABASE_URL ontbreekt. Zie README, stap 'Lokaal ontwikkelen' / 'Deployen'.");
	}
	return neon(env.DATABASE_URL);
}

/**
 * Voert een operatie uit op de auth-verbinding, met timing en logging.
 *
 * Fouten worden gelogd (zichtbaar via `wrangler tail`) en opnieuw gegooid.
 */
export async function withDatabase<T>(env: Env, operatie: (sql: NeonSql) => Promise<T>): Promise<T> {
	return meetEnLog("auth", () => operatie(getDb(env)));
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. De rol-verbindingen — waar alle tools op draaien
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Geeft een verse query-functie op de verbinding die bij `rol` hoort.
 *
 * Het secret staat in rollen.config.ts onder `secretNaam`. Ontbreekt het,
 * dan is de opzet voor die rol niet afgerond — dat is veruit de meest
 * voorkomende fout bij een nieuwe klant, dus de melding zegt precies wat er
 * moet gebeuren.
 */
export function getRolDb(env: Env, rol: number): NeonSql {
	const { secretNaam } = rolConfig(rol);
	const connectionString = (env as unknown as Record<string, string | undefined>)[secretNaam];

	if (!connectionString) {
		throw new Error(
			`Het secret ${secretNaam} voor rol ${rol} (${rolNaam(rol)}) ontbreekt. ` +
				`Maak in Neon de Postgres-rol met de juiste GRANT's aan en zet de connection string met: ` +
				`pnpm exec wrangler secret put ${secretNaam}`,
		);
	}

	return neon(connectionString);
}

/**
 * Voert een operatie uit op de rol-verbinding, met timing en logging.
 *
 * Voorbeeldgebruik in een tool:
 *
 *   const rijen = await withRolDatabase(env, rol, async (sql) => {
 *     // Waarden ALTIJD via ${...}-parameters — nooit string-concatenatie!
 *     return sql`SELECT id, naam FROM klanten WHERE naam ILIKE ${"%" + zoekterm + "%"}`;
 *   });
 *
 * Weigert Postgres de tabel (geen GRANT voor deze rol), dan komt die fout
 * hier gewoon naar boven; geef hem door aan formatDatabaseError().
 */
export async function withRolDatabase<T>(env: Env, rol: number, operatie: (sql: NeonSql) => Promise<T>): Promise<T> {
	return meetEnLog(`rol ${rol} (${rolNaam(rol)})`, () => operatie(getRolDb(env, rol)));
}

// ═══════════════════════════════════════════════════════════════════════════
// Gedeelde logging
// ═══════════════════════════════════════════════════════════════════════════

/** Voert een operatie uit en logt duur en uitkomst. */
async function meetEnLog<T>(label: string, operatie: () => Promise<T>): Promise<T> {
	const start = Date.now();
	try {
		const resultaat = await operatie();
		console.log(`Database-operatie [${label}] geslaagd in ${Date.now() - start}ms`);
		return resultaat;
	} catch (fout) {
		console.error(`Database-operatie [${label}] mislukt na ${Date.now() - start}ms:`, fout);
		throw fout;
	}
}
