/**
 * De drie databasetools. Dit is wat de gebruiker daadwerkelijk ziet wanneer
 * hij de MCP-server aan zijn AI-client koppelt.
 *
 * ⚠ VEILIGHEIDSKRITISCH — elke wijziging valt onder de zware controle.
 *
 * DE SET IS DRIE TOOLS EN GROEIT NIET. Elke rol krijgt dezelfde toolnamen;
 * nooit varianten per rol of per domein. Zodra een gebruiker twee query-tools
 * naast elkaar ziet, kan zijn AI-client niet meer verklaren waarom een tabel
 * in de ene wél bestaat en in de andere niet — en gaat hij gokken. Moet
 * iemand minder kunnen, dan haal je tabellen uit zijn rol of zet je zijn
 * stand lager. Je schrijft NOOIT een beperktere tool.
 *
 * De enige toegestane variatie: een rol zonder enig schrijfrecht krijgt de
 * schrijftool niet geregistreerd. Dat is netheid, geen beveiliging — de verse
 * toetsing bij de aanroep is het echte slot.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SCHEMA } from "../mcp.config";
import type { Props } from "../types";
import { MAX_QUERY_LENGTE } from "../database/analyse";
import { magNooitSchrijven, staatOpDenylist } from "../database/beschermd";
import { neonCatalogus, toets } from "../database/poort";
import { leesRolContext, type RolContext } from "../database/rechten";
import { MAX_RIJEN_PER_STATEMENT, corrigeer, reserveer } from "../database/quota";
import {
	MAX_RIJEN,
	bouwLeesStatement,
	bouwSchrijfStatement,
	controleerUpdateVorm,
	isBegrenzingsFout,
} from "../database/uitvoering";
import { withDatabase } from "../database/verbinding";
import { createErrorResponse, createSuccessResponse, formatDatabaseError } from "../utils/antwoorden";

/**
 * De rechten opnieuw lezen bij ÉLKE aanroep (regel 6). De context die bij het
 * opzetten van de sessie is gelezen, dient alleen om de toolbeschrijvingen te
 * vullen; hij wordt nooit gebruikt om iets toe te staan.
 */
async function verseContext(env: Env, props: Props): Promise<RolContext | null> {
	return leesRolContext(env, props.oid, props.email);
}

/**
 * De tabellen die deze rol op een bepaald niveau mag benaderen, gefilterd
 * langs dezelfde twee lijsten als de rest.
 *
 * Dat filteren gebeurt niet voor de vorm: de beschermde lijst groeit mee met
 * het schema, en een recht dat vóór die groei is toegekend blijft gewoon
 * staan. De toetsing weigert de query dan keurig — maar een ongefilterde
 * opsomming heeft de tabelnaam al aan het model verteld.
 */
function zichtbareTabellen(context: RolContext, niveau?: "schrijven"): string[] {
	const uit: string[] = [];
	for (const [tabel, stand] of context.rechten) {
		if (staatOpDenylist(tabel)) continue;
		if (niveau === "schrijven") {
			if (stand !== "schrijven" || magNooitSchrijven(tabel)) continue;
		}
		uit.push(tabel);
	}
	return uit.sort();
}

function opsomming(namen: string[]): string {
	return namen.length > 0 ? namen.join(", ") : "(geen)";
}

/**
 * Maakt kolomnamen uniek, zodat een join met gelijknamige kolommen aan beide
 * kanten geen waarden verliest. `id, id` wordt `id, id_2`.
 */
function uniekeKolomnamen(namen: string[]): string[] {
	const gezien = new Map<string, number>();
	return namen.map((naam) => {
		const n = (gezien.get(naam) ?? 0) + 1;
		gezien.set(naam, n);
		return n === 1 ? naam : `${naam}_${n}`;
	});
}

/**
 * Houdt van een lijst namen alleen over wat deze rol daadwerkelijk mag
 * bevragen: bestaat in het toepassingsschema, is een gewone tabel of een toegestane view,
 * is geen partitiekind en heeft geen overervende kinderen, en ligt er bij een
 * view niets beschermds onder.
 *
 * Wat hier afvalt, noemen we nergens — ook niet als naam.
 */
async function toegankelijk(env: Env, namen: string[]): Promise<string[]> {
	if (namen.length === 0) return [];
	const catalogus = neonCatalogus(env);
	const perNaam = await catalogus.relaties(namen);

	const bruikbaar = namen.filter((naam) => {
		const rij = perNaam.get(naam);
		if (!rij) return false;
		// Dezelfde soort-poort als toetsRelaties: een materialized view, een
		// partitiemoeder of een foreign table valt hier af. Zonder deze regel
		// hing de afscherming af van een filter in een ándere query, en week
		// de telling in de melding af van wat er getoond wordt.
		if (!["r", "v"].includes(rij.soort)) return false;
		return !rij.is_partitiekind && !rij.heeft_kinderen;
	});

	const views = bruikbaar.filter((n) => perNaam.get(n)?.soort === "v");
	if (views.length === 0) return bruikbaar;

	const onder = await catalogus.viewBronnen(views);
	return bruikbaar.filter((naam) => {
		if (perNaam.get(naam)?.soort !== "v") return true;
		const bronnen = onder.get(naam);
		if (bronnen === null || bronnen === undefined) return false;
		return !bronnen.some((b) => staatOpDenylist(b));
	});
}

export function registreerDatabaseTools(
	server: McpServer,
	env: Env,
	props: Props,
	context: RolContext,
): void {
	const leesbaar = zichtbareTabellen(context);
	const schrijfbaar = zichtbareTabellen(context, "schrijven");

	/* ══════════════════════════════════════════════════════════════════ *
	 * 1. lijst_tabellen — het controle-instrument
	 * ══════════════════════════════════════════════════════════════════ */
	server.tool(
		"lijst_tabellen",
		"Toont welke databasetabellen jouw rol mag benaderen, met per tabel de kolommen, " +
			"hun type, de uitleg die in de database staat, en of toevoegen en bijwerken zijn " +
			"toegestaan. Begin hier: tabellen die hier niet in staan, bestaan voor jou niet.",
		{},
		{ readOnlyHint: true, openWorldHint: false },
		async () => {
			try {
				const vers = await verseContext(env, props);
				if (!vers) return createErrorResponse(GEEN_TOEGANG);

				const ruweNamen = zichtbareTabellen(vers);

				/*
				 * Dezelfde poortcontrole als bij lees_query — niet alleen een
				 * naamfilter.
				 *
				 * Zonder dit toont deze tool de kolomnamen, types en
				 * databasecommentaren van een tabel waar de rol niet bij kan.
				 * Concreet: een recht op een view wordt bij het publiceren
				 * transitief gecontroleerd, maar wordt die view daarna met
				 * CREATE OR REPLACE op een beschermde tabel gericht, dan blijft
				 * de rij in mcp_rechten staan. lees_query weigert hem dan
				 * keurig — maar de tabellen-tool had het schema al prijsgegeven.
				 * Dat is precies het structuurlek dat regel 1 uitsluit.
				 */
				const namen = await toegankelijk(env, ruweNamen);
				if (namen.length === 0) {
					// Een leeg antwoord is informatiever dan een fout, en lekt niets.
					return createSuccessResponse(
						`Je rol "${vers.rolNaam}" heeft nog geen enkele tabel toegewezen gekregen. ` +
							"Vraag de beheerder om toegang tot wat je nodig hebt.",
						{ jij: props.naam, rol: vers.rolNaam, tabellen: [] },
					);
				}

				// Vers uit de RECHTENTABEL gecombineerd met de catalogus — niet uit de
				// databaserechten. Die zijn de vereniging over alle rollen en zouden
				// tabellen van andere rollen prijsgeven.
				const rijen = (await withDatabase(env, "service", async (sql) =>
					sql.query(
						`SELECT c.relname AS tabel,
                                c.relkind::text AS soort,
                                a.attname AS kolom,
                                format_type(a.atttypid, a.atttypmod) AS type,
                                NOT a.attnotnull AS nullable,
                                col_description(c.oid, a.attnum) AS uitleg
                           FROM pg_class c
                           JOIN pg_namespace n ON n.oid = c.relnamespace
                           JOIN pg_attribute a ON a.attrelid = c.oid
                          WHERE n.nspname = $2
                            AND c.relkind IN ('r', 'v')
                            AND c.relname = ANY($1)
                            AND a.attnum > 0
                            AND NOT a.attisdropped
                          ORDER BY c.relname, a.attnum`,
						[namen, SCHEMA],
					),
				)) as {
					tabel: string;
					soort: string;
					kolom: string;
					type: string;
					nullable: boolean;
					uitleg: string | null;
				}[];

				const perTabel = new Map<string, Record<string, unknown>>();
				for (const r of rijen) {
					let t = perTabel.get(r.tabel);
					if (!t) {
						const stand = vers.rechten.get(r.tabel);
						const isView = r.soort === "v";
						t = {
							tabel: r.tabel,
							soort: isView ? "view" : "tabel",
							mag_toevoegen: stand === "schrijven" && !isView && !magNooitSchrijven(r.tabel),
							mag_bijwerken: stand === "schrijven" && !isView && !magNooitSchrijven(r.tabel),
							kolommen: [] as unknown[],
						};
						if (isView) {
							t.opmerking = "Dit is een view: lezen kan, schrijven niet.";
						} else if (stand === "schrijven" && magNooitSchrijven(r.tabel)) {
							t.opmerking = "Op deze tabel handelt de applicatie zelf; schrijven is uitgesloten.";
						}
						perTabel.set(r.tabel, t);
					}
					(t.kolommen as unknown[]).push({
						naam: r.kolom,
						type: r.type,
						verplicht: !r.nullable,
						uitleg: r.uitleg ?? undefined,
					});
				}

				return createSuccessResponse(
					`Je bent ${props.naam} en draagt de rol "${vers.rolNaam}". ` +
						`Je mag ${perTabel.size} tabel(len) benaderen. Verwijderen en ` +
						"structuurwijzigingen zijn nooit mogelijk.",
					{ jij: props.naam, rol: vers.rolNaam, tabellen: [...perTabel.values()] },
				);
			} catch (fout) {
				return createErrorResponse(formatDatabaseError(fout));
			}
		},
	);

	/* ══════════════════════════════════════════════════════════════════ *
	 * 2. lees_query
	 *
	 * Binnen de tabellen van de rol is lezen ONBEPERKT en gewenst: joins,
	 * CTE's, subquery's, vensterfuncties, aggregaties, berekende kolommen —
	 * allemaal prima. Daar zit de hele waarde van een MCP-koppeling. De
	 * beperking gaat over wát er verandert en wélke tabellen bereikbaar zijn,
	 * niet over hoe slim je mag lezen.
	 * ══════════════════════════════════════════════════════════════════ */
	server.tool(
		"lees_query",
		`Voert één SELECT uit op de database en geeft de rijen terug. ` +
			`Je mag deze tabellen lezen: ${opsomming(leesbaar)}. ` +
			"Joins, CTE's, subquery's, aggregaties en vensterfuncties zijn allemaal toegestaan " +
			"zolang elke genoemde tabel in die lijst staat. Alleen ingebouwde functies mogen; " +
			"krijg je een melding dat een functie of constructie niet is toegestaan, schrijf de " +
			"query dan anders — de tabellen zijn dan niet het probleem. Een WITH-onderdeel mag " +
			"geen bestaande tabelnaam dragen. Toevoegen, bijwerken, verwijderen en " +
			"structuurwijzigingen kunnen hier niet.",
		{
			sql: z
				.string()
				.min(1)
				.max(MAX_QUERY_LENGTE)
				.describe("De uit te voeren SELECT-query (alleen lezen, één statement)"),
		},
		{ readOnlyHint: true, openWorldHint: false },
		async ({ sql: queryTekst }) => {
			try {
				const vers = await verseContext(env, props);
				if (!vers) return createErrorResponse(GEEN_TOEGANG);

				const oordeel = await toets(neonCatalogus(env), vers, queryTekst, "lezen");
				if (!oordeel.ok) return createErrorResponse(oordeel.melding);

				const omhuld = bouwLeesStatement(oordeel.sql);

				/*
				 * arrayMode, om dezelfde reden als bij schrijven: de driver bouwt
				 * zijn rij-objecten met "laatste wint", dus bij dubbele
				 * kolomnamen verdwijnen waarden stilzwijgend. En dubbele namen
				 * zijn hier volstrekt normaal — `SELECT k.*, c.* FROM klanten k
				 * JOIN contactpersonen c` levert twee keer id, email, telefoon, notitie,
				 * created_at en updated_at. De query slaagt dan, maar het antwoord
				 * klopt niet, en niemand merkt het.
				 */
				const [resultaat] = (await withDatabase(env, "lezer", async (sql) =>
					sql.transaction((txn) => [txn.query(omhuld, [])], {
						readOnly: true,
						fullResults: true,
						arrayMode: true,
					}),
				)) as unknown as { fields: { name: string }[]; rows: unknown[][] }[];

				const kolommen = uniekeKolomnamen((resultaat?.fields ?? []).map((f) => f.name));
				const rijen = resultaat?.rows ?? [];

				const afgekapt = rijen.length > MAX_RIJEN;
				const uit = (afgekapt ? rijen.slice(0, MAX_RIJEN) : rijen).map((rij) =>
					Object.fromEntries(kolommen.map((naam, i) => [naam, rij[i]])),
				);

				// Melden dát er is afgekapt: een model dat tweehonderd van vijfduizend
				// rijen krijgt zonder dat te weten, trekt conclusies over data die het
				// nooit gezien heeft.
				const bericht = afgekapt
					? `Meer dan ${MAX_RIJEN} rijen gevonden — hieronder staan de eerste ${MAX_RIJEN}. ` +
						"Verfijn je query (filter, groepeer of tel) om het volledige beeld te krijgen."
					: `${uit.length} rij(en) gevonden.`;

				return createSuccessResponse(bericht, uit);
			} catch (fout) {
				return createErrorResponse(formatDatabaseError(fout));
			}
		},
	);

	/* ══════════════════════════════════════════════════════════════════ *
	 * 3. schrijf_query — alleen als de rol ergens schrijfrecht heeft
	 * ══════════════════════════════════════════════════════════════════ */
	if (schrijfbaar.length === 0) return;

	server.tool(
		"schrijf_query",
		`Voert één INSERT of UPDATE uit. ` +
			`Je mag schrijven in: ${opsomming(schrijfbaar)}. ` +
			"Toevoegen en bijwerken kunnen; VERWIJDEREN KAN NIET — er bestaat geen manier om via " +
			"deze server rijen te wissen, en structuurwijzigingen (tabellen aanmaken, kolommen " +
			"toevoegen) evenmin. Een UPDATE heeft altijd een WHERE nodig, en élke bewerking mag maar " +
			"een beperkt aantal rijen tegelijk raken — ook een INSERT met ON CONFLICT DO UPDATE.",
		{
			sql: z
				.string()
				.min(1)
				.max(MAX_QUERY_LENGTE)
				.describe("Het uit te voeren INSERT- of UPDATE-statement (één statement)"),
		},
		{ destructiveHint: true, readOnlyHint: false, idempotentHint: false, openWorldHint: false },
		async ({ sql: queryTekst }) => {
			let gereserveerd = 0;
			let rolId: string | null = null;
			try {
				const vers = await verseContext(env, props);
				if (!vers) return createErrorResponse(GEEN_TOEGANG);
				rolId = vers.rolId;

				const oordeel = await toets(neonCatalogus(env), vers, queryTekst, "schrijven");
				if (!oordeel.ok) return createErrorResponse(oordeel.melding);

				// Goedkope vormcontroles die de domme gevallen vroeg afvangen. Ze zijn
				// NIET de begrenzing — die zit hieronder, op het aantal geraakte rijen.
				const vormfout = controleerUpdateVorm(oordeel.sql);
				if (vormfout) return createErrorResponse(vormfout);

				// Eerst reserveren, dan pas schrijven. Is het venster vol, dan gebeurt
				// er niets.
				if (!(await reserveer(env, vers.rolId, MAX_RIJEN_PER_STATEMENT))) {
					return createErrorResponse(
						"Er zijn de afgelopen tijd te veel rijen gewijzigd met deze rol. Probeer het later opnieuw.",
					);
				}
				gereserveerd = MAX_RIJEN_PER_STATEMENT;

				const omhuld = bouwSchrijfStatement(
					oordeel.sql,
					oordeel.heeftReturning,
					MAX_RIJEN_PER_STATEMENT,
				);

				/*
				 * ⚠ arrayMode + fullResults zijn hier GEEN detail.
				 *
				 * De omhulling zet twee eigen kolommen vooraan (mcp_geraakt en
				 * mcp_bewaking) en laat de RETURNING-kolommen van de aanroeper
				 * erachter volgen. Postgres staat dubbele resultaatkolomnamen
				 * toe, en de driver bouwt zijn rij-objecten met "laatste wint" —
				 * dus `… RETURNING 0 AS mcp_geraakt` overschreef onze telling
				 * met een waarde van de aanroeper. Daarmee kreeg hij zijn hele
				 * reservering terug en was het uurplafond uitgeschakeld.
				 *
				 * Op positie lezen kan niemand vervalsen: index 0 is altijd de
				 * echte telling.
				 */
				let velden: { name: string }[];
				let rijen: unknown[][];
				try {
					const [resultaat] = (await withDatabase(env, "schrijver", async (sql) =>
						sql.transaction((txn) => [txn.query(omhuld, [])], {
							fullResults: true,
							arrayMode: true,
						}),
					)) as unknown as { fields: { name: string }[]; rows: unknown[][] }[];
					velden = resultaat?.fields ?? [];
					rijen = resultaat?.rows ?? [];
				} catch (fout) {
					// De opzettelijke cast-fout betekent: te breed, en teruggedraaid.
					if (isBegrenzingsFout(fout)) {
						// Geen aanwijzing meegeven dat het in kleinere stappen wél kan —
						// dat is precies wat een model nodig heeft om de grens te omzeilen.
						return createErrorResponse(
							"Deze bewerking raakt te veel rijen en is niet uitgevoerd. Er is niets gewijzigd.",
						);
					}
					throw fout;
				}

				// Index 0 is onze eigen telling; index 1 de bewaking. Alles daarna
				// is wat de aanroeper zelf met RETURNING opvroeg.
				const geraakt = Number(rijen[0]?.[0] ?? 0);
				await corrigeer(env, vers.rolId, gereserveerd - geraakt);
				gereserveerd = 0;

				const eigenVelden = velden.slice(2);
				const inhoud = rijen.map((r) =>
					Object.fromEntries(
						eigenVelden
							.map((veld, i) => [veld.name, r[i + 2]] as const)
							// De hulpkolom die we zelf toevoegden als er geen RETURNING was.
							.filter(([naam]) => naam !== "mcp_rij"),
					),
				);
				const heeftKolommen = inhoud.some((r) => Object.keys(r).length > 0);

				console.log(`Schrijfactie door ${props.email} (rol ${vers.rolNaam}): ${geraakt} rij(en)`);
				return createSuccessResponse(
					`${geraakt} rij(en) gewijzigd.`,
					heeftKolommen ? inhoud : undefined,
				);
			} catch (fout) {
				// Faalde het schrijven, geef de reservering dan terug.
				if (gereserveerd > 0 && rolId) await corrigeer(env, rolId, gereserveerd);
				return createErrorResponse(formatDatabaseError(fout));
			}
		},
	);
}

const GEEN_TOEGANG =
	"Je account heeft op dit moment geen toegang tot de database. Vraag de beheerder om een rol.";
