import { db } from "@workspace/db";
import { assetComplianceItems, assets, complianceTypes, complianceHistory, tenants, tenantUsers, users } from "@workspace/db/schema";
import { eq, and, isNull, isNotNull, sql, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { sendEmail } from "./email";

const BATCH = 200;

const APP_URL = (process.env["APP_URL"] ?? "").replace(/\/$/, "");

function buildDeepLink(assetId: string, itemId: string): string {
  if (!APP_URL) return "";
  return `${APP_URL}/assets/${assetId}?tab=compliance&item=${itemId}`;
}

function buildEmailHtml(opts: {
  firstName: string | null;
  status: "due_soon" | "overdue";
  assetReference: string | null;
  complianceTypeName: string;
  nextDueDate: string;
  diffDays: number;
  deepLink: string;
  tenantName: string;
}): string {
  const greeting = `Hi ${opts.firstName ?? "Compliance Manager"},`;
  const urgencyLine =
    opts.status === "overdue"
      ? `<p style="color:#c0392b;font-weight:bold;">This compliance item is <strong>OVERDUE</strong> by ${Math.abs(opts.diffDays)} day(s).</p>`
      : `<p>This compliance item is due in <strong>${opts.diffDays} day(s)</strong>.</p>`;

  const deepLinkSection = opts.deepLink
    ? `<p><a href="${opts.deepLink}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block;margin-top:8px;">View Compliance Item</a></p>`
    : "";

  return `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#1e293b;">ComplianceOS — ${opts.status === "overdue" ? "Overdue Alert" : "Upcoming Due Date"}</h2>
  <p>${greeting}</p>
  ${urgencyLine}
  <table style="border-collapse:collapse;width:100%;margin:16px 0">
    <tr>
      <td style="padding:8px 12px;background:#f1f5f9;font-weight:600;width:40%">Organisation</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${opts.tenantName}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;background:#f1f5f9;font-weight:600">Asset Reference</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${opts.assetReference ?? "—"}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;background:#f1f5f9;font-weight:600">Compliance Type</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${opts.complianceTypeName}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;background:#f1f5f9;font-weight:600">Next Due Date</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${opts.nextDueDate}</td>
    </tr>
  </table>
  ${deepLinkSection}
  <p style="color:#64748b;font-size:12px;margin-top:24px;">
    You are receiving this because you are a compliance manager or admin for ${opts.tenantName} on ComplianceOS.
  </p>
</div>`.trim();
}

/** Recalculate compliance statuses for all active tenants and send reminder emails */
export async function runNightlyJob(): Promise<void> {
  const start = Date.now();
  logger.info("nightly_job: starting compliance status recalculation");

  try {
    const allTenants = await db
      .select({ id: tenants.id, name: tenants.name, status: tenants.status, notificationsEnabled: tenants.notificationsEnabled, notificationEmail: tenants.notificationEmail })
      .from(tenants)
      .where(isNull(tenants.deletedAt));

    let updated = 0;
    let emailsSent = 0;
    let emailsSkipped = 0;

    for (const tenant of allTenants) {
      if (tenant.status === "suspended") continue;
      const emailsAllowed = tenant.notificationsEnabled !== false;

      // Load all compliance types for this tenant to get dueSoonDays and name
      const ctMap = new Map<string, { frequencyMonths: number | null; dueSoonDays: number; name: string }>();
      const cts = await db
        .select({
          id: complianceTypes.id,
          frequencyMonths: complianceTypes.frequencyMonths,
          dueSoonDays: complianceTypes.dueSoonDays,
          name: complianceTypes.name,
        })
        .from(complianceTypes)
        .where(sql`${complianceTypes.tenantId} = ${tenant.id} OR ${complianceTypes.tenantId} IS NULL`);
      for (const ct of cts) {
        ctMap.set(ct.id, {
          frequencyMonths: ct.frequencyMonths,
          dueSoonDays: ct.dueSoonDays ?? 30,
          name: ct.name,
        });
      }

      // Cache tenant recipients (tenant_admin + compliance_manager) to avoid per-item queries
      const tenantRecipients: { email: string; firstName: string | null }[] = [];
      const memberRows = await db
        .select({ userId: tenantUsers.userId })
        .from(tenantUsers)
        .where(
          and(
            eq(tenantUsers.tenantId, tenant.id),
            inArray(tenantUsers.role, ["tenant_admin", "compliance_manager"] as any[]),
            eq(tenantUsers.isActive, true),
          )
        );

      for (const m of memberRows) {
        const [u] = await db
          .select({ email: users.email, firstName: users.firstName, isActive: users.isActive })
          .from(users)
          .where(eq(users.id, m.userId));
        if (u?.email && u.isActive) {
          tenantRecipients.push({ email: u.email, firstName: u.firstName });
        }
      }

      if (tenantRecipients.length === 0) {
        logger.info({ tenantId: tenant.id }, "nightly_job: no active recipients for tenant, skipping emails");
      }

      // Process items in batches
      let offset = 0;
      const today = new Date();

      while (true) {
        const items = await db
          .select()
          .from(assetComplianceItems)
          .where(
            and(
              eq(assetComplianceItems.tenantId, tenant.id),
              eq(assetComplianceItems.isEnabled, true),
              isNotNull(assetComplianceItems.nextDueDate),
            )
          )
          .limit(BATCH)
          .offset(offset);

        if (items.length === 0) break;

        for (const item of items) {
          if (!item.nextDueDate) continue;
          const ct = ctMap.get(item.complianceTypeId);
          const dueSoonDays = ct?.dueSoonDays ?? 30;

          const due = new Date(item.nextDueDate);
          const diffMs = due.getTime() - today.getTime();
          const diffDays = Math.ceil(diffMs / 86400000);

          let newStatus: string;
          if (diffDays < 0) newStatus = "overdue";
          else if (diffDays <= dueSoonDays) newStatus = "due_soon";
          else newStatus = "compliant";

          if (newStatus !== item.status) {
            const prev = { status: item.status };
            await db.update(assetComplianceItems)
              .set({ status: newStatus as any, updatedAt: new Date() })
              .where(eq(assetComplianceItems.id, item.id));
            await db.insert(complianceHistory).values({
              tenantId: tenant.id,
              entityType: "asset_compliance_item",
              entityId: item.id,
              action: "status_auto_updated",
              previousState: prev,
              newState: { status: newStatus },
              actorId: null,
            });
            updated++;
          }

          // Email reminder: send when transitioning INTO due_soon or overdue
          const shouldEmail =
            (newStatus === "due_soon" && item.status !== "due_soon") ||
            (newStatus === "overdue" && item.status !== "overdue");

          if (shouldEmail && tenantRecipients.length > 0 && emailsAllowed) {
            try {
              // Fetch asset reference for the email
              const [asset] = await db
                .select({ assetReference: assets.assetReference, id: assets.id })
                .from(assets)
                .where(eq(assets.id, item.assetId));

              const complianceTypeName = ct?.name ?? "Unknown";
              const deepLink = buildDeepLink(item.assetId, item.id);

              for (const recipient of tenantRecipients) {
                const subject =
                  newStatus === "overdue"
                    ? `[ComplianceOS] OVERDUE compliance item — ${tenant.name}`
                    : `[ComplianceOS] Compliance item due soon — ${tenant.name}`;

                const html = buildEmailHtml({
                  firstName: recipient.firstName,
                  status: newStatus as "due_soon" | "overdue",
                  assetReference: asset?.assetReference ?? null,
                  complianceTypeName,
                  nextDueDate: item.nextDueDate,
                  diffDays,
                  deepLink,
                  tenantName: tenant.name,
                });

                const result = await sendEmail({ to: recipient.email, subject, html });
                if (result.delivered) {
                  emailsSent++;
                  logger.info(
                    { to: recipient.email, status: newStatus, itemId: item.id, assetId: item.assetId },
                    "nightly_job: email delivered"
                  );
                } else {
                  emailsSkipped++;
                  logger.warn(
                    { to: recipient.email, reason: result.reason, itemId: item.id },
                    "nightly_job: email not delivered"
                  );
                }
              }
            } catch (emailErr) {
              emailsSkipped++;
              logger.warn({ emailErr, itemId: item.id }, "nightly_job: email send failed (non-fatal)");
            }
          } else if (shouldEmail && tenantRecipients.length === 0) {
            emailsSkipped++;
            logger.debug({ itemId: item.id, status: newStatus }, "nightly_job: email skipped — no recipients");
          }
        }

        offset += BATCH;
        if (items.length < BATCH) break;
      }
    }

    logger.info({ updated, emailsSent, emailsSkipped, durationMs: Date.now() - start }, "nightly_job: complete");
  } catch (err) {
    logger.error({ err }, "nightly_job: error");
  }
}

let schedulerHandle: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  // Run once on startup (delay 30s to let server warm up)
  const startupTimer = setTimeout(() => runNightlyJob(), 30_000);

  // Then daily
  schedulerHandle = setInterval(() => runNightlyJob(), MS_PER_DAY);

  logger.info("nightly_job: scheduler started");
}

export function stopScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}
