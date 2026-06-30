import { Router } from "express";
import { db } from "@workspace/db";
import { imports, importRows, mappingTemplates, assets, complianceTypes, assetComplianceItems, PROPERTY_SUBTYPES } from "@workspace/db/schema";
import { eq, and, desc, count, sql, isNull, or } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { writeAuditLog } from "../lib/audit";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const router = Router();
router.use(requireAuth);

function tid(req: any): string { return req.user.tenantId as string; }

// ── File parsing ─────────────────────────────────────────────────────────────

async function parseFile(filePath: string): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const XLSX = await import("xlsx");
  // xlsx handles both .xlsx and .csv (including quoted commas)
  const wb = XLSX.readFile(filePath, { raw: false, cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: "", raw: false });
  const headers = data.length > 0 ? Object.keys(data[0]) : [];
  return { headers, rows: data as Record<string, string>[] };
}

// ── Mapping: frontend sends { spreadsheetHeader → assetField } ───────────────

const ASSET_FIELDS = [
  "assetReference", "uprn", "fullAddress", "addressLine1", "addressLine2",
  "addressLine3", "addressLine4", "area", "postCode", "assetType",
  "propertySubtype", "buildType", "archetype", "bedrooms", "heatingType",
  "propertyCategory", "residentType", "blockReference", "status", "notes",
  "complianceTypes",
] as const;

/**
 * mapping = { spreadsheetHeader: assetField }
 * Returns { assetField: value } for a single row
 */
function mapRow(rawRow: Record<string, string>, mapping: Record<string, string>): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [srcCol, assetField] of Object.entries(mapping)) {
    if (assetField && rawRow[srcCol] !== undefined) {
      mapped[assetField] = String(rawRow[srcCol]);
    }
  }
  return mapped;
}

type ValidationError = { field: string; value: string; message: string };

const VALID_ASSET_TYPES = new Set(["property", "block"]);

// Legacy sub-type values that may appear in old spreadsheets — auto-correct to assetType=property
// Derived from the canonical PROPERTY_SUBTYPES list in the DB schema (shared source of truth)
const LEGACY_SUBTYPES = new Set<string>(PROPERTY_SUBTYPES);

/**
 * If the mapped row has assetType set to a legacy sub-type value (e.g. "flat"),
 * transparently promote it: assetType → "property", propertySubtype → the old value.
 */
function autoCorrectAssetType(mapped: Record<string, string>): Record<string, string> {
  const rawType = mapped.assetType?.trim().toLowerCase();
  if (rawType && LEGACY_SUBTYPES.has(rawType)) {
    return {
      ...mapped,
      assetType: "property",
      propertySubtype: mapped.propertySubtype || rawType,
    };
  }
  return mapped;
}

const VALID_STATUSES = new Set(["active", "inactive", "archived", "pending"]);
const DATE_FIELDS = ["lastInspectionDate", "nextDueDate", "expiryDate", "inspectionDate"] as const;

function validateRow(mapped: Record<string, string>, requireAssetType = false): ValidationError[] {
  const errs: ValidationError[] = [];
  const resolvedType = mapped.assetType?.toLowerCase();

  if (resolvedType && !VALID_ASSET_TYPES.has(resolvedType)) {
    errs.push({ field: "assetType", value: mapped.assetType, message: `Unknown asset type: "${mapped.assetType}". Allowed values: property, block (dwelling types like house/flat are valid sub-types — map them to "Property Sub-Type")` });
  } else if (requireAssetType && !mapped.assetType) {
    errs.push({ field: "assetType", value: "", message: "New property requires an Asset Type — add an Asset Type column to your file or ensure this row matches an existing property" });
  }

  // Cross-field: blocks must not carry a subtype
  if (resolvedType === "block" && mapped.propertySubtype) {
    errs.push({ field: "propertySubtype", value: mapped.propertySubtype, message: `Block assets cannot have a propertySubtype — remove the sub-type value or change Asset Type to "property"` });
  }

  // Cross-field: new properties should have a subtype (warn, not hard error, to allow partial imports)
  if (requireAssetType && resolvedType === "property" && !mapped.propertySubtype) {
    errs.push({ field: "propertySubtype", value: "", message: `Property assets should include a Property Sub-Type (e.g. flat, house, bungalow)` });
  }

  // Numeric fields
  if (mapped.bedrooms && isNaN(Number(mapped.bedrooms))) {
    errs.push({ field: "bedrooms", value: mapped.bedrooms, message: `bedrooms must be a number, got "${mapped.bedrooms}"` });
  }

  // Date fields
  for (const f of DATE_FIELDS) {
    if (mapped[f] && isNaN(Date.parse(mapped[f]))) {
      errs.push({ field: f, value: mapped[f], message: `${f} is not a valid date, got "${mapped[f]}"` });
    }
  }

  // Status enum
  if (mapped.status && !VALID_STATUSES.has(mapped.status.toLowerCase())) {
    errs.push({ field: "status", value: mapped.status, message: `Invalid status: "${mapped.status}". Allowed: ${[...VALID_STATUSES].join(", ")}` });
  }

  return errs;
}

// ── Download template ─────────────────────────────────────────────────────────

const TEMPLATE_HEADERS = [
  "UPRN",
  "Old UPRN",
  "Asset Type",
  "Full Address",
  "Address Line 1",
  "Address Line 2",
  "Address Line 3",
  "Address Line 4",
  "Postcode",
  "Area",
  "Bedrooms",
  "Heating Type",
  "Build Type",
  "Archetype",
  "Property Subtype",
  "Property Category",
  "Resident Type",
  "Block Reference",
  "Status",
  "Notes",
];

const TEMPLATE_EXAMPLE_ROW: Record<string, string> = {
  "UPRN": "100012345678",
  "Old UPRN": "",
  "Asset Type": "property",
  "Full Address": "1 Example Street, Anytown",
  "Address Line 1": "1 Example Street",
  "Address Line 2": "",
  "Address Line 3": "Anytown",
  "Address Line 4": "",
  "Postcode": "AB1 2CD",
  "Area": "North Estate",
  "Bedrooms": "3",
  "Heating Type": "Gas Central Heating",
  "Build Type": "Semi-Detached",
  "Archetype": "Pre-1919",
  "Property Subtype": "house",
  "Property Category": "Residential",
  "Resident Type": "Social",
  "Block Reference": "",
  "Status": "active",
  "Notes": "",
};

router.get("/imports/template", requireRole("tenant_admin", "compliance_manager"), async (req: any, res) => {
  try {
    const tenantId = tid(req);
    const XLSX = await import("xlsx");

    // Fetch active compliance types for this tenant (system + tenant-specific)
    const ctRows = await db.select({
      id: complianceTypes.id,
      name: complianceTypes.name,
      code: complianceTypes.code,
      applicableAssetTypes: complianceTypes.applicableAssetTypes,
    }).from(complianceTypes)
      .where(and(
        eq(complianceTypes.isActive, true),
        or(isNull(complianceTypes.tenantId), eq(complianceTypes.tenantId, tenantId))
      ))
      .orderBy(complianceTypes.name);

    const wb = XLSX.utils.book_new();

    // Build dynamic CT column headers: "CT: {name} ({code})"
    const ctHeaders = ctRows.map(ct => `CT: ${ct.name} (${ct.code})`);
    const allHeaders = [...TEMPLATE_HEADERS, ...ctHeaders];

    // Example row: blank for all CT columns (blank = auto-assign by sub-type)
    const exampleRow = allHeaders.map(h => TEMPLATE_EXAMPLE_ROW[h] ?? "");

    // ── Sheet 1: Assets ──────────────────────────────────────────────────────
    const ws = XLSX.utils.aoa_to_sheet([allHeaders, exampleRow]);
    ws["!cols"] = allHeaders.map(h => ({ wch: Math.max(h.length + 2, 16) }));
    XLSX.utils.book_append_sheet(wb, ws, "Assets");

    // ── Sheet 2: Compliance Type Reference ───────────────────────────────────
    const refHeaders = ["Code", "Name", "Applicable To", "Column in Sheet 1"];
    const refRows = ctRows.map(ct => [
      ct.code,
      ct.name,
      Array.isArray(ct.applicableAssetTypes) ? (ct.applicableAssetTypes as string[]).join(", ") : "all",
      `CT: ${ct.name} (${ct.code})`,
    ]);
    const refWs = XLSX.utils.aoa_to_sheet([
      refHeaders,
      ...refRows,
      [],
      ["HOW TO USE THE COMPLIANCE TYPE COLUMNS"],
      ["YES  → always assign this compliance type to this asset"],
      ["NO   → never assign this compliance type to this asset"],
      ["(blank) → auto-assign based on asset sub-type (recommended default)"],
    ]);
    refWs["!cols"] = [{ wch: 20 }, { wch: 36 }, { wch: 30 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, refWs, "Compliance Type Codes");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="asset-import-template.xlsx"');
    res.send(buf);
  } catch (err) {
    (res as any).log?.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Per-compliance-type scoped asset import template ─────────────────────────

router.get("/imports/template/:code", requireRole("tenant_admin", "compliance_manager"), async (req: any, res) => {
  try {
    const tenantId = tid(req);
    const code = String(req.params.code).toUpperCase();
    const XLSX = await import("xlsx");

    const [ct] = await db.select({
      id: complianceTypes.id,
      name: complianceTypes.name,
      code: complianceTypes.code,
      applicableAssetTypes: complianceTypes.applicableAssetTypes,
    }).from(complianceTypes)
      .where(and(
        eq(complianceTypes.code, code),
        eq(complianceTypes.isActive, true),
        or(isNull(complianceTypes.tenantId), eq(complianceTypes.tenantId, tenantId))
      ));

    if (!ct) { res.status(404).json({ error: `No active compliance type with code "${code}"` }); return; }

    const wb = XLSX.utils.book_new();

    const ctColHeader = `CT: ${ct.name} (${ct.code})`;
    const allHeaders = [...TEMPLATE_HEADERS, ctColHeader];

    const exampleRow = allHeaders.map(h => {
      if (h === ctColHeader) return "";
      return TEMPLATE_EXAMPLE_ROW[h] ?? "";
    });

    const ws = XLSX.utils.aoa_to_sheet([allHeaders, exampleRow]);
    ws["!cols"] = allHeaders.map(h => ({ wch: Math.max(h.length + 2, 16) }));
    XLSX.utils.book_append_sheet(wb, ws, "Assets");

    const refWs = XLSX.utils.aoa_to_sheet([
      ["Column", "Notes"],
      ["UPRN", "Unique Property Reference Number"],
      ["Asset Type", "property or block"],
      ["Full Address", "Full address of the asset"],
      ["Area", "Estate or area name"],
      ["Status", "active, inactive, archived, or pending"],
      [ctColHeader, "YES = assign, NO = skip, blank = auto-assign by sub-type"],
      [],
      ["HOW TO USE THE CT COLUMN"],
      [`YES  → always assign ${ct.name} to this asset`],
      [`NO   → never assign ${ct.name} to this asset`],
      ["(blank) → auto-assign based on asset sub-type (recommended)"],
      [],
      ["Applicable to", (ct.applicableAssetTypes as string[]).join(", ")],
    ]);
    refWs["!cols"] = [{ wch: 36 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, refWs, "Instructions");

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const safeName = ct.name.replace(/[^a-z0-9]/gi, "_");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="asset-import-${safeName}.xlsx"`);
    res.send(buf);
  } catch (err) {
    (res as any).log?.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Upload + parse preview ───────────────────────────────────────────────────

router.post("/imports/upload", requireRole("tenant_admin", "compliance_manager"), async (req: any, res) => {
  const tenantId = tid(req);
  if (!tenantId) { res.status(400).json({ error: "No tenant context — super admins must specify a tenantId" }); return; }
  try {
    const rawFilename = (req.headers["x-filename"] as string) || "upload.csv";
    // Security: strip to basename only, reject path traversal / control chars
    const filename = path.basename(rawFilename).replace(/[/\\<>:"|?*\x00-\x1f]/g, "_");
    if (!filename || filename === "." || filename === "..") {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }
    const ext = path.extname(filename).toLowerCase();
    if (![".csv", ".xlsx", ".xls"].includes(ext)) {
      res.status(400).json({ error: "Only CSV and Excel files are supported" });
      return;
    }

    const uploadDir = path.join(os.tmpdir(), "compliance-os-imports", tenantId);
    await fs.mkdir(uploadDir, { recursive: true });
    const savedName = `${Date.now()}-${filename}`;
    const savedPath = path.join(uploadDir, savedName);
    // Double-check resolved path stays under tenant dir (defence-in-depth)
    const resolvedSaved = path.resolve(savedPath);
    const resolvedDir = path.resolve(uploadDir);
    if (!resolvedSaved.startsWith(resolvedDir + path.sep)) {
      res.status(400).json({ error: "Invalid filename" });
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    if (buf.length === 0) { res.status(400).json({ error: "Empty file" }); return; }
    await fs.writeFile(savedPath, buf);

    const { headers, rows } = await parseFile(savedPath);

    if (headers.length === 0) {
      res.status(400).json({ error: "Could not detect headers — is the file empty?" });
      return;
    }

    const [imp] = await db.insert(imports).values({
      tenantId,
      filename: savedPath,
      originalName: filename,
      status: "pending",
      totalRows: rows.length,
      createdBy: req.user!.sub,
    }).returning();

    const previewRows = rows.slice(0, 20).map((r, i) => ({ rowNumber: i + 1, data: r }));

    res.status(201).json({
      importId: imp.id,
      filename: filename,
      totalRows: rows.length,
      headers,
      previewRows,
      assetFields: ASSET_FIELDS,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Save column mapping ──────────────────────────────────────────────────────

router.post("/imports/:importId/mapping", requireRole("tenant_admin", "compliance_manager"), async (req, res) => {
  const tenantId = tid(req);
  const { mapping, matchKey = "asset_reference", saveAs } = req.body as {
    mapping: Record<string, string>;
    matchKey?: string;
    saveAs?: string;
  };
  if (!mapping || typeof mapping !== "object") {
    res.status(400).json({ error: "mapping object required" }); return;
  }
  try {
    const [imp] = await db
      .update(imports)
      .set({ mappingConfig: mapping, matchKey, mappingTemplateName: saveAs ?? null })
      .where(and(eq(imports.id, String(req.params.importId)), eq(imports.tenantId, tenantId)))
      .returning();
    if (!imp) { res.status(404).json({ error: "Import not found" }); return; }

    if (saveAs?.trim()) {
      await db.insert(mappingTemplates)
        .values({ tenantId, name: saveAs.trim(), mappingConfig: mapping, createdBy: req.user!.sub })
        .onConflictDoNothing();
    }

    res.json({ importId: imp.id, mapping, matchKey });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Validate ─────────────────────────────────────────────────────────────────

router.post("/imports/:importId/validate", requireRole("tenant_admin", "compliance_manager"), async (req, res) => {
  const tenantId = tid(req);
  try {
    const [imp] = await db.select().from(imports)
      .where(and(eq(imports.id, String(req.params.importId)), eq(imports.tenantId, tenantId)));
    if (!imp) { res.status(404).json({ error: "Import not found" }); return; }
    if (!imp.mappingConfig) { res.status(400).json({ error: "Save mapping before validating" }); return; }

    const mapping = imp.mappingConfig as Record<string, string>;
    const matchKey = imp.matchKey ?? "asset_reference";
    const { rows } = await parseFile(imp.filename);

    // Clear any previous validation results so re-validation is clean
    await db.delete(importRows).where(eq(importRows.importId, imp.id));

    // Pre-fetch all existing assets for match-key values present in this file
    // so we can determine create-vs-update without per-row DB queries
    const matchCol =
      matchKey === "uprn" ? assets.uprn :
      matchKey === "old_uprn" ? assets.oldUprn :
      matchKey === "full_address" ? assets.fullAddress :
      assets.assetReference;

    // Field name in mapped row that holds the match value
    const matchMappedField =
      matchKey === "uprn" ? "uprn" :
      matchKey === "old_uprn" ? "oldUprn" :
      matchKey === "full_address" ? "fullAddress" :
      "assetReference";

    // Collect all non-empty match values from the file
    const allMatchValues = new Set<string>();
    for (const row of rows) {
      const mapped = mapRow(row, mapping);
      const v = mapped[matchMappedField];
      if (v) allMatchValues.add(v);
    }

    // Single query to find which match values already exist
    const existingSet = new Set<string>();
    if (allMatchValues.size > 0) {
      const matchValuesArr = [...allMatchValues];
      // Query in batches of 500 to stay within DB limits
      for (let b = 0; b < matchValuesArr.length; b += 500) {
        const batch = matchValuesArr.slice(b, b + 500);
        const found = await db.select({ val: matchCol }).from(assets)
          .where(and(
            eq(assets.tenantId, tenantId),
            ...(batch.length === 1
              ? [eq(matchCol as any, batch[0])]
              : [sql`${matchCol} = ANY(ARRAY[${sql.raw(batch.map(v => `'${v.replace(/'/g, "''")}'`).join(","))}])`]
            )
          ));
        for (const r of found) {
          if (r.val) existingSet.add(String(r.val));
        }
      }
    }

    const rowErrors: { row: number; errors: ValidationError[] }[] = [];
    const rowsToInsert: (typeof importRows.$inferInsert)[] = [];

    for (let i = 0; i < rows.length; i++) {
      const mapped = autoCorrectAssetType(mapRow(rows[i], mapping));
      const matchValue = mapped[matchMappedField];
      const isExisting = !!(matchValue && existingSet.has(matchValue));
      const errs = validateRow(mapped, !isExisting);
      if (errs.length > 0) {
        rowErrors.push({ row: i + 1, errors: errs });
        rowsToInsert.push({
          importId: imp.id,
          rowNumber: i + 1,
          rawData: rows[i] as any,
          mappedData: mapped as any,
          status: "error",
          errorMessage: errs.map(e => e.message).join("; "),
        });
      } else {
        rowsToInsert.push({
          importId: imp.id,
          rowNumber: i + 1,
          rawData: rows[i] as any,
          mappedData: mapped as any,
          status: "pending",
        });
      }
    }

    // Persist validation results (allows error CSV download before execute)
    const VBATCH = 100;
    for (let i = 0; i < rowsToInsert.length; i += VBATCH) {
      await db.insert(importRows).values(rowsToInsert.slice(i, i + VBATCH));
    }

    // Persist error count so execute gate can check it
    await db.update(imports).set({ errorCount: rowErrors.length }).where(eq(imports.id, imp.id));

    const valid = rowErrors.length === 0;
    res.json({
      valid,
      totalRows: rows.length,
      errorCount: rowErrors.length,
      rowErrors: rowErrors.slice(0, 200),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Execute import (background) ───────────────────────────────────────────────

router.post("/imports/:importId/execute", requireRole("tenant_admin", "compliance_manager"), async (req, res) => {
  const tenantId = tid(req);
  try {
    const [imp] = await db.select().from(imports)
      .where(and(eq(imports.id, String(req.params.importId)), eq(imports.tenantId, tenantId)));
    if (!imp) { res.status(404).json({ error: "Import not found" }); return; }
    if (!imp.mappingConfig) { res.status(400).json({ error: "Save mapping before executing" }); return; }
    if (imp.status === "processing" || imp.status === "complete" || imp.status === "rolled_back") {
      res.status(409).json({ error: `Import is already ${imp.status}` }); return;
    }

    // Gate 1: validation must have been run (validate persists rows)
    const [{ rowCount }] = await db.select({ rowCount: count() }).from(importRows)
      .where(eq(importRows.importId, imp.id));
    if (rowCount === 0) {
      res.status(422).json({ error: "Run validation before executing import" }); return;
    }
    // Gate 2: rows with errors will be skipped automatically during execution.
    // Partial imports are allowed — the user has been warned in the UI.

    await db.update(imports).set({ status: "processing" }).where(eq(imports.id, imp.id));
    res.json({ importId: imp.id, status: "processing" });

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "start_import", entityType: "import", entityId: imp.id,
      details: { originalName: imp.originalName, totalRows: imp.totalRows },
    });

    // Background — does not block HTTP response
    setImmediate(async () => {
      try {
        // Clear validation-stage rows; execute owns the final import_rows state
        await db.delete(importRows).where(eq(importRows.importId, imp.id));

        const mapping = imp.mappingConfig as Record<string, string>;
        const matchKey = imp.matchKey ?? "asset_reference";
        const { rows } = await parseFile(imp.filename);
        const BATCH = 50;
        let created = 0, updated = 0, skipped = 0, errors = 0;

        // Load compliance types once for the whole import run
        const allComplianceTypes = await db.select({
          id: complianceTypes.id,
          code: complianceTypes.code,
          name: complianceTypes.name,
          applicableAssetTypes: complianceTypes.applicableAssetTypes,
        }).from(complianceTypes)
          .where(and(
            eq(complianceTypes.isActive, true),
            or(isNull(complianceTypes.tenantId), eq(complianceTypes.tenantId, tenantId))
          ));

        // Build a lookup: "CT: {name} ({code})" header → ct record
        const ctByHeader = new Map(
          allComplianceTypes.map(ct => [`CT: ${ct.name} (${ct.code})`, ct])
        );

        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);

          for (let bi = 0; bi < batch.length; bi++) {
            const raw = batch[bi];
            const rowNum = i + bi + 1;
            const mapped = autoCorrectAssetType(mapRow(raw, mapping));
            const errs = validateRow(mapped);

            if (errs.length > 0) {
              await db.insert(importRows).values({
                importId: imp.id, rowNumber: rowNum, rawData: raw,
                mappedData: mapped, status: "error",
                errorMessage: errs.map(e => e.message).join("; "),
              });
              errors++;
              continue;
            }

            try {
              const matchValue =
                matchKey === "uprn" ? mapped.uprn :
                matchKey === "old_uprn" ? mapped.oldUprn :
                matchKey === "full_address" ? mapped.fullAddress :
                mapped.assetReference;

              let existing: typeof assets.$inferSelect | null = null;
              if (matchValue) {
                const matchCol =
                  matchKey === "uprn" ? assets.uprn :
                  matchKey === "old_uprn" ? assets.oldUprn :
                  matchKey === "full_address" ? assets.fullAddress :
                  assets.assetReference;
                const [found] = await db.select().from(assets)
                  .where(and(eq(assets.tenantId, tenantId), eq(matchCol as any, matchValue)));
                existing = found ?? null;
              }

              // New assets require an assetType — existing assets keep their current value if not provided
              if (!existing && !mapped.assetType) {
                await db.insert(importRows).values({
                  importId: imp.id, rowNumber: rowNum, rawData: raw,
                  mappedData: mapped, status: "error",
                  errorMessage: "New property requires an Asset Type — add an Asset Type column to your file or ensure this row matches an existing property",
                });
                errors++;
                continue;
              }

              const assetType = (mapped.assetType?.toLowerCase() ?? (existing?.assetType ?? "property")) as any;
              // Enforce cross-field invariants: block→subtype must be null; property→keep or set subtype
              const propertySubtypeFromImport = assetType === "block"
                ? null
                : (mapped.propertySubtype || existing?.propertySubtype || null);

              const assetPayload = {
                assetReference: mapped.assetReference || null,
                uprn: mapped.uprn || null,
                oldUprn: mapped.oldUprn || null,
                fullAddress: mapped.fullAddress || null,
                addressLine1: mapped.addressLine1 || null,
                addressLine2: mapped.addressLine2 || null,
                addressLine3: mapped.addressLine3 || null,
                addressLine4: mapped.addressLine4 || null,
                area: mapped.area || null,
                postCode: mapped.postCode || null,
                assetType,
                propertySubtype: propertySubtypeFromImport,
                buildType: mapped.buildType || null,
                archetype: mapped.archetype || null,
                bedrooms: mapped.bedrooms ? Number(mapped.bedrooms) : null,
                heatingType: mapped.heatingType || null,
                propertyCategory: mapped.propertyCategory || null,
                residentType: mapped.residentType || null,
                blockReference: mapped.blockReference || null,
                status: (mapped.status as any) || "active",
                notes: mapped.notes || null,
                updatedAt: new Date(),
              };

              let assetId: string;
              if (existing) {
                // Capture pre-import state for rollback
                const previousData: Record<string, unknown> = {};
                for (const k of Object.keys(assetPayload) as (keyof typeof assetPayload)[]) {
                  previousData[k] = (existing as any)[k] ?? null;
                }
                await db.update(assets).set(assetPayload).where(eq(assets.id, existing.id));
                assetId = existing.id;
                await db.insert(importRows).values({
                  importId: imp.id, rowNumber: rowNum, rawData: raw,
                  mappedData: mapped, previousData, status: "updated", assetId,
                });
                await writeAuditLog({
                  tenantId, userId: imp.createdBy, actorName: "import",
                  action: "update_asset", entityType: "asset", entityId: assetId,
                  details: { source: "excel_import", importId: imp.id, rowNumber: rowNum },
                });
                updated++;
              } else {
                const [createdAsset] = await db.insert(assets).values({
                  ...assetPayload, tenantId, createdBy: imp.createdBy,
                }).returning();
                assetId = createdAsset.id;
                await db.insert(importRows).values({
                  importId: imp.id, rowNumber: rowNum, rawData: raw,
                  mappedData: mapped, status: "created", assetId,
                });
                await writeAuditLog({
                  tenantId, userId: imp.createdBy, actorName: "import",
                  action: "create_asset", entityType: "asset", entityId: assetId,
                  details: { source: "excel_import", importId: imp.id, rowNumber: rowNum },
                });
                created++;

                // ── Compliance type assignment for new assets ───────────────
                // Determine auto-assign list for this asset's sub-type
                const subKey = assetType === "block"
                  ? "block"
                  : (propertySubtypeFromImport?.toLowerCase() ?? "property");
                const autoIds = new Set(
                  allComplianceTypes
                    .filter(ct => {
                      const applicable = (ct.applicableAssetTypes ?? []) as string[];
                      if (applicable.length === 0) return true;
                      return applicable.includes(subKey) ||
                             (assetType === "property" && applicable.includes("property"));
                    })
                    .map(ct => ct.id)
                );

                // Check for explicit YES/NO CT columns in the raw row
                const ctIdsToAssign = new Set<string>();
                let hasExplicitCtCols = false;
                for (const [header, ct] of ctByHeader.entries()) {
                  const val = (raw[header] ?? "").trim().toUpperCase();
                  if (val === "YES") {
                    hasExplicitCtCols = true;
                    ctIdsToAssign.add(ct.id);
                  } else if (val === "NO") {
                    hasExplicitCtCols = true;
                    // explicitly excluded — do not add
                  } else {
                    // blank → include if auto-applicable
                    if (autoIds.has(ct.id)) ctIdsToAssign.add(ct.id);
                  }
                }

                // If no CT columns were present at all, fall back to full auto-assign
                if (!hasExplicitCtCols) {
                  for (const id of autoIds) ctIdsToAssign.add(id);
                }

                if (ctIdsToAssign.size > 0) {
                  await db.insert(assetComplianceItems).values(
                    [...ctIdsToAssign].map(ctId => ({
                      tenantId,
                      assetId,
                      complianceTypeId: ctId,
                      status: "not_applicable" as const,
                      isEnabled: true,
                    }))
                  ).onConflictDoNothing();
                }
              }
            } catch (rowErr) {
              await db.insert(importRows).values({
                importId: imp.id, rowNumber: rowNum, rawData: raw,
                mappedData: mapped, status: "error",
                errorMessage: rowErr instanceof Error ? rowErr.message : String(rowErr),
              });
              errors++;
            }
          }

          // Update progress after each batch
          await db.update(imports).set({
            processedRows: Math.min(i + BATCH, rows.length),
            createdCount: created, updatedCount: updated,
            skippedCount: skipped, errorCount: errors,
          }).where(eq(imports.id, imp.id));
        }

        const finalStatus = errors > 0 && created + updated === 0 ? "failed" : "complete";
        await db.update(imports).set({
          status: finalStatus,
          processedRows: rows.length,
          createdCount: created, updatedCount: updated,
          skippedCount: skipped, errorCount: errors,
          completedAt: new Date(),
        }).where(eq(imports.id, imp.id));
      } catch (bgErr) {
        console.error("[import background]", bgErr);
        await db.update(imports).set({ status: "failed" }).where(eq(imports.id, imp.id));
      }
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Single import detail ──────────────────────────────────────────────────────

router.get("/imports/:importId", async (req, res) => {
  const tenantId = tid(req);
  try {
    const [imp] = await db.select().from(imports)
      .where(and(eq(imports.id, String(req.params.importId)), eq(imports.tenantId, tenantId)));
    if (!imp) { res.status(404).json({ error: "Import not found" }); return; }
    res.json(imp);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Progress ─────────────────────────────────────────────────────────────────

router.get("/imports/:importId/progress", async (req, res) => {
  const tenantId = tid(req);
  try {
    const [imp] = await db.select().from(imports)
      .where(and(eq(imports.id, String(req.params.importId)), eq(imports.tenantId, tenantId)));
    if (!imp) { res.status(404).json({ error: "Import not found" }); return; }
    res.json({
      importId: imp.id,
      status: imp.status,
      totalRows: imp.totalRows ?? 0,
      processedRows: imp.processedRows,
      createdCount: imp.createdCount,
      updatedCount: imp.updatedCount,
      skippedCount: imp.skippedCount,
      errorCount: imp.errorCount,
      completedAt: imp.completedAt,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Import history list ───────────────────────────────────────────────────────

router.get("/imports", async (req, res) => {
  const tenantId = tid(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  try {
    const list = await db.select().from(imports)
      .where(eq(imports.tenantId, tenantId))
      .orderBy(desc(imports.createdAt))
      .limit(limit).offset(offset);
    const [{ total }] = await db.select({ total: count() }).from(imports)
      .where(eq(imports.tenantId, tenantId));
    res.json({ data: list, total: Number(total), page, limit });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Row-level detail ──────────────────────────────────────────────────────────

router.get("/imports/:importId/rows", async (req, res) => {
  const tenantId = tid(req);
  const statusFilter = req.query.status as string | undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  try {
    const [imp] = await db.select().from(imports)
      .where(and(eq(imports.id, String(req.params.importId)), eq(imports.tenantId, tenantId)));
    if (!imp) { res.status(404).json({ error: "Import not found" }); return; }

    const conditions: any[] = [eq(importRows.importId, imp.id)];
    if (statusFilter) conditions.push(eq(importRows.status, statusFilter as any));

    const list = await db.select().from(importRows)
      .where(and(...conditions))
      .orderBy(importRows.rowNumber)
      .limit(limit).offset(offset);
    const [{ total }] = await db.select({ total: count() }).from(importRows)
      .where(and(...conditions));
    res.json({ data: list, total: Number(total), page, limit });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Error report CSV download ─────────────────────────────────────────────────

router.get("/imports/:importId/errors.csv", async (req, res) => {
  const tenantId = tid(req);
  try {
    const [imp] = await db.select().from(imports)
      .where(and(eq(imports.id, String(req.params.importId)), eq(imports.tenantId, tenantId)));
    if (!imp) { res.status(404).json({ error: "Import not found" }); return; }

    const errorRows = await db.select().from(importRows)
      .where(and(eq(importRows.importId, imp.id), eq(importRows.status, "error")))
      .orderBy(importRows.rowNumber);

    const lines: string[] = ["Row Number,Error Message,Raw Data"];
    for (const row of errorRows) {
      const rawStr = JSON.stringify(row.rawData ?? {}).replace(/"/g, '""');
      const errMsg = (row.errorMessage ?? "").replace(/"/g, '""');
      lines.push(`${row.rowNumber},"${errMsg}","${rawStr}"`);
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="import-errors-${imp.id.slice(0, 8)}.csv"`);
    res.send(lines.join("\n"));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Rollback ──────────────────────────────────────────────────────────────────

router.post("/imports/:importId/rollback", requireRole("tenant_admin"), async (req, res) => {
  const tenantId = tid(req);
  try {
    const [imp] = await db.select().from(imports)
      .where(and(eq(imports.id, String(req.params.importId)), eq(imports.tenantId, tenantId)));
    if (!imp) { res.status(404).json({ error: "Import not found" }); return; }
    if (imp.status !== "complete") {
      res.status(409).json({ error: "Only completed imports can be rolled back" }); return;
    }
    // Enforce 24-hour rollback window
    const ROLLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
    const completedAt = imp.completedAt ? new Date(imp.completedAt).getTime() : 0;
    if (!completedAt || Date.now() - completedAt > ROLLBACK_WINDOW_MS) {
      res.status(409).json({ error: "Rollback window has expired (24 hours after completion)" }); return;
    }

    // Archive created assets
    const createdRows = await db.select().from(importRows)
      .where(and(eq(importRows.importId, imp.id), eq(importRows.status, "created")));
    const createdAssetIds = createdRows.map(r => r.assetId).filter(Boolean) as string[];
    for (const assetId of createdAssetIds) {
      await db.update(assets)
        .set({ deletedAt: new Date(), status: "archived" })
        .where(eq(assets.id, assetId));
    }

    // Revert updated assets to their pre-import state
    const updatedRows = await db.select().from(importRows)
      .where(and(eq(importRows.importId, imp.id), eq(importRows.status, "updated")));
    let revertedCount = 0;
    for (const row of updatedRows) {
      if (row.assetId && row.previousData) {
        const prev = row.previousData as Record<string, any>;
        await db.update(assets).set({
          assetReference: prev.assetReference ?? null,
          uprn: prev.uprn ?? null,
          fullAddress: prev.fullAddress ?? null,
          addressLine1: prev.addressLine1 ?? null,
          addressLine2: prev.addressLine2 ?? null,
          addressLine3: prev.addressLine3 ?? null,
          addressLine4: prev.addressLine4 ?? null,
          area: prev.area ?? null,
          postCode: prev.postCode ?? null,
          assetType: prev.assetType ?? "property",
          propertySubtype: prev.propertySubtype ?? null,
          buildType: prev.buildType ?? null,
          archetype: prev.archetype ?? null,
          bedrooms: prev.bedrooms ?? null,
          heatingType: prev.heatingType ?? null,
          propertyCategory: prev.propertyCategory ?? null,
          residentType: prev.residentType ?? null,
          blockReference: prev.blockReference ?? null,
          status: prev.status ?? "active",
          notes: prev.notes ?? null,
          updatedAt: new Date(),
        }).where(eq(assets.id, row.assetId));
        revertedCount++;
      }
    }

    await db.update(imports).set({
      status: "rolled_back",
      rolledBackAt: new Date(),
      rolledBackBy: req.user!.sub,
    }).where(eq(imports.id, imp.id));

    await writeAuditLog({
      tenantId, userId: req.user!.sub, actorName: req.user!.username,
      action: "rollback_import", entityType: "import", entityId: imp.id,
      details: { archivedAssets: createdAssetIds.length, revertedAssets: revertedCount },
    });

    res.json({ success: true, archivedAssets: createdAssetIds.length, revertedAssets: revertedCount });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Mapping templates ─────────────────────────────────────────────────────────

router.get("/mapping-templates", async (req, res) => {
  const tenantId = tid(req);
  try {
    const list = await db.select().from(mappingTemplates)
      .where(eq(mappingTemplates.tenantId, tenantId))
      .orderBy(mappingTemplates.name);
    res.json(list);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
