import { MiddlewareHandler } from 'hono';
import { verifyJWT } from '../auth/jwt';
import { Bindings, Variables } from '../types';
import { getSupabase, getStaffSettingsFromDb, logToAuditDb } from '../services/db_service';

/**
 * 1. Global Authentication Middleware
 * Validates JWT token and sets the user payload into the request context.
 */
export const authenticate: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const authHeader = c.req.header('Authorization') || c.req.query('authorization');
  let token = authHeader?.split(' ')[1];

  if (!token && authHeader) {
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = authHeader;
    }
  }

  if (!token) {
    console.warn(`[SECURITY] Authentication failed: No token provided for path ${c.req.path}`);
    return c.json({ error: 'Unauthorized: No token provided' }, 401);
  }

  try {
    const payload = await verifyJWT(token, c.env.JWT_SECRET) as any;
    if (!payload) {
      console.warn(`[SECURITY] Authentication failed: JWT verify returned null for token`);
      return c.json({ error: 'Unauthorized: Invalid or expired token' }, 401);
    }

    if (payload && payload.role && typeof payload.role === 'string') {
      payload.role = payload.role.toLowerCase();
    }

    c.set('user', payload);
    await next();
  } catch (err: any) {
    console.error(`[SECURITY] Crucial authentication error: ${err.message}`);
    return c.json({ error: 'Unauthorized: Authentication error' }, 401);
  }
};

/**
 * 2. Enterprise Tenant Isolation Middleware
 * Guarantees that a user cannot query elements outside their allocated workspace/restaurant.
 */
export const requireTenantIsolation = (paramName: string = 'restId'): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> => {
  return async (c, next) => {
    const user = c.get('user');
    const targetedRestId = c.req.param(paramName);

    if (!user) {
      return c.json({ error: 'Unauthorized: User session not found' }, 401);
    }

    // Direct Bypass for global Super Admins
    if (user.platform_role === 'superadmin') {
      await next();
      return;
    }

    const userRestId = user.restaurantId || user.restaurant_id;

    if (!targetedRestId || userRestId !== targetedRestId) {
      console.error(`[SECURITY WARNING] Tenant Bypass Attempted! User ${user.email} (Tenant: ${userRestId}) tried accessing Resource: ${targetedRestId}`);
      
      // Attempt database audit log write
      try {
        const supabase = getSupabase(c.env);
        await logToAuditDb(supabase, user.id, user.email, user.role, `BLOCKED: Unauthorized cross-tenant attempt to access ${targetedRestId}`, userRestId || 'unknown');
      } catch (logErr) {}

      return c.json({ error: 'Forbidden: Multi-tenant isolation violation. Access Denied.' }, 403);
    }

    await next();
  };
};

/**
 * 3. Granular Capability-Based Authorization Middleware
 * Verifies if the authenticated staff member holds the required permission/capability.
 */
export const requireCapability = (capability: string, restIdParam: string = 'restId'): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> => {
  return async (c, next) => {
    const user = c.get('user');
    const restId = c.req.param(restIdParam);
    const supabase = getSupabase(c.env);

    if (!user) {
      return c.json({ error: 'Unauthorized: User details missing' }, 401);
    }

    // Global Super Admin has all capabilities
    if (user.platform_role === 'superadmin') {
      await next();
      return;
    }

    try {
      // Load actual permissions directly from the database to avoid stale claims in JWT
      const settings = await getStaffSettingsFromDb(supabase, user.id, user.role, restId);
      
      if (settings.status === 'suspended') {
        return c.json({ error: 'Forbidden: Your staff account has been suspended.' }, 403);
      }

      const permissions: Record<string, boolean> = settings.permissions || {};
      
      // Standardize Capability String to mapped key names
      // Supported matrices:
      // 'staff:manage'     -> can_manage_staff
      // 'menu:write'       -> can_edit_menu
      // 'payments:refund'  -> can_refund
      // 'order:cancel'     -> can_cancel_order
      // 'analytics:read'   -> can_view_analytics
      let hasPerm = false;
      if (capability === 'staff:manage' && permissions.can_manage_staff) hasPerm = true;
      if (capability === 'menu:write' && permissions.can_edit_menu) hasPerm = true;
      if (capability === 'payments:refund' && permissions.can_refund) hasPerm = true;
      if (capability === 'order:cancel' && permissions.can_cancel_order) hasPerm = true;
      if (capability === 'analytics:read' && permissions.can_view_analytics) hasPerm = true;

      // Safe default mappings for general lookups
      if (!hasPerm) {
        // High level fallback roles checking
        const isOwnerOrManager = user.role === 'owner' || user.role === 'admin' || user.role === 'manager';
        const isCashier = user.role === 'cashier';
        const isKitchen = user.role === 'kitchen';

        if (capability === 'order:write') {
          hasPerm = true; // Everyone can generate/write orders in a workspace
        } else if (capability === 'order:view') {
          hasPerm = true; // All staff can inspect workspace orders
        } else if (capability === 'menu:view') {
          hasPerm = true; // All staff can view menus
        } else if (capability === 'staff:view' && (isOwnerOrManager || permissions.can_manage_staff)) {
          hasPerm = true;
        }
      }

      if (!hasPerm) {
        console.warn(`[SECURITY] Capability Denied: ${user.email} lacks capability "${capability}" on tenant ${restId}`);
        return c.json({ error: `Forbidden: Lacking granular capability "${capability}"` }, 403);
      }

      await next();
    } catch (err: any) {
      console.error(`[SECURITY ERROR] Checking capabilities failed: ${err.message}`);
      return c.json({ error: 'Internal RBAC authorization failure' }, 500);
    }
  };
};

/**
 * 4. Zero Hardcoded Superadmin Authorization Middleware
 * Resolves permissions purely through clean environment declarations or secure tokens.
 */
export const requireSuperAdmin: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized: Session missing' }, 401);
  }

  if (user.platform_role !== 'superadmin') {
    console.warn(`[SECURITY WARNING] Blocked unauthorized superadmin panel access by user: ${user.email}`);
    return c.json({ error: "Forbidden: Redundant Superadmin access denied." }, 403);
  }

  await next();
};
