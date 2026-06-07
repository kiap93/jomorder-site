import { supabaseAdmin } from "./dbService";

export interface AuditLog {
  id: string;
  user_id: string;
  user_email: string;
  role: string;
  action: string;
  timestamp: string;
  restaurant_id: string;
}

const auditLogsInMemory: AuditLog[] = [];

export function readAuditLogs(): AuditLog[] {
  return auditLogsInMemory;
}

export function writeAuditLogs(logs: AuditLog[]) {
  auditLogsInMemory.length = 0;
  auditLogsInMemory.push(...logs);
}

export function logToAudit(userId: string, userEmail: string, role: string, action: string, restaurantId: string) {
  const logs = readAuditLogs();
  const log: AuditLog = {
    id: 'audit-' + Math.random().toString(36).substr(2, 9),
    user_id: userId,
    user_email: userEmail,
    role,
    action,
    timestamp: new Date().toISOString(),
    restaurant_id: restaurantId
  };
  logs.unshift(log);
  if (logs.length > 2000) {
    logs.length = 2000;
  }
  writeAuditLogs(logs);

  // Persist to audit_logs database table asynchronously
  (async () => {
    try {
      const { error } = await supabaseAdmin.from('audit_logs').insert({
        restaurant_id: restaurantId,
        user_id: userId || null,
        user_email: userEmail,
        user_role: role,
        action: action,
        metadata: {}
      });
      if (error) {
        console.error("[Audit] Error inserting audit log to DB:", error.message);
      }
    } catch (err: any) {
      console.error("[Audit] Exception inserting audit log to DB:", err?.message || err);
    }
  })();
}
