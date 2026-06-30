import { Router } from "express";
import { db } from "@workspace/db";
import {
  assetComplianceItems, complianceTypes, complianceRecords, complianceHistory, assets, PROPERTY_SUBTYPES,
} from "@workspace/db/schema";
import { eq, and, sql, count, desc, inArray, isNull, or, SQL } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { writeAuditLog } from "../lib/audit";

const SUBTYPE_SET = new Set<string>(PROPERTY_SUBTYPES);

/**
 * Build a WHERE condition for assets matching the given assetTypes list.
 * Handles the two-tier model:
 *   - "property" / "block"  → matches top-level assetType column
 *   - legacy sub-type values (flat, house, …) → matches assetType='property' AND propertySubtype IN (values)
 */
function buildAssetTypeCondition(assetTypes: string[]): SQL {
  const mainTypes = assetTypes.filter(t => !SUBTYPE_SET.has(t));
  const subtypes  = assetTypes.filter(t => SUBTYPE_SET.has(t));

  const clauses: SQL[] = [];
  if (mainTypes.length > 0) {
    clauses.push(inArray(assets.assetType, mainTypes as any));
  }
  if (subtypes.length > 0) {
    clauses.push(and(
      eq(assets.assetType, "property" as any),
      inArray(assets.propertySubtype, subtypes as any),
    ) as SQL);
  }
  if (clauses.length === 0) return eq(assets.assetType, "property" as any); // fallback
  return clauses.length === 1 ? clauses[0] : or(...clauses) as SQL;
}

const router = Router();
router.use(requireAuth);

function tid(req: any): string {
  return req.user.tenantId as string;
}

// ── Per-compliance-type status summary ────────────────────────────────────
router.get("/compliance-items/summary-by-type", async (req, res) => {
  const tenantId = tid(req);
  try {
    const rows = await db
      .select({
        typeId: complianceTypes.id,
        typeName: complianceTypes.name,
        typeCode: complianceTypes.code,
        typeColor: complianceTypes.color,
        status: assetComplianceItems.status,
        cnt: count(),
      })
      .from(assetComplianceItems)
      .innerJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id))
      .where(and(
        eq(assetComplianceItems.tenantId, tenantId),
        eq(assetComplianceItems.isEnabled, true),
      ))
      .groupBy(
        complianceTypes.id,
        complianceTypes.name,
        complianceTypes.code,
        complianceTypes.color,
        assetComplianceItems.status,
      )
      .orderBy(complianceTypes.name);

    const byType: Record<string, any> = {};
    for (const row of rows) {
      if (!byType[row.typeId]) {
        byType[row.typeId] = {
          typeId: row.typeId,
          typeName: row.typeName,
          typeCode: row.typeCode,
          typeColor: row.typeColor,
          overdue: 0, due_soon: 0, follow_on_required: 0,
          failed: 0, awaiting_evidence: 0, compliant: 0, not_applicable: 0,
          total: 0,
        };
      }
      byType[row.typeId][row.status] = Number(row.cnt);
      byType[row.typeId].total += Number(row.cnt);
    }

    res.json({ types: Object.values(byType) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Cross-asset compliance items list ─────────────────────────────────────
router.get("/compliance-items", async (req, res) => {
  const tenantId = tid(req);
  const ALLOWED_STATUSES = new Set([
    "compliant", "due_soon", "overdue", "failed",
    "not_applicable", "awaiting_evidence", "follow_on_required",
  ]);
  const rawStatus = req.query.status as string | undefined;
  if (rawStatus && !ALLOWED_STATUSES.has(rawStatus)) {
    res.status(400).json({ error: `Invalid status value: ${rawStatus}` });
    return;
  }
  const statusFilter = rawStatus || undefined;
  const typeId = req.query.complianceTypeId as string | undefined;
  const enabledOnly = req.query.enabledOnly !== "false";
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  try {
    const conditions: any[] = [eq(assetComplianceItems.tenantId, tenantId)];
    if (enabledOnly) conditions.push(eq(assetComplianceItems.isEnabled, true));
    if (statusFilter) conditions.push(eq(assetComplianceItems.status, statusFilter as any));
    if (typeId) conditions.push(eq(assetComplianceItems.complianceTypeId, typeId));

    const items = await db
      .select({
        id: assetComplianceItems.id,
        assetId: assetComplianceItems.assetId,
        assetReference: assets.assetReference,
        fullAddress: assets.fullAddress,
        addressLine1: assets.addressLine1,
        postCode: assets.postCode,
        complianceTypeId: assetComplianceItems.complianceTypeId,
        complianceTypeName: complianceTypes.name,
        complianceTypeCode: complianceTypes.code,
        complianceTypeColor: complianceTypes.color,
        isEnabled: assetComplianceItems.isEnabled,
        status: assetComplianceItems.status,
        lastInspectionDate: assetComplianceItems.lastInspectionDate,
        nextDueDate: assetComplianceItems.nextDueDate,
        expiryDate: assetComplianceItems.expiryDate,
        certificateRef: assetComplianceItems.certificateRef,
        contractor: assetComplianceItems.contractor,
        condition: assetComplianceItems.condition,
        followOnRequired: assetComplianceItems.followOnRequired,
        notes: assetComplianceItems.notes,
        riskLevel: assetComplianceItems.riskLevel,
        updatedAt: assetComplianceItems.updatedAt,
      })
      .from(assetComplianceItems)
      .innerJoin(assets, eq(assetComplianceItems.assetId, assets.id))
      .innerJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id))
      .where(and(...conditions))
      .orderBy(desc(assetComplianceItems.updatedAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(assetComplianceItems)
      .where(and(...conditions));

    res.json({ data: items, total: Number(total), page, limit });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/assets/:assetId/compliance", async (req, res) => {
  try {
    const items = await db
      .select({
        item: assetComplianceItems,
        typeName: complianceTypes.name,
        typeCode: complianceTypes.code,
        typeColor: complianceTypes.color,
      })
      .from(assetComplianceItems)
      .innerJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id))
      .where(eq(assetComplianceItems.assetId, req.params.assetId))
      .orderBy(complianceTypes.name);

    res.json(
      items.map(({ item, typeName, typeCode, typeColor }) => ({
        ...item,
        complianceTypeName: typeName,
        complianceTypeCode: typeCode,
        complianceTypeColor: typeColor,
      }))
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/assets/:assetId/compliance/:complianceTypeId/enable", async (req, res) => {
  const tenantId = tid(req);
  const { assetId, complianceTypeId } = req.params;

  try {
    const [existing] = await db
      .select()
      .from(assetComplianceItems)
      .where(and(eq(assetComplianceItems.assetId, assetId), eq(assetComplianceItems.complianceTypeId, complianceTypeId)));

    let item;
    if (existing) {
      const [updated] = await db
        .update(assetComplianceItems)
        .set({ isEnabled: true, updatedAt: new Date() })
        .where(eq(assetComplianceItems.id, existing.id))
        .returning();
      item = updated;
    } else {
      const [created] = await db
        .insert(assetComplianceItems)
        .values({
          tenantId, assetId, complianceTypeId,
          isEnabled: true, status: "not_applicable",
        })
        .returning();
      item = created;
    }

    const [ct] = await db.select().from(complianceTypes).where(eq(complianceTypes.id, complianceTypeId));
    res.json({
      ...item,
      complianceTypeName: ct?.name,
      complianceTypeCode: ct?.code,
      complianceTypeColor: ct?.color,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/assets/:assetId/compliance/:complianceTypeId/disable", async (req, res) => {
  const { assetId, complianceTypeId } = req.params;
  try {
    await db
      .update(assetComplianceItems)
      .set({ isEnabled: false, updatedAt: new Date() })
      .where(and(eq(assetComplianceItems.assetId, assetId), eq(assetComplianceItems.complianceTypeId, complianceTypeId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Delete (remove) a compliance item from an asset ─────────────────────────
router.delete("/assets/:assetId/compliance-items/:itemId", async (req, res) => {
  const tenantId = tid(req);
  const assetId = String(req.params.assetId);
  const itemId = String(req.params.itemId);

  try {
    const [item] = await db
      .select()
      .from(assetComplianceItems)
      .where(
        and(
          eq(assetComplianceItems.id, itemId),
          eq(assetComplianceItems.assetId, assetId),
          eq(assetComplianceItems.tenantId, tenantId),
        )
      );
    if (!item) { res.status(404).json({ error: "Compliance item not found" }); return; }

    // compliance_records has a non-cascading FK to asset_compliance_items,
    // so we must delete child records before removing the parent row.
    await db
      .delete(complianceRecords)
      .where(eq(complianceRecords.complianceItemId, itemId));

    await db.delete(assetComplianceItems).where(eq(assetComplianceItems.id, itemId));

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "remove_compliance_item", entityType: "asset_compliance_item", entityId: itemId,
      details: { assetId, complianceTypeId: item.complianceTypeId },
    });

    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Bulk-create compliance items ────────────────────────────────────────────
router.post("/assets/:assetId/compliance-items/bulk", async (req, res) => {
  const tenantId = tid(req);
  const assetId = String(req.params.assetId);
  const { complianceTypeIds } = req.body as { complianceTypeIds: string[] };

  if (!Array.isArray(complianceTypeIds) || complianceTypeIds.length === 0) {
    res.status(400).json({ error: "complianceTypeIds must be a non-empty array" });
    return;
  }

  try {
    // Verify asset belongs to caller's tenant
    const [ownerCheck] = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.tenantId, tenantId), isNull(assets.deletedAt)));
    if (!ownerCheck) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    // Verify all compliance types are accessible to this tenant (system or tenant-owned)
    const accessible = await db
      .select({ id: complianceTypes.id })
      .from(complianceTypes)
      .where(and(
        inArray(complianceTypes.id, complianceTypeIds),
        or(isNull(complianceTypes.tenantId), eq(complianceTypes.tenantId, tenantId))
      ));
    if (accessible.length !== complianceTypeIds.length) {
      res.status(403).json({ error: "One or more compliance types are not accessible" });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    const rows = complianceTypeIds.map((complianceTypeId: string) => ({
      tenantId,
      assetId,
      complianceTypeId,
      isEnabled: true,
      status: "due_soon" as const,
      nextDueDate: today,
    }));

    const created = await db
      .insert(assetComplianceItems)
      .values(rows)
      .onConflictDoNothing()
      .returning();

    // Fetch with type info for response
    if (created.length === 0) {
      res.status(201).json([]);
      return;
    }

    const createdIds = created.map(c => c.id);
    const items = await db
      .select({
        id: assetComplianceItems.id,
        assetId: assetComplianceItems.assetId,
        complianceTypeId: assetComplianceItems.complianceTypeId,
        complianceTypeName: complianceTypes.name,
        complianceTypeCode: complianceTypes.code,
        complianceTypeColor: complianceTypes.color,
        isEnabled: assetComplianceItems.isEnabled,
        status: assetComplianceItems.status,
        lastInspectionDate: assetComplianceItems.lastInspectionDate,
        nextDueDate: assetComplianceItems.nextDueDate,
        expiryDate: assetComplianceItems.expiryDate,
        certificateRef: assetComplianceItems.certificateRef,
        notes: assetComplianceItems.notes,
        updatedAt: assetComplianceItems.updatedAt,
      })
      .from(assetComplianceItems)
      .innerJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id))
      .where(inArray(assetComplianceItems.id, createdIds));

    res.status(201).json(items);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Portfolio-wide bulk-assign ───────────────────────────────────────────────
router.post("/compliance-items/bulk-assign", async (req, res) => {
  const tenantId = tid(req);
  const { complianceTypeIds, assetTypes, activeOnly = true, preview = false } =
    req.body as {
      complianceTypeIds: string[];
      assetTypes: string[];
      activeOnly?: boolean;
      preview?: boolean;
    };

  if (!Array.isArray(complianceTypeIds) || complianceTypeIds.length === 0) {
    res.status(400).json({ error: "complianceTypeIds must be a non-empty array" });
    return;
  }
  if (!Array.isArray(assetTypes) || assetTypes.length === 0) {
    res.status(400).json({ error: "assetTypes must be a non-empty array" });
    return;
  }

  try {
    // Verify all compliance types are accessible to this tenant
    const accessible = await db
      .select({ id: complianceTypes.id })
      .from(complianceTypes)
      .where(and(
        inArray(complianceTypes.id, complianceTypeIds),
        or(isNull(complianceTypes.tenantId), eq(complianceTypes.tenantId, tenantId))
      ));
    if (accessible.length !== complianceTypeIds.length) {
      res.status(403).json({ error: "One or more compliance types are not accessible" });
      return;
    }

    // Fetch matching assets — handles both top-level types (property/block) and legacy sub-type values
    const assetConditions: any[] = [
      eq(assets.tenantId, tenantId),
      isNull(assets.deletedAt),
      buildAssetTypeCondition(assetTypes),
    ];
    if (activeOnly) {
      assetConditions.push(eq(assets.status, "active"));
    }

    const matchingAssets = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(...assetConditions));

    if (preview) {
      res.json({ count: matchingAssets.length });
      return;
    }

    if (matchingAssets.length === 0) {
      res.json({ created: 0, skipped: 0 });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows = matchingAssets.flatMap((asset) =>
      complianceTypeIds.map((complianceTypeId) => ({
        tenantId,
        assetId: asset.id,
        complianceTypeId,
        isEnabled: true,
        status: "due_soon" as const,
        nextDueDate: today,
      }))
    );

    const created = await db
      .insert(assetComplianceItems)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: assetComplianceItems.id });

    const skipped = rows.length - created.length;

    await writeAuditLog({
      tenantId,
      userId: req.user!.sub,
      actorName: req.user!.username,
      action: "bulk_assign_compliance",
      entityType: "asset_compliance_item",
      entityId: tenantId,
      details: { complianceTypeIds, assetTypes, activeOnly, created: created.length, skipped },
    });

    res.json({ created: created.length, skipped });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/compliance-items/bulk-assign/preview", async (req, res) => {
  const tenantId = tid(req);
  const complianceTypeIds = (req.query.complianceTypeIds as string || "").split(",").filter(Boolean);
  const assetTypes = (req.query.assetTypes as string || "").split(",").filter(Boolean);
  const activeOnly = req.query.activeOnly !== "false";

  if (complianceTypeIds.length === 0 || assetTypes.length === 0) {
    res.json({ count: 0 });
    return;
  }

  try {
    const assetConditions: any[] = [
      eq(assets.tenantId, tenantId),
      isNull(assets.deletedAt),
      buildAssetTypeCondition(assetTypes),
    ];
    if (activeOnly) assetConditions.push(eq(assets.status, "active"));

    const [{ total }] = await db
      .select({ total: count() })
      .from(assets)
      .where(and(...assetConditions));

    res.json({ count: Number(total) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/compliance-records", async (req, res) => {
  const { itemId } = req.query as { itemId?: string };
  if (!itemId) { res.status(400).json({ error: "itemId required" }); return; }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  try {
    const list = await db
      .select()
      .from(complianceRecords)
      .where(eq(complianceRecords.complianceItemId, itemId))
      .orderBy(desc(complianceRecords.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(complianceRecords)
      .where(eq(complianceRecords.complianceItemId, itemId));

    res.json({ data: list, total: Number(total), page, limit });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

function calcNextDueDate(inspectionDate: string, frequencyMonths: number): string {
  const d = new Date(inspectionDate);
  d.setMonth(d.getMonth() + frequencyMonths);
  return d.toISOString().slice(0, 10);
}

function calcStatus(
  nextDue: string | null,
  dueSoonDays: number,
  followOn: boolean,
): "compliant" | "due_soon" | "overdue" | "follow_on_required" {
  if (followOn) return "follow_on_required";
  if (!nextDue) return "compliant";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextDue);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return "overdue";
  if (diffDays <= dueSoonDays) return "due_soon";
  return "compliant";
}

router.post("/compliance-items/:itemId/records", async (req, res) => {
  const tenantId = tid(req);
  const { itemId } = req.params;
  const {
    status: inputStatus, inspectionDate, nextDueDate: inputNextDue, expiryDate, certificateRef,
    contractor, condition, followOnRequired = false, notes, riskLevel,
  } = req.body;

  try {
    const [item] = await db
      .select()
      .from(assetComplianceItems)
      .where(eq(assetComplianceItems.id, itemId));
    if (!item) { res.status(404).json({ error: "Compliance item not found" }); return; }

    const [ct] = await db.select().from(complianceTypes).where(eq(complianceTypes.id, item.complianceTypeId));

    // Auto-calculate nextDueDate if not supplied but frequency is set
    let resolvedNextDue: string | null = inputNextDue ?? item.nextDueDate ?? null;
    if (!resolvedNextDue && inspectionDate && ct?.frequencyMonths) {
      resolvedNextDue = calcNextDueDate(inspectionDate, ct.frequencyMonths);
    } else if (inspectionDate && ct?.frequencyMonths && !inputNextDue) {
      resolvedNextDue = calcNextDueDate(inspectionDate, ct.frequencyMonths);
    }

    // Auto-calculate status from nextDueDate unless caller explicitly set it
    const dueSoonDays = ct?.dueSoonDays ?? 30;
    const resolvedStatus: typeof item.status = inputStatus
      ?? calcStatus(resolvedNextDue, dueSoonDays, followOnRequired);

    const previousState = { ...item };

    const [record] = await db
      .insert(complianceRecords)
      .values({
        tenantId,
        complianceItemId: itemId,
        status: resolvedStatus, inspectionDate, nextDueDate: resolvedNextDue, expiryDate,
        certificateRef, contractor, condition, followOnRequired,
        notes, riskLevel,
        source: "manual_edit",
        createdBy: req.user!.sub,
      })
      .returning();

    const [updatedItem] = await db
      .update(assetComplianceItems)
      .set({
        status: resolvedStatus,
        lastInspectionDate: inspectionDate ?? item.lastInspectionDate,
        nextDueDate: resolvedNextDue ?? item.nextDueDate,
        expiryDate: expiryDate ?? item.expiryDate,
        certificateRef: certificateRef ?? item.certificateRef,
        contractor: contractor ?? item.contractor,
        condition: condition ?? item.condition,
        followOnRequired: followOnRequired ?? item.followOnRequired,
        notes: notes ?? item.notes,
        riskLevel: riskLevel ?? item.riskLevel,
        updatedAt: new Date(),
      })
      .where(eq(assetComplianceItems.id, itemId))
      .returning();

    await db.insert(complianceHistory).values({
      tenantId,
      entityType: "asset_compliance_item",
      entityId: itemId,
      action: "update_compliance",
      previousState: previousState as any,
      newState: updatedItem as any,
      changedFields: ["status", "lastInspectionDate", "nextDueDate", "expiryDate", "certificateRef"],
      source: "manual_edit",
      actorId: req.user!.sub,
    });

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "create_compliance_record", entityType: "compliance_record", entityId: record.id,
    });

    res.status(201).json({ ...record, nextDueDate: resolvedNextDue, status: resolvedStatus });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/compliance-items/:itemId", async (req, res) => {
  const tenantId = tid(req);
  const { itemId } = req.params;
  try {
    const [row] = await db.select({
      item: assetComplianceItems,
      ct: { id: complianceTypes.id, name: complianceTypes.name, code: complianceTypes.code, frequencyMonths: complianceTypes.frequencyMonths, customFieldDefinitions: complianceTypes.customFieldDefinitions },
      asset: { id: assets.id, fullAddress: assets.fullAddress, assetReference: assets.assetReference, uprn: assets.uprn },
    })
      .from(assetComplianceItems)
      .innerJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id))
      .innerJoin(assets, eq(assetComplianceItems.assetId, assets.id))
      .where(and(eq(assetComplianceItems.id, itemId), eq(assetComplianceItems.tenantId, tenantId)));
    if (!row) { res.status(404).json({ error: "Compliance item not found" }); return; }
    res.json({ ...row.item, complianceType: row.ct, asset: row.asset });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/compliance-items/:itemId/history", async (req, res) => {
  const { itemId } = req.params;
  try {
    const history = await db
      .select()
      .from(complianceHistory)
      .where(
        and(
          eq(complianceHistory.entityType, "asset_compliance_item"),
          sql`${complianceHistory.entityId} = ${itemId}::uuid`,
        )
      )
      .orderBy(desc(complianceHistory.createdAt))
      .limit(100);
    res.json(history);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
