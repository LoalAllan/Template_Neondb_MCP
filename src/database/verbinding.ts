/**
 * Databaseverbindingen met Neon Postgres.
 *
 * We gebruiken de HTTP-modus van @neondatabase/serverless: elke query is één
 * HTTPS-request naar Neon. Geen pool, niets om open te houden — ideaal voor
 * Cloudflare Workers.
 *
 * ══════════════════════════════════════════════════════════════════
 * DRIE GESCHEIDEN GEBRUIKERS — en waarom dat geen luxe is
 * ══════════════════════════════════════════════════════════════════
 *
 *  • LEZER      mag uitsluitend SELECT, draait default_transaction_read_only
 *  • SCHRIJVER  mag uitsluitend INSERT en UPDATE — geen DELETE, geen DDL
 *  • SERVICE    leest de rechten en werkt de schrijfteller bij, meer niet
 *
 * De vierde, volledige gebruiker (de eigenaar) hoort bij de migraties en de
 * applicatie van de klant, en wordt door geen enkele MCP-tool gebruikt. Zonder die scheiding zou de
 * queryanalyse het énige slot zijn op precies de gevaarlijkste operatie.
 *
 * Zie sql/02-mcp-neon-rollen.sql voor de GRANT's die hierbij horen.
 *
 * ⚠ GEEN ENKELE TERUGVAL. Ontbreekt een van de drie connection strings, dan
 * weigert élke tool-aanroep. De vorige versie viel bij een ontbrekende
 * read-only string stilzwijgend terug op de schrijfverbinding en logde een
 * waarschuwing die niemand leest — vanaf dat moment draaiden alle leesqueries
 * met schrijfrechten, en niets in de UI verraadde dat. Dat is de klassieke
 * fail-open: de beveiliging verdwijnt zonder dat er iets stukgaat.
 *
 * Een Worker kent geen startmoment, dus de controle draait per aanroep.
 */

import { neon } from "@neondatabase/serverless";

/** Het type van de query-functie die `neon()` teruggeeft. */
export type NeonSql = ReturnType<typeof neon>;

export type Verbindingsrol = "lezer" | "schrijver" | "service";

const SECRET_VAN: Record<Verbindingsrol, keyof Env> = {
	lezer: "DATABASE_URL_LEZER",
	schrijver: "DATABASE_URL_SCHRIJVER",
	service: "DATABASE_URL_SERVICE",
};

/**
 * Secrets die niet over de database gaan maar wél veiligheidskritisch zijn.
 *
 * `COOKIE_ENCRYPTION_KEY` hoort hierbij: ontbreekt hij, dan tekent de
 * goedkeurings-cookie met de letterlijke string "undefined" — een publiek
 * bekende sleutel — en is die cookie te vervalsen. Er gaat niets stuk, dus
 * niemand merkt het. Precies de vorm die dit bestand moet uitsluiten.
 */
const OVERIGE_SECRETS: (keyof Env)[] = [
	"COOKIE_ENCRYPTION_KEY",
	"AZURE_CLIENT_ID",
	"AZURE_CLIENT_SECRET",
	"AZURE_TENANT_ID",
];

/** Gooit wanneer de configuratie onvolledig is. Luid en dicht, nooit stil en open. */
export class ConfiguratieFout extends Error {
	constructor(secret: string) {
		super(
			`De MCP-server is niet volledig geconfigureerd (${secret} ontbreekt). ` +
				"Vraag de beheerder de databaseverbindingen in te stellen.",
		);
		this.name = "ConfiguratieFout";
	}
}

/**
 * Controleert dat álle drie de verbindingen aanwezig zijn — niet alleen
 * degene die deze aanroep toevallig nodig heeft. Een half geconfigureerde
 * server hoort helemaal niet te werken; anders ontdek je het gat pas bij de
 * eerste aanroep die de ontbrekende verbinding raakt.
 */
export function controleerConfiguratie(env: Env): void {
	for (const secret of [...Object.values(SECRET_VAN), ...OVERIGE_SECRETS]) {
		if (!env[secret]) throw new ConfiguratieFout(String(secret));
	}
}

/**
 * Geeft een verse Neon query-functie voor de gevraagde rol.
 *
 * BEWUST: we cachen de `neon()`-instantie niet. De functie is stateless en
 * spotgoedkoop; per aanroep instantiëren voorkomt verrassingen bij hibernation
 * van het Durable Object.
 */
export function getDb(env: Env, rol: Verbindingsrol): NeonSql {
	controleerConfiguratie(env);
	const url = env[SECRET_VAN[rol]];
	if (!url) throw new ConfiguratieFout(String(SECRET_VAN[rol]));
	return neon(String(url));
}

/** Voert een database-operatie uit met timing en logging. */
export async function withDatabase<T>(
	env: Env,
	rol: Verbindingsrol,
	operatie: (sql: NeonSql) => Promise<T>,
): Promise<T> {
	const sql = getDb(env, rol);
	const start = Date.now();
	try {
		const resultaat = await operatie(sql);
		console.log(`Database-operatie (${rol}) geslaagd in ${Date.now() - start}ms`);
		return resultaat;
	} catch (fout) {
		console.error(`Database-operatie (${rol}) mislukt na ${Date.now() - start}ms:`, fout);
		throw fout;
	}
}
