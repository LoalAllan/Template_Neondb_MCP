/**
 * De cumulatieve schrijfteller.
 *
 * WAAROM DIT BESTAAT. Een grens per statement is geen grens. Honderd rijen
 * per keer, tweehonderd keer herhaald, wist een tabel net zo grondig — en een
 * model dat een weigering krijgt, probeert vanzelf een kleinere batch. Deze
 * teller is daarom niet een detail naast de rijbegrenzing, maar de andere
 * helft van dezelfde belofte.
 *
 * WAAROM IN DE DATABASE. Een teller in het geheugen is op Cloudflare Workers
 * bij elke aanroep weer nul, en dan is de hele grens een illusie.
 *
 * WAAROM RESERVEREN. De opdracht vraagt om de teller in dezelfde transactie
 * als het schrijven bij te werken. Dat kán hier niet: de schrijfgebruiker
 * heeft — terecht — geen enkel recht op deze tabel, en de tellertabel staat
 * op de denylist. We reserveren daarom vooraf het maximum via de smalle
 * serviceverbinding en corrigeren achteraf naar het werkelijke aantal. Valt
 * de Worker daartussenin om, dan is er te veel geteld: de veilige richting.
 *
 * Dit is geen logboek. We bewaren een getal, geen queries en geen geschiedenis.
 */

import { LIMIETEN } from "../mcp.config";
import { withDatabase } from "./verbinding";

/** Bovengrens per statement (richtwaarde uit de opdracht). */
export const MAX_RIJEN_PER_STATEMENT = LIMIETEN.maxRijenPerStatement;

/** Bovengrens per rol binnen het voortschrijdende venster. */
export const MAX_RIJEN_PER_VENSTER = LIMIETEN.maxRijenPerVenster;

/** De lengte van dat venster. */
export const VENSTER: string = LIMIETEN.venster;

/**
 * Reserveert ruimte in het venster. Geeft `false` als het venster vol is —
 * dan wordt er niet geschreven.
 *
 * Alles gebeurt in ÉÉN statement, atomair: ophogen en teruglezen tegelijk.
 * Twee gelijktijdige aanroepen kunnen elkaar zo niet inhalen.
 *
 * De rij wordt zo nodig aangemaakt; is het venster verlopen, dan begint de
 * teller opnieuw bij nul. Bij een volle teller wijzigt de UPDATE niets en
 * komt er geen rij terug.
 */
export async function reserveer(env: Env, rolId: string, aantal: number): Promise<boolean> {
	const rijen = await withDatabase(env, "service", async (sql) => {
		return (await sql.query(
			`INSERT INTO mcp_schrijfquota (rol_id, rijen, venster_start)
             VALUES ($1, $2, now())
             ON CONFLICT (rol_id) DO UPDATE
                SET rijen = CASE
                              WHEN mcp_schrijfquota.venster_start < now() - INTERVAL '${VENSTER}'
                              THEN $2
                              ELSE mcp_schrijfquota.rijen + $2
                            END,
                    venster_start = CASE
                              WHEN mcp_schrijfquota.venster_start < now() - INTERVAL '${VENSTER}'
                              THEN now()
                              ELSE mcp_schrijfquota.venster_start
                            END
              WHERE mcp_schrijfquota.venster_start < now() - INTERVAL '${VENSTER}'
                 OR mcp_schrijfquota.rijen + $2 <= $3
          RETURNING rijen`,
			[rolId, aantal, MAX_RIJEN_PER_VENSTER],
		)) as unknown[];
	});
	return rijen.length > 0;
}

/**
 * Corrigeert de reservering naar het werkelijke aantal geraakte rijen (of
 * geeft alles terug als het statement faalde). Nooit onder nul.
 *
 * Mislukt deze correctie, dan blijft de reservering staan. Dat telt te veel,
 * wat betekent dat de grens eerder dichtgaat — nooit later.
 */
export async function corrigeer(env: Env, rolId: string, teveel: number): Promise<void> {
	if (teveel <= 0) return;
	try {
		await withDatabase(env, "service", async (sql) => {
			await sql.query(
				`UPDATE mcp_schrijfquota
                    SET rijen = GREATEST(0, rijen - $2)
                  WHERE rol_id = $1`,
				[rolId, teveel],
			);
		});
	} catch (fout) {
		console.error("Kon de schrijfteller niet corrigeren (telt te veel, niet te weinig):", fout);
	}
}
