import {
  pgTable, uuid, text, date, timestamp, pgEnum, index, boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenants } from "./tenants";
import { users } from "./users";
import { assets } from "./assets";
import { complianceTypes } from "./compliance";

export const serviceRecordOutcomeEnum = pgEnum("service_record_outcome", [
  "pass", "fail", "follow_on_required",
]);

export const serviceRecords = pgTable("service_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  assetId: uuid("asset_id").notNull().references(() => assets.id),
  complianceTypeId: uuid("compliance_type_id").references(() => complianceTypes.id),
  serviceDate: date("service_date"),
  expiryDate: date("expiry_date"),
  nextDueDate: date("next_due_date"),
  engineerName: text("engineer_name"),
  engineerLicenceNumber: text("engineer_licence_number"),
  contractor: text("contractor"),
  certificateRef: text("certificate_ref"),
  certificateType: text("certificate_type"),
  certificateTypeCode: text("certificate_type_code"),
  outcome: serviceRecordOutcomeEnum("outcome"),
  condition: text("condition"),
  followOnRequired: boolean("follow_on_required").notNull().default(false),
  observations: text("observations").array(),
  uprn: text("uprn"),
  propertyAddress: text("property_address"),
  notes: text("notes"),
  parsedData: text("parsed_data"),
  status: text("status").notNull().default("draft"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_service_records_tenant_id").on(t.tenantId),
  index("idx_service_records_asset_id").on(t.assetId),
  index("idx_service_records_compliance_type").on(t.complianceTypeId),
  index("idx_service_records_created_at").on(t.tenantId, t.createdAt),
]);

export const insertServiceRecordSchema = createInsertSchema(serviceRecords).omit({
  id: true, createdAt: true, updatedAt: true, createdBy: true, tenantId: true, status: true,
});

export type ServiceRecord = typeof serviceRecords.$inferSelect;
export type InsertServiceRecord = z.infer<typeof insertServiceRecordSchema>;
