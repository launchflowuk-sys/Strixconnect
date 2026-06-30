import { db } from "@workspace/db";
import { auditLogs } from "@workspace/db/schema";

interface AuditParams {
  tenantId?: string | null;
  userId?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export async function writeAuditLog(params: AuditParams): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      tenantId: params.tenantId ?? undefined,
      userId: params.userId ?? undefined,
      actorName: params.actorName ?? undefined,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? undefined,
      details: params.details ?? undefined,
      ipAddress: params.ipAddress ?? undefined,
    });
  } catch {
  }
}
