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
	console.error("Databasefout (volledig):", boodschap);

	// Verberg connection strings en credentials.
	if (/postgres(ql)?:\/\//i.test(boodschap) || /password|wachtwoord/i.test(boodschap)) {
		return "Er is een databasefout opgetreden (details staan in de serverlogs).";
	}
	// Time-outs apart benoemen: meestal een tijdelijk probleem.
	if (/timeout|timed out|statement timeout|canceling statement/i.test(boodschap)) {
		return "De query duurde te lang en is afgebroken. Maak hem eenvoudiger of filter scherper.";
	}

	/*
	 * Een foreign-key-fout noemt de tabel waarnáár verwezen wordt — en dat kan
	 * een tabel zijn die de aanroeper nooit genoemd heeft en niet mag zien. Zo'n
	 * melding is een gratis kijkje in het schema, dus die geven we niet door.
	 *
	 * Er blijft een restrisico: of de INSERT slaagt of faalt hangt af van wat er
	 * in die gesloten tabel staat. Dat verschil is niet te verbergen zonder de
	 * schrijffunctie zelf onbruikbaar te maken. Het lekt weinig (één bit per
	 * poging), maar het lekt.
	 */
	if (/foreign key|violates foreign key constraint/i.test(boodschap)) {
		return "Deze waarde verwijst naar iets dat niet bestaat of niet toegankelijk is.";
	}

	/*
	 * Fouten die uitsluitend over de aangeleverde gegevens gaan, mogen wél door:
	 * daar heeft het model iets aan, en ze noemen niets wat het niet al wist.
	 */
	if (/violates not-null constraint|null value in column/i.test(boodschap)) {
		return `Een verplichte kolom bleef leeg. ${boodschap}`;
	}
	if (/duplicate key value|unique constraint/i.test(boodschap)) {
		return "Er bestaat al een rij met deze waarde.";
	}
	if (/invalid input syntax|out of range|violates check constraint/i.test(boodschap)) {
		return `De aangeleverde waarde klopt niet. ${boodschap}`;
	}
	if (/permission denied|must be owner|read-only transaction/i.test(boodschap)) {
		// De database heeft geweigerd. Wélke tabel dat was, houden we voor ons.
		return "Deze bewerking is niet toegestaan.";
	}

	// Alles wat we niet herkennen, geven we NIET door: een onbekende melding
	// kan tabelnamen bevatten die de aanroeper niet noemde.
	return "Er is een databasefout opgetreden (details staan in de serverlogs).";
}
