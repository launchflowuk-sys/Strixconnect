import { Router } from "express";
import { db } from "@workspace/db";
import { teams, teamMembers, tenantUsers, users } from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

function tid(req: any): string {
  return req.user.tenantId as string;
}

router.get("/teams", async (req, res) => {
  const tenantId = tid(req);
  try {
    const list = await db
      .select()
      .from(teams)
      .where(and(eq(teams.tenantId, tenantId), eq(teams.isActive, true)))
      .orderBy(teams.name);

    const withMembers = await Promise.all(
      list.map(async (team) => {
        const members = await db
          .select({
            id: teamMembers.id,
            userId: teamMembers.userId,
            isLead: teamMembers.isLead,
            firstName: users.firstName,
            lastName: users.lastName,
            username: users.username,
            email: users.email,
          })
          .from(teamMembers)
          .innerJoin(users, eq(teamMembers.userId, users.id))
          .where(eq(teamMembers.teamId, team.id));
        return { ...team, members };
      })
    );
    res.json(withMembers);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/teams", requireRole("tenant_admin", "compliance_manager"), async (req, res) => {
  const tenantId = tid(req);
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  try {
    const [team] = await db
      .insert(teams)
      .values({ tenantId, name, description, createdBy: req.user!.sub })
      .returning();
    res.status(201).json({ ...team, members: [] });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/teams/:teamId", requireRole("tenant_admin", "compliance_manager"), async (req, res) => {
  const tenantId = tid(req);
  const { name, description } = req.body;
  try {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    const [team] = await db
      .update(teams)
      .set(updates as any)
      .where(and(eq(teams.id, String(req.params.teamId)), eq(teams.tenantId, tenantId)))
      .returning();
    if (!team) { res.status(404).json({ error: "Team not found" }); return; }
    res.json(team);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/teams/:teamId", requireRole("tenant_admin"), async (req, res) => {
  const tenantId = tid(req);
  try {
    await db
      .update(teams)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(teams.id, String(req.params.teamId)), eq(teams.tenantId, tenantId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/teams/:teamId/members", requireRole("tenant_admin", "compliance_manager"), async (req, res) => {
  const tenantId = tid(req);
  const { userId, isLead = false } = req.body;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  try {
    const [existing] = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, String(req.params.teamId)), eq(teamMembers.userId, userId)));
    if (existing) { res.status(409).json({ error: "User already in team" }); return; }

    const [member] = await db
      .insert(teamMembers)
      .values({ teamId: String(req.params.teamId), userId, tenantId, isLead })
      .returning();
    res.status(201).json(member);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/teams/:teamId/members/:userId", requireRole("tenant_admin", "compliance_manager"), async (req, res) => {
  try {
    await db
      .delete(teamMembers)
      .where(and(
        eq(teamMembers.teamId, String(req.params.teamId)),
        eq(teamMembers.userId, String(req.params.userId))
      ));
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
