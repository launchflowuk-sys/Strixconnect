import { Router } from "express";
import { db } from "@workspace/db";
import {
  serviceRecords, assets, complianceTypes, assetComplianceItems,
  complianceHistory, jobs,
} from "@workspace/db/schema";
import { and, eq, desc, isNull, count } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { writeAuditLog } from "../lib/audit";
import { saveFile, isAllowedFileType } from "../lib/storage";
import { documents } from "@workspace/db/schema";

const router = Router();
router.use(requireAuth);

const tid = (req: any): string => req.user!.tenantId;

/** Recalculate compliance status after a service record is confirmed */
async function syncComplianceItem(
  tenantId: string,
  assetId: string,
  complianceTypeId: string,
  serviceRecord: typeof serviceRecords.$inferSelect,
  userId: string,
  actorName: string,
) {
  const [item] = await db.select().from(assetComplianceItems)
    .where(and(
      eq(assetComplianceItems.assetId, assetId),
      eq(assetComplianceItems.complianceTypeId, complianceTypeId),
    ));
  if (!item) return null;

  // Snapshot previous state for history
  const previousState = {
    status: item.status,
    lastInspectionDate: item.lastInspectionDate,
    nextDueDate: item.nextDueDate,
    expiryDate: item.expiryDate,
    certificateRef: item.certificateRef,
    followOnRequired: item.followOnRequired,
  };

  // Calculate next due date from service_date + compliance frequency
  let nextDueDate: string | null = null;
  const [ct] = await db.select().from(complianceTypes).where(eq(complianceTypes.id, complianceTypeId));
  if (ct?.frequencyMonths && serviceRecord.serviceDate) {
    const sd = new Date(serviceRecord.serviceDate);
    sd.setMonth(sd.getMonth() + ct.frequencyMonths);
    nextDueDate = sd.toISOString().substring(0, 10);
  }

  // Determine new compliance status
  let newStatus: string;
  const outcome = serviceRecord.outcome;
  if (outcome === "fail") {
    newStatus = "failed";
  } else if (outcome === "follow_on_required") {
    newStatus = "follow_on_required";
  } else if (nextDueDate) {
    const today = new Date();
    const due = new Date(nextDueDate);
    const diffMs = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffMs / 86400000);
    const dueSoonDays = ct?.dueSoonDays ?? 30;
    if (diffDays < 0) newStatus = "overdue";
    else if (diffDays <= dueSoonDays) newStatus = "due_soon";
    else newStatus = "compliant";
  } else {
    newStatus = "compliant";
  }

  const newState = {
    status: newStatus,
    lastInspectionDate: serviceRecord.serviceDate,
    nextDueDate,
    expiryDate: serviceRecord.expiryDate ?? null,
    certificateRef: serviceRecord.certificateRef ?? null,
    followOnRequired: outcome === "follow_on_required",
  };

  await db.update(assetComplianceItems).set({
    status: newStatus as any,
    lastInspectionDate: serviceRecord.serviceDate ?? null,
    nextDueDate,
    expiryDate: serviceRecord.expiryDate ?? null,
    certificateRef: serviceRecord.certificateRef ?? null,
    followOnRequired: outcome === "follow_on_required",
    updatedAt: new Date(),
  }).where(eq(assetComplianceItems.id, item.id));

  // Write compliance history
  await db.insert(complianceHistory).values({
    tenantId,
    entityType: "asset_compliance_item",
    entityId: item.id,
    action: "service_record_update",
    previousState,
    newState,
    changedFields: Object.keys(newState),
    source: "service_record_upload",
    actorId: userId,
  });

  return { item, newStatus, nextDueDate };
}

// ── Upload service record file (parse preview) ────────────────────────────────

router.post("/service-records/upload", async (req: any, res) => {
  const tenantId = tid(req);
  try {
    const rawFilename = (req.headers["x-filename"] as string) || "service_record.pdf";
    const filename = require("path").basename(rawFilename)
      .replace(/[/\\<>:"|?*\x00-\x1f]/g, "_") || "upload";

    if (!isAllowedFileType(filename)) {
      res.status(400).json({ error: "File type not allowed. Accepted: PDF, images, Excel, CSV, Word" });
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);

    const { relativePath: filePath, storedName } = await saveFile(tenantId, "service-records", filename, buf);

    // Basic parse attempt for CSV/Excel — extract recognisable fields
    let parsed: Record<string, string> = {};
    const ext = require("path").extname(filename).toLowerCase();
    if (ext === ".csv") {
      const text = buf.toString("utf-8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length >= 2) {
        const headers = lines[0].split(",").map((h: string) => h.trim().toLowerCase());
        const vals = lines[1].split(",").map((v: string) => v.trim());
        const map: Record<string, string[]> = {
          certificateRef: ["certificate ref", "cert ref", "cert_ref", "certificate_ref", "ref"],
          engineerName: ["engineer", "engineer name", "engineer_name", "technician"],
          serviceDate: ["service date", "service_date", "inspection date", "inspection_date", "date"],
          expiryDate: ["expiry date", "expiry_date", "expiry"],
          outcome: ["outcome", "result", "status"],
        };
        for (const [field, aliases] of Object.entries(map)) {
          const idx = headers.findIndex((h: string) => aliases.includes(h));
          if (idx !== -1 && vals[idx]) parsed[field] = vals[idx];
        }
      }
    }

    res.status(201).json({ filePath, storedName, parsed });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Confirm service record (creates record + updates compliance) ───────────────

router.post("/service-records", async (req, res) => {
  const tenantId = tid(req);
  const {
    assetId, complianceTypeId, serviceDate, expiryDate,
    engineerName, certificateRef, outcome, notes, filePath,
  } = req.body;

  if (!assetId) { res.status(400).json({ error: "assetId is required" }); return; }

  try {
    const [asset] = await db.select().from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.tenantId, tenantId), isNull(assets.deletedAt)));
    if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

    const [sr] = await db.insert(serviceRecords).values({
      tenantId,
      assetId,
      complianceTypeId: complianceTypeId ?? null,
      serviceDate: serviceDate ?? null,
      expiryDate: expiryDate ?? null,
      engineerName: engineerName ?? null,
      certificateRef: certificateRef ?? null,
      outcome: outcome ?? null,
      notes: notes ?? null,
      status: "confirmed",
      createdBy: req.user!.sub,
    }).returning();

    // Link uploaded file as document if filePath provided
    if (filePath) {
      const fname = require("path").basename(filePath);
      await db.insert(documents).values({
        tenantId,
        assetId,
        serviceRecordId: sr.id,
        fileName: fname,
        filePath,
        fileType: require("../lib/storage").guessMime(fname),
        uploadedBy: req.user!.sub,
      });
    }

    // Update compliance item if compliance type is linked
    let complianceUpdate = null;
    if (complianceTypeId) {
      complianceUpdate = await syncComplianceItem(
        tenantId, assetId, complianceTypeId, sr, req.user!.sub, req.user!.username,
      );
    }

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "create_service_record", entityType: "service_record", entityId: sr.id,
      details: { source: "service_record_upload", assetId, complianceTypeId, outcome },
    });

    res.status(201).json({
      serviceRecord: sr,
      complianceUpdate: complianceUpdate
        ? { newStatus: complianceUpdate.newStatus, nextDueDate: complianceUpdate.nextDueDate }
        : null,
      followOnRequired: outcome === "follow_on_required",
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── List service records ──────────────────────────────────────────────────────

router.get("/service-records", async (req, res) => {
  const tenantId = tid(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const offset = (page - 1) * limit;
  const { assetId, complianceTypeId } = req.query as Record<string, string>;

  try {
    const conditions: any[] = [eq(serviceRecords.tenantId, tenantId)];
    if (assetId) conditions.push(eq(serviceRecords.assetId, assetId));
    if (complianceTypeId) conditions.push(eq(serviceRecords.complianceTypeId, complianceTypeId));

    const [list, [{ total }]] = await Promise.all([
      db.select({
        sr: serviceRecords,
        asset: { id: assets.id, fullAddress: assets.fullAddress, assetReference: assets.assetReference },
        ct: { id: complianceTypes.id, name: complianceTypes.name, code: complianceTypes.code },
      })
        .from(serviceRecords)
        .leftJoin(assets, eq(serviceRecords.assetId, assets.id))
        .leftJoin(complianceTypes, eq(serviceRecords.complianceTypeId, complianceTypes.id))
        .where(and(...conditions))
        .orderBy(desc(serviceRecords.createdAt))
        .limit(limit).offset(offset),
      db.select({ total: count() }).from(serviceRecords).where(and(...conditions)),
    ]);

    res.json({
      data: list.map(({ sr, asset, ct }) => ({ ...sr, asset, complianceType: ct })),
      total: Number(total), page, limit,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get service record detail ─────────────────────────────────────────────────

router.get("/service-records/:srId", async (req, res) => {
  const tenantId = tid(req);
  try {
    const [row] = await db.select({
      sr: serviceRecords,
      asset: { id: assets.id, fullAddress: assets.fullAddress, assetReference: assets.assetReference },
      ct: { id: complianceTypes.id, name: complianceTypes.name },
    })
      .from(serviceRecords)
      .leftJoin(assets, eq(serviceRecords.assetId, assets.id))
      .leftJoin(complianceTypes, eq(serviceRecords.complianceTypeId, complianceTypes.id))
      .where(and(eq(serviceRecords.id, req.params.srId), eq(serviceRecords.tenantId, tenantId)));

    if (!row) { res.status(404).json({ error: "Service record not found" }); return; }

    const docs = await db.select().from(documents)
      .where(and(eq(documents.serviceRecordId, row.sr.id), isNull(documents.deletedAt)));

    res.json({ ...row.sr, asset: row.asset, complianceType: row.ct, documents: docs });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
