import { Router } from "express";
import { db } from "@workspace/db";
import {
  jobs, jobComments, assets, users, teams,
  assetComplianceItems, documents,
} from "@workspace/db/schema";
import { and, eq, isNull, desc, asc, count, or, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { writeAuditLog } from "../lib/audit";

const router = Router();
router.use(requireAuth);

const tid = (req: any): string => req.user!.tenantId;

// ── List jobs ─────────────────────────────────────────────────────────────────

router.get("/jobs", async (req, res) => {
  const tenantId = tid(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;
  const { status, priority, assetId, assignedUserId, assignedTeamId } = req.query as Record<string, string>;

  try {
    const conditions: any[] = [
      eq(jobs.tenantId, tenantId),
      isNull(jobs.deletedAt),
    ];
    if (status) conditions.push(eq(jobs.status, status as any));
    if (priority) conditions.push(eq(jobs.priority, priority as any));
    if (assetId) conditions.push(eq(jobs.assetId, assetId));
    if (assignedUserId) conditions.push(eq(jobs.assignedUserId, assignedUserId));
    if (assignedTeamId) conditions.push(eq(jobs.assignedTeamId, assignedTeamId));

    const [list, [{ total }]] = await Promise.all([
      db.select({
        job: jobs,
        asset: { id: assets.id, fullAddress: assets.fullAddress, assetReference: assets.assetReference, assetType: assets.assetType },
        assignee: { id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username },
      })
        .from(jobs)
        .leftJoin(assets, eq(jobs.assetId, assets.id))
        .leftJoin(users, eq(jobs.assignedUserId, users.id))
        .where(and(...conditions))
        .orderBy(desc(jobs.createdAt))
        .limit(limit).offset(offset),
      db.select({ total: count() }).from(jobs).where(and(...conditions)),
    ]);

    res.json({
      data: list.map(({ job, asset, assignee }) => ({ ...job, asset, assignee })),
      total: Number(total), page, limit,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── My jobs (current user) ────────────────────────────────────────────────────

router.get("/jobs/my", async (req, res) => {
  const tenantId = tid(req);
  const userId = req.user!.sub;
  try {
    const list = await db.select({
      job: jobs,
      asset: { id: assets.id, fullAddress: assets.fullAddress, assetReference: assets.assetReference },
    })
      .from(jobs)
      .leftJoin(assets, eq(jobs.assetId, assets.id))
      .where(and(
        eq(jobs.tenantId, tenantId),
        eq(jobs.assignedUserId, userId),
        isNull(jobs.deletedAt),
        or(eq(jobs.status, "open"), eq(jobs.status, "assigned"), eq(jobs.status, "in_progress"), eq(jobs.status, "awaiting_evidence")),
      ))
      .orderBy(asc(jobs.dueDate), desc(jobs.priority))
      .limit(50);

    res.json(list.map(({ job, asset }) => ({ ...job, asset })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Create job ────────────────────────────────────────────────────────────────

router.post("/jobs", async (req, res) => {
  const tenantId = tid(req);
  const {
    title, description, assetId, complianceItemId, assignedUserId,
    assignedTeamId, priority, dueDate, parentJobId,
  } = req.body;

  if (!title?.trim()) { res.status(400).json({ error: "title is required" }); return; }

  try {
    const [job] = await db.insert(jobs).values({
      tenantId,
      title: title.trim(),
      description: description ?? null,
      assetId: assetId ?? null,
      complianceItemId: complianceItemId ?? null,
      assignedUserId: assignedUserId ?? null,
      assignedTeamId: assignedTeamId ?? null,
      priority: priority ?? "medium",
      dueDate: dueDate ?? null,
      parentJobId: parentJobId ?? null,
      status: assignedUserId ? "assigned" : "open",
      createdBy: req.user!.sub,
    }).returning();

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "create_job", entityType: "job", entityId: job.id,
      details: { title, priority, assetId },
    });

    res.status(201).json(job);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get job detail ────────────────────────────────────────────────────────────

router.get("/jobs/:jobId", async (req, res) => {
  const tenantId = tid(req);
  try {
    const [row] = await db.select({
      job: jobs,
      asset: { id: assets.id, fullAddress: assets.fullAddress, assetReference: assets.assetReference, assetType: assets.assetType },
      assignee: { id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username },
    })
      .from(jobs)
      .leftJoin(assets, eq(jobs.assetId, assets.id))
      .leftJoin(users, eq(jobs.assignedUserId, users.id))
      .where(and(eq(jobs.id, req.params.jobId), eq(jobs.tenantId, tenantId), isNull(jobs.deletedAt)));

    if (!row) { res.status(404).json({ error: "Job not found" }); return; }

    // Load comments
    const comments = await db.select({
      comment: jobComments,
      user: { id: users.id, firstName: users.firstName, lastName: users.lastName, username: users.username },
    })
      .from(jobComments)
      .leftJoin(users, eq(jobComments.userId, users.id))
      .where(eq(jobComments.jobId, row.job.id))
      .orderBy(asc(jobComments.createdAt));

    // Load documents
    const docs = await db.select().from(documents)
      .where(and(eq(documents.jobId, row.job.id), isNull(documents.deletedAt)));

    // Load child follow-on jobs
    const followOns = await db.select().from(jobs)
      .where(and(
        eq(jobs.parentJobId, row.job.id),
        eq(jobs.tenantId, tenantId),
        isNull(jobs.deletedAt),
      ));

    res.json({
      ...row.job,
      asset: row.asset,
      assignee: row.assignee,
      comments: comments.map(({ comment, user }) => ({ ...comment, user })),
      documents: docs,
      followOnJobs: followOns,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Update job ────────────────────────────────────────────────────────────────

router.patch("/jobs/:jobId", async (req, res) => {
  const tenantId = tid(req);
  try {
    const [existing] = await db.select().from(jobs)
      .where(and(eq(jobs.id, req.params.jobId), eq(jobs.tenantId, tenantId), isNull(jobs.deletedAt)));
    if (!existing) { res.status(404).json({ error: "Job not found" }); return; }

    const {
      title, description, assignedUserId, assignedTeamId,
      priority, dueDate, status, completionNotes,
    } = req.body;

    const patch: Record<string, any> = { updatedAt: new Date() };
    if (title !== undefined) patch.title = title;
    if (description !== undefined) patch.description = description;
    if (assignedUserId !== undefined) patch.assignedUserId = assignedUserId;
    if (assignedTeamId !== undefined) patch.assignedTeamId = assignedTeamId;
    if (priority !== undefined) patch.priority = priority;
    if (dueDate !== undefined) patch.dueDate = dueDate;
    if (status !== undefined) patch.status = status;
    if (completionNotes !== undefined) patch.completionNotes = completionNotes;

    const [updated] = await db.update(jobs).set(patch)
      .where(eq(jobs.id, existing.id)).returning();

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "update_job", entityType: "job", entityId: existing.id,
      details: { changes: Object.keys(patch).filter(k => k !== "updatedAt") },
    });

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Complete job ──────────────────────────────────────────────────────────────

router.post("/jobs/:jobId/complete", async (req, res) => {
  const tenantId = tid(req);
  try {
    const [existing] = await db.select().from(jobs)
      .where(and(eq(jobs.id, req.params.jobId), eq(jobs.tenantId, tenantId), isNull(jobs.deletedAt)));
    if (!existing) { res.status(404).json({ error: "Job not found" }); return; }
    if (existing.status === "completed" || existing.status === "cancelled") {
      res.status(409).json({ error: "Job is already closed" }); return;
    }

    const [updated] = await db.update(jobs).set({
      status: "completed",
      completionDate: new Date(),
      completionNotes: req.body.notes ?? null,
      updatedAt: new Date(),
    }).where(eq(jobs.id, existing.id)).returning();

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "complete_job", entityType: "job", entityId: existing.id, details: {},
    });

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Cancel job ────────────────────────────────────────────────────────────────

router.post("/jobs/:jobId/cancel", async (req, res) => {
  const tenantId = tid(req);
  try {
    const [existing] = await db.select().from(jobs)
      .where(and(eq(jobs.id, req.params.jobId), eq(jobs.tenantId, tenantId), isNull(jobs.deletedAt)));
    if (!existing) { res.status(404).json({ error: "Job not found" }); return; }
    if (existing.status === "completed" || existing.status === "cancelled") {
      res.status(409).json({ error: "Job is already closed" }); return;
    }

    const [updated] = await db.update(jobs).set({
      status: "cancelled", updatedAt: new Date(),
    }).where(eq(jobs.id, existing.id)).returning();

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "cancel_job", entityType: "job", entityId: existing.id, details: {},
    });

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Create follow-on job ──────────────────────────────────────────────────────

router.post("/jobs/:jobId/follow-on", async (req, res) => {
  const tenantId = tid(req);
  try {
    const [parent] = await db.select().from(jobs)
      .where(and(eq(jobs.id, req.params.jobId), eq(jobs.tenantId, tenantId), isNull(jobs.deletedAt)));
    if (!parent) { res.status(404).json({ error: "Parent job not found" }); return; }

    const { title, description, priority, dueDate } = req.body;
    if (!title?.trim()) { res.status(400).json({ error: "title is required" }); return; }

    const [child] = await db.insert(jobs).values({
      tenantId,
      title: title.trim(),
      description: description ?? null,
      assetId: parent.assetId,
      complianceItemId: parent.complianceItemId,
      assignedUserId: parent.assignedUserId,
      assignedTeamId: parent.assignedTeamId,
      priority: priority ?? parent.priority,
      dueDate: dueDate ?? null,
      parentJobId: parent.id,
      status: parent.assignedUserId ? "assigned" : "open",
      createdBy: req.user!.sub,
    }).returning();

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "create_follow_on_job", entityType: "job", entityId: child.id,
      details: { parentJobId: parent.id },
    });

    res.status(201).json(child);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Add comment ───────────────────────────────────────────────────────────────

router.post("/jobs/:jobId/comments", async (req, res) => {
  const tenantId = tid(req);
  const { body } = req.body;
  if (!body?.trim()) { res.status(400).json({ error: "body is required" }); return; }

  try {
    const [job] = await db.select().from(jobs)
      .where(and(eq(jobs.id, req.params.jobId), eq(jobs.tenantId, tenantId), isNull(jobs.deletedAt)));
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }

    const [comment] = await db.insert(jobComments).values({
      jobId: job.id,
      tenantId,
      userId: req.user!.sub,
      body: body.trim(),
    }).returning();

    res.status(201).json(comment);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Delete job (soft) ─────────────────────────────────────────────────────────

router.delete("/jobs/:jobId", requireRole("tenant_admin", "compliance_manager"), async (req, res) => {
  const tenantId = tid(req);
  try {
    const [existing] = await db.select().from(jobs)
      .where(and(eq(jobs.id, req.params.jobId), eq(jobs.tenantId, tenantId), isNull(jobs.deletedAt)));
    if (!existing) { res.status(404).json({ error: "Job not found" }); return; }

    await db.update(jobs).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(jobs.id, existing.id));

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "delete_job", entityType: "job", entityId: existing.id, details: {},
    });

    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
