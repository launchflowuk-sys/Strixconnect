import { Router } from "express";
import { db } from "@workspace/db";
import { assetFieldDefinitions, FIELD_TYPES } from "@workspace/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

function tid(req: any): string {
  const tenantId = req.user?.tenantId as string | null;
  if (!tenantId) throw new Error("No tenant context");
  return tenantId;
}

router.get("/asset-field-definitions", async (req: any, res) => {
  let tenantId: string;
  try { tenantId = tid(req); } catch { res.status(400).json({ error: "No tenant context" }); return; }
  try {
    const defs = await db
      .select()
      .from(assetFieldDefinitions)
      .where(eq(assetFieldDefinitions.tenantId, tenantId))
      .orderBy(asc(assetFieldDefinitions.position), asc(assetFieldDefinitions.createdAt));
    res.json(defs);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/asset-field-definitions", async (req: any, res) => {
  let tenantId: string;
  try { tenantId = tid(req); } catch { res.status(400).json({ error: "No tenant context" }); return; }

  const { label, fieldType = "text", position = 0 } = req.body ?? {};

  if (!label || typeof label !== "string" || !label.trim()) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  if (!(FIELD_TYPES as readonly string[]).includes(fieldType)) {
    res.status(400).json({ error: `fieldType must be one of: ${FIELD_TYPES.join(", ")}` });
    return;
  }

  try {
    const [created] = await db
      .insert(assetFieldDefinitions)
      .values({ tenantId, label: label.trim(), fieldType, position: Number(position) || 0 })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/asset-field-definitions/:defId", async (req: any, res) => {
  let tenantId: string;
  try { tenantId = tid(req); } catch { res.status(400).json({ error: "No tenant context" }); return; }

  const { defId } = req.params;
  const { label, fieldType, position } = req.body ?? {};

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (label !== undefined) {
    if (typeof label !== "string" || !label.trim()) {
      res.status(400).json({ error: "label must be a non-empty string" });
      return;
    }
    updates.label = label.trim();
  }
  if (fieldType !== undefined) {
    if (!(FIELD_TYPES as readonly string[]).includes(fieldType)) {
      res.status(400).json({ error: `fieldType must be one of: ${FIELD_TYPES.join(", ")}` });
      return;
    }
    updates.fieldType = fieldType;
  }
  if (position !== undefined) {
    updates.position = Number(position) || 0;
  }

  try {
    const [updated] = await db
      .update(assetFieldDefinitions)
      .set(updates as any)
      .where(and(eq(assetFieldDefinitions.id, defId), eq(assetFieldDefinitions.tenantId, tenantId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Field definition not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/asset-field-definitions/:defId", async (req: any, res) => {
  let tenantId: string;
  try { tenantId = tid(req); } catch { res.status(400).json({ error: "No tenant context" }); return; }

  const { defId } = req.params;
  try {
    await db
      .delete(assetFieldDefinitions)
      .where(and(eq(assetFieldDefinitions.id, defId), eq(assetFieldDefinitions.tenantId, tenantId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
