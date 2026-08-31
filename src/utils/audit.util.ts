import prisma from "../config/database.config";

// Fire-and-forget audit trail for sensitive privileged actions. Never throws —
// auditing must not block or fail the operation it records.
export async function writeAudit(entry: {
  actorId?: number | null;
  action: string;
  entity: string;
  entityId?: number | null;
  meta?: unknown;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        meta: entry.meta != null ? JSON.stringify(entry.meta) : null,
      },
    });
  } catch (err) {
    console.error("audit write failed:", (err as Error)?.message);
  }
}
