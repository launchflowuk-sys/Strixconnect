import {
  pgTable, uuid, text, integer, timestamp, pgEnum, index, jsonb
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenants } from "./tenants";
import { users } from "./users";

export const assetTypeEnum = pgEnum("asset_type", [
  "property", "block",
]);

export const PROPERTY_SUBTYPES = [
  "house", "flat", "maisonette", "bungalow", "commercial",
  "garage", "communal", "land", "hmo", "traveller_site", "other",
] as const;

export type PropertySubtype = typeof PROPERTY_SUBTYPES[number];

export const assetStatusEnum = pgEnum("asset_status", [
  "active", "archived", "sold", "demolished", "inactive",
]);

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  assetReference: text("asset_reference"),
  uprn: text("uprn"),
  oldUprn: text("old_uprn"),
  fullAddress: text("full_address"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  addressLine3: text("address_line3"),
  addressLine4: text("address_line4"),
  area: text("area"),
  postCode: text("post_code"),
  assetType: assetTypeEnum("asset_type").notNull(),
  propertySubtype: text("property_subtype"),
  buildType: text("build_type"),
  archetype: text("archetype"),
  bedrooms: integer("bedrooms"),
  heatingType: text("heating_type"),
  propertyCategory: text("property_category"),
  residentType: text("resident_type"),
  parentAssetId: uuid("parent_asset_id"),
  blockReference: text("block_reference"),
  status: assetStatusEnum("status").notNull().default("active"),
  notes: text("notes"),
  customAttributes: jsonb("custom_attributes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.id),
  updatedBy: uuid("updated_by").references(() => users.id),
  deletedAt: timestamp("deleted_at"),
}, (t) => [
  index("idx_assets_tenant_id").on(t.tenantId),
  index("idx_assets_tenant_status").on(t.tenantId, t.status),
  index("idx_assets_uprn").on(t.tenantId, t.uprn),
  index("idx_assets_reference").on(t.tenantId, t.assetReference),
  index("idx_assets_parent").on(t.parentAssetId),
]);

export const insertAssetSchema = createInsertSchema(assets).omit({
  id: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  updatedBy: true,
  deletedAt: true,
});

export type Asset = typeof assets.$inferSelect;
export type InsertAsset = z.infer<typeof insertAssetSchema>;
