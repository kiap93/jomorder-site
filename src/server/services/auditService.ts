import fs from "fs";
import path from "path";

export interface AuditLog {
  id: string;
  user_id: string;
  user_email: string;
  role: string;
  action: string;
  timestamp: string;
  restaurant_id: string;
}

const AUDIT_LOGS_FILE = path.join(process.cwd(), "audit_logs.json");

export function readAuditLogs(): AuditLog[] {
  try {
    if (!fs.existsSync(AUDIT_LOGS_FILE)) {
      fs.writeFileSync(AUDIT_LOGS_FILE, JSON.stringify([]));
    }
    return JSON.parse(fs.readFileSync(AUDIT_LOGS_FILE, "utf-8"));
  } catch (err) {
    console.error("Failed to read audit_logs.json", err);
    return [];
  }
}

export function writeAuditLogs(logs: AuditLog[]) {
  try {
    fs.writeFileSync(AUDIT_LOGS_FILE, JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error("Failed to write audit_logs.json", err);
  }
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
}
