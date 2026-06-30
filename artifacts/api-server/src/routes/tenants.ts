import { Router } from "express";
import { db } from "@workspace/db";
import { tenants, users, tenantUsers, assets, assetComplianceItems } from "@workspace/db/schema";
import { eq, isNull, ilike, or, sql, count } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../middleware/auth";
import { writeAuditLog } from "../lib/audit";

const router = Router();

router.get("/tenants", requireAuth, requireSuperAdmin, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  try {
    const list = await db.select().from(tenants).where(isNull(tenants.deletedAt)).limit(limit).offset(offset);
    const [{ total }] = await db.select({ total: count() }).from(tenants).where(isNull(tenants.deletedAt));

    const withCounts = await Promise.all(
      list.map(async (t) => {
        const [assetCount] = await db.select({ c: count() }).from(assets).where(eq(assets.tenantId, t.id));
        const [userCount] = await db.select({ c: count() }).from(tenantUsers).where(eq(tenantUsers.tenantId, t.id));
        return { ...t, assetCount: Number(assetCount.c), userCount: Number(userCount.c) };
      })
    );

    res.json({ data: withCounts, total: Number(total), page, limit });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tenants", requireAuth, requireSuperAdmin, async (req, res) => {
  const { name, slug, contactEmail, contactName, plan, maxAssets, maxUsers } = req.body;
  if (!name || !slug) {
    res.status(400).json({ error: "name and slug are required" });
    return;
  }
  try {
    const [existing] = await db.select().from(tenants).where(eq(tenants.slug, slug));
    if (existing) {
      res.status(409).json({ error: "Slug already taken" });
      return;
    }
    const [tenant] = await db
      .insert(tenants)
      .values({ name, slug, contactEmail, contactName, plan, maxAssets, maxUsers })
      .returning();

    await writeAuditLog({
      userId: req.user!.sub,
      actorName: req.user!.username,
      action: "create_tenant",
      entityType: "tenant",
      entityId: tenant.id,
      details: { name, slug },
    });

    res.status(201).json(tenant);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/tenants/:tenantId", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, req.params.tenantId));
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    const [assetCount] = await db.select({ c: count() }).from(assets).where(eq(assets.tenantId, tenant.id));
    const [userCount] = await db.select({ c: count() }).from(tenantUsers).where(eq(tenantUsers.tenantId, tenant.id));
    res.json({ ...tenant, assetCount: Number(assetCount.c), userCount: Number(userCount.c) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/tenants/:tenantId", requireAuth, requireSuperAdmin, async (req, res) => {
  const { name, contactEmail, contactName, plan, maxAssets, maxUsers, status } = req.body;
  try {
    const [tenant] = await db
      .update(tenants)
      .set({
        ...(name !== undefined && { name }),
        ...(contactEmail !== undefined && { contactEmail }),
        ...(contactName !== undefined && { contactName }),
        ...(plan !== undefined && { plan }),
        ...(maxAssets !== undefined && { maxAssets }),
        ...(maxUsers !== undefined && { maxUsers }),
        ...(status !== undefined && { status }),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, req.params.tenantId))
      .returning();
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    res.json(tenant);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tenants/:tenantId/suspend", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await db
      .update(tenants)
      .set({ status: "suspended", updatedAt: new Date() })
      .where(eq(tenants.id, req.params.tenantId));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tenants/:tenantId/activate", requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await db
      .update(tenants)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(tenants.id, req.params.tenantId));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/tenants/:tenantId/stats", requireAuth, requireSuperAdmin, async (req, res) => {
  const tid = req.params.tenantId;
  try {
    const [assetCount] = await db.select({ c: count() }).from(assets).where(eq(assets.tenantId, tid));
    const [userCount] = await db.select({ c: count() }).from(tenantUsers).where(eq(tenantUsers.tenantId, tid));
    const [itemCount] = await db.select({ c: count() }).from(assetComplianceItems).where(eq(assetComplianceItems.tenantId, tid));
    const [overdueCount] = await db
      .select({ c: count() })
      .from(assetComplianceItems)
      .where(
        sql`${assetComplianceItems.tenantId} = ${tid} AND ${assetComplianceItems.status} = 'overdue'`
      );
    res.json({
      tenantId: tid,
      assetCount: Number(assetCount.c),
      userCount: Number(userCount.c),
      complianceItemCount: Number(itemCount.c),
      overdueCount: Number(overdueCount.c),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
