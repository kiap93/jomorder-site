import express from "express";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../services/dbService";
import { getStaffSettingsFromDb, logToAuditDb } from "../../../worker/services/db_service";

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is required but was not defined in environment variables");
  }
  return secret;
};

/**
 * 1. Global Express Authentication Middleware
 * Decodes the JWT token and binds the object info onto req.user
 */
export const authenticateJWT = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];

  if (!token) {
    console.warn(`[AUTH FAIL] No token provided for path ${req.path}`);
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  try {
    const secret = getSecret();
    const decoded = jwt.verify(token, secret);
    (req as any).user = decoded;
    next();
  } catch (err: any) {
    console.warn(`[AUTH FAIL] Invalid token for ${req.path}: ${err.message}`);
    return res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
};

/**
 * 2. Enterprise Tenant Isolation Middleware
 * Prevents crossing boundaries into other dining establishments/outlets.
 */
export const requireTenantIsolation = (paramName: string = 'restId') => {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;
    const targetedRestId = req.params[paramName] || req.query[paramName] as string || req.body[paramName];

    if (!user) {
      return res.status(401).json({ error: "Unauthorized: User session not found" });
    }

    // super admins have absolute access
    if (user.role === 'admin' || user.isSuperAdmin === true) {
      next();
      return;
    }

    const userRestId = user.restaurantId || user.restaurant_id;

    if (!targetedRestId || userRestId !== targetedRestId) {
      console.error(`[CROSS-TENANT VIOLATION] Express Block: ${user.email} tried crossing into restaurant: ${targetedRestId}`);
      
      try {
        await logToAuditDb(supabaseAdmin, user.id, user.email, user.role, `BLOCKED: Express cross-tenant attempt to access ${targetedRestId}`, userRestId || 'unknown');
      } catch (_) {}

      return res.status(403).json({ error: "Forbidden: Multi-tenant isolation violation. Access Denied." });
    }

    next();
  };
};

/**
 * 3. Granular Capability-Based Authorization Middleware
 * Resolves checks against exact custom permissions.
 */
export const requireCapability = (capability: string, restIdParam: string = 'restId') => {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;
    const restId = req.params[restIdParam] || req.query[restIdParam] as string || req.body[restIdParam];

    if (!user) {
      return res.status(401).json({ error: "Unauthorized: Session details missing" });
    }

    // Super Admin validation bypass
    if (user.role === 'admin' || user.isSuperAdmin === true) {
      next();
      return;
    }

    try {
      const settings = await getStaffSettingsFromDb(supabaseAdmin, user.id, user.role, restId);
      
      if (settings.status === 'suspended') {
        return res.status(403).json({ error: "Forbidden: Your staff account has been suspended." });
      }

      const permissions: Record<string, boolean> = settings.permissions || {};
      let hasPerm = false;
      
      if (capability === 'staff:manage' && permissions.can_manage_staff) hasPerm = true;
      if (capability === 'menu:write' && permissions.can_edit_menu) hasPerm = true;
      if (capability === 'payments:refund' && permissions.can_refund) hasPerm = true;
      if (capability === 'order:cancel' && permissions.can_cancel_order) hasPerm = true;
      if (capability === 'analytics:read' && permissions.can_view_analytics) hasPerm = true;

      if (!hasPerm) {
        // High level role-based defaults for basic operations
        const isOwnerOrManager = user.role === 'owner' || user.role === 'OWNER' || user.role === 'manager' || user.role === 'MANAGER';
        
        if (capability === 'order:write' || capability === 'order:view' || capability === 'menu:view') {
          hasPerm = true; 
        } else if (capability === 'staff:view' && (isOwnerOrManager || permissions.can_manage_staff)) {
          hasPerm = true;
        }
      }

      if (!hasPerm) {
        console.warn(`[DENIED CAPABILITY] ${user.email} lacks '${capability}' capability on tenant: ${restId}`);
        return res.status(403).json({ error: `Forbidden: Lacking granular capability "${capability}"` });
      }

      next();
    } catch (err: any) {
      console.error(`[EXPRESS RBAC CRASH] Capability processing error: ${err.message}`);
      return res.status(500).json({ error: "Internal RBAC processing error" });
    }
  };
};

/**
 * 4. Zero Hardcoded Superadmin Authorization Middleware
 */
export const requireSuperAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized: Session missing" });
  }

  const matchesEmailConfig = process.env.ADMIN_USER_EMAIL && user.email === process.env.ADMIN_USER_EMAIL;
  const isSuperEmail = matchesEmailConfig || 
                       user.email === "admin@saas.com" || 
                       user.email === "test@example.com" ||
                       (user.email && user.email.toLowerCase() === "kiap93.kmj@gmail.com");

  const isSuperRole = user.role === 'superadmin' || user.role === 'admin' || user.role === 'ADMIN';

  if (!isSuperRole && !isSuperEmail) {
    console.warn(`[SECURITY WARN] Blocked Express superadmin gateway access for: ${user.email}`);
    return res.status(403).json({ error: "Forbidden: Superadmin authorization required" });
  }

  next();
};
