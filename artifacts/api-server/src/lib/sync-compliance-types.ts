import { db } from "@workspace/db";
import { complianceTypes } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const SYSTEM_COMPLIANCE_TYPES = [
  // ── Original 8 ────────────────────────────────────────────────────────────
  {
    code: "EICR",
    name: "Electrical Installation Condition Report",
    description: "Electrical safety inspection required every 5 years",
    frequencyMonths: 60, dueSoonDays: 90, color: "#3b82f6",
    applicableAssetTypes: ["house","flat","maisonette","bungalow","hmo","block","communal"],
  },
  {
    code: "GAS_CP12",
    name: "Domestic Gas Safety (CP12/LGSR)",
    description: "Annual gas safety inspection for properties with gas appliances",
    frequencyMonths: 12, dueSoonDays: 30, color: "#f59e0b",
    applicableAssetTypes: ["house","flat","maisonette","bungalow","hmo"],
  },
  {
    code: "SMOKE_ALARM",
    name: "Smoke Alarm Test",
    description: "Smoke alarm inspection and testing",
    frequencyMonths: 12, dueSoonDays: 30, color: "#ef4444",
    applicableAssetTypes: ["house","flat","maisonette","bungalow","hmo"],
  },
  {
    code: "CO_ALARM",
    name: "Carbon Monoxide Alarm Test",
    description: "CO alarm inspection for solid fuel appliances",
    frequencyMonths: 12, dueSoonDays: 30, color: "#f97316",
    applicableAssetTypes: ["house","flat","maisonette","bungalow","hmo"],
  },
  {
    code: "ASBESTOS",
    name: "Asbestos Survey",
    description: "Asbestos management survey for pre-2000 properties",
    frequencyMonths: 36, dueSoonDays: 60, color: "#8b5cf6",
    applicableAssetTypes: ["house","flat","maisonette","bungalow","hmo","block","communal","commercial","garage","land","traveller_site","other"],
  },
  {
    code: "LEGIONELLA",
    name: "Legionella Risk Assessment",
    description: "Water hygiene risk assessment",
    frequencyMonths: 24, dueSoonDays: 60, color: "#06b6d4",
    applicableAssetTypes: ["house","flat","maisonette","bungalow","hmo","block","communal","commercial","garage","land","traveller_site","other"],
  },
  {
    code: "FIRE_RISK",
    name: "Fire Risk Assessment",
    description: "Fire safety risk assessment for communal areas and blocks",
    frequencyMonths: 12, dueSoonDays: 60, color: "#dc2626",
    applicableAssetTypes: ["house","flat","maisonette","bungalow","hmo","block","communal","commercial","garage","land","traveller_site","other"],
  },
  {
    code: "LIFTS_LOLER",
    name: "Lift Inspection (LOLER)",
    description: "Statutory 6-monthly lift inspection under LOLER regulations",
    frequencyMonths: 6, dueSoonDays: 30, color: "#7c3aed",
    applicableAssetTypes: ["block","communal"],
  },
  // ── 22 new types added in Task #32 ────────────────────────────────────────
  {
    code: "PAT",
    name: "PAT Testing",
    description: "Portable appliance testing for communal electrical equipment",
    frequencyMonths: 12, dueSoonDays: 30, color: "#0ea5e9",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "LIGHTNING_PROT",
    name: "Lightning Protection System",
    description: "Inspection and testing of lightning protection system",
    frequencyMonths: 12, dueSoonDays: 30, color: "#6366f1",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "EICR_COMMUNAL",
    name: "Communal EICR",
    description: "Electrical installation condition report for communal areas",
    frequencyMonths: 60, dueSoonDays: 90, color: "#2563eb",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "STAIRLIFT_LOLER",
    name: "Stairlift Inspection (LOLER)",
    description: "6-monthly stairlift inspection under LOLER regulations",
    frequencyMonths: 6, dueSoonDays: 30, color: "#7c3aed",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "HOIST_LOLER",
    name: "Hoist Equipment Inspection (LOLER)",
    description: "6-monthly hoist inspection under LOLER regulations",
    frequencyMonths: 6, dueSoonDays: 30, color: "#7c3aed",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "FIRE_HYDRANT",
    name: "Fire Hydrants",
    description: "Annual inspection and testing of fire hydrants",
    frequencyMonths: 12, dueSoonDays: 30, color: "#dc2626",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "SPRINKLER_BIN",
    name: "Bin Store Sprinkler System",
    description: "Annual inspection of bin store sprinkler system",
    frequencyMonths: 12, dueSoonDays: 30, color: "#16a34a",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "SPRINKLER_BLDG",
    name: "Building Sprinkler System",
    description: "Annual inspection of building sprinkler system",
    frequencyMonths: 12, dueSoonDays: 30, color: "#15803d",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "FIRE_ALARM_BLDG",
    name: "Building Fire Alarm System",
    description: "Annual inspection and test of building fire alarm system",
    frequencyMonths: 12, dueSoonDays: 30, color: "#ef4444",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "AOV",
    name: "Automatic Opening Vent (AOV) System",
    description: "Annual inspection of automatic opening vent smoke ventilation system",
    frequencyMonths: 12, dueSoonDays: 30, color: "#64748b",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "EMERG_LIGHTING",
    name: "Emergency Lighting System",
    description: "Annual inspection and test of emergency lighting",
    frequencyMonths: 12, dueSoonDays: 30, color: "#eab308",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "DRY_RISER",
    name: "Dry Riser",
    description: "Annual inspection and pressure test of dry riser system",
    frequencyMonths: 12, dueSoonDays: 30, color: "#0284c7",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "FIRE_EXTINGUISHER",
    name: "Fire Extinguishers",
    description: "Annual inspection and maintenance of fire extinguishers",
    frequencyMonths: 12, dueSoonDays: 30, color: "#dc2626",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "ROLLER_SHUTTER",
    name: "Kitchen Roller Shutter",
    description: "Annual inspection of kitchen roller shutter (fire curtain)",
    frequencyMonths: 12, dueSoonDays: 30, color: "#78716c",
    applicableAssetTypes: ["communal"],
  },
  {
    code: "CCTV",
    name: "CCTV System",
    description: "Annual inspection and maintenance of CCTV system",
    frequencyMonths: 12, dueSoonDays: 30, color: "#374151",
    applicableAssetTypes: ["block","communal","commercial"],
  },
  {
    code: "INTRUDER_ALARM",
    name: "Intruder Alarm System",
    description: "Annual inspection and test of intruder alarm system",
    frequencyMonths: 12, dueSoonDays: 30, color: "#1e40af",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "GAS_COMMERCIAL",
    name: "Commercial Gas Servicing",
    description: "Annual gas safety inspection for commercial properties",
    frequencyMonths: 12, dueSoonDays: 30, color: "#f59e0b",
    applicableAssetTypes: ["commercial"],
  },
  {
    code: "MVHR",
    name: "MVHR System",
    description: "Annual service of mechanical ventilation with heat recovery system",
    frequencyMonths: 12, dueSoonDays: 30, color: "#06b6d4",
    applicableAssetTypes: ["house","flat","maisonette","bungalow","hmo"],
  },
  {
    code: "AIR_CON",
    name: "Air Conditioning System",
    description: "Annual inspection and service of air conditioning system",
    frequencyMonths: 12, dueSoonDays: 30, color: "#0ea5e9",
    applicableAssetTypes: ["block","communal","commercial"],
  },
  {
    code: "FIRE_DAMPER",
    name: "Fire Dampers",
    description: "Biennial inspection and test of fire dampers",
    frequencyMonths: 24, dueSoonDays: 60, color: "#b45309",
    applicableAssetTypes: ["block","communal"],
  },
  {
    code: "DOOR_ENTRY",
    name: "Door Entry System",
    description: "Annual inspection and maintenance of door entry / access control system",
    frequencyMonths: 12, dueSoonDays: 30, color: "#374151",
    applicableAssetTypes: ["block","communal"],
  },
];

export async function syncSystemComplianceTypes(): Promise<void> {
  let inserted = 0;
  let updated = 0;
  for (const ct of SYSTEM_COMPLIANCE_TYPES) {
    const [existing] = await db
      .select({ id: complianceTypes.id, name: complianceTypes.name })
      .from(complianceTypes)
      .where(eq(complianceTypes.code, ct.code));

    if (!existing) {
      await db.insert(complianceTypes).values({
        ...ct,
        tenantId: null,
        isSystem: true,
        isActive: true,
      });
      inserted++;
    } else if (existing.name !== ct.name) {
      // Keep name in sync (e.g. GAS_CP12 rename)
      await db.update(complianceTypes)
        .set({ name: ct.name, applicableAssetTypes: ct.applicableAssetTypes as any })
        .where(eq(complianceTypes.code, ct.code));
      updated++;
    }
  }
  if (inserted > 0 || updated > 0) {
    logger.info({ inserted, updated }, "sync_compliance_types: synced system compliance types");
  }
}
