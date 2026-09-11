/**
 * Gedeelde opzet voor de poort-tests: een nagebootste catalogus en een
 * nagebootste rolcontext, zodat de volledige toetsing zonder database draait.
 */

import type { Catalogus, CatalogusRij } from "../src/database/poort";
import type { Niveau, RolContext } from "../src/database/rechten";

/** Een schema in het voorbeelddomein van de template, plus wat randgevallen. */
export const SCHEMA: Record<string, Partial<CatalogusRij> & { bronnen?: string[] | null }> = {
	klanten: { soort: "r" },
	contactpersonen: { soort: "r" },
	contactmomenten: { soort: "r" },
	transacties: { soort: "r" },
	kostcategorieen: { soort: "r" },
	instellingen: { soort: "r" },
	facturen: { soort: "r" },
	sync_logboek: { soort: "r" },
	gebruikers: { soort: "r" },
	mcp_rollen: { soort: "r" },
	mcp_rechten: { soort: "r" },
	mcp_schrijfquota: { soort: "r" },
	// Randgevallen die in het echte schema (nog) niet bestaan:
	// (matview / partitiemoeder / foreign table bestaan wél, maar vallen buiten
	//  relkind 'r'/'v' — daar zat een gat in de CTE-botsingscontrole)
	mv_omzet: { soort: "m" },
	part_moeder: { soort: "p" },
	ft_extern: { soort: "f" },
	v_klanten: { soort: "v", bronnen: ["klanten"] },
	v_gebruikers: { soort: "v", bronnen: ["gebruikers"] },
	v_onontleedbaar: { soort: "v", bronnen: null },
	partitie_kind: { soort: "r", is_partitiekind: true },
	moeder_met_kinderen: { soort: "r", heeft_kinderen: true },
};

export const catalogus: Catalogus = {
	async relaties(namen) {
		const uit = new Map<string, CatalogusRij>();
		for (const naam of namen) {
			const def = SCHEMA[naam];
			// Bootst de echte query na: die filtert BEWUST niet op relkind, zodat
			// ook een matview, partitiemoeder of foreign table zichtbaar is voor
			// de CTE-botsingscontrole. Het filteren gebeurt in de poort.
			if (!def) continue;
			uit.set(naam, {
				naam,
				soort: def.soort ?? "r",
				is_partitiekind: def.is_partitiekind ?? false,
				heeft_kinderen: def.heeft_kinderen ?? false,
			});
		}
		return uit;
	},
	async viewBronnen(views) {
		const uit = new Map<string, string[] | null>();
		for (const v of views) {
			const def = SCHEMA[v];
			// Let op: `?? []` zou null (niet te ontleden) stilzwijgend platslaan.
			uit.set(v, def && "bronnen" in def ? (def.bronnen ?? null) : []);
		}
		return uit;
	},
};

/** Bouwt een rolcontext uit een simpele tabel → stand-map. */
export function rol(rechten: Record<string, Niveau>): RolContext {
	return {
		gebruikerId: "gebruiker-1",
		rolId: "rol-1",
		rolNaam: "Test",
		rechten: new Map(Object.entries(rechten)),
	};
}
