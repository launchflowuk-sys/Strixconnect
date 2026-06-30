import { Router } from "express";
import { db } from "@workspace/db";
import { complianceTypes } from "@workspace/db/schema";
import { eq, or, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

router.get("/compliance-types", async (req, res) => {
  const tenantId = req.user!.tenantId;
  try {
    const list = await db
      .select()
      .from(complianceTypes)
      .where(
        tenantId
          ? or(isNull(complianceTypes.tenantId), eq(complianceTypes.tenantId, tenantId))
          : isNull(complianceTypes.tenantId)
      )
      .orderBy(complianceTypes.name);
    res.json(list);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/compliance-types", requireRole("tenant_admin"), async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { name, code, description, frequencyMonths, dueSoonDays = 30, color, applicableAssetTypes } = req.body;
  if (!name || !code) { res.status(400).json({ error: "name and code required" }); return; }
  try {
    const [ct] = await db
      .insert(complianceTypes)
      .values({
        tenantId: tenantId ?? undefined,
        name, code, description, frequencyMonths,
        dueSoonDays, color, isSystem: false, isActive: true,
        applicableAssetTypes: Array.isArray(applicableAssetTypes) ? applicableAssetTypes : undefined,
      })
      .returning();
    res.status(201).json(ct);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/compliance-types/:typeId", requireRole("tenant_admin"), async (req, res) => {
  const { name, description, frequencyMonths, dueSoonDays, isActive, color, applicableAssetTypes } = req.body;
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (frequencyMonths !== undefined) updates.frequencyMonths = frequencyMonths;
    if (dueSoonDays !== undefined) updates.dueSoonDays = dueSoonDays;
    if (isActive !== undefined) updates.isActive = isActive;
    if (color !== undefined) updates.color = color;
    if (applicableAssetTypes !== undefined) updates.applicableAssetTypes = Array.isArray(applicableAssetTypes) ? applicableAssetTypes : [];

    const [ct] = await db
      .update(complianceTypes)
      .set(updates as any)
      .where(eq(complianceTypes.id, String(req.params.typeId)))
      .returning();
    if (!ct) { res.status(404).json({ error: "Not found" }); return; }
    res.json(ct);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/compliance-types/:typeId/custom-fields/:fieldKey", requireRole("tenant_admin"), async (req, res) => {
  const tenantId = req.user!.tenantId;
  const typeId = String(req.params.typeId);
  const fieldKey = String(req.params.fieldKey);
  const { label } = req.body;
  if (!label || typeof label !== "string") {
    res.status(400).json({ error: "label is required" });
    return;
  }
  try {
    const [existing] = await db
      .select()
      .from(complianceTypes)
      .where(eq(complianceTypes.id, typeId));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    if (existing.tenantId !== tenantId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const defs: Array<{ key: string; label: string }> = Array.isArray(existing.customFieldDefinitions)
      ? (existing.customFieldDefinitions as any[])
      : [];
    const idx = defs.findIndex(d => d.key === fieldKey);
    if (idx === -1) { res.status(404).json({ error: "Custom field not found" }); return; }

    defs[idx] = { key: fieldKey, label };

    const [updated] = await db
      .update(complianceTypes)
      .set({ customFieldDefinitions: defs as any, updatedAt: new Date() })
      .where(eq(complianceTypes.id, typeId))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/compliance-types/:typeId/custom-fields/:fieldKey", requireRole("tenant_admin"), async (req, res) => {
  const tenantId = req.user!.tenantId;
  const typeId = String(req.params.typeId);
  const fieldKey = String(req.params.fieldKey);
  try {
    const [existing] = await db
      .select()
      .from(complianceTypes)
      .where(eq(complianceTypes.id, typeId));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    if (existing.tenantId !== tenantId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const defs: Array<{ key: string; label: string }> = Array.isArray(existing.customFieldDefinitions)
      ? (existing.customFieldDefinitions as any[])
      : [];
    const fieldExists = defs.some(d => d.key === fieldKey);
    if (!fieldExists) { res.status(404).json({ error: "Custom field not found" }); return; }

    const filtered = defs.filter(d => d.key !== fieldKey);

    const [updated] = await db
      .update(complianceTypes)
      .set({ customFieldDefinitions: filtered as any, updatedAt: new Date() })
      .where(eq(complianceTypes.id, typeId))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
