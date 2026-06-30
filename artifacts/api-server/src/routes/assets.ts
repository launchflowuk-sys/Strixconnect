import { Router } from "express";
import { db } from "@workspace/db";
import {
  assets, assetComplianceItems, complianceTypes, complianceHistory, PROPERTY_SUBTYPES,
} from "@workspace/db/schema";
import { eq, and, isNull, ilike, or, sql, count, inArray } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { writeAuditLog } from "../lib/audit";

const router = Router();
router.use(requireAuth);

function tenantFilter(req: any) {
  const tid = req.user.tenantId as string;
  if (!tid && !req.user.isSuperAdmin) throw new Error("No tenant context");
  return tid;
}

router.get("/assets", async (req, res) => {
  let tenantId: string;
  try { tenantId = tenantFilter(req); } catch { res.status(400).json({ error: "No tenant context" }); return; }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const { search, assetType, status, area, parentId, heatingType, propertySubtype, buildType, residentType } = req.query as Record<string, string>;

  try {
    const conditions = [
      eq(assets.tenantId, tenantId),
      isNull(assets.deletedAt),
    ] as any[];

    if (status) conditions.push(sql`${assets.status} = ${status}`);
    if (assetType) conditions.push(sql`${assets.assetType} = ${assetType}`);
    if (area) conditions.push(ilike(assets.area, `%${area}%`));
    if (parentId) conditions.push(eq(assets.parentAssetId, parentId));
    if (heatingType) conditions.push(ilike(assets.heatingType, `%${heatingType}%`));
    if (propertySubtype) conditions.push(sql`${assets.propertySubtype} = ${propertySubtype}`);
    if (buildType) conditions.push(ilike(assets.buildType, `%${buildType}%`));
    if (residentType) conditions.push(ilike(assets.residentType, `%${residentType}%`));
    if (search) {
      conditions.push(
        or(
          ilike(assets.fullAddress, `%${search}%`),
          ilike(assets.assetReference, `%${search}%`),
          ilike(assets.uprn, `%${search}%`),
          ilike(assets.postCode, `%${search}%`),
        )!
      );
    }

    const where = and(...conditions);
    const list = await db.select().from(assets).where(where).limit(limit).offset(offset).orderBy(assets.assetReference);
    const [{ total }] = await db.select({ total: count() }).from(assets).where(where);

    const withSummary = await Promise.all(
      list.map(async (a) => {
        const items = await db
          .select({ status: assetComplianceItems.status })
          .from(assetComplianceItems)
          .where(and(eq(assetComplianceItems.assetId, a.id), eq(assetComplianceItems.isEnabled, true)));
        const summary = {
          total: items.length,
          compliant: items.filter((i) => i.status === "compliant").length,
          dueSoon: items.filter((i) => i.status === "due_soon").length,
          overdue: items.filter((i) => i.status === "overdue").length,
          failed: items.filter((i) => i.status === "failed").length,
          notApplicable: items.filter((i) => i.status === "not_applicable").length,
        };
        return { ...a, complianceSummary: summary };
      })
    );

    res.json({ data: withSummary, total: Number(total), page, limit });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/assets", async (req, res) => {
  let tenantId: string;
  try { tenantId = tenantFilter(req); } catch { res.status(400).json({ error: "No tenant context" }); return; }

  const { assetType: rawAssetType, propertySubtype: rawSubtype, complianceTypeIds, ...rest } = req.body;
  if (!rawAssetType) { res.status(400).json({ error: "assetType required" }); return; }
  const VALID_TYPES = new Set(["property", "block"]);
  const assetType = String(rawAssetType).toLowerCase();
  if (!VALID_TYPES.has(assetType)) {
    res.status(400).json({ error: `Invalid assetType "${rawAssetType}". Allowed values: property, block` }); return;
  }
  const VALID_SUBTYPES = new Set<string>(PROPERTY_SUBTYPES);
  let propertySubtype: string | null = null;
  if (assetType === "property") {
    if (!rawSubtype) { res.status(400).json({ error: "propertySubtype is required when assetType is property" }); return; }
    const sub = String(rawSubtype).toLowerCase();
    if (!VALID_SUBTYPES.has(sub)) {
      res.status(400).json({ error: `Invalid propertySubtype "${rawSubtype}". Allowed values: ${PROPERTY_SUBTYPES.join(", ")}` }); return;
    }
    propertySubtype = sub;
  }
  // blocks must not carry a sub-type
  delete (rest as any).propertySubtype;

  const typeIds: string[] = Array.isArray(complianceTypeIds) ? complianceTypeIds : [];

  try {
    // Validate complianceTypeIds are tenant-accessible before starting transaction
    if (typeIds.length > 0) {
      const accessible = await db
        .select({ id: complianceTypes.id })
        .from(complianceTypes)
        .where(and(
          inArray(complianceTypes.id, typeIds),
          or(isNull(complianceTypes.tenantId), eq(complianceTypes.tenantId, tenantId))
        ));
      if (accessible.length !== typeIds.length) {
        res.status(403).json({ error: "One or more compliance types are not accessible" });
        return;
      }
    }

    let asset: typeof assets.$inferSelect;

    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(assets)
        .values({ ...rest, assetType, propertySubtype, tenantId, createdBy: req.user!.sub, updatedBy: req.user!.sub })
        .returning();
      asset = created;

      if (typeIds.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        await tx
          .insert(assetComplianceItems)
          .values(typeIds.map(ctId => ({
            tenantId,
            assetId: asset.id,
            complianceTypeId: ctId,
            isEnabled: true,
            status: "due_soon" as const,
            nextDueDate: today,
          })))
          .onConflictDoNothing();
      }
    });

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "create_asset", entityType: "asset", entityId: asset!.id,
      details: { assetReference: asset!.assetReference, assetType, complianceItemsAdded: typeIds.length },
    });

    res.status(201).json({
      ...asset!,
      complianceSummary: {
        total: typeIds.length, compliant: 0, dueSoon: typeIds.length, overdue: 0, failed: 0, notApplicable: 0,
      },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/assets/:assetId", async (req, res) => {
  let tenantId: string;
  try { tenantId = tenantFilter(req); } catch { res.status(400).json({ error: "No tenant context" }); return; }

  try {
    const [asset] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, req.params.assetId), eq(assets.tenantId, tenantId), isNull(assets.deletedAt)));
    if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

    const items = await db
      .select({
        item: assetComplianceItems,
        typeName: complianceTypes.name,
        typeCode: complianceTypes.code,
        typeColor: complianceTypes.color,
      })
      .from(assetComplianceItems)
      .innerJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id))
      .where(eq(assetComplianceItems.assetId, asset.id));

    const [{ childCount }] = await db
      .select({ childCount: count() })
      .from(assets)
      .where(and(eq(assets.parentAssetId, asset.id), isNull(assets.deletedAt)));

    const summary = {
      total: items.length,
      compliant: items.filter((i) => i.item.status === "compliant").length,
      dueSoon: items.filter((i) => i.item.status === "due_soon").length,
      overdue: items.filter((i) => i.item.status === "overdue").length,
      failed: items.filter((i) => i.item.status === "failed").length,
      notApplicable: items.filter((i) => i.item.status === "not_applicable").length,
    };

    res.json({
      ...asset,
      complianceSummary: summary,
      complianceItems: items.map(({ item, typeName, typeCode, typeColor }) => ({
        ...item,
        complianceTypeName: typeName,
        complianceTypeCode: typeCode,
        complianceTypeColor: typeColor,
      })),
      childCount: Number(childCount),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/assets/:assetId", async (req, res) => {
  let tenantId: string;
  try { tenantId = tenantFilter(req); } catch { res.status(400).json({ error: "No tenant context" }); return; }

  try {
    const [existing] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, req.params.assetId), eq(assets.tenantId, tenantId)));
    if (!existing) { res.status(404).json({ error: "Asset not found" }); return; }

    const allowedFields = [
      "assetReference", "uprn", "fullAddress", "addressLine1", "addressLine2",
      "addressLine3", "addressLine4", "area", "postCode", "assetType",
      "propertySubtype", "buildType", "archetype", "bedrooms", "heatingType",
      "propertyCategory", "residentType", "parentAssetId", "blockReference",
      "status", "notes", "customAttributes",
    ];
    const VALID_TYPES = new Set(["property", "block"]);
    const VALID_SUBTYPES = new Set<string>(PROPERTY_SUBTYPES);
    const updates: Record<string, unknown> = { updatedAt: new Date(), updatedBy: req.user!.sub };

    // Validate and normalise incoming assetType (if present)
    const incomingAssetType = req.body.assetType
      ? String(req.body.assetType).toLowerCase()
      : undefined;
    if (incomingAssetType !== undefined && !VALID_TYPES.has(incomingAssetType)) {
      res.status(400).json({ error: `Invalid assetType "${req.body.assetType}". Allowed values: property, block` }); return;
    }
    // Compute the effective assetType after this update (existing value if not being changed)
    const finalAssetType = incomingAssetType ?? existing.assetType;

    // Validate and normalise incoming propertySubtype (if present)
    const incomingSubtype = req.body.propertySubtype !== undefined
      ? (req.body.propertySubtype === null || req.body.propertySubtype === ""
          ? null
          : String(req.body.propertySubtype).toLowerCase())
      : undefined;
    if (incomingSubtype !== undefined && incomingSubtype !== null && !VALID_SUBTYPES.has(incomingSubtype)) {
      res.status(400).json({ error: `Invalid propertySubtype "${req.body.propertySubtype}". Allowed values: ${PROPERTY_SUBTYPES.join(", ")}` }); return;
    }
    // Compute effective subtype after this update
    const finalSubtype = incomingSubtype !== undefined ? incomingSubtype : (existing.propertySubtype ?? null);

    // Enforce cross-field invariants using effective (post-update) values
    if (finalAssetType === "block") {
      // Blocks must never carry a subtype — force null regardless of what was sent
      updates["propertySubtype"] = null;
    } else if (finalAssetType === "property") {
      if (!finalSubtype) {
        res.status(400).json({ error: "propertySubtype is required when assetType is property" }); return;
      }
    }

    for (const f of allowedFields) {
      if (req.body[f] !== undefined) {
        if (f === "assetType") {
          updates[f] = incomingAssetType;
        } else if (f === "propertySubtype") {
          if (updates["propertySubtype"] === null) continue; // already forced null for block
          updates[f] = incomingSubtype;
        } else {
          updates[f] = req.body[f];
        }
      }
    }

    const [updated] = await db
      .update(assets)
      .set(updates as any)
      .where(and(eq(assets.id, req.params.assetId), eq(assets.tenantId, tenantId)))
      .returning();

    await db.insert(complianceHistory).values({
      tenantId,
      entityType: "asset",
      entityId: req.params.assetId,
      action: "update",
      previousState: existing as any,
      newState: updated as any,
      changedFields: Object.keys(updates).filter((k) => k !== "updatedAt" && k !== "updatedBy"),
      source: "manual_edit",
      actorId: req.user!.sub,
    });

    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/assets/:assetId", async (req, res) => {
  let tenantId: string;
  try { tenantId = tenantFilter(req); } catch { res.status(400).json({ error: "No tenant context" }); return; }

  try {
    await db
      .update(assets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(assets.id, req.params.assetId), eq(assets.tenantId, tenantId)));

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "archive_asset", entityType: "asset", entityId: req.params.assetId,
    });

    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/assets/:assetId/children", async (req, res) => {
  let tenantId: string;
  try { tenantId = tenantFilter(req); } catch { res.status(400).json({ error: "No tenant context" }); return; }

  try {
    const list = await db
      .select()
      .from(assets)
      .where(and(eq(assets.parentAssetId, req.params.assetId), eq(assets.tenantId, tenantId), isNull(assets.deletedAt)))
      .orderBy(assets.assetReference);

    res.json({ data: list, total: list.length, page: 1, limit: list.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/assets/:assetId/history", async (req, res) => {
  let tenantId: string;
  try { tenantId = tenantFilter(req); } catch { res.status(400).json({ error: "No tenant context" }); return; }

  try {
    const history = await db
      .select()
      .from(complianceHistory)
      .where(
        and(
          eq(complianceHistory.entityType, "asset"),
          sql`${complianceHistory.entityId} = ${req.params.assetId}::uuid`,
          eq(complianceHistory.tenantId, tenantId),
        )
      )
      .orderBy(sql`${complianceHistory.createdAt} DESC`)
      .limit(100);

    res.json(history);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
