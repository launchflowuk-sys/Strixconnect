import { db, pool } from "@workspace/db";
import {
  tenants, users, tenantUsers, complianceTypes,
} from "@workspace/db/schema";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

const SALT_ROUNDS = 12;

async function seed() {
  console.log("🌱 Seeding database...");

  const systemTypes = [
    {
      code: "EICR",
      name: "Electrical Installation Condition Report",
      description: "Electrical safety inspection required every 5 years",
      frequencyMonths: 60,
      dueSoonDays: 90,
      color: "#3b82f6",
    },
    {
      code: "GAS_CP12",
      name: "Gas Safety Certificate (CP12/LGSR)",
      description: "Annual gas safety inspection for properties with gas appliances",
      frequencyMonths: 12,
      dueSoonDays: 30,
      color: "#f59e0b",
    },
    {
      code: "SMOKE_ALARM",
      name: "Smoke Alarm Test",
      description: "Smoke alarm inspection and testing",
      frequencyMonths: 12,
      dueSoonDays: 30,
      color: "#ef4444",
    },
    {
      code: "CO_ALARM",
      name: "Carbon Monoxide Alarm Test",
      description: "CO alarm inspection for solid fuel appliances",
      frequencyMonths: 12,
      dueSoonDays: 30,
      color: "#f97316",
    },
    {
      code: "ASBESTOS",
      name: "Asbestos Survey",
      description: "Asbestos management survey for pre-2000 properties",
      frequencyMonths: 36,
      dueSoonDays: 60,
      color: "#8b5cf6",
    },
    {
      code: "LEGIONELLA",
      name: "Legionella Risk Assessment",
      description: "Water hygiene risk assessment",
      frequencyMonths: 24,
      dueSoonDays: 60,
      color: "#06b6d4",
    },
    {
      code: "FIRE_RISK",
      name: "Fire Risk Assessment",
      description: "Fire safety risk assessment for communal areas and blocks",
      frequencyMonths: 12,
      dueSoonDays: 60,
      color: "#dc2626",
    },
    {
      code: "LIFTS_LOLER",
      name: "Lift Inspection (LOLER)",
      description: "Statutory 6-monthly lift inspection under LOLER regulations",
      frequencyMonths: 6,
      dueSoonDays: 30,
      color: "#7c3aed",
    },
  ];

  for (const ct of systemTypes) {
    const existing = await db
      .select()
      .from(complianceTypes)
      .where(eq(complianceTypes.code, ct.code));
    if (existing.length === 0) {
      await db.insert(complianceTypes).values({
        ...ct,
        tenantId: null,
        isSystem: true,
        isActive: true,
      });
      console.log(`  ✓ Compliance type: ${ct.code}`);
    } else {
      console.log(`  · Skip: ${ct.code} (exists)`);
    }
  }

  // Thurrock tenant
  let thucrockTenant;
  const [existingTenant] = await db.select().from(tenants).where(eq(tenants.slug, "thurrock"));
  if (!existingTenant) {
    [thucrockTenant] = await db
      .insert(tenants)
      .values({
        name: "Thurrock Council",
        slug: "thurrock",
        status: "active",
        contactEmail: "housing@thurrock.gov.uk",
        contactName: "Housing Team",
        plan: "enterprise",
        maxAssets: 50000,
        maxUsers: 100,
      })
      .returning();
    console.log(`  ✓ Tenant: Thurrock Council`);
  } else {
    thucrockTenant = existingTenant;
    console.log(`  · Skip: Thurrock (exists)`);
  }

  // Super admin
  const superAdminPwd = process.env.SUPER_ADMIN_PASSWORD ?? "Admin1234!";
  const [existingAdmin] = await db.select().from(users).where(eq(users.username, "admin"));
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(superAdminPwd, SALT_ROUNDS);
    await db.insert(users).values({
      username: "admin",
      email: "admin@complianceos.local",
      passwordHash,
      firstName: "System",
      lastName: "Administrator",
      isSuperAdmin: true,
      isActive: true,
    });
    console.log(`  ✓ Super admin: admin / ${superAdminPwd}`);
  } else {
    console.log(`  · Skip: admin (exists)`);
  }

  // Tenant admin
  const [existingTAdmin] = await db.select().from(users).where(eq(users.username, "thurrock.admin"));
  if (!existingTAdmin) {
    const passwordHash = await bcrypt.hash("Thurrock2024!", SALT_ROUNDS);
    const [tAdmin] = await db
      .insert(users)
      .values({
        username: "thurrock.admin",
        email: "admin@thurrock.gov.uk",
        passwordHash,
        firstName: "Thurrock",
        lastName: "Administrator",
        isSuperAdmin: false,
        isActive: true,
      })
      .returning();
    await db.insert(tenantUsers).values({
      tenantId: thucrockTenant!.id,
      userId: tAdmin.id,
      role: "tenant_admin",
      isActive: true,
    });
    console.log(`  ✓ Tenant admin: thurrock.admin / Thurrock2024!`);
  } else {
    console.log(`  · Skip: thurrock.admin (exists)`);
  }

  // Compliance manager
  const [existingMgr] = await db.select().from(users).where(eq(users.username, "compliance.manager"));
  if (!existingMgr) {
    const passwordHash = await bcrypt.hash("Manager2024!", SALT_ROUNDS);
    const [mgr] = await db
      .insert(users)
      .values({
        username: "compliance.manager",
        email: "compliance@thurrock.gov.uk",
        passwordHash,
        firstName: "Compliance",
        lastName: "Manager",
        isSuperAdmin: false,
        isActive: true,
      })
      .returning();
    await db.insert(tenantUsers).values({
      tenantId: thucrockTenant!.id,
      userId: mgr.id,
      role: "compliance_manager",
      isActive: true,
    });
    console.log(`  ✓ Compliance manager: compliance.manager / Manager2024!`);
  } else {
    console.log(`  · Skip: compliance.manager (exists)`);
  }

  console.log("\n✅ Seed complete.\n");
  console.log("Credentials:");
  console.log("  admin / Admin1234!  (super admin)");
  console.log("  thurrock.admin / Thurrock2024!  (tenant admin)");
  console.log("  compliance.manager / Manager2024!  (compliance manager)");
}

seed()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(() => pool.end());
