import { Router } from "express";
import { db } from "@workspace/db";
import { users, tenantUsers, tenants } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { comparePassword, hashPassword } from "../lib/password";
import { signToken } from "../lib/jwt";
import { requireAuth } from "../middleware/auth";
import { writeAuditLog } from "../lib/audit";

const router = Router();

router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "username and password required" });
    return;
  }
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.username, username), eq(users.isActive, true)));
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    let tenantId: string | null = null;
    let role: string | null = null;

    if (!user.isSuperAdmin) {
      const [membership] = await db
        .select()
        .from(tenantUsers)
        .where(and(eq(tenantUsers.userId, user.id), eq(tenantUsers.isActive, true)));
      if (membership) {
        tenantId = membership.tenantId;
        role = membership.role;
      }
    }

    const token = signToken({
      sub: user.id,
      username: user.username,
      isSuperAdmin: user.isSuperAdmin,
      tenantId,
      role,
    });

    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    await writeAuditLog({
      tenantId,
      userId: user.id,
      actorName: user.username,
      action: "login",
      entityType: "user",
      entityId: user.id,
      ipAddress: req.ip,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.isSuperAdmin ? "super_admin" : role,
        tenantId,
      },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/logout", requireAuth, async (req, res) => {
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.sub,
    actorName: req.user!.username,
    action: "logout",
    entityType: "user",
    entityId: req.user!.sub,
  });
  res.json({ success: true });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.user!.sub));
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    let tenantName: string | null = null;
    if (req.user!.tenantId) {
      const [tenant] = await db
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, req.user!.tenantId));
      tenantName = tenant?.name ?? null;
    }

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.isSuperAdmin ? "super_admin" : req.user!.role,
      tenantId: req.user!.tenantId,
      tenantName,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, req.user!.sub));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const valid = await comparePassword(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }
    const newHash = await hashPassword(newPassword);
    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    await writeAuditLog({
      tenantId: req.user!.tenantId,
      userId: user.id,
      actorName: user.username,
      action: "change_password",
      entityType: "user",
      entityId: user.id,
    });

    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
