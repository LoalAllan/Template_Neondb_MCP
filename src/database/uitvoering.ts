/**
 * De omhullingen waarmee een goedgekeurde query begrensd wordt uitgevoerd.
 *
 * ⚠ VEILIGHEIDSKRITISCH. Dit is de plek waar "MCP kan geen data wissen" ook
 * voor OVERSCHRIJVEN waargemaakt wordt.
 *
 * Ze staan hier apart van de tools zodat ze los te testen zijn: een omhulling
 * die stilletjes breekt op een afsluitend commentaar of een puntkomma is geen
 * theoretisch probleem maar precies hoe een begrenzing verdwijnt zonder dat
 * iemand het merkt.
 */

import { LIMIETEN } from "../mcp.config";
import { kaalGemaakt } from "./analyse";

/** Bovengrens op wat één leesquery terugmag. */
export const MAX_RIJEN = LIMIETEN.maxRijenLees;

/**
 * Omhult een goedgekeurde SELECT met een LIMIT.
 *
 * We vragen er ÉÉN rij meer op dan we teruggeven; komt die terug, dan weten we
 * dat er is afgekapt en kunnen we dat melden. Een model dat tweehonderd van
 * vijfduizend rijen krijgt zonder dat te weten, trekt conclusies over data die
 * het nooit gezien heeft.
 *
 * Twee dingen die dit stilletjes zouden breken:
 *  - een afsluitende puntkomma (die strookt `analyseer` er al af);
 *  - een afsluitend regelcommentaar — zonder de newline vóór het sluithaakje
 *    commentarieert dat ons haakje weg. Vandaar de \n.
 *
 * Dit begrenst het ANTWOORD, niet het werk: een aggregatie of een cartesisch
 * product draait binnenin volledig. De statement_timeout op de databaserol is
 * daar de echte rem.
 */
export function bouwLeesStatement(sql: string): string {
	return `SELECT * FROM (\n${sql}\n) AS mcp_begrensd LIMIT ${MAX_RIJEN + 1}`;
}

/**
 * Omhult een goedgekeurde INSERT of UPDATE zó dat hij zichzelf terugdraait
 * wanneer hij te veel rijen raakt.
 *
 * WAAROM NIET OP DE VORM VAN DE WHERE. Een WHERE eisen is niet genoeg:
 * `UPDATE klanten SET naam='' WHERE id IS NOT NULL` heeft een WHERE, gebruikt
 * een kolom van de doeltabel, is niet altijd-waar van vorm — en wist net zo
 * goed de hele tabel als een DELETE. Elke controle op de vórm van de
 * voorwaarde is te omzeilen met één extra woord. Daarom begrenzen we op het
 * AANTAL GERAAKTE RIJEN.
 *
 * HOE HET TERUGDRAAIT. De data-wijzigende CTE en de omhullende SELECT zitten
 * in één statement, en dus in één impliciete transactie. Laten we die SELECT
 * falen — met een opzettelijke cast van tekst naar integer — dan aborteert het
 * statement en rolt de schrijfactie mee terug. Dat werkt ook in een
 * HTTP-driver die geen interactieve transacties kent.
 *
 * @param heeftReturning Heeft het statement een eigen RETURNING? Zonder
 *   RETURNING levert een data-wijzigende CTE geen kolommen op en weigert
 *   Postgres eruit te selecteren; dan voegen we er zelf één toe.
 */
export function bouwSchrijfStatement(
	sql: string,
	heeftReturning: boolean,
	maxRijen: number,
): string {
	/*
	 * ⚠ DE CAST MOET BÍNNEN DE CASE STAAN.
	 *
	 * Schrijf je `CASE WHEN n > 100 THEN CAST('te breed' AS int) ELSE 0 END`,
	 * dan is die cast een constante uitdrukking en vouwt Postgres hem al bij het
	 * PLANNEN uit — ongeacht welke tak wordt genomen. De fout treedt dan ALTIJD
	 * op, ook bij één gewijzigde rij, en de schrijftool is volledig kapot.
	 *
	 * Door de cast om de CASE heen te zetten hangt de operand van `n` af, kan er
	 * niets gevouwen worden, en faalt hij precies wanneer we dat willen.
	 * (Empirisch vastgesteld tegen Postgres, niet uit de documentatie.)
	 */
	const bewaking = `CAST(CASE WHEN n > ${maxRijen} THEN 'te breed' ELSE '0' END AS int)`;

	if (!heeftReturning) {
		return `WITH mcp_doel AS (\n${sql}\nRETURNING 1 AS mcp_rij),
     mcp_n AS (SELECT count(*)::int AS n FROM mcp_doel)
SELECT n AS mcp_geraakt, ${bewaking} AS mcp_bewaking
  FROM mcp_n`;
	}

	// Met een eigen RETURNING geven we die rijen gewoon door.
	return `WITH mcp_doel AS (\n${sql}\n),
     mcp_n AS (SELECT count(*)::int AS n FROM mcp_doel)
SELECT (SELECT n FROM mcp_n) AS mcp_geraakt,
       (SELECT ${bewaking} FROM mcp_n) AS mcp_bewaking,
       mcp_doel.*
  FROM mcp_doel
 LIMIT ${MAX_RIJEN}`;
}

/**
 * Goedkope vormcontroles op een UPDATE: een ontbrekende WHERE en een
 * altijd-ware voorwaarde.
 *
 * Dit is expliciet NIET de begrenzing — die staat hierboven — en ook niet de
 * poort: `analyseer()` toetst hetzelfde op de SYNTAXBOOM, waar het niet te
 * omzeilen is. Deze functie is het vangnet ernaast.
 *
 * Twee dingen die de vorige versie stilletjes uitschakelden, en waarom hij nu
 * op `kaalGemaakt()` werkt:
 *  - `/* c *\/ UPDATE …` begon niet met "update", dus de check sloeg volledig
 *    over — een UPDATE zonder WHERE kwam er zo doorheen;
 *  - `SET naam = 'where dit'` liet hem denken dat er een WHERE stond.
 * Commentaar en stringliterals moeten er dus eerst uit.
 */
export function controleerUpdateVorm(sql: string): string | null {
	const kaal = kaalGemaakt(sql).replace(/\s+/g, " ").trim().toLowerCase();
	if (!/^update\b/.test(kaal)) return null;
	if (!/\bwhere\b/.test(kaal)) {
		return "Een UPDATE zonder WHERE zou de hele tabel overschrijven en is niet toegestaan.";
	}
	if (/\bwhere\s+(true|1\s*=\s*1)\b/.test(kaal)) {
		return "Deze voorwaarde geldt voor elke rij en is daarom niet toegestaan.";
	}
	return null;
}

/**
 * Herkent de opzettelijke cast-fout waarmee we de rijgrens afdwingen.
 *
 * Alleen op de sentinel `te breed` matchen, niet op "invalid input syntax" in
 * het algemeen: een gewone castfout in de query van de gebruiker zou anders
 * gemeld worden als "raakt te veel rijen", wat niet klopt en het foutzoeken
 * vertroebelt. In beide gevallen wordt er niets geschreven — alleen de melding
 * verschilde.
 */
export function isBegrenzingsFout(fout: unknown): boolean {
	const bericht = fout instanceof Error ? fout.message : String(fout);
	return bericht.includes("te breed");
}
