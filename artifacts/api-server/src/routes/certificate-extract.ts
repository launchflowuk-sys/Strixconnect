import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { db } from "@workspace/db";
const execFileAsync = promisify(execFile);
import {
  assets, complianceTypes, assetComplianceItems, serviceRecords,
  complianceHistory, documents, complianceRecords,
} from "@workspace/db/schema";
import { and, eq, ilike, isNull, or } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { saveFile, saveFileExact, isAllowedFileType, absolutePath } from "../lib/storage";
// Lazy AI client — missing integration env vars disable only this feature,
// they do not crash the server at startup
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _openai: any = null;
function getOpenAI(): any | null {
  if (!_openai) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { openai } = require("@workspace/integrations-openai-ai-server");
      _openai = openai;
    } catch {
      return null;
    }
  }
  return _openai;
}

const router = Router();
router.use(requireAuth);

const tid = (req: any): string => req.user!.tenantId;

// ── Cert type → compliance type code mapping ──────────────────────────────────
const CERT_CODE_HINTS: Record<string, string[]> = {
  EICR: ["EICR", "ELECTRICAL", "ELEC"],
  GAS_SAFETY: ["CP12", "GAS", "GAS_SAFETY"],
  FIRE_RISK: ["FRA", "FIRE_RISK", "FIRE"],
  FIRE_ALARM: ["FIRE_ALARM", "FA"],
  PAT: ["PAT", "PORTABLE"],
  LEGIONELLA: ["LEGIONELLA", "WATER"],
  ASBESTOS: ["ASBESTOS"],
  LIFT: ["LIFT", "LOLER", "ELEVATOR"],
  LIGHTNING: ["LIGHTNING", "LPS"],
  EMERGENCY_LIGHTING: ["EML", "EMERGENCY_LIGHT"],
};

// ── Fixed-period expiry rules (years added to inspectionDate when expiryDate missing) ──
const EXPIRY_PERIOD_YEARS: Record<string, number> = {
  EICR: 5,
  GAS_SAFETY: 1,
  EMERGENCY_LIGHTING: 1,
  PAT: 1,
  LEGIONELLA: 2,
  ASBESTOS: 2,
};

// ── Discrepancy types that do NOT block auto-commit (saved as flags in parsedData) ──
const NON_BLOCKER_TYPES = new Set(["low_confidence", "date_conflict", "uprn_mismatch"]);

// ── File extensions that support AI extraction ────────────────────────────────
const AI_EXTRACTABLE_EXTS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".tiff", ".tif"]);

// ── Parse leading UPRN digits from filename (e.g. 0000016_PER_... → "16") ────
function parseUprnFromFilename(filename: string): string | null {
  const base = path.basename(filename, path.extname(filename));
  const match = base.match(/^(\d{4,})/); // at least 4 digits to avoid false positives
  if (!match) return null;
  return String(parseInt(match[1], 10)); // strip leading zeros
}

// ── Post-process expiry date using fixed-period rules ─────────────────────────
function applyExpiryDateRules(fields: Record<string, any>): void {
  if (fields.expiryDate) return; // AI already extracted one
  const certType = (fields.certificateType ?? "").toUpperCase();
  const periodYears = EXPIRY_PERIOD_YEARS[certType];
  if (!periodYears) return;
  const inspDate = fields.inspectionDate ?? fields.nextDueDate;
  if (!inspDate) return;
  const d = new Date(inspDate);
  if (isNaN(d.getTime())) return;
  d.setFullYear(d.getFullYear() + periodYears);
  fields.expiryDate = d.toISOString().substring(0, 10);
}

// ── Parse image as base64 url ─────────────────────────────────────────────────
async function fileToBase64ImageUrl(filePath: string, mimeType: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return `data:${mimeType};base64,${buf.toString("base64")}`;
}

// ── Render PDF first page to PNG via pdftoppm, return base64 data URL ────────
async function pdfFirstPageToImageUrl(absPath: string): Promise<string | null> {
  const tmpBase = path.join(os.tmpdir(), `cert_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  try {
    // -png: output PNG; -r 150: 150 DPI; -l 1: only first page
    await execFileAsync("pdftoppm", ["-png", "-r", "150", "-l", "1", absPath, tmpBase]);
    const tmpFiles = await fs.readdir(os.tmpdir());
    const basename = path.basename(tmpBase);
    const generated = tmpFiles.filter(f => f.startsWith(basename)).sort();
    if (!generated.length) return null;
    const imgPath = path.join(os.tmpdir(), generated[0]);
    const buf = await fs.readFile(imgPath);
    await fs.unlink(imgPath).catch(() => {});
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// ── Fall back: extract text from PDF (digital PDFs only) ─────────────────────
async function extractPdfTextFallback(filePath: string): Promise<string> {
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const buf = await fs.readFile(filePath);
    const result = await pdfParse(buf);
    return result.text ?? "";
  } catch {
    return "";
  }
}

// ── Call GPT to extract certificate fields ────────────────────────────────────
async function extractCertificateFields(
  absPath: string,
  mimeType: string,
): Promise<{ fields: Record<string, any>; confidence: Record<string, number>; error?: string }> {
  const isImage = mimeType.startsWith("image/");
  const isPdf = mimeType === "application/pdf";

  const systemPrompt = `You are an expert at reading UK compliance certificates. 
Extract all available information and return ONLY a valid JSON object.
Use ISO date format (YYYY-MM-DD) for all dates.
For outcome, use exactly one of: "pass", "fail", "follow_on_required".
For certificateType, identify the most specific type from the document.
If a field is not visible or not applicable, use null.
If the certificate states a validity period (e.g. "5 years"), calculate the expiryDate from inspectionDate + that period.`;

  const userPrompt = `Extract all fields from this UK compliance certificate and return a JSON object with exactly this structure:
{
  "certificateType": "EICR|GAS_SAFETY|FIRE_RISK|FIRE_ALARM|PAT|LEGIONELLA|ASBESTOS|LIFT|LIGHTNING|EMERGENCY_LIGHTING|OTHER",
  "certificateTypeCode": "short code e.g. EICR, CP12, FRA, PAT",
  "certificateRef": "certificate or report number",
  "uprn": "UPRN number if visible (numbers only)",
  "propertyAddress": "full property address",
  "inspectionDate": "YYYY-MM-DD or null",
  "expiryDate": "YYYY-MM-DD or null (calculate from inspectionDate + validity period if stated)",
  "nextDueDate": "YYYY-MM-DD or null (use this if expiryDate not present)",
  "engineerName": "inspector/engineer full name",
  "engineerLicenceNumber": "Gas Safe/NICEIC/NAPIT number or equivalent",
  "contractor": "company/organisation name",
  "outcome": "pass|fail|follow_on_required or null",
  "condition": "e.g. satisfactory, unsatisfactory, poor, good",
  "followOnRequired": true or false,
  "observations": ["key observation 1", "key observation 2"],
  "notes": "any other relevant notes",
  "confidence": {
    "certificateType": 0.0-1.0,
    "certificateRef": 0.0-1.0,
    "uprn": 0.0-1.0,
    "propertyAddress": 0.0-1.0,
    "inspectionDate": 0.0-1.0,
    "expiryDate": 0.0-1.0,
    "engineerName": 0.0-1.0,
    "contractor": 0.0-1.0,
    "outcome": 0.0-1.0
  }
}
Return ONLY the JSON object.`;

  let messages: any[];

  if (isImage) {
    const imageUrl = await fileToBase64ImageUrl(absPath, mimeType);
    messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: userPrompt },
        ],
      },
    ];
  } else if (isPdf) {
    // Prefer vision: render first page via pdftoppm for maximum accuracy (handles scanned PDFs)
    const imageUrl = await pdfFirstPageToImageUrl(absPath);
    if (imageUrl) {
      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: userPrompt },
          ],
        },
      ];
    } else {
      // pdftoppm rendering failed — try text extraction for digital (non-scanned) PDFs
      const text = await extractPdfTextFallback(absPath);
      if (!text.trim()) {
        return { fields: {}, confidence: {}, error: "scanned_pdf_unreadable" };
      }
      messages = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${userPrompt}\n\nCertificate text content:\n\n${text.substring(0, 8000)}`,
        },
      ];
    }
  } else {
    return { fields: {}, confidence: {} };
  }

  const openai = getOpenAI();
  if (!openai) {
    return { fields: {}, confidence: {}, error: "ai_unavailable" };
  }
  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 2048,
    messages,
  });

  const content = response.choices[0]?.message?.content ?? "";
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { fields: {}, confidence: {} };
    const parsed = JSON.parse(jsonMatch[0]);
    const { confidence = {}, ...fields } = parsed;
    return { fields, confidence };
  } catch {
    return { fields: {}, confidence: {} };
  }
}

// ── Resolve asset from filename UPRN (priority), AI UPRN, or address ──────────
async function resolveAsset(
  tenantId: string,
  filenameUprn: string | null,
  aiUprn: string | null,
  address: string | null,
) {
  // Priority 1: filename UPRN — exact match (try both raw and stripped forms)
  if (filenameUprn) {
    const rows = await db.select().from(assets)
      .where(and(
        eq(assets.tenantId, tenantId),
        isNull(assets.deletedAt),
        or(
          eq(assets.uprn, filenameUprn),
          ilike(assets.uprn, filenameUprn),
        ),
      ))
      .limit(5);
    if (rows.length === 1) return { asset: rows[0], matchType: "uprn_filename" as const, candidates: rows };
    if (rows.length > 1) return { asset: null, matchType: "uprn_multiple" as const, candidates: rows };
  }

  // Priority 2: AI-extracted UPRN (fuzzy contains match)
  if (aiUprn) {
    const norm = aiUprn.replace(/\D/g, "");
    if (norm.length >= 4) {
      const rows = await db.select().from(assets)
        .where(and(eq(assets.tenantId, tenantId), isNull(assets.deletedAt), ilike(assets.uprn, `%${norm}%`)))
        .limit(5);
      if (rows.length === 1) return { asset: rows[0], matchType: "uprn" as const, candidates: rows };
      if (rows.length > 1) return { asset: null, matchType: "uprn_multiple" as const, candidates: rows };
    }
  }

  // Priority 3: address word matching
  if (address && address.length > 5) {
    const words = address.split(/[\s,]+/).filter(w => w.length > 3).slice(0, 3);
    if (words.length) {
      const conditions = words.map(w => ilike(assets.fullAddress, `%${w}%`));
      const rows = await db.select().from(assets)
        .where(and(eq(assets.tenantId, tenantId), isNull(assets.deletedAt), or(...conditions)))
        .limit(10);
      if (rows.length === 1) return { asset: rows[0], matchType: "address" as const, candidates: rows };
      if (rows.length > 1) return { asset: null, matchType: "address_multiple" as const, candidates: rows };
    }
  }

  return { asset: null, matchType: "not_found" as const, candidates: [] };
}

// ── Resolve compliance type + item ───────────────────────────────────────────
async function resolveComplianceItem(
  tenantId: string,
  assetId: string,
  certType: string | null,
  certTypeCode: string | null,
) {
  const allItems = await db.select({
    item: assetComplianceItems,
    ct: complianceTypes,
  })
    .from(assetComplianceItems)
    .innerJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id))
    .where(and(
      eq(assetComplianceItems.assetId, assetId),
      eq(assetComplianceItems.tenantId, tenantId),
      eq(assetComplianceItems.isEnabled, true),
    ));

  if (!allItems.length) return { item: null, matchType: "no_items" as const, candidates: [] };

  // Find best match using cert type hints
  const typeKey = certType?.toUpperCase() ?? "";
  const codeKey = certTypeCode?.toUpperCase() ?? "";
  const hints = CERT_CODE_HINTS[typeKey] ?? (codeKey ? [codeKey] : []);

  const scored = allItems.map(({ item, ct }) => {
    const ctCode = (ct.code ?? "").toUpperCase();
    const ctName = (ct.name ?? "").toUpperCase();
    let score = 0;
    for (const hint of hints) {
      if (ctCode.includes(hint) || ctName.includes(hint)) score += 2;
    }
    if (codeKey && (ctCode.includes(codeKey) || ctName.includes(codeKey))) score += 3;
    return { item, ct, score };
  }).sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (top.score === 0) {
    if (allItems.length === 1) {
      // Cert type genuinely unknown (no hints at all) → user must confirm, even for a single item
      if (hints.length === 0) {
        return { item: null, matchType: "type_unknown" as const, candidates: allItems };
      }
      // We have hints but the single item doesn't match → return for type_mismatch check
      return { item: allItems[0].item, ct: allItems[0].ct, matchType: "only_one" as const, candidates: allItems };
    }
    // Items exist but none match the certificate type
    return { item: null, matchType: "no_matching_item" as const, candidates: allItems };
  }
  // If top score is tied with second, it's ambiguous
  if (scored.length > 1 && scored[1].score === top.score) {
    return { item: null, matchType: "ambiguous" as const, candidates: allItems };
  }
  return { item: top.item, ct: top.ct, matchType: "matched" as const, candidates: allItems };
}

// ── Commit certificate: insert service record, document, update compliance item ─
async function commitCertificate(
  tenantId: string,
  assetId: string,
  complianceTypeId: string,
  complianceItemId: string,
  fields: Record<string, any>,
  filePath: string,
  userId: string,
  actorName: string,
  confidence?: Record<string, number>,
  flags?: any[],
) {
  const serviceDate = fields.inspectionDate ?? null;
  const expiryDate = fields.expiryDate ?? fields.nextDueDate ?? null;
  const outcome = (["pass", "fail", "follow_on_required"].includes(fields.outcome))
    ? fields.outcome : "pass";
  const observations = Array.isArray(fields.observations)
    ? fields.observations.join("; ") : null;
  const notes = [fields.notes, observations].filter(Boolean).join(" | ") || null;

  // Persist full extraction payload (all fields + confidence map + non-blocker flags) to parsedData
  const parsedData = JSON.stringify({
    certificateType: fields.certificateType ?? null,
    certificateTypeCode: fields.certificateTypeCode ?? null,
    uprn: fields.uprn ?? null,
    propertyAddress: fields.propertyAddress ?? null,
    engineerLicenceNumber: fields.engineerLicenceNumber ?? null,
    condition: fields.condition ?? null,
    followOnRequired: fields.followOnRequired ?? null,
    observations: Array.isArray(fields.observations) ? fields.observations : null,
    notes: fields.notes ?? null,
    confidence: confidence ?? null,
    flags: flags?.length ? flags : undefined,
  });

  const observationsArr: string[] | null = Array.isArray(fields.observations) && fields.observations.length
    ? fields.observations as string[]
    : null;

  const [sr] = await db.insert(serviceRecords).values({
    tenantId,
    assetId,
    complianceTypeId,
    serviceDate,
    expiryDate,
    nextDueDate: fields.nextDueDate ?? null,
    engineerName: fields.engineerName ?? null,
    engineerLicenceNumber: fields.engineerLicenceNumber ?? null,
    contractor: fields.contractor ?? null,
    certificateRef: fields.certificateRef ?? null,
    certificateType: fields.certificateType ?? null,
    certificateTypeCode: fields.certificateTypeCode ?? null,
    outcome: outcome as any,
    condition: fields.condition ?? null,
    followOnRequired: typeof fields.followOnRequired === "boolean"
      ? fields.followOnRequired
      : outcome === "follow_on_required",
    observations: observationsArr,
    uprn: fields.uprn ?? null,
    propertyAddress: fields.propertyAddress ?? null,
    notes,
    parsedData,
    status: "confirmed",
    createdBy: userId,
  }).returning();

  // Link certificate document — include UPRN from extracted fields for direct UPRN lookup
  const fname = path.basename(filePath);
  const [doc] = await db.insert(documents).values({
    tenantId,
    assetId,
    uprn: fields.uprn ?? null,
    serviceRecordId: sr.id,
    complianceItemId,
    fileName: fname,
    filePath,
    fileType: guessMimeFromPath(fname),
    uploadedBy: userId,
  }).returning();

  // Fetch compliance type for frequency calc
  const [ct] = await db.select().from(complianceTypes).where(eq(complianceTypes.id, complianceTypeId));
  let nextDueDate: string | null = null;
  if (ct?.frequencyMonths && serviceDate) {
    const sd = new Date(serviceDate);
    sd.setMonth(sd.getMonth() + ct.frequencyMonths);
    nextDueDate = sd.toISOString().substring(0, 10);
  } else if (expiryDate) {
    nextDueDate = expiryDate;
  }

  const today = new Date();
  let newStatus: string;
  if (outcome === "fail") {
    newStatus = "failed";
  } else if (outcome === "follow_on_required") {
    newStatus = "follow_on_required";
  } else if (nextDueDate) {
    const due = new Date(nextDueDate);
    const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000);
    const dueSoonDays = ct?.dueSoonDays ?? 30;
    if (diffDays < 0) newStatus = "overdue";
    else if (diffDays <= dueSoonDays) newStatus = "due_soon";
    else newStatus = "compliant";
  } else {
    newStatus = "compliant";
  }

  // Snapshot old state
  const [oldItem] = await db.select().from(assetComplianceItems).where(eq(assetComplianceItems.id, complianceItemId));
  const previousState = oldItem ? {
    status: oldItem.status,
    lastInspectionDate: oldItem.lastInspectionDate,
    nextDueDate: oldItem.nextDueDate,
    expiryDate: oldItem.expiryDate,
    certificateRef: oldItem.certificateRef,
    contractor: oldItem.contractor,
  } : {};

  const newState = {
    status: newStatus,
    lastInspectionDate: serviceDate,
    nextDueDate,
    expiryDate,
    certificateRef: fields.certificateRef ?? null,
    contractor: fields.contractor ?? null,
    condition: fields.condition ?? null,
    riskLevel: fields.riskLevel ?? null,
    extractedFields: fields,
    extractionConfidence: confidence ?? null,
  };

  await db.update(assetComplianceItems).set({
    status: newStatus as any,
    lastInspectionDate: serviceDate ?? null,
    nextDueDate,
    expiryDate,
    certificateRef: fields.certificateRef ?? null,
    contractor: fields.contractor ?? null,
    condition: fields.condition ?? null,
    riskLevel: fields.riskLevel ?? null,
    engineerName: fields.engineerName ?? null,
    engineerLicenceNumber: fields.engineerLicenceNumber ?? null,
    outcome: fields.outcome ?? null,
    certificateType: fields.certificateType ?? null,
    certificateTypeCode: fields.certificateTypeCode ?? null,
    observations: observationsArr,
    followOnRequired: typeof fields.followOnRequired === "boolean"
      ? fields.followOnRequired
      : outcome === "follow_on_required",
    updatedAt: new Date(),
  }).where(eq(assetComplianceItems.id, complianceItemId));

  // Insert compliance record (point-in-time snapshot)
  await db.insert(complianceRecords).values({
    tenantId,
    complianceItemId,
    status: newStatus,
    inspectionDate: serviceDate ?? null,
    nextDueDate,
    expiryDate,
    certificateRef: fields.certificateRef ?? null,
    contractor: fields.contractor ?? null,
    condition: fields.condition ?? null,
    riskLevel: fields.riskLevel ?? null,
    engineerName: fields.engineerName ?? null,
    engineerLicenceNumber: fields.engineerLicenceNumber ?? null,
    outcome: fields.outcome ?? null,
    certificateType: fields.certificateType ?? null,
    certificateTypeCode: fields.certificateTypeCode ?? null,
    observations: observationsArr,
    uprn: fields.uprn ?? null,
    propertyAddress: fields.propertyAddress ?? null,
    followOnRequired: typeof fields.followOnRequired === "boolean"
      ? fields.followOnRequired
      : outcome === "follow_on_required",
    notes,
    parsedData: { extractedFields: fields, confidence: confidence ?? null, flags: flags ?? null },
    source: "certificate_upload",
    createdBy: userId,
  });

  // Write audit history
  await db.insert(complianceHistory).values({
    tenantId,
    entityType: "asset_compliance_item",
    entityId: complianceItemId,
    action: "certificate_upload",
    previousState,
    newState,
    changedFields: Object.keys(newState),
    source: "certificate_upload",
    actorId: userId,
  });

  return { serviceRecord: sr, document: doc, newStatus, nextDueDate };
}

// ── Store document without AI processing (for non-AI file types) ──────────────
async function storeDocumentOnly(
  tenantId: string,
  assetId: string,
  filePath: string,
  userId: string,
  uprn?: string | null,
) {
  const fname = path.basename(filePath);
  const [doc] = await db.insert(documents).values({
    tenantId,
    assetId,
    uprn: uprn ?? null,
    fileName: fname,
    filePath,
    fileType: guessMimeFromPath(fname),
    uploadedBy: userId,
  }).returning();
  return { document: doc };
}

function guessMimeFromPath(fname: string): string {
  const ext = path.extname(fname).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
  };
  return map[ext] ?? "application/octet-stream";
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/certificate-extract
// Upload a certificate, AI-extract it, auto-commit if clean.
// Optional header x-compliance-item-id: pre-fills the target item.
// Accepts all file types; AI extraction only runs for PDF/image files.
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/certificate-extract", async (req: any, res) => {
  const tenantId = tid(req);
  try {
    const rawFilename = decodeURIComponent((req.headers["x-filename"] as string) || "certificate.pdf");
    const filename = path.basename(rawFilename).replace(/[/\\<>:"|?*\x00-\x1f]/g, "_") || "upload";

    if (!isAllowedFileType(filename)) {
      res.status(400).json({ error: "File type not allowed. Accepted: PDF, JPG, PNG, WebP, Word, Excel, CSV" });
      return;
    }

    const ext = path.extname(filename).toLowerCase();
    const canExtractAI = AI_EXTRACTABLE_EXTS.has(ext);

    // ── Parse UPRN from filename (e.g. 0000016_PER_16_BRIDGE_COURT... → "16") ──
    const filenameUprn = parseUprnFromFilename(filename);

    // Save uploaded file — use UPRN-keyed path {tenantId}/{uprn}/{filename} when UPRN known
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    let filePath: string;
    if (filenameUprn) {
      const r = await saveFileExact(tenantId, filenameUprn, filename, buf);
      filePath = r.relativePath;
    } else {
      const r = await saveFile(tenantId, "certificates", filename, buf);
      filePath = r.relativePath;
    }
    const absPath = absolutePath(filePath);
    const mimeType = guessMimeFromPath(filename);

    // ── Non-AI file types: skip extraction, store and link to asset ───────────
    if (!canExtractAI) {
      const assetRes = await resolveAsset(tenantId, filenameUprn, null, null);
      if (!assetRes.asset) {
        res.status(200).json({
          committed: false,
          filePath,
          extracted: {},
          confidence: {},
          discrepancies: [{
            type: "asset_not_found",
            message: filenameUprn
              ? `UPRN ${filenameUprn} not found in this account — please select the asset`
              : "Could not determine which property this file belongs to — please select the asset",
            extractedUprn: filenameUprn ?? null,
            extractedAddress: null,
          }],
          asset: null,
          complianceType: null,
        });
        return;
      }
      const stored = await storeDocumentOnly(tenantId, assetRes.asset.id, filePath, req.user!.sub, filenameUprn ?? assetRes.asset.uprn ?? null);
      res.status(200).json({
        committed: true,
        filePath,
        extracted: {},
        confidence: {},
        discrepancies: [],
        asset: { id: assetRes.asset.id, assetReference: assetRes.asset.assetReference, fullAddress: assetRes.asset.fullAddress },
        complianceType: null,
        documentId: stored.document.id,
        documentOnly: true,
      });
      return;
    }

    // ── AI extraction ─────────────────────────────────────────────────────────
    const { fields, confidence, error: extractError } = await extractCertificateFields(absPath, mimeType);

    if (extractError === "ai_unavailable") {
      res.status(503).json({
        error: "AI certificate extraction is not configured on this server. Please contact your administrator.",
        filePath,
      });
      return;
    }

    if (extractError === "scanned_pdf_unreadable") {
      res.status(422).json({
        error: "This PDF appears to be a scanned document that could not be rendered as an image. Please upload a JPG or PNG photo of the certificate instead.",
        filePath,
      });
      return;
    }

    if (!fields || Object.keys(fields).length === 0) {
      res.status(422).json({
        error: "Could not extract any information from this file. Please check it is a valid compliance certificate.",
        filePath,
      });
      return;
    }

    // ── Apply fixed-period expiry date rules (runs after AI, catches any miss) ─
    applyExpiryDateRules(fields);

    // ── Build discrepancy + flags lists ────────────────────────────────────────
    const discrepancies: any[] = []; // genuine blockers only
    const flags: any[] = [];         // non-blockers saved in parsedData, don't prevent commit

    // Low-confidence key fields → flag (not blocker)
    const LOW_CONF = 0.55;
    const KEY_FIELDS = ["inspectionDate", "outcome", "certificateRef"];
    for (const field of KEY_FIELDS) {
      const conf = confidence[field] ?? 1;
      if (conf < LOW_CONF && fields[field]) {
        flags.push({
          type: "low_confidence",
          field,
          value: fields[field],
          confidence: conf,
          message: `Low confidence reading "${field}" — value saved but should be verified`,
        });
      }
    }

    // ── Pre-filled path: caller already knows the compliance item ─────────────
    const prefilledItemId = (req.headers["x-compliance-item-id"] as string) || null;
    if (prefilledItemId) {
      const [preItem] = await db.select().from(assetComplianceItems)
        .where(and(eq(assetComplianceItems.id, prefilledItemId), eq(assetComplianceItems.tenantId, tenantId)));
      if (preItem) {
        const [preCt] = await db.select().from(complianceTypes).where(eq(complianceTypes.id, preItem.complianceTypeId));
        const [preAsset] = await db.select().from(assets).where(eq(assets.id, preItem.assetId));

        // type_mismatch: extracted cert type doesn't match the prefilled item → genuine blocker
        if (fields.certificateType && fields.certificateType !== "OTHER" && preCt) {
          const typeKey = (fields.certificateType as string).toUpperCase();
          const codeKey = ((fields.certificateTypeCode ?? "") as string).toUpperCase();
          const hints = CERT_CODE_HINTS[typeKey] ?? (codeKey ? [codeKey] : []);
          if (hints.length > 0) {
            const ctCode = (preCt.code ?? "").toUpperCase();
            const ctName = (preCt.name ?? "").toUpperCase();
            const matchesType = hints.some(h => ctCode.includes(h) || ctName.includes(h));
            if (!matchesType) {
              discrepancies.push({
                type: "type_mismatch",
                message: `Certificate appears to be a ${fields.certificateType}${fields.certificateTypeCode ? ` (${fields.certificateTypeCode})` : ""} but this compliance item is "${preCt.name}" — please confirm this is the correct item`,
                certType: fields.certificateType,
                certTypeCode: fields.certificateTypeCode ?? null,
                itemName: preCt.name,
                itemCode: preCt.code,
              });
            }
          }
        }

        // date_conflict → flag (not blocker)
        if (fields.expiryDate && preItem.expiryDate) {
          const extractedMs = new Date(fields.expiryDate).getTime();
          const existingMs = new Date(preItem.expiryDate as string).getTime();
          if (!isNaN(extractedMs) && !isNaN(existingMs) && Math.abs(extractedMs - existingMs) / 86400000 > 7) {
            flags.push({
              type: "date_conflict",
              field: "expiryDate",
              value: fields.expiryDate,
              existingValue: preItem.expiryDate,
              message: `Certificate expiry (${fields.expiryDate}) differs from recorded expiry (${preItem.expiryDate}) — saved as new expiry`,
            });
          }
        }

        // uprn_mismatch → flag (not blocker)
        if (fields.uprn && preAsset?.uprn && fields.uprn.replace(/\D/g, "") !== preAsset.uprn.replace(/\D/g, "")) {
          flags.push({
            type: "uprn_mismatch",
            field: "uprn",
            value: fields.uprn,
            existingValue: preAsset.uprn,
            message: `Certificate UPRN (${fields.uprn}) differs from asset UPRN (${preAsset.uprn}) — recorded as-is`,
          });
        }

        // Only block on genuine blockers
        if (discrepancies.length > 0) {
          res.status(200).json({
            committed: false, filePath, extracted: fields, confidence, discrepancies: [...discrepancies, ...flags],
            asset: preAsset ? { id: preAsset.id, assetReference: preAsset.assetReference, fullAddress: preAsset.fullAddress } : null,
            complianceType: preCt ? { id: preCt.id, name: preCt.name, code: preCt.code } : null,
            complianceItemId: preItem.id,
            assetId: preItem.assetId,
          });
          return;
        }

        // Auto-commit — flags are informational only
        const commit = await commitCertificate(
          tenantId, preItem.assetId, preItem.complianceTypeId, preItem.id,
          fields, filePath, req.user!.sub, req.user!.username, confidence, flags,
        );
        res.status(200).json({
          committed: true, filePath, extracted: fields, confidence, discrepancies: flags,
          asset: preAsset ? { id: preAsset.id, assetReference: preAsset.assetReference, fullAddress: preAsset.fullAddress } : null,
          complianceType: preCt ? { id: preCt.id, name: preCt.name, code: preCt.code } : null,
          serviceRecordId: commit.serviceRecord.id,
          complianceItemId: preItem.id,
          newStatus: commit.newStatus,
          nextDueDate: commit.nextDueDate,
        });
        return;
      }
    }

    // ── Normal path: resolve asset + compliance item ────────────────────────────
    // filenameUprn takes priority over AI-extracted uprn
    const assetRes = await resolveAsset(tenantId, filenameUprn, fields.uprn ?? null, fields.propertyAddress ?? null);
    let resolvedAsset = assetRes.asset;
    let resolvedComplianceItem: any = null;
    let resolvedCt: any = null;

    if (!resolvedAsset) {
      if (assetRes.matchType === "uprn_multiple" || assetRes.matchType === "address_multiple") {
        discrepancies.push({
          type: "asset_multiple",
          message: "Multiple assets match this certificate — please select the correct one",
          candidates: assetRes.candidates.map(a => ({
            id: a.id,
            assetReference: a.assetReference,
            fullAddress: a.fullAddress,
            uprn: a.uprn,
          })),
        });
      } else {
        const uprn = filenameUprn ?? fields.uprn ?? null;
        discrepancies.push({
          type: "asset_not_found",
          message: uprn
            ? `UPRN ${uprn} not found in this account — please select the asset manually`
            : "Property address not matched — please select the asset manually",
          extractedUprn: uprn,
          extractedAddress: fields.propertyAddress ?? null,
        });
      }
    } else {
      const itemRes = await resolveComplianceItem(
        tenantId, resolvedAsset.id,
        fields.certificateType ?? null, fields.certificateTypeCode ?? null,
      );
      resolvedComplianceItem = itemRes.item ?? null;
      resolvedCt = (itemRes as any).ct ?? null;

      if (!resolvedComplianceItem) {
        if (itemRes.matchType === "no_items") {
          discrepancies.push({
            type: "no_compliance_items",
            message: "This asset has no compliance items assigned — please assign a compliance type first",
          });
        } else if (itemRes.matchType === "no_matching_item") {
          // Items exist but none match this cert type — show picker
          discrepancies.push({
            type: "type_ambiguous",
            message: `No "${fields.certificateType ?? "matching"}" compliance item found on this asset — please select`,
            certType: fields.certificateType,
            certTypeCode: fields.certificateTypeCode,
            candidates: (itemRes.candidates as any[]).map((c: any) => ({
              complianceItemId: c.item.id,
              complianceTypeId: c.ct.id,
              name: c.ct.name,
              code: c.ct.code,
            })),
          });
        } else if (itemRes.matchType === "type_unknown") {
          // Genuinely undetermined cert type with one item — rule #5 requires user to confirm
          discrepancies.push({
            type: "type_ambiguous",
            message: "Could not determine certificate type — please confirm which compliance item this belongs to",
            certType: fields.certificateType,
            certTypeCode: fields.certificateTypeCode,
            candidates: (itemRes.candidates as any[]).map((c: any) => ({
              complianceItemId: c.item.id,
              complianceTypeId: c.ct.id,
              name: c.ct.name,
              code: c.ct.code,
            })),
          });
        } else {
          discrepancies.push({
            type: "type_ambiguous",
            message: "Could not determine which compliance item this certificate belongs to — please select",
            certType: fields.certificateType,
            certTypeCode: fields.certificateTypeCode,
            candidates: (itemRes.candidates as any[]).map((c: any) => ({
              complianceItemId: c.item.id,
              complianceTypeId: c.ct.id,
              name: c.ct.name,
              code: c.ct.code,
            })),
          });
        }
      } else {
        // type_mismatch: only_one item and cert type doesn't match → genuine blocker
        if (itemRes.matchType === "only_one" && fields.certificateType && fields.certificateType !== "OTHER" && resolvedCt) {
          const typeKey = (fields.certificateType as string).toUpperCase();
          const codeKey = ((fields.certificateTypeCode ?? "") as string).toUpperCase();
          const hints = CERT_CODE_HINTS[typeKey] ?? (codeKey ? [codeKey] : []);
          if (hints.length > 0) {
            const ctCode = (resolvedCt.code ?? "").toUpperCase();
            const ctName = (resolvedCt.name ?? "").toUpperCase();
            const matchesType = hints.some((h: string) => ctCode.includes(h) || ctName.includes(h));
            if (!matchesType) {
              discrepancies.push({
                type: "type_mismatch",
                message: `Certificate appears to be a ${fields.certificateType}${fields.certificateTypeCode ? ` (${fields.certificateTypeCode})` : ""} but the only compliance item on this asset is "${resolvedCt.name}" — please confirm`,
                certType: fields.certificateType,
                certTypeCode: fields.certificateTypeCode ?? null,
                itemName: resolvedCt.name,
                itemCode: resolvedCt.code,
              });
            }
          }
        }

        // date_conflict → flag (not blocker)
        if (fields.expiryDate && resolvedComplianceItem.expiryDate) {
          const extractedMs = new Date(fields.expiryDate).getTime();
          const existingMs = new Date(resolvedComplianceItem.expiryDate as string).getTime();
          if (!isNaN(extractedMs) && !isNaN(existingMs) && Math.abs(extractedMs - existingMs) / 86400000 > 7) {
            flags.push({
              type: "date_conflict",
              field: "expiryDate",
              value: fields.expiryDate,
              existingValue: resolvedComplianceItem.expiryDate,
              message: `Certificate expiry (${fields.expiryDate}) differs from recorded expiry (${resolvedComplianceItem.expiryDate}) — saved as new expiry`,
            });
          }
        }
      }

      // uprn_mismatch → flag (not blocker)
      if (fields.uprn && resolvedAsset.uprn &&
          fields.uprn.replace(/\D/g, "") !== resolvedAsset.uprn.replace(/\D/g, "")) {
        flags.push({
          type: "uprn_mismatch",
          field: "uprn",
          value: fields.uprn,
          existingValue: resolvedAsset.uprn,
          message: `Certificate UPRN (${fields.uprn}) differs from asset UPRN (${resolvedAsset.uprn}) — recorded as-is`,
        });
      }
    }

    // ── Auto-commit when no genuine blockers ───────────────────────────────────
    if (discrepancies.length === 0 && resolvedAsset && resolvedComplianceItem) {
      const commit = await commitCertificate(
        tenantId, resolvedAsset.id, resolvedComplianceItem.complianceTypeId,
        resolvedComplianceItem.id, fields, filePath, req.user!.sub, req.user!.username, confidence, flags,
      );
      res.status(200).json({
        committed: true, filePath, extracted: fields, confidence, discrepancies: flags,
        asset: { id: resolvedAsset.id, assetReference: resolvedAsset.assetReference, fullAddress: resolvedAsset.fullAddress },
        complianceType: resolvedCt ? { id: resolvedCt.id, name: resolvedCt.name, code: resolvedCt.code } : null,
        serviceRecordId: commit.serviceRecord.id,
        complianceItemId: resolvedComplianceItem.id,
        newStatus: commit.newStatus,
        nextDueDate: commit.nextDueDate,
      });
      return;
    }

    // ── Return with blockers for user review ───────────────────────────────────
    res.status(200).json({
      committed: false, filePath, extracted: fields, confidence,
      discrepancies: [...discrepancies, ...flags],
      asset: resolvedAsset ? { id: resolvedAsset.id, assetReference: resolvedAsset.assetReference, fullAddress: resolvedAsset.fullAddress } : null,
      complianceType: resolvedCt ? { id: resolvedCt.id, name: resolvedCt.name, code: resolvedCt.code } : null,
      assetId: resolvedAsset?.id ?? null,
      complianceItemId: resolvedComplianceItem?.id ?? null,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error during certificate extraction" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/certificate-extract/commit
// Commit after blockers have been resolved on the frontend
// ═══════════════════════════════════════════════════════════════════════════════
router.post("/certificate-extract/commit", async (req: any, res) => {
  const tenantId = tid(req);
  const { filePath, extracted, assetId, complianceItemId, confidence: bodyConfidence } = req.body;

  if (!filePath || !extracted || !assetId) {
    res.status(400).json({ error: "filePath, extracted and assetId are required" });
    return;
  }

  // Tenant-scoped file path validation
  const expectedPrefix = `${tenantId}/`;
  if (!filePath.startsWith(expectedPrefix)) {
    res.status(403).json({ error: "File path does not belong to this tenant" });
    return;
  }

  try {
    const [asset] = await db.select().from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.tenantId, tenantId), isNull(assets.deletedAt)));
    if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

    // ── Non-AI file (no extracted fields): just store as a document, no compliance commit ──
    const isNonAI = Object.keys(extracted).length === 0;
    if (isNonAI || !complianceItemId) {
      const stored = await storeDocumentOnly(tenantId, assetId, filePath, req.user!.sub, asset.uprn ?? null);
      res.status(200).json({
        committed: true,
        documentId: stored.document.id,
        asset: { id: asset.id, assetReference: asset.assetReference, fullAddress: asset.fullAddress },
      });
      return;
    }

    const [item] = await db.select().from(assetComplianceItems)
      .where(and(eq(assetComplianceItems.id, complianceItemId), eq(assetComplianceItems.tenantId, tenantId)));
    if (!item) { res.status(404).json({ error: "Compliance item not found" }); return; }

    if (item.assetId !== assetId) {
      res.status(409).json({ error: "Compliance item does not belong to the specified asset" });
      return;
    }

    const [ct] = await db.select().from(complianceTypes).where(eq(complianceTypes.id, item.complianceTypeId));

    // Apply expiry date rules in case extracted data is missing expiryDate
    applyExpiryDateRules(extracted);

    const commit = await commitCertificate(
      tenantId,
      assetId,
      item.complianceTypeId,
      complianceItemId,
      extracted,
      filePath,
      req.user!.sub,
      req.user!.username,
      bodyConfidence ?? undefined,
    );

    // If certificate carried a different UPRN, update asset (user confirmed)
    if (extracted.uprn && asset.uprn &&
        extracted.uprn.replace(/\D/g, "") !== asset.uprn.replace(/\D/g, "")) {
      await db.update(assets).set({ uprn: String(extracted.uprn), updatedAt: new Date() })
        .where(eq(assets.id, assetId));
    }

    res.status(200).json({
      committed: true,
      serviceRecordId: commit.serviceRecord.id,
      complianceItemId,
      newStatus: commit.newStatus,
      nextDueDate: commit.nextDueDate,
      asset: { id: asset.id, assetReference: asset.assetReference, fullAddress: asset.fullAddress },
      complianceType: ct ? { id: ct.id, name: ct.name, code: ct.code } : null,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
