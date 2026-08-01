/**
 * Hulpfuncties voor uniforme tool-antwoorden in MCP-formaat.
 *
 * Elke tool geeft een resultaat terug met "content blocks". Gebruik altijd
 * deze helpers zodat succes- en foutmeldingen er overal hetzelfde uitzien
 * en er nooit per ongeluk gevoelige details naar de client lekken.
 */

/** Het resultaatformaat dat de MCP SDK verwacht van een tool-handler. */
export type ToolResultaat = {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
};

/**
 * Bouwt een succesvol tool-antwoord.
 *
 * @param tekst  De boodschap voor de gebruiker (Nederlands).
 * @param data   Optionele structured data; wordt als JSON-codeblok toegevoegd.
 */
export function createSuccessResponse(tekst: string, data?: unknown): ToolResultaat {
	let volledigeTekst = tekst;
	if (data !== undefined) {
		volledigeTekst += `\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
	}
	return {
		content: [{ type: "text", text: volledigeTekst }],
	};
}

/**
 * Bouwt een fout-antwoord (isError: true) dat de MCP-client netjes toont.
 *
 * @param tekst    De foutboodschap voor de gebruiker (Nederlands, zonder
 *                 gevoelige details — haal databasefouten eerst door
 *                 formatDatabaseError).
 * @param details  Optionele extra context (bv. welk veld ongeldig was).
 */
export function createErrorResponse(tekst: string, details?: string): ToolResultaat {
	let volledigeTekst = `**Fout:** ${tekst}`;
	if (details) {
		volledigeTekst += `\n\n${details}`;
	}
	return {
		content: [{ type: "text", text: volledigeTekst }],
		isError: true,
	};
}

/**
 * Maakt van een database-exceptie een veilige, Nederlandstalige melding.
 *
 * Verbergt bewust alles wat op een connection string, wachtwoord of interne
 * infrastructuur lijkt: die informatie hoort nooit bij de MCP-client terecht
 * te komen. De volledige fout blijft beschikbaar in de Worker-logs
 * (`wrangler tail`).
 */
export function formatDatabaseError(fout: unknown): string {
	const boodschap = fout instanceof Error ? fout.message : String(fout);

	// Verberg connection strings en credentials
	if (/postgres(ql)?:\/\//i.test(boodschap) || /password|wachtwoord/i.test(boodschap)) {
		return "Er is een databasefout opgetreden (details staan in de serverlogs).";
	}
	// Postgres weigert de tabel: dat is geen storing maar het rechtenmodel dat
	// zijn werk doet. Zie rollen.config.ts — elke rol heeft eigen GRANT's.
	if (/permission denied/i.test(boodschap)) {
		return (
			"Je rol heeft geen toegang tot die tabel. " +
			"Gebruik `lijst_tabellen` om te zien welke tabellen je wél mag benaderen."
		);
	}
	// Time-outs apart benoemen: meestal een tijdelijk probleem
	if (/timeout|timed out/i.test(boodschap)) {
		return "De database reageerde niet op tijd. Probeer het zo meteen opnieuw.";
	}
	return `Databasefout: ${boodschap}`;
}
