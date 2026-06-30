import { pgTable, uuid, text, integer, jsonb, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenants } from "./tenants";
import { users } from "./users";

export const importStatusEnum = pgEnum("import_status", [
  "pending", "processing", "complete", "failed", "rolled_back",
]);

export const importRowStatusEnum = pgEnum("import_row_status", [
  "pending", "created", "updated", "skipped", "error",
]);

export const imports = pgTable("imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  status: importStatusEnum("status").notNull().default("pending"),
  mappingConfig: jsonb("mapping_config"),
  mappingTemplateName: text("mapping_template_name"),
  matchKey: text("match_key").default("asset_reference"),
  totalRows: integer("total_rows"),
  processedRows: integer("processed_rows").notNull().default(0),
  createdCount: integer("created_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  errorSummary: text("error_summary"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  rolledBackAt: timestamp("rolled_back_at"),
  rolledBackBy: uuid("rolled_back_by").references(() => users.id),
}, (t) => [
  index("idx_imports_tenant_id").on(t.tenantId),
  index("idx_imports_tenant_status").on(t.tenantId, t.status),
  index("idx_imports_created_at").on(t.tenantId, t.createdAt),
]);

export const importRows = pgTable("import_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  importId: uuid("import_id").notNull().references(() => imports.id),
  rowNumber: integer("row_number").notNull(),
  rawData: jsonb("raw_data").notNull(),
  mappedData: jsonb("mapped_data"),
  previousData: jsonb("previous_data"),
  status: importRowStatusEnum("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  assetId: uuid("asset_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_import_rows_import_id").on(t.importId),
  index("idx_import_rows_status").on(t.importId, t.status),
]);

export const mappingTemplates = pgTable("mapping_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  mappingConfig: jsonb("mapping_config").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_mapping_templates_tenant").on(t.tenantId),
]);

export const insertImportSchema = createInsertSchema(imports).omit({
  id: true, createdAt: true, completedAt: true, rolledBackAt: true,
  processedRows: true, createdCount: true, updatedCount: true, skippedCount: true, errorCount: true,
});

export type Import = typeof imports.$inferSelect;
export type ImportRow = typeof importRows.$inferSelect;
export type MappingTemplate = typeof mappingTemplates.$inferSelect;
export type InsertImport = z.infer<typeof insertImportSchema>;
