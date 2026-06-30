import {
  pgTable, uuid, text, timestamp, date, pgEnum, index
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenants } from "./tenants";
import { users } from "./users";
import { assets } from "./assets";
import { assetComplianceItems } from "./compliance";
import { teams } from "./teams";

export const jobPriorityEnum = pgEnum("job_priority", [
  "low", "medium", "high", "critical",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "open", "assigned", "in_progress", "awaiting_evidence", "completed", "cancelled",
]);

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  title: text("title").notNull(),
  description: text("description"),
  assetId: uuid("asset_id").references(() => assets.id),
  complianceItemId: uuid("compliance_item_id").references(() => assetComplianceItems.id),
  assignedUserId: uuid("assigned_user_id").references(() => users.id),
  assignedTeamId: uuid("assigned_team_id").references(() => teams.id),
  priority: jobPriorityEnum("priority").notNull().default("medium"),
  dueDate: date("due_date"),
  status: jobStatusEnum("status").notNull().default("open"),
  completionDate: timestamp("completion_date"),
  completionNotes: text("completion_notes"),
  parentJobId: uuid("parent_job_id"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (t) => [
  index("idx_jobs_tenant_id").on(t.tenantId),
  index("idx_jobs_tenant_status").on(t.tenantId, t.status),
  index("idx_jobs_asset_id").on(t.assetId),
  index("idx_jobs_assigned_user").on(t.assignedUserId),
  index("idx_jobs_assigned_team").on(t.assignedTeamId),
  index("idx_jobs_parent").on(t.parentJobId),
  index("idx_jobs_due_date").on(t.tenantId, t.dueDate),
]);

export const jobComments = pgTable("job_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => jobs.id),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_job_comments_job_id").on(t.jobId),
]);

export const insertJobSchema = createInsertSchema(jobs).omit({
  id: true, tenantId: true, createdAt: true, updatedAt: true,
  deletedAt: true, createdBy: true, completionDate: true,
});

export const insertJobCommentSchema = createInsertSchema(jobComments).omit({
  id: true, createdAt: true,
});

export type Job = typeof jobs.$inferSelect;
export type JobComment = typeof jobComments.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
