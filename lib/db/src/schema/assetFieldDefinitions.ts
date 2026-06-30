import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const FIELD_TYPES = ["text", "number", "date", "boolean"] as const;
export type FieldType = typeof FIELD_TYPES[number];

export const assetFieldDefinitions = pgTable("asset_field_definitions", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull().references(() => tenants.id),
  label:     text("label").notNull(),
  fieldType: text("field_type").notNull().default("text"),
  position:  integer("position").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AssetFieldDefinition = typeof assetFieldDefinitions.$inferSelect;
export type InsertAssetFieldDefinition = typeof assetFieldDefinitions.$inferInsert;
