/**
 * Databaseverbinding met Neon Postgres.
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

/** Het type van de query-functie die `neon()` teruggeeft. */
export type NeonSql = ReturnType<typeof neon>;

/**
 * Geeft een verse Neon query-functie terug.
 *
 * Gebruik in tools bij voorkeur `withDatabase()` (hieronder) in plaats van
 * deze functie rechtstreeks — dan krijg je logging en nette foutafhandeling
 * cadeau.
 */
export function getDb(env: Env): NeonSql {
	return neon(env.DATABASE_URL);
}

/**
 * Voert een database-operatie uit met timing en logging.
 *
 * Voorbeeldgebruik in een tool:
 *
 *   const klanten = await withDatabase(env, async (sql) => {
 *     // Waarden ALTIJD via ${...}-parameters — nooit string-concatenatie!
 *     return sql`SELECT id, naam FROM klanten WHERE naam ILIKE ${"%" + zoekterm + "%"}`;
 *   });
 *
 * Fouten worden gelogd (zichtbaar via `wrangler tail`) en opnieuw gegooid;
 * vang ze in de tool op en geef ze door aan formatDatabaseError().
 */
export async function withDatabase<T>(env: Env, operatie: (sql: NeonSql) => Promise<T>): Promise<T> {
	const sql = getDb(env);
	const start = Date.now();
	try {
		const resultaat = await operatie(sql);
		console.log(`Database-operatie geslaagd in ${Date.now() - start}ms`);
		return resultaat;
	} catch (fout) {
		console.error(`Database-operatie mislukt na ${Date.now() - start}ms:`, fout);
		throw fout;
	}
}
