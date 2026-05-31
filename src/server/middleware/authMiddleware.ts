import express from "express";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../services/dbService";
import { getStaffSettingsFromDb, logToAuditDb } from "../../../worker/services/db_service";
import { hasPermission, PermissionCode } from "../../lib/rbac";

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

    let userRestId: string | null = null;
    let allowedRestaurantIds: string[] = [];

    try {
      // Real-time Database Membership Lookup to resolve authentic tenant/organization boundaries
      const [profileResult, permissionsResult] = await Promise.all([
        supabaseAdmin
          .from('profiles')
          .select('restaurant_id, status')
          .eq('id', user.id)
          .maybeSingle(),
        supabaseAdmin
          .from('restaurant_users')
          .select('restaurant_id, status')
          .eq('user_id', user.id)
      ]);

      if (profileResult.data) {
        const p = profileResult.data;
        if (p.status === 'suspended') {
          return res.status(403).json({ error: "Forbidden: Your profile has been suspended." });
        }
        if (p.restaurant_id) {
          allowedRestaurantIds.push(p.restaurant_id);
          userRestId = p.restaurant_id; // Default primary candidate
        }
      }

      if (permissionsResult.data && permissionsResult.data.length > 0) {
        for (const membership of permissionsResult.data) {
          if (membership.status !== 'suspended' && membership.restaurant_id) {
            allowedRestaurantIds.push(membership.restaurant_id);
            if (!userRestId) {
              userRestId = membership.restaurant_id; // Fallback candidate
            }
          }
        }
      }

      // De-duplicate the array of permitted restaurant IDs
      allowedRestaurantIds = Array.from(new Set(allowedRestaurantIds));

    } catch (err: any) {
      console.error("[TenantIsolation] Real-time database membership lookup failed:", err);
      return res.status(500).json({ error: "Internal security constraint error: Failed to verify multi-tenant membership." });
    }

    if (allowedRestaurantIds.length === 0 || !userRestId) {
      return res.status(403).json({ error: "Forbidden: No authorized restaurant/tenant context coordinates matched. Membership invalid." });
    }

    // Determine targeted workspace context from request params, query, or body
    const requestedWorkspaceId = req.params[paramName] || req.params.restId || req.params.restaurantId || req.query.restaurantId || req.query.restaurant_id || req.query.restId || (req.body && (req.body.restaurantId || req.body.restaurant_id || req.body.restId));

    if (requestedWorkspaceId) {
      if (allowedRestaurantIds.includes(requestedWorkspaceId)) {
        userRestId = requestedWorkspaceId;
      } else {
        console.error(`[CROSS-TENANT VIOLATION] Express Blocked: User ${user.email} (id: ${user.id}) tried accessing unauthorized workspace context: ${requestedWorkspaceId}`);
        try {
          await logToAuditDb(supabaseAdmin, user.id, user.email, user.role, `BLOCKED: Unauthorized cross-tenant attempt to access ${requestedWorkspaceId}`, userRestId);
        } catch (_) {}
        return res.status(403).json({ error: "Forbidden: Multi-tenant isolation violation. You do not hold permissions for this workspace." });
      }
    }

    // Force Overriding & Sanitization: strictly overwrite all user-facing payload entries using the derived verified database ID.
    // We NEVER trust raw values passed in body or queries from the client.
    if (req.body) {
      req.body.restaurantId = userRestId;
      req.body.restaurant_id = userRestId;
      req.body.restId = userRestId;
    }
    if (req.query) {
      req.query.restaurantId = userRestId as string;
      req.query.restaurant_id = userRestId as string;
      req.query.restId = userRestId as string;
    }

    // 2. Validate URL Params to prevent crossed references
    const targetedRestId = req.params[paramName] || req.params.restId || req.params.restaurantId;

    if (targetedRestId && targetedRestId !== userRestId) {
      console.error(`[CROSS-TENANT VIOLATION] Express Block: ${user.email} tried crossing into restaurant: ${targetedRestId} (User bound to parent tenant: ${userRestId})`);
      try {
        await logToAuditDb(supabaseAdmin, user.id, user.email, user.role, `BLOCKED: Express cross-tenant attempt to access ${targetedRestId}`, userRestId as string);
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

/**
 * 5. Production-Grade Reusable Permission Protection Middleware
 * Restricts access to API routes by matching user credentials and dynamic JSON overrides
 * against specific target permission codes, respecting restaurant/tenant isolation boundaries.
 */
export const requirePermissions = (...requiredPermissions: PermissionCode[]) => {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized: User session details not found." });
    }

    // Platform Super Admins hold absolute bypass
    if (user.platform_role === 'superadmin' || user.is_platform_admin === true) {
      next();
      return;
    }

    try {
      // Resolve targeted restId/restaurantId parameter to validate boundary isolation
      const restId = req.params.restId || req.params.restaurantId || req.query.restaurantId || req.query.restaurant_id || req.query.restId || (req.body && (req.body.restaurantId || req.body.restaurant_id || req.body.restId)) || user.restaurantId;

      if (!restId) {
        return res.status(400).json({ error: "Bad Request: Missing restaurant identifier mapping in context." });
      }

      // Read dynamic staff registry/custom profiles permissions configuration from the persistent cache
      const settings = await getStaffSettingsFromDb(supabaseAdmin, user.id, user.role, restId);
      
      if (settings.status === 'suspended') {
        return res.status(403).json({ error: "Forbidden: Your staff account has been suspended." });
      }

      const customPermissions = settings.permissions || {};
      const userRole = user.role;

      // Type-safe matching of every required permission
      const isAuthorized = requiredPermissions.every(perm => 
        hasPermission(userRole, perm, customPermissions)
      );

      if (!isAuthorized) {
        console.warn(`[API ACCESS DENIED] User: ${user.email} | Role: ${userRole} | Lacks: ${requiredPermissions.join(', ')} on Tenant: ${restId}`);
        return res.status(403).json({
          error: `Forbidden: Lacking required capabilities: ${requiredPermissions.join(', ')}`
        });
      }

      next();
    } catch (err: any) {
      console.error(`[API RBAC EXCEPTION] Failed to verify system user permissions:`, err);
      return res.status(500).json({ error: "Internal security constraints failed to match RBAC state properties." });
    }
  };
};

/**
 * 6. Or-Based Permission Protection Middleware
 * Restricts access to API routes by matching user credentials and dynamic JSON overrides
 * against any option from target permission codes, respecting restaurant/tenant isolation boundaries.
 */
export const requireAnyPermission = (...allowedPermissions: PermissionCode[]) => {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: "Unauthorized: User session details not found." });
    }

    // Platform Super Admins hold absolute bypass
    if (user.platform_role === 'superadmin' || user.is_platform_admin === true) {
      next();
      return;
    }

    try {
      const restId = req.params.restId || req.params.restaurantId || req.query.restaurantId || req.query.restaurant_id || req.query.restId || (req.body && (req.body.restaurantId || req.body.restaurant_id || req.body.restId)) || user.restaurantId;

      if (!restId) {
        return res.status(400).json({ error: "Bad Request: Missing restaurant identifier mapping in context." });
      }

      const settings = await getStaffSettingsFromDb(supabaseAdmin, user.id, user.role, restId);
      
      if (settings.status === 'suspended') {
        return res.status(403).json({ error: "Forbidden: Your staff account has been suspended." });
      }

      const customPermissions = settings.permissions || {};
      const userRole = user.role;

      const isAuthorized = allowedPermissions.some(perm => 
        hasPermission(userRole, perm, customPermissions)
      );

      if (!isAuthorized) {
        console.warn(`[API ACCESS DENIED] User: ${user.email} | Role: ${userRole} | Lacks any of: ${allowedPermissions.join(', ')} on Tenant: ${restId}`);
        return res.status(403).json({
          error: `Forbidden: Lacking any of required capabilities: ${allowedPermissions.join(', ')}`
        });
      }

      next();
    } catch (err: any) {
      console.error(`[API RBAC EXCEPTION] Failed to verify system user permissions:`, err);
      return res.status(500).json({ error: "Internal security constraints failed to match RBAC state properties." });
    }
  };
};

