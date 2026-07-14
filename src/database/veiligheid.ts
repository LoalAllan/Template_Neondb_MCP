/**
 * SQL-vangnet voor tools die RUWE SQL accepteren (bv. een "voer een query
 * uit"-tool waarbij de AI-client zelf SQL aanlevert).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ EERLIJKE WAARSCHUWING: dit is een VANGNET, geen volwaardige beveiliging.│
 * │ Een regex-denylist is principieel omzeilbaar. De échte bescherming voor │
 * │ een lees-tool is een aparte READ-ONLY databaserol in Neon (eigen        │
 * │ connection string zonder schrijfrechten) — zie het recept in CLAUDE.md. │
 * │ Deze checks zijn de tweede verdedigingslinie, niet de eerste.           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Voor tools met VASTE queries en alleen variabele waarden heb je dit bestand
 * NIET nodig: gebruik daar gewone geparametriseerde tagged templates
 * (zie src/database/verbinding.ts).
 *
 * Context: de Neon HTTP-driver voert per aanroep maar ÉÉN statement uit,
 * dus gestapelde injecties ("...; DROP TABLE ...") falen sowieso al
 * server-side. De patronen hieronder vangen ze desondanks vroeg af, met een
 * duidelijke Nederlandse melding in plaats van een cryptische databasefout.
 */

/** Resultaat van een SQL-validatie. */
export type SqlValidatie = {
	geldig: boolean;
	/** Nederlandse uitleg wanneer de query geweigerd wordt. */
	fout?: string;
};

/**
 * Controleert ruwe SQL op overduidelijk gevaarlijke patronen.
 *
 * Roep dit aan als EERSTE stap in elke tool die ruwe SQL accepteert —
 * zowel lees- als schrijf-tools.
 */
export function valideerSqlQuery(sql: string): SqlValidatie {
	const genormaliseerd = sql.trim().toLowerCase();

	if (!genormaliseerd) {
		return { geldig: false, fout: "De SQL-query mag niet leeg zijn." };
	}

	// Overduidelijk destructieve of gestapelde patronen. Bewust beperkt
	// gehouden: schema-wijzigingen en gestapelde statements horen niet via
	// een generieke query-tool te lopen.
	const gevaarlijkePatronen: RegExp[] = [
		/^drop\s/i, // DROP als eerste statement
		/;\s*drop\s/i, // gestapeld DROP
		/^truncate\s/i,
		/;\s*truncate\s/i,
		/^alter\s/i,
		/;\s*alter\s/i,
		/;\s*create\s/i,
		/;\s*grant\s/i,
		/;\s*revoke\s/i,
		/;\s*delete\s+.*\s+where\s+1\s*=\s*1/i, // klassiek "verwijder alles"-patroon
		/;\s*update\s+.*\s+set\s+.*\s+where\s+1\s*=\s*1/i,
		/xp_cmdshell/i, // SQL Server-artefacten die in injectiepayloads opduiken
		/sp_executesql/i,
	];

	for (const patroon of gevaarlijkePatronen) {
		if (patroon.test(sql)) {
			return {
				geldig: false,
				fout: "De query bevat een potentieel gevaarlijk SQL-patroon en is geweigerd.",
			};
		}
	}

	return { geldig: true };
}

/**
 * Bepaalt of ruwe SQL een schrijf-/wijzigingsoperatie is.
 *
 * Gebruik dit in LEES-tools om schrijfpogingen te weigeren, en in
 * SCHRIJF-tools om te loggen wat er gewijzigd wordt.
 *
 * Let op de CTE-valkuil die veel implementaties missen: een query die met
 * WITH begint kan alsnog schrijven ("WITH x AS (DELETE ... RETURNING *) ...").
 * Daarom scannen we bij WITH-queries de hele tekst op wijzigende keywords.
 */
export function isSchrijfOperatie(sql: string): boolean {
	const genormaliseerd = sql.trim().toLowerCase();

	const schrijfKeywords = [
		"insert",
		"update",
		"delete",
		"merge",
		"create",
		"drop",
		"alter",
		"truncate",
		"grant",
		"revoke",
		"commit",
		"rollback",
	];

	if (schrijfKeywords.some((keyword) => genormaliseerd.startsWith(keyword))) {
		return true;
	}

	// CTE-valkuil: data-wijzigende statements verstopt in een WITH-query.
	if (genormaliseerd.startsWith("with")) {
		return /\b(insert|update|delete|merge)\b/i.test(genormaliseerd);
	}

	return false;
}
