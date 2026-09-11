/**
 * Testconfiguratie: vervangt `src/mcp.config.ts` door een vaste variant in het
 * voorbeelddomein van de template.
 *
 * Daardoor blijven de tests groen ongeacht wat een klant later in
 * mcp.config.ts invult, én bewijzen ze het gedrag van NOOIT_SCHRIJVEN met een
 * niet-lege lijst. De echte config wordt met `importOriginal` ingeladen, zodat
 * alleen de klantspecifieke velden overschreven worden.
 */

import { vi } from "vitest";

vi.mock("../src/mcp.config", async (importOriginal) => {
	const echt = await importOriginal<typeof import("../src/mcp.config")>();
	return {
		...echt,
		SERVER_NAAM: "MCP-server (test)",
		SCHEMA: "public",
		GEBRUIKERS: { tabel: "gebruikers", idKolom: "id", emailKolom: "email", updatedAtKolom: "updated_at" },
		NOOIT_SCHRIJVEN: ["instellingen", "facturen", "sync_logboek"],
	};
});
