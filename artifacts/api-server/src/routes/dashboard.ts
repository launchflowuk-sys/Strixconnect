import { Router } from "express";
import { db } from "@workspace/db";
import { assets, assetComplianceItems, complianceTypes } from "@workspace/db/schema";
import { eq, and, isNull, sql, count, lt, gte, lte } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

function tid(req: any): string | null {
  return req.user.tenantId ?? null;
}

router.get("/dashboard/summary", async (req, res) => {
  const tenantId = tid(req);
  if (!tenantId) {
    res.json({ totalAssets: 0, totalCompliance: 0, compliant: 0, dueSoon: 0, overdue: 0, failed: 0, notApplicable: 0, followOnRequired: 0, assetsByType: [] });
    return;
  }

  try {
    const [{ totalAssets }] = await db
      .select({ totalAssets: count() })
      .from(assets)
      .where(and(eq(assets.tenantId, tenantId), isNull(assets.deletedAt)));

    const items = await db
      .select({ status: assetComplianceItems.status })
      .from(assetComplianceItems)
      .where(and(eq(assetComplianceItems.tenantId, tenantId), eq(assetComplianceItems.isEnabled, true)));

    const statusCounts = items.reduce(
      (acc, { status }) => {
        acc[status] = (acc[status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const assetsByTypeRaw = await db
      .select({ assetType: assets.assetType, c: count() })
      .from(assets)
      .where(and(eq(assets.tenantId, tenantId), isNull(assets.deletedAt)))
      .groupBy(assets.assetType);

    res.json({
      totalAssets: Number(totalAssets),
      totalCompliance: items.length,
      compliant: statusCounts["compliant"] ?? 0,
      dueSoon: statusCounts["due_soon"] ?? 0,
      overdue: statusCounts["overdue"] ?? 0,
      failed: statusCounts["failed"] ?? 0,
      notApplicable: statusCounts["not_applicable"] ?? 0,
      followOnRequired: statusCounts["follow_on_required"] ?? 0,
      assetsByType: assetsByTypeRaw.map((r) => ({ assetType: r.assetType, count: Number(r.c) })),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/compliance-status", async (req, res) => {
  const tenantId = tid(req);
  if (!tenantId) { res.json([]); return; }

  try {
    const types = await db
      .select()
      .from(complianceTypes)
      .where(sql`${complianceTypes.tenantId} = ${tenantId} OR ${complianceTypes.tenantId} IS NULL`);

    const result = await Promise.all(
      types.map(async (ct) => {
        const items = await db
          .select({ status: assetComplianceItems.status })
          .from(assetComplianceItems)
          .where(
            and(
              eq(assetComplianceItems.tenantId, tenantId),
              eq(assetComplianceItems.complianceTypeId, ct.id),
              eq(assetComplianceItems.isEnabled, true),
            )
          );

        const sc = items.reduce((acc, { status }) => { acc[status] = (acc[status] ?? 0) + 1; return acc; }, {} as Record<string, number>);
        const total = items.length;

        if (total === 0) return null;

        return {
          complianceTypeId: ct.id,
          complianceTypeName: ct.name,
          complianceTypeCode: ct.code,
          complianceTypeColor: ct.color,
          compliant: sc["compliant"] ?? 0,
          dueSoon: sc["due_soon"] ?? 0,
          overdue: sc["overdue"] ?? 0,
          failed: sc["failed"] ?? 0,
          notApplicable: sc["not_applicable"] ?? 0,
          total,
        };
      })
    );

    res.json(result.filter(Boolean));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/overdue", async (req, res) => {
  const tenantId = tid(req);
  if (!tenantId) { res.json([]); return; }

  const limit = Math.min(100, Number(req.query.limit) || 20);
  const complianceTypeId = req.query.complianceTypeId as string | undefined;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const cond = [
      eq(assetComplianceItems.tenantId, tenantId),
      eq(assetComplianceItems.isEnabled, true),
      sql`${assetComplianceItems.status} = 'overdue'`,
    ] as any[];
    if (complianceTypeId) cond.push(eq(assetComplianceItems.complianceTypeId, complianceTypeId));

    const rows = await db
      .select({
        item: assetComplianceItems,
        assetReference: assets.assetReference,
        fullAddress: assets.fullAddress,
        typeName: complianceTypes.name,
        typeCode: complianceTypes.code,
        typeColor: complianceTypes.color,
      })
      .from(assetComplianceItems)
      .innerJoin(assets, eq(assetComplianceItems.assetId, assets.id))
      .innerJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id))
      .where(and(...cond))
      .orderBy(assetComplianceItems.nextDueDate)
      .limit(limit);

    res.json(
      rows.map(({ item, assetReference, fullAddress, typeName, typeCode, typeColor }) => {
        const due = item.nextDueDate ? new Date(item.nextDueDate) : null;
        const daysOverdue = due ? Math.floor((Date.now() - due.getTime()) / 86400000) : 0;
        return {
          itemId: item.id, assetId: item.assetId,
          assetReference, fullAddress,
          complianceTypeName: typeName, complianceTypeCode: typeCode, complianceTypeColor: typeColor,
          nextDueDate: item.nextDueDate, daysOverdue,
          status: item.status, contractor: item.contractor,
        };
      })
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/assets-by-type", async (req, res) => {
  const tenantId = tid(req);
  if (!tenantId) { res.json([]); return; }

  try {
    const rows = await db
      .select({ assetType: assets.assetType, c: count() })
      .from(assets)
      .where(and(eq(assets.tenantId, tenantId), isNull(assets.deletedAt)))
      .groupBy(assets.assetType);
    res.json(rows.map((r) => ({ assetType: r.assetType, count: Number(r.c) })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/due-soon", async (req, res) => {
  const tenantId = tid(req);
  if (!tenantId) { res.json([]); return; }

  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const future = new Date();
  future.setDate(future.getDate() + days);
  const today = new Date().toISOString().slice(0, 10);
  const futureDateStr = future.toISOString().slice(0, 10);

  try {
    const rows = await db
      .select({
        item: assetComplianceItems,
        assetReference: assets.assetReference,
        fullAddress: assets.fullAddress,
        typeName: complianceTypes.name,
        typeCode: complianceTypes.code,
        typeColor: complianceTypes.color,
      })
      .from(assetComplianceItems)
      .innerJoin(assets, eq(assetComplianceItems.assetId, assets.id))
      .innerJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id))
      .where(
        and(
          eq(assetComplianceItems.tenantId, tenantId),
          eq(assetComplianceItems.isEnabled, true),
          sql`${assetComplianceItems.status} = 'due_soon'`,
          sql`${assetComplianceItems.nextDueDate} >= ${today}`,
          sql`${assetComplianceItems.nextDueDate} <= ${futureDateStr}`,
        )
      )
      .orderBy(assetComplianceItems.nextDueDate)
      .limit(100);

    res.json(
      rows.map(({ item, assetReference, fullAddress, typeName, typeCode, typeColor }) => {
        const due = item.nextDueDate ? new Date(item.nextDueDate) : null;
        const daysUntilDue = due ? Math.max(0, Math.floor((due.getTime() - Date.now()) / 86400000)) : 0;
        return {
          itemId: item.id, assetId: item.assetId,
          assetReference, fullAddress,
          complianceTypeName: typeName, complianceTypeCode: typeCode, complianceTypeColor: typeColor,
          nextDueDate: item.nextDueDate, daysUntilDue, status: item.status,
        };
      })
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
