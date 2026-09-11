import { defineConfig } from "vitest/config";

/**
 * De queryanalyse en de rechtentoetsing zijn pure functies met een
 * injecteerbare catalogus (zie database/poort.ts). Ze draaien dus in gewoon
 * Node, zonder database en zonder Worker-runtime — de hele matrix uit §13 en
 * élke omzeiling uit §6 lopen in milliseconden.
 *
 * Wat NIET hier getest wordt, is wat in de database thuishoort: de GRANT's,
 * search_path, read-only en de controlequery. Daarvoor is
 * test/privileges.db.test.ts, dat alleen draait met MCP_TEST_BRANCH=1.
 */
export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		setupFiles: ["test/setup.ts"],
	},
});
