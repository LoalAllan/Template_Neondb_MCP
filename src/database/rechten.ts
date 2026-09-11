/**
 * Identiteit en rechten — vers gelezen bij ÉLKE tool-aanroep.
 *
 * ⚠ VEILIGHEIDSKRITISCH.
 *
 * Niet cachen. Niet uit het token halen. Niet één keer per sessie. Een
 * ingetrokken recht moet onmiddellijk gelden, en dus bij de eerstvolgende
 * aanroep. Eén kleine, geïndexeerde query per aanroep is goedkoper dan de
 * vraag of een ingetrokken recht al is aangekomen.
 *
 * Alles hier loopt over de smalle SERVICEVERBINDING. Lezer en schrijver
 * hebben op deze tabellen geen enkel recht — dat is precies de bedoeling.
 */

import { GEBRUIKERS, SCHEMA, veiligeIdentifier } from "../mcp.config";
import { DENYLIST } from "./beschermd";
import { withDatabase } from "./verbinding";

/** De gebruikerstabel en -kolommen van de klant, gevalideerd vóór interpolatie. */
const G = {
	tabel: veiligeIdentifier(GEBRUIKERS.tabel),
	id: veiligeIdentifier(GEBRUIKERS.idKolom),
	email: veiligeIdentifier(GEBRUIKERS.emailKolom),
	updatedAt: GEBRUIKERS.updatedAtKolom ? veiligeIdentifier(GEBRUIKERS.updatedAtKolom) : null,
};

export type Niveau = "lezen" | "schrijven";

export interface RolContext {
	gebruikerId: string;
	rolId: string;
	rolNaam: string;
	/** Alleen tabellen waarop toegang IS verleend. Geen rij = geen toegang. */
	rechten: Map<string, Niveau>;
}

/** Gegooid als de beveiliging niet betrouwbaar te handhaven is. Fail-closed. */
export class HandhavingFout extends Error {
	constructor(boodschap: string) {
		super(boodschap);
		this.name = "HandhavingFout";
	}
}

/**
 * Bestaat élke naam op de denylist ook echt in de database?
 *
 * De denylist werkt op tabelnamen. Wordt een beschermde tabel hernoemd, dan
 * matcht de lijst niet meer en verandert de rechtentabel in een gewone tabel
 * die iemand kan openzetten — dezelfde eigenschap die elders een voordeel is
 * (een hernoemde tabel verliest zijn rechten), werkt hier tegen ons.
 *
 * Ontbreekt er één, dan weigert de server dienst. Zo kan een hernoeming de
 * beveiliging nooit ongemerkt uitschakelen.
 */
async function controleerDenylist(env: Env): Promise<void> {
	const rijen = (await withDatabase(env, "service", async (sql) =>
		sql.query(
			`SELECT c.relname AS naam
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = $2 AND c.relname = ANY($1)`,
			[DENYLIST as string[], SCHEMA],
		),
	)) as { naam: string }[];

	const gevonden = new Set(rijen.map((r) => r.naam));
	const ontbreekt = DENYLIST.filter((n) => !gevonden.has(n));
	if (ontbreekt.length > 0) {
		throw new HandhavingFout(
			"De MCP-server weigert dienst: een beschermde tabel is hernoemd of verdwenen " +
				`(${ontbreekt.join(", ")}). Neem contact op met de beheerder.`,
		);
	}
}

/**
 * Zoekt de gebruiker op de ONVERANDERLIJKE Entra object-id.
 *
 * Een e-mailadres is bij de meeste identiteitsproviders te wijzigen en
 * opnieuw uit te geven: wie het adres van een vertrokken beheerder toegewezen
 * krijgt, zou diens rol erven. Daarom matchen we op de oid.
 *
 * Is de oid nog niet vastgelegd, dan binden we hem éénmalig aan de rij die op
 * e-mail matcht. Die UPDATE is voorwaardelijk (`entra_oid IS NULL`), zodat
 * twee gelijktijdige logins elkaar niet kunnen overschrijven. Een identiteit
 * zonder rij in de tabel krijgt geen toegang en wordt NOOIT automatisch
 * aangemaakt.
 *
 * ⚠ BINDEN MAG ALLEEN OP HET LOGIN-PAD (`magBinden`). Deed elke tool-aanroep
 * het ook, dan bindt een nóg geldig token zich zonder tussenkomst aan élke rij
 * die op e-mail matcht en nog vrij is. Twee concrete gevolgen: een beheerder
 * die een rij "ontkoppelt" om hem aan een opvolger te geven, ziet de
 * vertrokken collega zich bij zijn eerstvolgende tool-aanroep opnieuw binden;
 * en wordt een adres later opnieuw aangemaakt met een hógere rol, dan erft het
 * oude token die rol. Binden hoort bij het moment dat iemand zich aanmeldt.
 */
async function zoekGebruiker(
	env: Env,
	oid: string,
	email: string,
	magBinden: boolean,
): Promise<{ id: string; rolId: string | null; rolNaam: string | null } | null> {
	const schoon = email.toLowerCase().trim();

	const zoek = async () =>
		(await withDatabase(env, "service", async (sql) =>
			sql.query(
				`SELECT g.${G.id} AS id, r.id AS rol_id, r.naam AS rol_naam
                   FROM ${G.tabel} g
              LEFT JOIN mcp_rollen r ON r.id = g.mcp_rol_id
                  WHERE g.entra_oid = $1
                  LIMIT 2`,
				[oid],
			),
		)) as { id: string; rol_id: string | null; rol_naam: string | null }[];

	let rijen = await zoek();
	if (rijen.length > 1) {
		// Het hele model rust op "precies één rij". Bij twijfel weigeren.
		throw new HandhavingFout("Je account is niet eenduidig te herleiden.");
	}

	if (rijen.length === 0 && magBinden) {
		// Eerste login: de oid vastleggen op de rij die op e-mail matcht.
		await withDatabase(env, "service", async (sql) =>
			sql.query(
				`UPDATE ${G.tabel}
                    SET entra_oid = $1${G.updatedAt ? `, ${G.updatedAt} = now()` : ""}
                  WHERE lower(${G.email}) = $2 AND entra_oid IS NULL`,
				[oid, schoon],
			),
		);
		rijen = await zoek();
	}

	const rij = rijen[0];
	if (!rij) return null;
	return { id: rij.id, rolId: rij.rol_id, rolNaam: rij.rol_naam };
}

/**
 * De volledige context voor deze aanroep: wie het is, welke rol hij draagt en
 * wélke tabellen die rol mag lezen of schrijven.
 *
 * Geeft `null` als de gebruiker geen rij heeft of geen rol draagt — beide
 * betekenen: geen MCP-toegang.
 */
export async function leesRolContext(
	env: Env,
	oid: string,
	email: string,
	opties: { magBinden?: boolean } = {},
): Promise<RolContext | null> {
	await controleerDenylist(env);

	const gebruiker = await zoekGebruiker(env, oid, email, opties.magBinden === true);
	if (!gebruiker || !gebruiker.rolId) return null;

	const rijen = (await withDatabase(env, "service", async (sql) =>
		sql.query(`SELECT tabelnaam, niveau FROM mcp_rechten WHERE rol_id = $1`, [gebruiker.rolId]),
	)) as { tabelnaam: string; niveau: Niveau }[];

	const rechten = new Map<string, Niveau>();
	for (const r of rijen) {
		// Een recht dat naar een beschermde naam wijst, ruimen we hier stil op:
		// de beschermde lijst kan mee zijn gegroeid met het schema, terwijl een
		// eerder toegekend recht gewoon is blijven staan.
		if (DENYLIST.includes(r.tabelnaam)) continue;
		// Expliciet tegen de twee bekende waarden toetsen. Zou er ooit een derde
		// waarde in de enum komen, dan mag die niet stilzwijgend als "toegang"
		// gelden puur omdat de string niet leeg is.
		if (r.niveau !== "lezen" && r.niveau !== "schrijven") continue;
		rechten.set(r.tabelnaam, r.niveau);
	}

	return {
		gebruikerId: gebruiker.id,
		rolId: gebruiker.rolId,
		rolNaam: gebruiker.rolNaam ?? "onbekend",
		rechten,
	};
}
