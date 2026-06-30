import { Router } from "express";
import path from "path";
import crypto from "crypto";
import { db } from "@workspace/db";
import { documents, complianceRecords, users, assetComplianceItems, complianceTypes, assets } from "@workspace/db/schema";
import { and, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { writeAuditLog } from "../lib/audit";
import { saveFile, saveFileExact, isAllowedFileType, guessMime, absolutePath } from "../lib/storage";
import { existsSync } from "fs";

const DOWNLOAD_TOKEN_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";
const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

function generateDownloadToken(docId: string, tenantId: string): string {
  const expires = Date.now() + DOWNLOAD_TOKEN_TTL_MS;
  const payload = `${docId}:${tenantId}:${expires}`;
  const sig = crypto.createHmac("sha256", DOWNLOAD_TOKEN_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

function verifyDownloadToken(token: string, docId: string, tenantId: string): { valid: boolean; extractedTenantId?: string } {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const colonCount = (decoded.match(/:/g) || []).length;
    if (colonCount < 3) return { valid: false };
    const lastColon = decoded.lastIndexOf(":");
    const sig = decoded.slice(lastColon + 1);
    const payloadPart = decoded.slice(0, lastColon);
    const parts = payloadPart.split(":");
    if (parts.length < 3) return { valid: false };
    const [id, tid, expiresStr] = parts;
    const expires = parseInt(expiresStr, 10);
    if (id !== docId || tid !== tenantId || isNaN(expires) || Date.now() > expires) return { valid: false };
    const expected = crypto.createHmac("sha256", DOWNLOAD_TOKEN_SECRET).update(payloadPart).digest("hex");
    return { valid: sig === expected, extractedTenantId: tid };
  } catch { return { valid: false }; }
}

function parseTenantFromToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(":");
    return parts[1] ?? null;
  } catch { return null; }
}

const router = Router();

// ── Token-based download (no requireAuth — auth is embedded in token) ─────────
router.get("/documents/:docId/download", async (req: any, res) => {
  const tokenParam = req.query.t as string | undefined;
  let tenantId: string;

  if (tokenParam) {
    const extracted = parseTenantFromToken(tokenParam);
    if (!extracted) { res.status(401).json({ error: "Invalid token" }); return; }
    const docId = String(req.params.docId);
    if (!verifyDownloadToken(tokenParam, docId, extracted).valid) {
      res.status(401).json({ error: "Token expired or invalid" }); return;
    }
    tenantId = extracted;
  } else {
    if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
    tenantId = req.user.tenantId;
  }

  try {
    const [doc] = await db.select().from(documents)
      .where(and(eq(documents.id, String(req.params.docId)), eq(documents.tenantId, tenantId), isNull(documents.deletedAt)));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    const inline = req.query.inline === "true";
    const mime = doc.fileType || guessMime(doc.fileName);
    const disposition = `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(doc.fileName)}"`;

    if (doc.filePath.startsWith("/objects/")) {
      res.status(404).json({ error: "File not found (legacy storage path not supported)" });
      return;
    }

    const abs = absolutePath(doc.filePath);
    const resolved = require("path").resolve(abs);
    const tenantRoot = require("path").resolve(
      process.env.UPLOAD_ROOT ?? require("path").join(process.cwd(), "uploads"),
      tenantId,
    );
    if (!resolved.startsWith(tenantRoot + require("path").sep)) {
      res.status(403).json({ error: "Access denied" }); return;
    }
    if (!existsSync(abs)) { res.status(404).json({ error: "File not found on disk" }); return; }
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", disposition);
    require("fs").createReadStream(abs).pipe(res);
  } catch (err: any) {
    req.log?.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.use(requireAuth);

const tid = (req: any): string => req.user!.tenantId;


// ── Upload document ───────────────────────────────────────────────────────────

router.post("/documents/upload", async (req: any, res) => {
  const tenantId = tid(req);
  try {
    const rawFilename = decodeURIComponent((req.headers["x-filename"] as string) || "document");
    const filename = path.basename(rawFilename).replace(/[/\\<>:"|?*\x00-\x1f]/g, "_") || "upload";

    if (!isAllowedFileType(filename)) {
      res.status(400).json({ error: "File type not allowed. Accepted: PDF, images, Excel, CSV, Word" });
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);

    const { relativePath: filePath } = await saveFile(tenantId, "documents", filename, buf);

    const {
      assetId, complianceItemId, jobId, serviceRecordId,
    } = req.query as Record<string, string | undefined>;

    const [doc] = await db.insert(documents).values({
      tenantId,
      assetId: assetId ?? null,
      complianceItemId: complianceItemId ?? null,
      jobId: jobId ?? null,
      serviceRecordId: serviceRecordId ?? null,
      fileName: filename,
      filePath,
      fileType: guessMime(filename),
      fileSize: buf.length,
      uploadedBy: req.user!.sub,
    }).returning();

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "upload_document", entityType: "document", entityId: doc.id,
      details: { fileName: filename, assetId, jobId, complianceItemId },
    });

    res.status(201).json(doc);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── List documents (by context) — includes uploader name and compliance type ──

router.get("/documents", async (req, res) => {
  const tenantId = tid(req);
  const {
    assetId,
    complianceItemId,
    jobId,
    serviceRecordId,
    search,
    fileType,
    complianceTypeId,
    dateFrom,
    dateTo,
    page: pageStr,
    limit: limitStr,
  } = req.query as Record<string, string | undefined>;

  const isGlobalSearch = !assetId && !complianceItemId && !jobId && !serviceRecordId;
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(limitStr ?? "50", 10) || 50));
  const offset = (page - 1) * limit;

  try {
    const conditions: any[] = [eq(documents.tenantId, tenantId), isNull(documents.deletedAt)];
    if (assetId) conditions.push(eq(documents.assetId, assetId));
    if (complianceItemId) conditions.push(eq(documents.complianceItemId, complianceItemId));
    if (jobId) conditions.push(eq(documents.jobId, jobId));
    if (serviceRecordId) conditions.push(eq(documents.serviceRecordId, serviceRecordId));

    if (search) {
      const term = `%${search}%`;
      conditions.push(
        or(
          ilike(documents.uprn, term),
          ilike(assets.uprn, term),
          ilike(assets.fullAddress, term),
          ilike(assets.addressLine1, term),
          ilike(assets.postCode, term),
          ilike(documents.fileName, term),
        ),
      );
    }

    if (fileType) {
      conditions.push(ilike(documents.fileType, `%${fileType}%`));
    }

    if (complianceTypeId) {
      conditions.push(eq(complianceTypes.id, complianceTypeId));
    }

    if (dateFrom) {
      const from = new Date(dateFrom);
      if (isNaN(from.getTime())) { res.status(400).json({ error: "Invalid dateFrom" }); return; }
      conditions.push(gte(documents.createdAt, from));
    }

    if (dateTo) {
      const to = new Date(dateTo);
      if (isNaN(to.getTime())) { res.status(400).json({ error: "Invalid dateTo" }); return; }
      to.setHours(23, 59, 59, 999);
      conditions.push(lte(documents.createdAt, to));
    }

    const baseQuery = db
      .select({
        id: documents.id,
        tenantId: documents.tenantId,
        assetId: documents.assetId,
        uprn: sql<string | null>`COALESCE(${documents.uprn}, ${assets.uprn})`,
        assetAddress: assets.fullAddress,
        assetAddressLine1: assets.addressLine1,
        assetPostCode: assets.postCode,
        complianceItemId: documents.complianceItemId,
        complianceRecordId: documents.complianceRecordId,
        jobId: documents.jobId,
        serviceRecordId: documents.serviceRecordId,
        fileName: documents.fileName,
        filePath: documents.filePath,
        fileType: documents.fileType,
        fileSize: documents.fileSize,
        uploadedBy: documents.uploadedBy,
        uploadedByName: users.username,
        complianceTypeName: complianceTypes.name,
        complianceTypeCode: complianceTypes.code,
        createdAt: documents.createdAt,
        deletedAt: documents.deletedAt,
      })
      .from(documents)
      .leftJoin(users, eq(documents.uploadedBy, users.id))
      .leftJoin(assets, eq(documents.assetId, assets.id))
      .leftJoin(assetComplianceItems, eq(documents.complianceItemId, assetComplianceItems.id))
      .leftJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id));

    if (isGlobalSearch) {
      const [countRow] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(documents)
        .leftJoin(assets, eq(documents.assetId, assets.id))
        .leftJoin(assetComplianceItems, eq(documents.complianceItemId, assetComplianceItems.id))
        .leftJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id))
        .where(and(...conditions));

      const total = Number(countRow?.count ?? 0);

      const list = await baseQuery
        .where(and(...conditions))
        .orderBy(sql`${documents.createdAt} DESC`)
        .limit(limit)
        .offset(offset);

      res.json({ data: list, total, page, limit });
    } else {
      const list = await baseQuery
        .where(and(...conditions))
        .orderBy(documents.createdAt);

      res.json(list);
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get document metadata ─────────────────────────────────────────────────────

router.get("/documents/:docId", async (req, res) => {
  const tenantId = tid(req);
  try {
    const [doc] = await db.select().from(documents)
      .where(and(eq(documents.id, req.params.docId), eq(documents.tenantId, tenantId), isNull(documents.deletedAt)));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
    res.json(doc);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Signed-URL for download (returns a time-limited URL the client can open) ──

router.get("/documents/:docId/signed-url", async (req, res) => {
  const tenantId = tid(req);
  try {
    const [doc] = await db.select().from(documents)
      .where(and(eq(documents.id, req.params.docId), eq(documents.tenantId, tenantId), isNull(documents.deletedAt)));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    if (doc.filePath.startsWith("/objects/")) {
      res.status(404).json({ error: "File not found (legacy storage path not supported)" });
      return;
    }

    const token = generateDownloadToken(doc.id, tenantId);
    res.json({ url: `/api/documents/${doc.id}/download?t=${token}` });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Compliance-record-scoped upload ──────────────────────────────────────────
// POST /compliance-records/:recordId/documents

router.post("/compliance-records/:recordId/documents", async (req: any, res) => {
  const tenantId = tid(req);
  const recordId = String(req.params.recordId);
  try {
    const [record] = await db.select().from(complianceRecords)
      .where(and(eq(complianceRecords.id, recordId), eq(complianceRecords.tenantId, tenantId)));
    if (!record) { res.status(404).json({ error: "Compliance record not found" }); return; }

    const rawFilename = decodeURIComponent((req.headers["x-filename"] as string) || "document");
    const filename = path.basename(rawFilename).replace(/[/\\<>:"|?*\x00-\x1f]/g, "_") || "upload";

    if (!isAllowedFileType(filename)) {
      res.status(400).json({ error: "File type not allowed. Accepted: PDF, images, Excel, CSV, Word" });
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);

    if (buf.length > 10 * 1024 * 1024) {
      res.status(400).json({ error: "File exceeds 10 MB limit" });
      return;
    }

    const mimeType = guessMime(filename);
    const { relativePath: filePath } = await saveFile(tenantId, "compliance-records", filename, buf);

    const [doc] = await db.insert(documents).values({
      tenantId,
      complianceItemId: record.complianceItemId,
      complianceRecordId: recordId,
      fileName: filename,
      filePath,
      fileType: mimeType,
      fileSize: buf.length,
      uploadedBy: req.user!.sub,
    }).returning();

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "upload_document", entityType: "document", entityId: doc.id,
      details: { fileName: filename, complianceRecordId: recordId, complianceItemId: record.complianceItemId },
    });

    res.status(201).json(doc);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Compliance-record-scoped list ─────────────────────────────────────────────
// GET /compliance-records/:recordId/documents

router.get("/compliance-records/:recordId/documents", async (req: any, res) => {
  const tenantId = tid(req);
  const recordId = String(req.params.recordId);
  try {
    const [record] = await db.select().from(complianceRecords)
      .where(and(eq(complianceRecords.id, recordId), eq(complianceRecords.tenantId, tenantId)));
    if (!record) { res.status(404).json({ error: "Compliance record not found" }); return; }

    const list = await db.select().from(documents)
      .where(and(
        eq(documents.tenantId, tenantId),
        eq(documents.complianceRecordId, recordId),
        isNull(documents.deletedAt),
      ))
      .orderBy(documents.createdAt);

    res.json(list);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Soft-delete document ──────────────────────────────────────────────────────

router.delete("/documents/:docId", async (req, res) => {
  const tenantId = tid(req);
  try {
    const [doc] = await db.select().from(documents)
      .where(and(eq(documents.id, req.params.docId), eq(documents.tenantId, tenantId), isNull(documents.deletedAt)));
    if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

    await db.update(documents).set({ deletedAt: new Date() }).where(eq(documents.id, doc.id));

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "delete_document", entityType: "document", entityId: doc.id,
      details: { fileName: doc.fileName },
    });

    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Asset-scoped document upload (no AI processing) ───────────────────────────
// POST /assets/:assetId/documents

router.post("/assets/:assetId/documents", async (req: any, res) => {
  const tenantId = tid(req);
  const assetId = String(req.params.assetId);

  try {
    const [asset] = await db.select().from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.tenantId, tenantId), isNull(assets.deletedAt)));
    if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

    const rawFilename = decodeURIComponent((req.headers["x-filename"] as string) || "document");
    const filename = path.basename(rawFilename).replace(/[/\\<>:"|?*\x00-\x1f]/g, "_") || "upload";

    if (!isAllowedFileType(filename)) {
      res.status(400).json({ error: "File type not allowed" });
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);

    if (buf.length > 20 * 1024 * 1024) {
      res.status(400).json({ error: "File exceeds 20 MB limit" });
      return;
    }

    const uprn = asset.uprn ?? null;
    let filePath: string;
    if (uprn) {
      const r = await saveFileExact(tenantId, uprn, filename, buf);
      filePath = r.relativePath;
    } else {
      const r = await saveFile(tenantId, "documents", filename, buf);
      filePath = r.relativePath;
    }

    const [doc] = await db.insert(documents).values({
      tenantId,
      assetId,
      uprn,
      fileName: filename,
      filePath,
      fileType: guessMime(filename),
      fileSize: buf.length,
      uploadedBy: req.user!.sub,
    }).returning();

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "upload_document", entityType: "document", entityId: doc.id,
      details: { fileName: filename, assetId, uprn },
    });

    res.status(201).json(doc);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
