import {
  pgTable, uuid, text, integer, timestamp, index
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenants } from "./tenants";
import { users } from "./users";
import { assets } from "./assets";
import { assetComplianceItems, complianceRecords } from "./compliance";
import { jobs } from "./jobs";

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  assetId: uuid("asset_id").references(() => assets.id),
  uprn: text("uprn"),
  complianceItemId: uuid("compliance_item_id").references(() => assetComplianceItems.id),
  complianceRecordId: uuid("compliance_record_id").references(() => complianceRecords.id),
  jobId: uuid("job_id").references(() => jobs.id),
  serviceRecordId: uuid("service_record_id"),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size"),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (t) => [
  index("idx_documents_tenant_id").on(t.tenantId),
  index("idx_documents_asset_id").on(t.assetId),
  index("idx_documents_job_id").on(t.jobId),
  index("idx_documents_service_record").on(t.serviceRecordId),
  index("idx_documents_compliance_item").on(t.complianceItemId),
  index("idx_documents_compliance_record").on(t.complianceRecordId),
]);

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true, createdAt: true, deletedAt: true, uploadedBy: true, tenantId: true,
});

export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
