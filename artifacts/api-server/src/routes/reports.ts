import { Router } from "express";
import { db } from "@workspace/db";
import {
  assets, assetComplianceItems, complianceTypes, serviceRecords, jobs, tenants, tenantUsers,
} from "@workspace/db/schema";
import { and, eq, isNull, gte, lte, sql, or } from "drizzle-orm";
import { requireAuth, requireRole, requireSuperAdmin } from "../middleware/auth";

type CustomFieldDef = { key: string; label: string };

async function loadCustomDefs(complianceTypeId: string | undefined): Promise<CustomFieldDef[]> {
  if (!complianceTypeId) return [];
  const [ct] = await db.select({ customFieldDefinitions: complianceTypes.customFieldDefinitions })
    .from(complianceTypes).where(eq(complianceTypes.id, complianceTypeId));
  return (ct?.customFieldDefinitions as CustomFieldDef[] | null) ?? [];
}

function collectCustomFieldMeta(rows: Array<{ customFieldDefinitions: unknown; customFields: unknown }>): {
  customHeaders: string[];
  customKeys: string[];
} {
  const keyToLabel = new Map<string, string>();
  for (const row of rows) {
    const defs: CustomFieldDef[] = Array.isArray(row.customFieldDefinitions)
      ? (row.customFieldDefinitions as CustomFieldDef[])
      : [];
    for (const def of defs) {
      if (def.key && !keyToLabel.has(def.key)) {
        keyToLabel.set(def.key, def.label || def.key);
      }
    }
    const fields = row.customFields && typeof row.customFields === "object"
      ? (row.customFields as Record<string, unknown>)
      : {};
    for (const k of Object.keys(fields)) {
      if (!keyToLabel.has(k)) keyToLabel.set(k, k);
    }
  }
  const customKeys = Array.from(keyToLabel.keys());
  const customHeaders = customKeys.map(k => keyToLabel.get(k)!);
  return { customHeaders, customKeys };
}

function customFieldValue(customFields: unknown, key: string): unknown {
  if (!customFields || typeof customFields !== "object") return "";
  const v = (customFields as Record<string, unknown>)[key];
  return v === undefined || v === null ? "" : v;
}

function escCsv(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escCsv).join(",")];
  for (const row of rows) lines.push(row.map(escCsv).join(","));
  return lines.join("\r\n");
}

function sendCsv(res: any, filename: string, csv: string) {
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  res.send("\uFEFF" + csv);
}

function tid(req: any): string { return req.user.tenantId as string; }

function pickColumns(
  headers: string[],
  rows: unknown[][],
  columns: string | undefined,
): { headers: string[]; rows: unknown[][] } {
  if (!columns) return { headers, rows };
  const wanted = columns.split(",").map(c => c.trim().toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return { headers, rows };
  const indices = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => wanted.includes(h.toLowerCase()))
    .map(({ i }) => i);
  if (indices.length === 0) return { headers, rows };
  return {
    headers: indices.map(i => headers[i]),
    rows: rows.map(row => indices.map(i => (row as any[])[i])),
  };
}

// ── Reports router (tenant scoped) ────────────────────────────────────────────
const reportsRouter = Router();
reportsRouter.use(requireAuth);
reportsRouter.use(requireRole("tenant_admin", "compliance_manager", "auditor"));

// ── Column metadata — tells the UI what columns are available per report type
// ?complianceTypeId=<id> appends that type's custom field labels to each applicable report
reportsRouter.get("/reports/columns", async (req, res) => {
  const { complianceTypeId } = req.query as Record<string, string>;
  const customDefs = await loadCustomDefs(complianceTypeId);
  const customLabels = customDefs.map(d => d.label);
  res.json({
    compliance: [
      "Asset Reference","UPRN","Full Address","Asset Type","Area",
      "Compliance Type","Code","Status","Last Inspection","Next Due Date",
      "Expiry Date","Certificate Ref","Contractor","Follow-on Required","Notes",
      ...customLabels,
    ],
    overdue: [
      "Asset Reference","UPRN","Full Address","Asset Type","Area",
      "Compliance Type","Code","Last Inspection","Due Date","Days Overdue",
      "Certificate Ref","Contractor",
      ...customLabels,
    ],
    "follow-on": [
      "Asset Reference","UPRN","Full Address","Asset Type","Area",
      "Compliance Type","Code","Status","Next Due","Contractor","Linked Jobs","Notes",
      ...customLabels,
    ],
    custom: [
      "Service Date","Asset Reference","UPRN","Full Address","Asset Type","Area",
      "Compliance Type","Code","Outcome","Engineer","Certificate Ref","Expiry Date","Notes",
    ],
  });
});

reportsRouter.get("/reports/compliance", async (req, res) => {
  const tenantId = tid(req);
  const { assetType, complianceTypeId, status, columns } = req.query as Record<string, string>;

  try {
    const conditions: any[] = [
      eq(assetComplianceItems.tenantId, tenantId),
      isNull(assets.deletedAt),
    ];
    if (assetType) conditions.push(eq(assets.assetType, assetType as any));
    if (complianceTypeId) conditions.push(eq(assetComplianceItems.complianceTypeId, complianceTypeId));
    if (status) conditions.push(sql`${assetComplianceItems.status} = ${status}`);

    const rows = await db
      .select({
        assetReference: assets.assetReference,
        uprn: assets.uprn,
        fullAddress: assets.fullAddress,
        assetType: assets.assetType,
        area: assets.area,
        typeName: complianceTypes.name,
        typeCode: complianceTypes.code,
        status: assetComplianceItems.status,
        lastInspectionDate: assetComplianceItems.lastInspectionDate,
        nextDueDate: assetComplianceItems.nextDueDate,
        expiryDate: assetComplianceItems.expiryDate,
        certificateRef: assetComplianceItems.certificateRef,
        contractor: assetComplianceItems.contractor,
        followOnRequired: assetComplianceItems.followOnRequired,
        notes: assetComplianceItems.notes,
        customFields: assetComplianceItems.customFields,
        customFieldDefinitions: complianceTypes.customFieldDefinitions,
      })
      .from(assetComplianceItems)
      .innerJoin(assets, eq(assetComplianceItems.assetId, assets.id))
      .innerJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id))
      .where(and(...conditions))
      .orderBy(assets.assetReference, complianceTypes.name);

    const { customHeaders, customKeys } = collectCustomFieldMeta(rows);
    const headers = [
      "Asset Reference","UPRN","Full Address","Asset Type","Area",
      "Compliance Type","Code","Status","Last Inspection","Next Due Date",
      "Expiry Date","Certificate Ref","Contractor","Follow-on Required","Notes",
      ...customHeaders,
    ];
    const csvRows = rows.map(r => [
      r.assetReference, r.uprn, r.fullAddress, r.assetType, r.area,
      r.typeName, r.typeCode, r.status, r.lastInspectionDate, r.nextDueDate,
      r.expiryDate, r.certificateRef, r.contractor,
      r.followOnRequired ? "Yes" : "No", r.notes,
      ...customKeys.map(k => customFieldValue(r.customFields, k)),
    ]);
    const filtered = pickColumns(headers, csvRows, columns);
    sendCsv(res, `compliance-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(filtered.headers, filtered.rows));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

reportsRouter.get("/reports/overdue", async (req, res) => {
  const tenantId = tid(req);
  const { assetType, complianceTypeId, columns } = req.query as Record<string, string>;

  try {
    const conditions: any[] = [
      eq(assetComplianceItems.tenantId, tenantId),
      sql`${assetComplianceItems.status} = 'overdue'`,
      isNull(assets.deletedAt),
    ];
    if (assetType) conditions.push(eq(assets.assetType, assetType as any));
    if (complianceTypeId) conditions.push(eq(assetComplianceItems.complianceTypeId, complianceTypeId));

    const rows = await db
      .select({
        assetReference: assets.assetReference,
        uprn: assets.uprn,
        fullAddress: assets.fullAddress,
        assetType: assets.assetType,
        area: assets.area,
        typeName: complianceTypes.name,
        typeCode: complianceTypes.code,
        lastInspectionDate: assetComplianceItems.lastInspectionDate,
        nextDueDate: assetComplianceItems.nextDueDate,
        certificateRef: assetComplianceItems.certificateRef,
        contractor: assetComplianceItems.contractor,
        customFields: assetComplianceItems.customFields,
        customFieldDefinitions: complianceTypes.customFieldDefinitions,
      })
      .from(assetComplianceItems)
      .innerJoin(assets, eq(assetComplianceItems.assetId, assets.id))
      .innerJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id))
      .where(and(...conditions))
      .orderBy(assetComplianceItems.nextDueDate);

    const today = new Date();
    const { customHeaders, customKeys } = collectCustomFieldMeta(rows);
    const headers = [
      "Asset Reference","UPRN","Full Address","Asset Type","Area",
      "Compliance Type","Code","Last Inspection","Due Date","Days Overdue",
      "Certificate Ref","Contractor",
      ...customHeaders,
    ];
    const csvRows = rows.map(r => {
      const due = r.nextDueDate ? new Date(r.nextDueDate) : null;
      const daysOverdue = due ? Math.floor((today.getTime() - due.getTime()) / 86400000) : "";
      return [
        r.assetReference, r.uprn, r.fullAddress, r.assetType, r.area,
        r.typeName, r.typeCode, r.lastInspectionDate, r.nextDueDate, daysOverdue,
        r.certificateRef, r.contractor,
        ...customKeys.map(k => customFieldValue(r.customFields, k)),
      ];
    });
    const filtered = pickColumns(headers, csvRows, columns);
    sendCsv(res, `overdue-${today.toISOString().slice(0, 10)}.csv`, toCsv(filtered.headers, filtered.rows));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

reportsRouter.get("/reports/follow-on", async (req, res) => {
  const tenantId = tid(req);
  const { complianceTypeId, assetType, columns } = req.query as Record<string, string>;

  try {
    const conditions: any[] = [
      eq(assetComplianceItems.tenantId, tenantId),
      eq(assetComplianceItems.followOnRequired, true),
      isNull(assets.deletedAt),
    ];
    if (complianceTypeId) conditions.push(eq(assetComplianceItems.complianceTypeId, complianceTypeId));
    if (assetType) conditions.push(eq(assets.assetType, assetType as any));

    const items = await db
      .select({
        assetReference: assets.assetReference,
        uprn: assets.uprn,
        fullAddress: assets.fullAddress,
        assetType: assets.assetType,
        area: assets.area,
        typeName: complianceTypes.name,
        typeCode: complianceTypes.code,
        status: assetComplianceItems.status,
        nextDueDate: assetComplianceItems.nextDueDate,
        contractor: assetComplianceItems.contractor,
        notes: assetComplianceItems.notes,
        itemId: assetComplianceItems.id,
        customFields: assetComplianceItems.customFields,
        customFieldDefinitions: complianceTypes.customFieldDefinitions,
      })
      .from(assetComplianceItems)
      .innerJoin(assets, eq(assetComplianceItems.assetId, assets.id))
      .innerJoin(complianceTypes, eq(assetComplianceItems.complianceTypeId, complianceTypes.id))
      .where(and(...conditions))
      .orderBy(assets.assetReference);

    const [linkedJobs] = await Promise.all([
      db.select({ complianceItemId: jobs.complianceItemId, title: jobs.title, status: jobs.status })
        .from(jobs)
        .where(and(eq(jobs.tenantId, tenantId), sql`${jobs.complianceItemId} IS NOT NULL`)),
    ]);

    const jobsByItem = new Map<string, string[]>();
    for (const j of linkedJobs) {
      if (!j.complianceItemId) continue;
      const arr = jobsByItem.get(j.complianceItemId) ?? [];
      arr.push(j.title ?? "Untitled");
      jobsByItem.set(j.complianceItemId, arr);
    }

    const { customHeaders, customKeys } = collectCustomFieldMeta(items);
    const headers = [
      "Asset Reference","UPRN","Full Address","Asset Type","Area",
      "Compliance Type","Code","Status","Next Due","Contractor","Linked Jobs","Notes",
      ...customHeaders,
    ];
    const csvRows = items.map(r => [
      r.assetReference, r.uprn, r.fullAddress, r.assetType, r.area,
      r.typeName, r.typeCode, r.status, r.nextDueDate, r.contractor,
      (jobsByItem.get(r.itemId) ?? []).join("; "), r.notes,
      ...customKeys.map(k => customFieldValue(r.customFields, k)),
    ]);
    const filtered = pickColumns(headers, csvRows, columns);
    sendCsv(res, `follow-on-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(filtered.headers, filtered.rows));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

reportsRouter.get("/reports/custom", async (req, res) => {
  const tenantId = tid(req);
  const { from, to, complianceTypeId, columns } = req.query as Record<string, string>;

  if (!from || !to) {
    res.status(400).json({ error: "from and to dates are required (YYYY-MM-DD)" });
    return;
  }

  try {
    const conditions: any[] = [
      eq(serviceRecords.tenantId, tenantId),
      gte(serviceRecords.serviceDate as any, from),
      lte(serviceRecords.serviceDate as any, to),
    ];
    if (complianceTypeId) conditions.push(eq(serviceRecords.complianceTypeId, complianceTypeId));

    const rows = await db
      .select({
        serviceDate: serviceRecords.serviceDate,
        assetReference: assets.assetReference,
        uprn: assets.uprn,
        fullAddress: assets.fullAddress,
        assetType: assets.assetType,
        area: assets.area,
        typeName: complianceTypes.name,
        typeCode: complianceTypes.code,
        outcome: serviceRecords.outcome,
        engineerName: serviceRecords.engineerName,
        certificateRef: serviceRecords.certificateRef,
        expiryDate: serviceRecords.expiryDate,
        notes: serviceRecords.notes,
      })
      .from(serviceRecords)
      .innerJoin(assets, eq(serviceRecords.assetId, assets.id))
      .innerJoin(complianceTypes, eq(serviceRecords.complianceTypeId, complianceTypes.id))
      .where(and(...conditions))
      .orderBy(serviceRecords.serviceDate);

    const headers = [
      "Service Date","Asset Reference","UPRN","Full Address","Asset Type","Area",
      "Compliance Type","Code","Outcome","Engineer","Certificate Ref","Expiry Date","Notes",
    ];
    const csvRows = rows.map(r => [
      r.serviceDate, r.assetReference, r.uprn, r.fullAddress, r.assetType, r.area,
      r.typeName, r.typeCode, r.outcome, r.engineerName, r.certificateRef,
      r.expiryDate, r.notes,
    ]);
    const filtered = pickColumns(headers, csvRows, columns);
    sendCsv(res, `service-records-${from}-to-${to}.csv`, toCsv(filtered.headers, filtered.rows));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Platform summary (Super Admin only) ───────────────────────────────────────
const platformRouter = Router();
platformRouter.use(requireAuth);
platformRouter.use(requireSuperAdmin);

platformRouter.get("/platform/summary", async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM tenants WHERE deleted_at IS NULL)::int                                                           AS total_tenants,
        (SELECT COUNT(*) FROM tenants WHERE deleted_at IS NULL AND status = 'active')::int                                     AS active_tenants,
        (SELECT COUNT(*) FROM tenants WHERE deleted_at IS NULL AND status = 'trial')::int                                      AS trial_tenants,
        (SELECT COUNT(*) FROM tenants WHERE deleted_at IS NULL AND status = 'suspended')::int                                  AS suspended_tenants,
        (SELECT COUNT(*) FROM assets WHERE deleted_at IS NULL)::int                                                            AS total_assets,
        (SELECT COUNT(*) FROM tenant_users)::int                                                                               AS total_users,
        (SELECT COUNT(*) FROM asset_compliance_items WHERE status = 'overdue' AND is_enabled = true)::int                     AS total_overdue,
        (SELECT COUNT(*) FROM asset_compliance_items WHERE status = 'due_soon' AND is_enabled = true)::int                    AS total_due_soon,
        (SELECT COUNT(*) FROM service_records WHERE created_at >= date_trunc('month', now()))::int                            AS service_records_this_month
    `);
    const row = (result.rows as any[])[0] ?? {};
    res.json({
      totalTenants: Number(row.total_tenants ?? 0),
      activeTenants: Number(row.active_tenants ?? 0),
      trialTenants: Number(row.trial_tenants ?? 0),
      suspendedTenants: Number(row.suspended_tenants ?? 0),
      totalAssets: Number(row.total_assets ?? 0),
      totalUsers: Number(row.total_users ?? 0),
      totalOverdue: Number(row.total_overdue ?? 0),
      totalDueSoon: Number(row.total_due_soon ?? 0),
      serviceRecordsThisMonth: Number(row.service_records_this_month ?? 0),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export { reportsRouter, platformRouter };
