/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SQL-ALLOWLIST — WAT MAG ER ÜBERHAUPT UITGEVOERD WORDEN?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deze module beantwoordt één vraag: is dit statement van een SOORT die deze
 * MCP-server mag uitvoeren? Het gaat dus niet over WELKE tabellen — dat regelen
 * de GRANT's van de Postgres-rol (zie database/verbinding.ts).
 *
 * WAT WEL KAN:
 *   · lezen zonder beperking binnen de eigen tabellen — SELECT met joins,
 *     CTE's, window-functies, aggregaties, subqueries, berekende kolommen;
 *   · rijen toevoegen (INSERT), en bij rechten "wijzigen" ook bijwerken (UPDATE).
 *
 * WAT NOOIT KAN, VOOR GEEN ENKELE ROL:
 *   DELETE · TRUNCATE · DROP · CREATE · ALTER · GRANT · REVOKE · MERGE · COPY
 *   en alles wat verder aan de structuur of de sessie raakt.
 *
 * Er kan via deze server dus nooit data verdwijnen en nooit iets aan de
 * databasestructuur veranderen. Zie .claude/rules/mcp-rechten.md.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ DIT IS DE TWEEDE VERDEDIGINGSLINIE, NIET DE EERSTE.                     │
 * │ De eerste zijn de GRANT's in Neon: geen DELETE-recht, geen eigenaarschap│
 * │ en geen CREATE op het schema. Deze allowlist bestaat om een geweigerde   │
 * │ poging te beantwoorden met een begrijpelijke Nederlandse uitleg in       │
 * │ plaats van een ruwe Postgres-fout — en om een fout gezette GRANT niet    │
 * │ meteen fataal te laten zijn.                                            │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import type { Rechten } from "../rollen.config";

/** Resultaat van een SQL-validatie. */
export type SqlValidatie = {
	geldig: boolean;
	/** Nederlandse uitleg wanneer het statement geweigerd wordt. */
	fout?: string;
};

/**
 * Statementsoorten die deze server nooit uitvoert, met per soort een uitleg
 * die vertelt waaróm — zodat de AI-client het niet blijft proberen en de
 * gebruiker weet waar hij dan wél moet zijn.
 */
const VERBODEN_STATEMENTS: Record<string, string> = {
	delete:
		"DELETE is met deze MCP-server niet mogelijk: er kan via deze weg nooit data verwijderd worden. " +
		"Verwijderen gebeurt in de applicatie zelf. Is het de bedoeling iets als vervallen te markeren, " +
		"gebruik dan een statusveld met een UPDATE (als je rol dat mag).",
	truncate: "TRUNCATE is niet mogelijk: deze MCP-server kan nooit data verwijderen.",
	drop: "DROP is niet mogelijk: deze MCP-server mag niets aan de databasestructuur veranderen.",
	create:
		"CREATE is niet mogelijk: deze MCP-server mag geen tabellen, views of andere objecten aanmaken — " +
		"ook geen tijdelijke. Gebruik voor tussenresultaten een CTE (WITH ...) of een subquery.",
	alter: "ALTER is niet mogelijk: deze MCP-server mag niets aan de databasestructuur veranderen.",
	grant: "GRANT is niet mogelijk: rechten worden buiten de MCP-server om beheerd.",
	revoke: "REVOKE is niet mogelijk: rechten worden buiten de MCP-server om beheerd.",
	merge: "MERGE is niet mogelijk, omdat het rijen kan verwijderen. Gebruik een losse INSERT of UPDATE.",
	copy: "COPY is niet mogelijk met deze MCP-server.",
	vacuum: "VACUUM is niet mogelijk: onderhoud aan de database gebeurt buiten de MCP-server om.",
	reindex: "REINDEX is niet mogelijk: onderhoud aan de database gebeurt buiten de MCP-server om.",
	cluster: "CLUSTER is niet mogelijk: onderhoud aan de database gebeurt buiten de MCP-server om.",
	call: "CALL is niet mogelijk: stored procedures kunnen buiten het rechtenmodel om werken.",
	do: "DO is niet mogelijk: anonieme codeblokken kunnen buiten het rechtenmodel om werken.",
	execute: "EXECUTE is niet mogelijk: voorbereide statements kunnen de controle hierboven omzeilen.",
	prepare: "PREPARE is niet mogelijk: voorbereide statements kunnen de controle hierboven omzeilen.",
	set: "SET is niet mogelijk: sessie-instellingen mogen niet gewijzigd worden.",
	reset: "RESET is niet mogelijk: sessie-instellingen mogen niet gewijzigd worden.",
	begin: "Transacties worden door de server beheerd; BEGIN, COMMIT en ROLLBACK zijn niet toegestaan.",
	start: "Transacties worden door de server beheerd; BEGIN, COMMIT en ROLLBACK zijn niet toegestaan.",
	commit: "Transacties worden door de server beheerd; BEGIN, COMMIT en ROLLBACK zijn niet toegestaan.",
	rollback: "Transacties worden door de server beheerd; BEGIN, COMMIT en ROLLBACK zijn niet toegestaan.",
	savepoint: "Transacties worden door de server beheerd; SAVEPOINT is niet toegestaan.",
	listen: "LISTEN/NOTIFY zijn niet mogelijk met deze MCP-server.",
	notify: "LISTEN/NOTIFY zijn niet mogelijk met deze MCP-server.",
	comment: "COMMENT is niet mogelijk: deze MCP-server mag niets aan de databasestructuur veranderen.",
	refresh: "REFRESH MATERIALIZED VIEW is niet mogelijk met deze MCP-server.",
	lock: "LOCK is niet mogelijk: vergrendelingen worden niet handmatig beheerd.",
};

/** Vaste melding voor een UPDATE-poging door een rol die alleen mag toevoegen. */
const GEEN_UPDATE =
	"Jouw rol mag alleen nieuwe gegevens toevoegen, geen bestaande rijen wijzigen. " +
	"Gebruik een INSERT, of vraag een beheerder om ruimere rechten.";

/**
 * Maakt SQL analyseerbaar: commentaar weg, tekst in literals leeggemaakt,
 * alles lowercase.
 *
 * WAAROM DIT DE BELANGRIJKSTE FUNCTIE VAN DIT BESTAND IS:
 *
 *   · Zonder commentaar te strippen glipt `-- iets\nDELETE FROM klanten`
 *     erdoor: het eerste woord lijkt dan geen DELETE.
 *   · Zonder literals leeg te maken slaat de keywordscan vals alarm op een
 *     doodgewone leesquery als
 *       SELECT * FROM notities WHERE tekst = 'graag verwijderen'
 *     — de gebruiker krijgt dan een onbegrijpelijke weigering.
 *
 * De lengte van de tekst blijft gelijk (alles wordt vervangen door spaties),
 * zodat posities kloppen en niets per ongeluk aan elkaar plakt.
 */
export function normaliseerVoorAnalyse(sql: string): string {
	const tekens = [...sql];
	const uit: string[] = [];

	let i = 0;
	while (i < tekens.length) {
		const teken = tekens[i];
		const volgende = tekens[i + 1];

		// Regelcommentaar: -- tot einde regel
		if (teken === "-" && volgende === "-") {
			while (i < tekens.length && tekens[i] !== "\n") {
				uit.push(" ");
				i++;
			}
			continue;
		}

		// Blokcommentaar: /* ... */ (in Postgres nestbaar)
		if (teken === "/" && volgende === "*") {
			let diepte = 0;
			while (i < tekens.length) {
				if (tekens[i] === "/" && tekens[i + 1] === "*") {
					diepte++;
					uit.push(" ", " ");
					i += 2;
				} else if (tekens[i] === "*" && tekens[i + 1] === "/") {
					diepte--;
					uit.push(" ", " ");
					i += 2;
					if (diepte === 0) break;
				} else {
					uit.push(tekens[i] === "\n" ? "\n" : " ");
					i++;
				}
			}
			continue;
		}

		// Stringliteral: '...' met '' als escape
		if (teken === "'") {
			uit.push(" ");
			i++;
			while (i < tekens.length) {
				if (tekens[i] === "'" && tekens[i + 1] === "'") {
					uit.push(" ", " ");
					i += 2;
					continue;
				}
				if (tekens[i] === "'") {
					uit.push(" ");
					i++;
					break;
				}
				uit.push(tekens[i] === "\n" ? "\n" : " ");
				i++;
			}
			continue;
		}

		// Quoted identifier: "..." met "" als escape
		if (teken === '"') {
			uit.push(" ");
			i++;
			while (i < tekens.length) {
				if (tekens[i] === '"' && tekens[i + 1] === '"') {
					uit.push(" ", " ");
					i += 2;
					continue;
				}
				if (tekens[i] === '"') {
					uit.push(" ");
					i++;
					break;
				}
				uit.push(tekens[i] === "\n" ? "\n" : " ");
				i++;
			}
			continue;
		}

		// Dollar-quoted string: $$...$$ of $tag$...$tag$
		if (teken === "$") {
			const rest = tekens.slice(i).join("");
			const opening = /^\$[a-zA-Z_]*\$/.exec(rest);
			if (opening) {
				const tag = opening[0];
				const eind = rest.indexOf(tag, tag.length);
				const lengte = eind === -1 ? rest.length : eind + tag.length;
				for (let n = 0; n < lengte; n++) {
					uit.push(tekens[i + n] === "\n" ? "\n" : " ");
				}
				i += lengte;
				continue;
			}
		}

		uit.push(teken.toLowerCase());
		i++;
	}

	return uit.join("");
}

/** Het eerste SQL-sleutelwoord van een genormaliseerd statement. */
function eersteSleutelwoord(genormaliseerd: string): string {
	return /^\s*([a-z_]+)/.exec(genormaliseerd)?.[1] ?? "";
}

/** Komt een sleutelwoord ergens als los woord voor? */
function bevatSleutelwoord(genormaliseerd: string, woord: string): boolean {
	return new RegExp(`\\b${woord}\\b`).test(genormaliseerd);
}

/**
 * Controles die voor élk statement gelden, ongeacht lees of schrijf.
 *
 * @returns een foutmelding, of null als het statement deze horde neemt.
 */
function algemeneBezwaren(genormaliseerd: string): string | null {
	if (!genormaliseerd.trim()) {
		return "De SQL-query mag niet leeg zijn.";
	}

	// Meerdere statements. De Neon HTTP-driver voert er sowieso maar één uit,
	// maar een expliciete melding is duidelijker dan een cryptische driverfout.
	// Een afsluitende puntkomma mag; er mag alleen niets ná staan.
	const puntkomma = genormaliseerd.indexOf(";");
	if (puntkomma !== -1 && genormaliseerd.slice(puntkomma + 1).trim() !== "") {
		return "Voer één statement per aanroep uit; meerdere statements achter elkaar zijn niet toegestaan.";
	}

	const woord = eersteSleutelwoord(genormaliseerd);
	const bezwaar = VERBODEN_STATEMENTS[woord];
	if (bezwaar) {
		return bezwaar;
	}

	return null;
}

/**
 * Valideert een statement voor de LEES-tool.
 *
 * Toegestaan: SELECT, en WITH zolang er in de hele query niets wijzigends
 * voorkomt. Die laatste controle vangt de CTE-valkuil die veel implementaties
 * missen: `WITH x AS (DELETE FROM a RETURNING *) SELECT * FROM x` begint met
 * WITH, maar verwijdert wel degelijk rijen.
 */
export function valideerLeesQuery(sql: string): SqlValidatie {
	const genormaliseerd = normaliseerVoorAnalyse(sql);

	const bezwaar = algemeneBezwaren(genormaliseerd);
	if (bezwaar) {
		return { geldig: false, fout: bezwaar };
	}

	const woord = eersteSleutelwoord(genormaliseerd);

	if (woord === "select" || woord === "table" || woord === "values") {
		return { geldig: true };
	}

	if (woord === "with") {
		for (const wijzigend of ["insert", "update", "delete", "merge"]) {
			if (bevatSleutelwoord(genormaliseerd, wijzigend)) {
				return {
					geldig: false,
					fout:
						`Deze tool leest alleen. De query bevat een ${wijzigend.toUpperCase()} in een WITH-clausule, ` +
						"en dat wijzigt data.",
				};
			}
		}
		return { geldig: true };
	}

	return {
		geldig: false,
		fout: "Deze tool voert alleen leesqueries uit. Begin je query met SELECT of met een WITH-clausule.",
	};
}

/**
 * Valideert een statement voor de SCHRIJF-tool, gegeven de rechten van de rol.
 *
 * Toegestaan: INSERT altijd, UPDATE alleen bij rechten "wijzigen". Ook een
 * WITH-clausule mag — `WITH x AS (SELECT ...) INSERT INTO t SELECT * FROM x`
 * is een legitiem en nuttig patroon — zolang de wijzigende bewerkingen erin
 * beperkt blijven tot wat de rol mag.
 */
export function valideerSchrijfStatement(sql: string, rechten: Rechten): SqlValidatie {
	const genormaliseerd = normaliseerVoorAnalyse(sql);

	const bezwaar = algemeneBezwaren(genormaliseerd);
	if (bezwaar) {
		return { geldig: false, fout: bezwaar };
	}

	if (rechten === "lezen") {
		return { geldig: false, fout: "Jouw rol mag geen gegevens schrijven." };
	}

	const magWijzigen = rechten === "wijzigen";
	const woord = eersteSleutelwoord(genormaliseerd);

	if (woord !== "insert" && woord !== "update" && woord !== "with") {
		return {
			geldig: false,
			fout: magWijzigen
				? "Deze tool voert alleen INSERT- en UPDATE-statements uit."
				: "Deze tool voert alleen INSERT-statements uit.",
		};
	}

	if (woord === "update" && !magWijzigen) {
		return { geldig: false, fout: GEEN_UPDATE };
	}

	// Ook binnen een WITH-clausule mag er niets zitten wat de rol niet mag.
	// (DELETE en MERGE zijn hier al afgevangen door algemeneBezwaren als ze
	//  vooraan stonden; verstopt in een CTE moeten ze hier alsnog sneuvelen.)
	for (const verboden of ["delete", "merge", "truncate", "drop", "create", "alter"]) {
		if (bevatSleutelwoord(genormaliseerd, verboden)) {
			return {
				geldig: false,
				fout: VERBODEN_STATEMENTS[verboden] ?? `${verboden.toUpperCase()} is niet toegestaan.`,
			};
		}
	}

	if (!magWijzigen && bevatSleutelwoord(genormaliseerd, "update")) {
		return { geldig: false, fout: GEEN_UPDATE };
	}

	if (woord === "with" && !bevatSleutelwoord(genormaliseerd, "insert") && !bevatSleutelwoord(genormaliseerd, "update")) {
		return {
			geldig: false,
			fout: "Deze tool is bedoeld om gegevens te schrijven. Gebruik `lees_query` voor een query die alleen leest.",
		};
	}

	return { geldig: true };
}
