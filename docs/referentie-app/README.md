# Referentie voor de app-kant

Deze map bevat de **logica** van het rechtenscherm die in elk framework en in elke layoutvariant
hetzelfde is, als referentie voor de agent die `docs/opdracht-app-kant.md` uitvoert. Het is
**geen drop-in code**: de bestanden komen uit een werkende Next.js/Drizzle-implementatie en zijn
geschreven in het **voorbeelddomein** van de template (`klanten`, `projecten`, …). Elke tabelnaam
erin is een placeholder; lees het Drizzle-schema van de klant en vervang ze. De bestanden zijn
ontdaan van merknamen en framework-imports, maar je herschrijft ze in de conventies van de
codebase van de klant (ORM, server-acties of endpoints, UI-kit).

| Bestand | Wat het is | Wat vast moet blijven |
|---|---|---|
| `drizzle-schema.ts` | de Drizzle-definities van `mcp_rollen`, `mcp_rechten`, `mcp_schrijfquota`, de enum en de drie gebruikerskolommen | de tabel- en kolomnamen; de `ON DELETE`-regels; de unieke index |
| `mcp-beschermd.ts` | de app-kopie van de beschermde lijsten + de lijst technische tabellen | identiek aan `mcp-server/src/database/beschermd.ts` en `NOOIT_SCHRIJVEN` in `mcp-server/src/mcp.config.ts` |
| `mcp-standen.ts` | de drie standen, hun tekens en uitlegzinnen, en `clusterStand()` | de woorden en tekens: Geen toegang `—` · Lezen `◦` · Schrijven `●` · Gedeeltelijk `◐` |
| `mcp-clusters.ts` | het clustertype, een voorbeeldindeling, `bouwPlattegrond()`, `bundelMachinerie()`, de dev-asserts | het vangnet "Nog niet ingedeeld"; één tabel in precies één cluster |
| `schema-atlas.sql` | de vier catalogusquery's waarmee de app het schema leest | kolomcommentaar via `col_description`; denylist-tabellen worden weggefilterd |
| `publiceer-validatie.md` | de server-side validatie van de publiceer-actie, stap voor stap, met de SQL | de volgorde; de view-resolutiequery moet gelijk blijven aan `bronnenVanViews` in `mcp-server/src/database/poort.ts` |
| `canvas-geometrie.ts` | Bézier met loodrechte raaklijnen, punt-op-kromme, gulden-fase | pure functies; bruikbaar voor de verbindingen in alle drie de varianten |

Twee dingen die **byte-gelijk** moeten blijven met de server, omdat het scherm anders rechten
toekent die de server daarna altijd weigert:

1. de recursieve view-resolutie (`publiceer-validatie.md` ↔ `poort.ts` → `bronnenVanViews`);
2. de partitie-/overervingscontrole (`publiceer-validatie.md` ↔ `poort.ts` → `toetsRelaties`).

Wat hier bewust **niet** in zit: React-componenten. Het framework van de klant is onbekend, en de
vormgeving staat in `docs/design-brief-connector.md`.
