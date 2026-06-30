import { Router } from "express";
import { db } from "@workspace/db";
import { assets, assetComplianceItems, complianceTypes, complianceRecords } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { writeAuditLog } from "../lib/audit";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const router = Router();
router.use(requireAuth);
function tid(req: any): string { return req.user.tenantId as string; }

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Convert Excel serial number OR UK/ISO date string to YYYY-MM-DD, or null */
function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.toString().trim();
  if (!t || t.toUpperCase() === "N/A" || t === "0") return null;

  // Excel serial (e.g. 45944)
  if (/^\d{4,6}(\.\d+)?$/.test(t)) {
    const n = parseFloat(t);
    if (n < 1) return null;
    const d = new Date((n - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  // UK DD/MM/YYYY or DD-MM-YYYY
  const uk = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (uk) {
    const [, d, m, y] = uk;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

/** Map STATUS column text → our enum values */
function mapStatus(raw: string | undefined): typeof assetComplianceItems.$inferSelect["status"] | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase().replace(/[\s_\-]+/g, "");
  if (v === "compliant")                                          return "compliant";
  if (v === "duesoon" || v === "duesioon")                        return "due_soon";
  if (v === "overdue")                                            return "overdue";
  if (v.includes("await"))                                        return "awaiting_evidence";
  if (v.includes("followon") || v.includes("follow"))            return "follow_on_required";
  if (v === "failed" || v.includes("unsat") || v === "noncompliant" || v === "non-compliant") return "failed";
  if (v === "n/a" || v === "na" || v === "nocert" || v === "notapplicable") return "not_applicable";
  return null;
}

/** Normalise a column header for loose matching */
function nh(h: string): string {
  return h.toLowerCase().replace(/[\s\r\n_\-\/\.\(\):]+/g, "");
}

/** Convert a user-supplied label into a stable field key (e.g. "Fire Alarm Category" → "fire_alarm_category") */
function slugifyFieldKey(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * All normalised header keys that mapComplianceRow already handles.
 * Any column header whose nh() form is NOT in this set is an "extra" column
 * and will be surfaced to the user for optional mapping.
 */
const KNOWN_NH_HEADERS = new Set([
  // identity / address
  "uprn", "uprndonotdelete", "assetreference", "assetref",
  "fulladdress", "addressline1", "addressline2", "area", "postcode",
  // last inspection
  "lastelectricaltestdate", "lastinspectiondate", "lasttestdate",
  "inspectiondate", "testdate", "lastgassafetydate", "lastfiredate",
  // next due
  "dateofnexttest5yearstolasttestdatecoln", "dateofnexttest",
  "nexttestdate", "nextduedate", "nextinspectiondate",
  // cert
  "certificatetype", "certtype", "certificateref", "certificatenumber",
  "certificatetyperef", "certificatetypref",
  // condition
  "conditioneicironly", "conditioneicrony", "conditioneiconly", "condition",
  // contractor
  "contractorcompletedlasteicreic", "contractorcompletedlast", "contractor", "installedby",
  // follow-on
  "eicrfollowonworkscompleted", "followonworkscompleted",
  "followon", "followonrequired", "followonrequiredyesno", "followonrequiredyesnno",
  // status
  "status", "ab",
  // known ancillary notes fields
  "remedialworkcompletiondate", "remedialworkcompletiontype",
  "firealarmssystemcategory", "firealarmssystemlasttestdate",
  "programmedtotakeplace", "transforminghomesprogramme",
  "electricalcertificationlocation", "mearslastvoiddtestcert",
  "c3observations", "comments",
]);

/**
 * Pick the sheet index most likely to contain per-asset compliance data.
 * Uses a two-pass strategy:
 *   1. Heuristic name match (faster).
 *   2. Header scan for a UPRN-like column (fallback).
 * Returns the sheet index (0-based) to load.
 */
function pickDataSheetIndex(XLSX: any, sheetNames: string[], buf: Buffer): number {
  // 1. Heuristic name match
  const GOOD_NAMES = [
    /master.*individual/i, /individual.*dwelling/i,
    /dwelling/i, /assets?/i, /properties/i, /compliance.*data/i,
  ];
  for (let i = 0; i < sheetNames.length; i++) {
    if (GOOD_NAMES.some(rx => rx.test(sheetNames[i]))) return i;
  }

  // 2. Scan first row of each sheet for a UPRN column — parse one sheet at a time
  const uprnKeys = new Set(["uprn", "uprndonotdelete", "assetreference", "assetref"]);
  for (let i = 0; i < sheetNames.length; i++) {
    const wb2 = XLSX.read(buf, { type: "buffer", raw: true, cellDates: false, sheets: i });
    const ws = wb2.Sheets[sheetNames[i]];
    if (!ws) continue;
    const [row] = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: true, range: 0 });
    if (!row) continue;
    if (Object.keys(row).some(k => uprnKeys.has(nh(k)))) return i;
  }
  return 0;
}

/** Extract compliance fields from a raw row using flexible header matching */
function mapComplianceRow(raw: Record<string, string>) {
  const n: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) n[nh(k)] = v;

  const uprn =
    n["uprn"] ?? n["uprndonotdelete"] ?? n["assetreference"] ?? n["assetref"] ?? null;

  const inspRaw =
    n["lastelectricaltestdate"] ?? n["lastinspectiondate"] ?? n["lasttestdate"] ??
    n["inspectiondate"] ?? n["testdate"] ?? n["lastgassafetydate"] ?? n["lastfiredate"] ?? "";

  const nextRaw =
    n["dateofnexttest5yearstolasttestdatecoln"] ?? n["dateofnexttest"] ??
    n["nexttestdate"] ?? n["nextduedate"] ?? n["nextinspectiondate"] ?? "";

  const certRef =
    n["certificatetype"] ?? n["certtype"] ?? n["certificateref"] ?? n["certificatenumber"] ?? null;

  const condition =
    n["conditioneicironly"] ?? n["conditioneicrony"] ?? n["conditioneiconly"] ??
    n["condition"] ?? null;

  const contractor =
    n["contractorcompletedlasteicreic"] ?? n["contractorcompletedlast"] ??
    n["contractor"] ?? n["installedby"] ?? null;

  // "EICR follow on works completed (YES/NO)" — NO means still outstanding → required
  const foRaw =
    n["eicrfollowonworkscompleted"] ?? n["followonworkscompleted"] ??
    n["followon"] ?? n["followonrequired"] ?? "";
  const followOnRequired =
    foRaw.trim().toUpperCase() === "NO"     ? true :
    foRaw.trim().toUpperCase() === "YES"    ? false :
    foRaw.trim().toUpperCase() === "TRUE"   ? true : false;

  const statusRaw = n["status"] ?? n["ab"] ?? "";

  // Collect ancillary fields into notes
  const noteChunks: string[] = [];
  const add = (label: string, key: string) => {
    const v = n[key];
    if (v && v.trim() && v.trim().toUpperCase() !== "N/A") noteChunks.push(`${label}: ${v.trim()}`);
  };
  add("Remedial completion date", "remedialworkcompletiondate");
  add("Remedial type", "remedialworkcompletiontype");
  add("Fire alarm category", "firealarmssystemcategory");
  add("Fire alarm last test", "firealarmssystemlasttestdate");
  add("Programmed", "programmedtotakeplace");
  add("Transforming Homes", "transforminghomesprogramme");
  add("Cert location", "electricalcertificationlocation");
  add("Mears void cert", "mearslastvoiddtestcert");
  const c3 = n["c3observations"];
  if (c3 && c3.trim()) noteChunks.push(`C3 observations: ${c3.trim()}`);
  const comments = n["comments"];
  if (comments && comments.trim()) noteChunks.push(comments.trim());

  return {
    uprn: uprn?.toString().trim() || null,
    lastInspectionDate: parseDate(inspRaw),
    nextDueDate: parseDate(nextRaw),
    certificateRef: certRef?.trim() || null,
    condition: condition?.trim() || null,
    contractor: contractor?.trim() || null,
    followOnRequired,
    status: mapStatus(statusRaw),
    notes: noteChunks.join(" | ") || null,
  };
}

type MappedRow = ReturnType<typeof mapComplianceRow>;

/**
 * Apply user-chosen extra column mappings on top of an already-parsed row.
 * extraMappings: { [nhHeader]: "skip" | "notes" | fieldName | "custom_field:<label>" }
 * custom_field: actions are handled separately in the execute handler; skip them here.
 */
function applyExtraMappings(
  mapped: MappedRow,
  raw: Record<string, string>,
  extraMappings: Record<string, string>,
): MappedRow {
  const n: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) n[nh(k)] = v;

  const noteAdditions: string[] = [];
  const overrides: Partial<MappedRow> = {};

  for (const [nhKey, action] of Object.entries(extraMappings)) {
    if (action === "skip") continue;
    if (action.startsWith("custom_field:")) continue; // handled in execute
    const val = (n[nhKey] ?? "").trim();
    if (!val || val.toUpperCase() === "N/A") continue;

    // Original column heading for notes label
    const origHeader = Object.keys(raw).find(k => nh(k) === nhKey) ?? nhKey;

    switch (action) {
      case "notes":
        noteAdditions.push(`${origHeader}: ${val}`);
        break;
      case "lastInspectionDate":
        overrides.lastInspectionDate = parseDate(val) ?? mapped.lastInspectionDate;
        break;
      case "nextDueDate":
        overrides.nextDueDate = parseDate(val) ?? mapped.nextDueDate;
        break;
      case "certificateRef":
        overrides.certificateRef = val || mapped.certificateRef;
        break;
      case "condition":
        overrides.condition = val || mapped.condition;
        break;
      case "contractor":
        overrides.contractor = val || mapped.contractor;
        break;
      case "followOnRequired": {
        const u = val.toUpperCase();
        overrides.followOnRequired =
          u === "YES" || u === "TRUE"  ? true :
          u === "NO"  || u === "FALSE" ? false :
          mapped.followOnRequired;
        break;
      }
      case "status":
        overrides.status = mapStatus(val) ?? mapped.status;
        break;
    }
  }

  const allNotes = [mapped.notes, ...noteAdditions].filter(Boolean).join(" | ") || null;
  return { ...mapped, ...overrides, notes: allNotes };
}

// ── Status auto-calculation ───────────────────────────────────────────────────

function calcStatus(
  nextDue: string | null, dueSoonDays: number, followOn: boolean,
): typeof assetComplianceItems.$inferSelect["status"] {
  if (followOn) return "follow_on_required";
  if (!nextDue) return "compliant";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(nextDue);
  const diff = Math.floor((due.getTime() - today.getTime()) / 86_400_000);
  if (diff < 0) return "overdue";
  if (diff <= dueSoonDays) return "due_soon";
  return "compliant";
}

// ── Template download ─────────────────────────────────────────────────────────

router.get(
  "/compliance-imports/template/:typeId",
  requireRole("tenant_admin", "compliance_manager"),
  async (req: any, res) => {
    const tenantId = tid(req);
    const { typeId } = req.params;
    try {
      const [ct] = await db.select().from(complianceTypes).where(eq(complianceTypes.id, String(typeId)));
      if (!ct) { res.status(404).json({ error: "Compliance type not found" }); return; }

      const customDefs: Array<{ key: string; label: string }> = (ct.customFieldDefinitions as any) ?? [];

      // All assets assigned to this compliance type
      const rows = await db
        .select({
          uprn: assets.uprn,
          assetReference: assets.assetReference,
          fullAddress: assets.fullAddress,
          addressLine1: assets.addressLine1,
          addressLine2: assets.addressLine2,
          area: assets.area,
          postCode: assets.postCode,
          lastInspectionDate: assetComplianceItems.lastInspectionDate,
          nextDueDate: assetComplianceItems.nextDueDate,
          certificateRef: assetComplianceItems.certificateRef,
          condition: assetComplianceItems.condition,
          contractor: assetComplianceItems.contractor,
          followOnRequired: assetComplianceItems.followOnRequired,
          status: assetComplianceItems.status,
          notes: assetComplianceItems.notes,
          customFields: assetComplianceItems.customFields,
        })
        .from(assetComplianceItems)
        .innerJoin(assets, eq(assetComplianceItems.assetId, assets.id))
        .where(and(
          eq(assetComplianceItems.tenantId, tenantId),
          eq(assetComplianceItems.complianceTypeId, String(typeId)),
          eq(assetComplianceItems.isEnabled, true),
        ))
        .orderBy(assets.fullAddress);

      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      const standardHeaders = [
        "UPRN (DO NOT DELETE)",
        "Asset Reference",
        "Full Address",
        "Address Line 1",
        "Address Line 2",
        "Area",
        "Post Code",
        "Last Inspection Date",
        "Certificate Type / Ref",
        "Condition",
        "Contractor",
        "Follow-on Required (YES/NO)",
        "Date of Next Test",
        "STATUS",
        "C3 / Observations",
        "Comments",
      ];

      // Append custom field columns after standard ones
      const customHeaders = customDefs.map(d => d.label);
      const headers = [...standardHeaders, ...customHeaders];

      const dataRows = rows.map(r => {
        const cf = (r.customFields as Record<string, string> | null) ?? {};
        const standardCols = [
          r.uprn ?? r.assetReference ?? "",
          r.assetReference ?? "",
          r.fullAddress ?? "",
          r.addressLine1 ?? "",
          r.addressLine2 ?? "",
          r.area ?? "",
          r.postCode ?? "",
          r.lastInspectionDate ?? "",
          r.certificateRef ?? "",
          r.condition ?? "",
          r.contractor ?? "",
          r.followOnRequired ? "YES" : "",
          r.nextDueDate ?? "",
          r.status ?? "",
          "",   // C3 / Observations — blank for user to fill
          r.notes ?? "",
        ];
        const customCols = customDefs.map(d => cf[d.key] ?? "");
        return [...standardCols, ...customCols];
      });

      const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
      ws["!cols"] = headers.map(h => ({ wch: Math.max(h.length + 2, 18) }));

      // Freeze header row
      ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" };

      XLSX.utils.book_append_sheet(wb, ws, ct.name.slice(0, 30));

      // Reference sheet
      const refRows: string[][] = [
        ["Column", "Notes"],
        ["UPRN (DO NOT DELETE)", "Do not change — used to match back to the asset"],
        ["Last Inspection Date", "DD/MM/YYYY or YYYY-MM-DD"],
        ["Certificate Type / Ref", "e.g. EICR, EIC, GAS_CP12, certificate number"],
        ["Condition", "e.g. Satisfactory, Unsatisfactory, C1, C2"],
        ["Contractor", "Company or person who carried out the inspection"],
        ["Follow-on Required (YES/NO)", "YES = follow-on works still needed, NO = completed or N/A"],
        ["Date of Next Test", "DD/MM/YYYY or YYYY-MM-DD — leave blank to auto-calculate from frequency"],
        ["STATUS", "COMPLIANT | OVERDUE | DUE SOON | AWAITING | FAILED | N/A"],
        ["C3 / Observations", "Any C3 observations or additional notes"],
        ["Comments", "General comments"],
      ];
      for (const d of customDefs) {
        refRows.push([d.label, `Custom field — text value`]);
      }
      const refWs = XLSX.utils.aoa_to_sheet(refRows);
      refWs["!cols"] = [{ wch: 30 }, { wch: 70 }];
      XLSX.utils.book_append_sheet(wb, refWs, "Instructions");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const safeName = ct.name.replace(/[^a-z0-9]/gi, "_");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="compliance-template-${safeName}.xlsx"`);
      res.send(buf);
    } catch (err) {
      (res as any).log?.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ── Upload + preview ──────────────────────────────────────────────────────────

router.post(
  "/compliance-imports/preview/:typeId",
  requireRole("tenant_admin", "compliance_manager"),
  async (req: any, res) => {
    const tenantId = tid(req);
    const typeId = String(req.params.typeId);
    if (!tenantId) { res.status(400).json({ error: "No tenant context" }); return; }

    try {
      const [ct] = await db.select().from(complianceTypes).where(eq(complianceTypes.id, typeId));
      if (!ct) { res.status(404).json({ error: "Compliance type not found" }); return; }

      // Build a per-request known-headers set that includes saved custom field keys
      const customDefs: Array<{ key: string; label: string }> = (ct.customFieldDefinitions as any) ?? [];
      const knownForThisType = new Set(KNOWN_NH_HEADERS);
      for (const def of customDefs) {
        // The label normalised is what the template column header will normalise to
        knownForThisType.add(nh(def.label));
        knownForThisType.add(def.key);
      }

      // Save uploaded file
      const rawFilename = (req.headers["x-filename"] as string) || "upload.xlsx";
      const filename = path.basename(rawFilename).replace(/[/\\<>:"|?*\x00-\x1f]/g, "_");
      const uploadDir = path.join(os.tmpdir(), "compliance-imports", tenantId);
      await fs.mkdir(uploadDir, { recursive: true });
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const filePath = path.join(uploadDir, `${sessionId}.xlsx`);

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) { res.status(400).json({ error: "Empty file" }); return; }
      await fs.writeFile(filePath, buf);

      // Parse — find the right sheet without loading the whole workbook at once
      const XLSX = await import("xlsx");
      const wbNames = XLSX.read(buf, { type: "buffer", bookSheets: true });
      const sheetIdx = pickDataSheetIndex(XLSX, wbNames.SheetNames as string[], buf);
      const wb = XLSX.read(buf, { type: "buffer", raw: false, cellDates: false, sheets: sheetIdx });
      const ws = wb.Sheets[wb.SheetNames[sheetIdx] ?? wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: false });

      if (rawRows.length === 0) { res.status(422).json({ error: "File appears to be empty or has no UPRN column" }); return; }

      // ── Detect extra (unmapped) columns ──────────────────────────────────────
      const allHeadersSet = new Set<string>();
      for (const row of rawRows.slice(0, 10)) {
        for (const k of Object.keys(row)) allHeadersSet.add(k);
      }
      const sampleRows = rawRows.slice(0, 5);
      const unmappedColumns: Array<{ header: string; nhHeader: string; samples: string[] }> = [];
      for (const h of allHeadersSet) {
        const nhh = nh(h);
        if (knownForThisType.has(nhh)) continue;
        const samples = sampleRows
          .map(r => (r[h] ?? "").trim())
          .filter(s => s && s.toUpperCase() !== "N/A");
        unmappedColumns.push({ header: h, nhHeader: nhh, samples: samples.slice(0, 3) });
      }

      // Load all compliance items for this type so we can match
      const allItems = await db
        .select({
          id: assetComplianceItems.id,
          uprn: assets.uprn,
          assetReference: assets.assetReference,
          fullAddress: assets.fullAddress,
          status: assetComplianceItems.status,
          complianceTypeId: assetComplianceItems.complianceTypeId,
        })
        .from(assetComplianceItems)
        .innerJoin(assets, eq(assetComplianceItems.assetId, assets.id))
        .where(and(
          eq(assetComplianceItems.tenantId, tenantId),
          eq(assetComplianceItems.complianceTypeId, typeId),
        ));

      // Build UPRN lookup with both raw and leading-zero-stripped forms
      const byUprn = new Map<string, typeof allItems[0]>();
      for (const item of allItems) {
        if (!item.uprn) continue;
        const raw = item.uprn.trim();
        byUprn.set(raw, item);
        const stripped = /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : null;
        if (stripped && stripped !== raw) byUprn.set(stripped, item);
      }
      const byAssetRef = new Map(allItems.filter(i => i.assetReference).map(i => [i.assetReference!.trim().toUpperCase(), i]));

      const preview: Array<{
        row: number; uprn: string | null; address: string | null;
        matched: boolean; itemId: string | null;
        lastInspectionDate: string | null; nextDueDate: string | null;
        certificateRef: string | null; condition: string | null;
        contractor: string | null; followOnRequired: boolean;
        status: string | null; notes: string | null;
        errors: string[];
      }> = [];

      for (let i = 0; i < rawRows.length; i++) {
        const raw = rawRows[i];
        const mapped = mapComplianceRow(raw);
        const errors: string[] = [];

        // Match asset
        let matchedItem = mapped.uprn ? byUprn.get(mapped.uprn) : undefined;
        if (!matchedItem && mapped.uprn) {
          matchedItem = byAssetRef.get(mapped.uprn.toUpperCase());
        }
        if (!matchedItem && !mapped.uprn) errors.push("No UPRN or Asset Reference in this row");
        if (!matchedItem && mapped.uprn) errors.push(`UPRN "${mapped.uprn}" not found in assets with ${ct.name} assigned`);

        preview.push({
          row: i + 1,
          uprn: mapped.uprn,
          address: matchedItem?.fullAddress ?? null,
          matched: !!matchedItem,
          itemId: matchedItem?.id ?? null,
          lastInspectionDate: mapped.lastInspectionDate,
          nextDueDate: mapped.nextDueDate,
          certificateRef: mapped.certificateRef,
          condition: mapped.condition,
          contractor: mapped.contractor,
          followOnRequired: mapped.followOnRequired,
          status: mapped.status,
          notes: mapped.notes,
          errors,
        });
      }

      const matched = preview.filter(p => p.matched).length;
      const errored = preview.filter(p => p.errors.length > 0).length;

      res.json({
        sessionId,
        totalRows: rawRows.length,
        matched,
        errored,
        preview: preview.slice(0, 200),
        unmappedColumns,
        existingCustomFields: customDefs,
      });
    } catch (err) {
      (res as any).log?.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ── Execute ───────────────────────────────────────────────────────────────────

// Normalised (no underscores) forms of standard field names — used to prevent
// a custom field shadowing a built-in field regardless of how it was slugified.
const RESERVED_FIELD_KEYS_NH = new Set([
  "status", "lastinspectiondate", "nextduedate", "certificateref",
  "condition", "contractor", "followonrequired", "notes",
]);

router.post(
  "/compliance-imports/execute/:typeId",
  requireRole("tenant_admin", "compliance_manager"),
  async (req: any, res) => {
    const tenantId = tid(req);
    const typeId = String(req.params.typeId);
    const { sessionId, columnMappings } = req.body as {
      sessionId: string;
      columnMappings?: Record<string, string>; // nhHeader → action
    };
    if (!sessionId) { res.status(400).json({ error: "sessionId required" }); return; }

    try {
      const [ct] = await db.select().from(complianceTypes).where(eq(complianceTypes.id, typeId));
      if (!ct) { res.status(404).json({ error: "Compliance type not found" }); return; }

      // ── Parse NEW custom field mappings from UI selections ───────────────
      // custom_field:<label> → { key, label }
      // Returns 400 if any custom_field: action carries an invalid label.
      const customFieldMappings: Record<string, { key: string; label: string }> = {};
      const seenKeysThisImport = new Set<string>();
      for (const [nhKey, action] of Object.entries(columnMappings ?? {})) {
        if (!action.startsWith("custom_field:")) continue;
        const label = action.slice("custom_field:".length).trim();
        if (!label) {
          res.status(400).json({ error: `Custom field name cannot be empty (column mapping key: ${nhKey})` }); return;
        }
        if (label.length > 80) {
          res.status(400).json({ error: `Custom field name too long (max 80 chars): "${label}"` }); return;
        }
        const key = slugifyFieldKey(label);
        if (!key) {
          res.status(400).json({ error: `Custom field name "${label}" produces an invalid key` }); return;
        }
        if (RESERVED_FIELD_KEYS_NH.has(key.replace(/_/g, ""))) {
          res.status(400).json({ error: `"${label}" conflicts with a built-in field name` }); return;
        }
        if (seenKeysThisImport.has(key)) {
          res.status(400).json({ error: `Two custom fields produce the same key "${key}" — use distinct names` }); return;
        }
        seenKeysThisImport.add(key);
        customFieldMappings[nhKey] = { key, label };
      }

      // ── Upsert new custom field definitions ───────────────────────────────
      const existingDefs: Array<{ key: string; label: string }> = (ct.customFieldDefinitions as any) ?? [];
      const existingKeys = new Set(existingDefs.map(d => d.key));
      // Skip any key that already exists (idempotent — no collision possible)
      const newDefs = Object.values(customFieldMappings).filter(d => !existingKeys.has(d.key));
      if (newDefs.length > 0) {
        const merged = [...existingDefs, ...newDefs];
        await db.update(complianceTypes)
          .set({ customFieldDefinitions: merged, updatedAt: new Date() })
          .where(eq(complianceTypes.id, typeId));
      }

      // ── Build auto-mapping for already-saved definitions (re-import case) ─
      // These columns appear in the file (because the template includes them)
      // but don't appear in columnMappings — the user never saw them as "unknown".
      // Map normalised label → def so they're automatically written on every import.
      const autoDefMappings: Record<string, { key: string; label: string }> = {};
      for (const def of existingDefs) {
        autoDefMappings[nh(def.label)] = def;
      }

      // Merged set: saved defs (auto) + newly created defs from this import
      const allCustomDefMappings: Record<string, { key: string; label: string }> = {
        ...autoDefMappings,
        ...customFieldMappings, // newly created ones override by nhHeader if there's a clash
      };

      const uploadDir = path.join(os.tmpdir(), "compliance-imports", tenantId);
      const filePath = path.join(uploadDir, `${sessionId}.xlsx`);

      let buf: Buffer;
      try {
        buf = await fs.readFile(filePath);
      } catch {
        res.status(404).json({ error: "Session expired — please re-upload the file" }); return;
      }

      const XLSX = await import("xlsx");
      const wbNames2 = XLSX.read(buf, { type: "buffer", bookSheets: true });
      const sheetIdx2 = pickDataSheetIndex(XLSX, wbNames2.SheetNames as string[], buf);
      const wb = XLSX.read(buf, { type: "buffer", raw: false, cellDates: false, sheets: sheetIdx2 });
      const ws = wb.Sheets[wb.SheetNames[sheetIdx2] ?? wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: false });

      // Load all compliance items for matching (include existing customFields for merging)
      const allItems = await db
        .select({
          id: assetComplianceItems.id,
          assetId: assetComplianceItems.assetId,
          uprn: assets.uprn,
          assetReference: assets.assetReference,
          nextDueDate: assetComplianceItems.nextDueDate,
          status: assetComplianceItems.status,
          customFields: assetComplianceItems.customFields,
        })
        .from(assetComplianceItems)
        .innerJoin(assets, eq(assetComplianceItems.assetId, assets.id))
        .where(and(
          eq(assetComplianceItems.tenantId, tenantId),
          eq(assetComplianceItems.complianceTypeId, typeId),
        ));

      const byUprn = new Map<string, typeof allItems[0]>();
      for (const item of allItems) {
        if (!item.uprn) continue;
        const raw = item.uprn.trim();
        byUprn.set(raw, item);
        const stripped = /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : null;
        if (stripped && stripped !== raw) byUprn.set(stripped, item);
      }
      const byAssetRef = new Map(allItems.filter(i => i.assetReference).map(i => [i.assetReference!.trim().toUpperCase(), i]));

      // Filter extra mappings to only non-skip, non-custom_field actions
      const activeExtraMappings = columnMappings
        ? Object.fromEntries(Object.entries(columnMappings).filter(([, v]) => v !== "skip" && !v.startsWith("custom_field:")))
        : {};
      const hasExtraMappings = Object.keys(activeExtraMappings).length > 0;
      const hasAnyCustomDefMappings = Object.keys(allCustomDefMappings).length > 0;

      let updated = 0, skipped = 0, errors = 0;
      const dueSoonDays = ct.dueSoonDays ?? 30;

      for (const raw of rawRows) {
        let mapped = mapComplianceRow(raw);
        if (hasExtraMappings) {
          mapped = applyExtraMappings(mapped, raw, activeExtraMappings);
        }

        if (!mapped.uprn) { skipped++; continue; }

        let item = byUprn.get(mapped.uprn) ?? byAssetRef.get(mapped.uprn.toUpperCase());
        if (!item) { errors++; continue; }

        try {
          // Determine final status: prefer explicit STATUS from file, else auto-calculate
          let resolvedStatus: typeof assetComplianceItems.$inferSelect["status"] =
            (mapped.status as any) ?? calcStatus(mapped.nextDueDate, dueSoonDays, mapped.followOnRequired);

          // Auto-calculate nextDueDate from inspection date + frequency if missing
          let resolvedNextDue = mapped.nextDueDate;
          if (!resolvedNextDue && mapped.lastInspectionDate && ct.frequencyMonths) {
            const d = new Date(mapped.lastInspectionDate);
            d.setMonth(d.getMonth() + ct.frequencyMonths);
            resolvedNextDue = d.toISOString().slice(0, 10);
          }
          // Re-calculate status if next due was just derived
          if (!mapped.status && resolvedNextDue) {
            resolvedStatus = calcStatus(resolvedNextDue, dueSoonDays, mapped.followOnRequired);
          }

          // ── Collect custom field values for this row ─────────────────────
          // Handles both: re-import of already-saved fields (autoDefMappings)
          // and newly-created fields chosen in the UI (customFieldMappings).
          let mergedCustomFields: Record<string, string> | null = null;
          if (hasAnyCustomDefMappings) {
            const rawNorm: Record<string, string> = {};
            for (const [k, v] of Object.entries(raw)) rawNorm[nh(k)] = v;

            const newCustomFields: Record<string, string> = {};
            for (const [nhKey, def] of Object.entries(allCustomDefMappings)) {
              const val = (rawNorm[nhKey] ?? "").trim();
              if (val && val.toUpperCase() !== "N/A") {
                newCustomFields[def.key] = val;
              }
            }

            if (Object.keys(newCustomFields).length > 0) {
              // Merge new values on top of whatever was already stored on this item
              const existing = (item.customFields as Record<string, string> | null) ?? {};
              mergedCustomFields = { ...existing, ...newCustomFields };
            }
          }

          // Insert compliance record (history entry)
          await db.insert(complianceRecords).values({
            tenantId,
            complianceItemId: item.id,
            status: resolvedStatus,
            inspectionDate: mapped.lastInspectionDate,
            nextDueDate: resolvedNextDue,
            certificateRef: mapped.certificateRef,
            contractor: mapped.contractor,
            condition: mapped.condition,
            followOnRequired: mapped.followOnRequired,
            notes: mapped.notes,
            customFields: mergedCustomFields ?? undefined,
            source: "excel_import",
            createdBy: req.user!.sub,
          });

          // Update the compliance item current state
          await db.update(assetComplianceItems)
            .set({
              status: resolvedStatus,
              lastInspectionDate: mapped.lastInspectionDate ?? undefined,
              nextDueDate: resolvedNextDue ?? undefined,
              certificateRef: mapped.certificateRef ?? undefined,
              contractor: mapped.contractor ?? undefined,
              condition: mapped.condition ?? undefined,
              followOnRequired: mapped.followOnRequired,
              notes: mapped.notes ?? undefined,
              ...(mergedCustomFields !== null ? { customFields: mergedCustomFields } : {}),
              updatedAt: new Date(),
            })
            .where(eq(assetComplianceItems.id, item.id));

          updated++;
        } catch (rowErr) {
          errors++;
        }
      }

      // Clean up temp file
      fs.unlink(filePath).catch(() => {});

      await writeAuditLog({
        tenantId, userId: req.user!.sub, actorName: req.user!.username,
        action: "compliance_import", entityType: "compliance_type", entityId: typeId,
        details: {
          complianceTypeName: ct.name, updated, skipped, errors, sessionId,
          extraColumnsMapped: hasExtraMappings ? Object.keys(activeExtraMappings) : [],
          customFieldsCreated: newDefs.map(d => d.label),
        },
      });

      res.json({ updated, skipped, errors });
    } catch (err) {
      (res as any).log?.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
