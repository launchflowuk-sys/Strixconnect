import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogs } from "@workspace/db/schema";
import { eq, and, count, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

router.get("/audit-logs", async (req, res) => {
  const tenantId = req.user!.tenantId;
  if (!tenantId && !req.user!.isSuperAdmin) {
    res.status(400).json({ error: "No tenant context" });
    return;
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const { entityType, entityId, userId } = req.query as Record<string, string>;

  try {
    const cond = [] as any[];
    if (tenantId) cond.push(eq(auditLogs.tenantId, tenantId));
    if (entityType) cond.push(eq(auditLogs.entityType, entityType));
    if (entityId) cond.push(sql`${auditLogs.entityId} = ${entityId}::uuid`);
    if (userId) cond.push(sql`${auditLogs.userId} = ${userId}::uuid`);

    const where = cond.length > 0 ? and(...cond) : undefined;

    const list = await db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(where);

    res.json({ data: list, total: Number(total), page, limit });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
