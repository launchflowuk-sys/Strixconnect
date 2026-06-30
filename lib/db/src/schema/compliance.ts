import {
  pgTable, uuid, text, integer, boolean, timestamp, date, pgEnum, index, uniqueIndex, jsonb
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenants } from "./tenants";
import { assets } from "./assets";
import { users } from "./users";

export const complianceStatusEnum = pgEnum("compliance_status", [
  "compliant", "due_soon", "overdue", "failed",
  "not_applicable", "awaiting_evidence", "follow_on_required",
]);

export const changeSourceEnum = pgEnum("change_source", [
  "manual_edit", "excel_import", "service_record_upload", "system_automation", "certificate_upload",
]);

export const complianceTypes = pgTable("compliance_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  name: text("name").notNull(),
  code: text("code").notNull(),
  description: text("description"),
  frequencyMonths: integer("frequency_months"),
  dueSoonDays: integer("due_soon_days").notNull().default(30),
  isActive: boolean("is_active").notNull().default(true),
  isSystem: boolean("is_system").notNull().default(false),
  color: text("color"),
  applicableAssetTypes: text("applicable_asset_types").array(),
  customFieldDefinitions: jsonb("custom_field_definitions"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const assetComplianceItems = pgTable("asset_compliance_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  assetId: uuid("asset_id").notNull().references(() => assets.id),
  complianceTypeId: uuid("compliance_type_id").notNull().references(() => complianceTypes.id),
  isEnabled: boolean("is_enabled").notNull().default(true),
  status: complianceStatusEnum("status").notNull().default("not_applicable"),
  lastInspectionDate: date("last_inspection_date"),
  nextDueDate: date("next_due_date"),
  expiryDate: date("expiry_date"),
  certificateRef: text("certificate_ref"),
  contractor: text("contractor"),
  condition: text("condition"),
  followOnRequired: boolean("follow_on_required").notNull().default(false),
  notes: text("notes"),
  riskLevel: text("risk_level"),
  engineerName: text("engineer_name"),
  engineerLicenceNumber: text("engineer_licence_number"),
  outcome: text("outcome"),
  certificateType: text("certificate_type"),
  certificateTypeCode: text("certificate_type_code"),
  observations: text("observations").array(),
  customFields: jsonb("custom_fields"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_aci_tenant_id").on(t.tenantId),
  index("idx_aci_asset_id").on(t.assetId),
  index("idx_aci_tenant_status").on(t.tenantId, t.status),
  index("idx_aci_tenant_next_due").on(t.tenantId, t.nextDueDate),
  index("idx_aci_compliance_type").on(t.tenantId, t.complianceTypeId),
  uniqueIndex("idx_aci_asset_type_unique").on(t.assetId, t.complianceTypeId),
]);

export const complianceRecords = pgTable("compliance_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  complianceItemId: uuid("compliance_item_id").notNull().references(() => assetComplianceItems.id),
  status: text("status").notNull(),
  inspectionDate: date("inspection_date"),
  nextDueDate: date("next_due_date"),
  expiryDate: date("expiry_date"),
  certificateRef: text("certificate_ref"),
  contractor: text("contractor"),
  condition: text("condition"),
  followOnRequired: boolean("follow_on_required").notNull().default(false),
  notes: text("notes"),
  riskLevel: text("risk_level"),
  engineerName: text("engineer_name"),
  engineerLicenceNumber: text("engineer_licence_number"),
  outcome: text("outcome"),
  certificateType: text("certificate_type"),
  certificateTypeCode: text("certificate_type_code"),
  observations: text("observations").array(),
  customFields: jsonb("custom_fields"),
  uprn: text("uprn"),
  propertyAddress: text("property_address"),
  parsedData: jsonb("parsed_data"),
  source: changeSourceEnum("source").notNull().default("manual_edit"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_cr_compliance_item").on(t.complianceItemId),
  index("idx_cr_tenant_created").on(t.tenantId, t.createdAt),
]);

export const complianceHistory = pgTable("compliance_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  previousState: jsonb("previous_state"),
  newState: jsonb("new_state"),
  changedFields: text("changed_fields").array(),
  source: changeSourceEnum("source").notNull().default("manual_edit"),
  actorId: uuid("actor_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_ch_entity").on(t.entityType, t.entityId),
  index("idx_ch_tenant_created").on(t.tenantId, t.createdAt),
]);

export const insertComplianceTypeSchema = createInsertSchema(complianceTypes).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertAssetComplianceItemSchema = createInsertSchema(assetComplianceItems).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertComplianceRecordSchema = createInsertSchema(complianceRecords).omit({
  id: true, createdAt: true, createdBy: true,
});
export const insertComplianceHistorySchema = createInsertSchema(complianceHistory).omit({
  id: true, createdAt: true,
});

export type ComplianceType = typeof complianceTypes.$inferSelect;
export type AssetComplianceItem = typeof assetComplianceItems.$inferSelect;
export type ComplianceRecord = typeof complianceRecords.$inferSelect;
export type ComplianceHistory = typeof complianceHistory.$inferSelect;
