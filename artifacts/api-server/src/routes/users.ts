import { Router } from "express";
import { db } from "@workspace/db";
import { users, tenantUsers, tenants } from "@workspace/db/schema";
import { eq, and, ilike, or, count, isNull } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth";
import { hashPassword } from "../lib/password";
import { writeAuditLog } from "../lib/audit";

const router = Router();

router.use(requireAuth);

function getTenantId(req: any): string {
  if (req.user.isSuperAdmin && req.query.tenantId) return req.query.tenantId as string;
  return req.user.tenantId as string;
}

router.get("/users", requireRole("tenant_admin", "compliance_manager"), async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) { res.status(400).json({ error: "No tenant context" }); return; }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  try {
    const memberships = await db
      .select({
        userId: tenantUsers.userId,
        role: tenantUsers.role,
        tuIsActive: tenantUsers.isActive,
      })
      .from(tenantUsers)
      .where(eq(tenantUsers.tenantId, tenantId))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(tenantUsers)
      .where(eq(tenantUsers.tenantId, tenantId));

    const userList = await Promise.all(
      memberships.map(async (m) => {
        const [u] = await db.select().from(users).where(eq(users.id, m.userId));
        return u
          ? {
              id: u.id,
              username: u.username,
              email: u.email,
              firstName: u.firstName,
              lastName: u.lastName,
              role: m.role,
              isActive: m.tuIsActive && u.isActive,
              createdAt: u.createdAt,
              lastLoginAt: u.lastLoginAt,
            }
          : null;
      })
    );

    res.json({ data: userList.filter(Boolean), total: Number(total), page, limit });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/users", requireRole("tenant_admin"), async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) { res.status(400).json({ error: "No tenant context" }); return; }

  const { username, email, password, firstName, lastName, role = "team_member" } = req.body;
  if (!username || !email || !password) {
    res.status(400).json({ error: "username, email, and password are required" });
    return;
  }
  try {
    const [existingUser] = await db
      .select()
      .from(users)
      .where(or(eq(users.username, username), eq(users.email, email)));
    if (existingUser) {
      res.status(409).json({ error: "Username or email already taken" });
      return;
    }

    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(users)
      .values({ username, email, passwordHash, firstName, lastName })
      .returning();

    const [membership] = await db
      .insert(tenantUsers)
      .values({ tenantId, userId: user.id, role })
      .returning();

    await writeAuditLog({
      tenantId,
      userId: req.user!.sub,
      actorName: req.user!.username,
      action: "create_user",
      entityType: "user",
      entityId: user.id,
      details: { username, email, role },
    });

    res.status(201).json({
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: membership.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users/:userId", requireRole("tenant_admin", "compliance_manager"), async (req, res) => {
  const tenantId = getTenantId(req);
  try {
    const userId = String(req.params.userId);
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    if (!u) { res.status(404).json({ error: "User not found" }); return; }
    const [m] = await db.select().from(tenantUsers).where(
      and(eq(tenantUsers.userId, u.id), eq(tenantUsers.tenantId, tenantId!))
    );
    res.json({
      id: u.id,
      username: u.username,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: m?.role ?? null,
      isActive: u.isActive && (m?.isActive ?? false),
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/users/:userId", requireRole("tenant_admin"), async (req, res) => {
  const tenantId = getTenantId(req);
  const { email, firstName, lastName, role } = req.body;
  try {
    const userId = String(req.params.userId);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (email !== undefined) updates.email = email;
    if (firstName !== undefined) updates.firstName = firstName;
    if (lastName !== undefined) updates.lastName = lastName;

    const [u] = await db
      .update(users)
      .set(updates as any)
      .where(eq(users.id, userId))
      .returning();

    if (role !== undefined) {
      await db
        .update(tenantUsers)
        .set({ role, updatedAt: new Date() })
        .where(and(eq(tenantUsers.userId, userId), eq(tenantUsers.tenantId, tenantId!)));
    }

    res.json({ ...u, role });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/users/:userId/deactivate", requireRole("tenant_admin"), async (req, res) => {
  const tenantId = getTenantId(req);
  try {
    const userId = String(req.params.userId);
    await db
      .update(tenantUsers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(tenantUsers.userId, userId), eq(tenantUsers.tenantId, tenantId!)));

    await writeAuditLog({
      tenantId,
      userId: req.user!.sub,
      actorName: req.user!.username,
      action: "deactivate_user",
      entityType: "user",
      entityId: String(req.params.userId),
    });

    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Tenant self-service (tenant_admin reads/updates their own workspace) ─────

router.get("/my-tenant", requireRole("tenant_admin", "compliance_manager", "team_member", "auditor"), async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) { res.status(400).json({ error: "No tenant context" }); return; }
  try {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }
    res.json(tenant);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/my-tenant", requireRole("tenant_admin"), async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) { res.status(400).json({ error: "No tenant context" }); return; }
  const { name, contactEmail, contactName, notificationsEnabled, notificationEmail } = req.body;
  try {
    const [tenant] = await db
      .update(tenants)
      .set({
        ...(name !== undefined && { name }),
        ...(contactEmail !== undefined && { contactEmail }),
        ...(contactName !== undefined && { contactName }),
        ...(notificationsEnabled !== undefined && { notificationsEnabled: Boolean(notificationsEnabled) }),
        ...(notificationEmail !== undefined && { notificationEmail: notificationEmail || null }),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))
      .returning();
    if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

    await writeAuditLog({
      tenantId,
      userId: req.user!.sub,
      actorName: req.user!.username,
      action: "update_tenant_settings",
      entityType: "tenant",
      entityId: tenantId,
      details: { name, contactEmail, contactName, notificationsEnabled, notificationEmail },
    });

    res.json(tenant);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
