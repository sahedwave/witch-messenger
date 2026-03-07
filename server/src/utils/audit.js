import { AuditLog } from "../models/AuditLog.js";

export async function writeAuditLog({ action, actor, metadata = {}, targetId = null, targetType }) {
  try {
    await AuditLog.create({
      actor: actor || null,
      action,
      targetId,
      targetType,
      metadata
    });
  } catch (error) {
    console.error("Audit log write failed", error);
  }
}

