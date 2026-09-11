/**
 * Drizzle-definities van het MCP-rechtenmodel — voor het `schema.ts` van de klant.
 *
 * Neem dit over in het Drizzle-schema van de codebase, in haar eigen
 * conventies (bestandsindeling, naamgeving van indexen, `relations`). Genereer
 * daarna de migratie met drizzle-kit en vergelijk de SQL met
 * `mcp-server/sql/01-mcp-tabellen.sql`. Voeg de COMMENT ON-regels uit dat
 * bestand met de hand toe aan de gegenereerde migratie: Drizzle genereert die
 * niet, en de MCP-server en het rechtenscherm tonen dat commentaar.
 *
 * WAT VAST LIGT — de MCP-server kent deze namen letterlijk:
 *   tabellen  mcp_rollen · mcp_rechten · mcp_schrijfquota
 *   enum      mcp_recht_niveau ('lezen', 'schrijven')
 *   kolommen  <gebruikerstabel>.entra_oid · .mcp_rol_id · .is_beheerder
 *
 * WAT VAN DE KLANT IS: de gebruikerstabel zelf (`gebruikers` hieronder is een
 * placeholder — het is de bestaande tabel, met haar bestaande kolommen; je
 * voegt er alleen drie kolommen aan toe). Dezelfde naam staat in
 * `mcp-server/src/mcp.config.ts` (GEBRUIKERS.tabel).
 */

import { relations } from "drizzle-orm";
import { boolean, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Twee waarden, bewust geen "geen": geen toegang is de AFWEZIGHEID van een rij
 * in mcp_rechten. Daardoor is een nieuwe tabel automatisch dicht voor elke rol.
 */
export const mcpRechtNiveauEnum = pgEnum("mcp_recht_niveau", ["lezen", "schrijven"]);

/** Een rol is een benoemde verzameling tabelrechten, aangemaakt door een beheerder. */
export const mcpRollen = pgTable("mcp_rollen", {
  id: uuid("id").primaryKey().defaultRandom(),
  naam: text("naam").notNull().unique(),
  omschrijving: text("omschrijving"),
  /** Gaat bij elke publicatie met één omhoog: herkent gelijktijdig bewerken. */
  versie: integer("versie").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Eén rij per (rol × tabel) waar toegang IS verleend. Geen rij = geen toegang. */
export const mcpRechten = pgTable(
  "mcp_rechten",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rolId: uuid("rol_id")
      .notNull()
      .references(() => mcpRollen.id, { onDelete: "cascade" }),
    /** Platte tekst, bewust geen catalogus-verwijzing: hernoemen = recht vervalt. */
    tabelnaam: text("tabelnaam").notNull(),
    niveau: mcpRechtNiveauEnum("niveau").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mcp_rechten_rol_tabel_idx").on(t.rolId, t.tabelnaam)],
);

/** De cumulatieve schrijfteller per rol, in de database (niet in het geheugen). */
export const mcpSchrijfquota = pgTable("mcp_schrijfquota", {
  rolId: uuid("rol_id")
    .primaryKey()
    .references(() => mcpRollen.id, { onDelete: "cascade" }),
  rijen: integer("rijen").notNull().default(0),
  vensterStart: timestamp("venster_start", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * DE BESTAANDE GEBRUIKERSTABEL VAN DE KLANT — hier alleen als voorbeeld van de
 * drie kolommen die erbij komen. Vervang `gebruikers` door de echte tabel en
 * laat haar bestaande kolommen ongemoeid.
 */
export const gebruikers = pgTable("gebruikers", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  // … de bestaande kolommen van de klant …

  /** Onveranderlijke Entra object-id; eenmalig gebonden bij de eerste login. */
  entraOid: text("entra_oid").unique(),
  /** Precies één MCP-rol, of NULL = geen MCP-toegang (de standaard). */
  mcpRolId: uuid("mcp_rol_id").references(() => mcpRollen.id, { onDelete: "restrict" }),
  /** Mag rollen en rechten beheren. Los van de rol; per actie uit de database gelezen. */
  isBeheerder: boolean("is_beheerder").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mcpRollenRelations = relations(mcpRollen, ({ many }) => ({
  rechten: many(mcpRechten),
  dragers: many(gebruikers),
}));

export const mcpRechtenRelations = relations(mcpRechten, ({ one }) => ({
  rol: one(mcpRollen, { fields: [mcpRechten.rolId], references: [mcpRollen.id] }),
}));

export const gebruikersRelations = relations(gebruikers, ({ one }) => ({
  mcpRol: one(mcpRollen, { fields: [gebruikers.mcpRolId], references: [mcpRollen.id] }),
}));
