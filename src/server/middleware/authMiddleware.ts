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
 * Derived strictly from authenticated JWT/Session - NEVER trusting client-supplied IDs.
 */
export const requireTenantIsolation = (paramName: string = 'restId') => {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ error: "Unauthorized: User session not found" });
    }

    // Platform Super Admins have bypass permissions
    if (user.platform_role === 'superadmin' || user.is_platform_admin === true) {
      next();
      return;
    }

    const userRestId = user.restaurantId || user.restaurant_id;

    if (!userRestId) {
      return res.status(403).json({ error: "Forbidden: No authorized restaurant/tenant context in active token." });
    }

    // 1. Force override/sanitize any input payload structures to ensure the query CANNOT target another tenant.
    if (req.body) {
      if (req.body.restaurantId && req.body.restaurantId !== userRestId) req.body.restaurantId = userRestId;
      if (req.body.restaurant_id && req.body.restaurant_id !== userRestId) req.body.restaurant_id = userRestId;
      if (req.body.restId && req.body.restId !== userRestId) req.body.restId = userRestId;
    }
    if (req.query) {
      if (req.query.restaurantId) req.query.restaurantId = userRestId;
      if (req.query.restaurant_id) req.query.restaurant_id = userRestId;
      if (req.query.restId) req.query.restId = userRestId;
    }

    // 2. Validate URL Params to prevent crossed references
    const targetedRestId = req.params[paramName] || req.params.restId || req.params.restaurantId;

    if (targetedRestId && targetedRestId !== userRestId) {
      console.error(`[CROSS-TENANT VIOLATION] Express Block: ${user.email} tried crossing into restaurant: ${targetedRestId} (User bound to parent tenant: ${userRestId})`);
      try {
        await logToAuditDb(supabaseAdmin, user.id, user.email, user.role, `BLOCKED: Express cross-tenant attempt to access ${targetedRestId}`, userRestId);
      } catch (_) {}
      return res.status(403).json({ error: "Forbidden: Multi-tenant isolation violation. Access Denied." });
    }

    // 3. Verify resource ownership dynamically if resource ID parameter is present (BOLA protection)
    const targetId = req.params.id || req.params.staffId || req.params.orderId;
    if (targetId) {
      const fullPath = (req.baseUrl || '') + (req.path || '');
      let tableName = '';
      
      if (fullPath.includes('/tables/')) {
        tableName = 'tables';
      } else if (fullPath.includes('/menu-items/')) {
        tableName = 'menu_items';
      } else if (fullPath.includes('/categories/')) {
        tableName = 'categories';
      } else if (fullPath.includes('/orders/')) {
        tableName = 'orders';
      } else if (fullPath.includes('/dining-sessions/')) {
        tableName = 'dining_sessions';
      } else if (fullPath.includes('/translation-jobs/')) {
        tableName = 'translation_jobs';
      } else if (fullPath.includes('/staff/')) {
        tableName = 'profiles';
      } else if (fullPath.includes('/restaurants/') && !fullPath.includes('/orders') && !fullPath.includes('/categories') && !fullPath.includes('/menu-items') && !fullPath.includes('/tables') && !fullPath.includes('/staff') && !fullPath.includes('/dining-sessions')) {
        tableName = 'restaurants';
      }

      if (tableName) {
        try {
          if (tableName === 'restaurants') {
            if (targetId !== userRestId) {
              return res.status(403).json({ error: "Forbidden: Access denied to target restaurant." });
            }
          } else {
            const { data, error } = await supabaseAdmin
              .from(tableName)
              .select('restaurant_id')
              .eq('id', targetId)
              .maybeSingle();

            if (error) {
              return res.status(500).json({ error: `Ownership check error: ${error.message}` });
            }

            if (data) {
              const resourceRestId = (data as any).restaurant_id || (data as any).restaurantId;
              if (resourceRestId && resourceRestId !== userRestId) {
                console.error(`[OWNERSHIP VIOLATION] ${user.email} tried accessing/modifying ${tableName} ID ${targetId} which belongs to restaurant ${resourceRestId} (User belongs to: ${userRestId})`);
                return res.status(403).json({ error: "Forbidden: You do not own this resource level object." });
              }
            }
          }
        } catch (err: any) {
          console.error(`[OWNERSHIP ABORT] Res ${targetId} matching ${tableName}:`, err);
          return res.status(500).json({ error: "Internal resource ownership evaluation error" });
        }
      }
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
    if (user.platform_role === 'superadmin') {
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

  if (user.platform_role !== 'superadmin') {
    console.warn(`[SECURITY WARN] Blocked Express superadmin gateway access for: ${user.email}`);
    return res.status(403).json({ error: "Forbidden: Superadmin authorization required" });
  }

  next();
};
