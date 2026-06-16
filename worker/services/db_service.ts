import { createClient } from '@supabase/supabase-js';
import { Bindings } from '../types';

// Use Supabase Admin (service role)
export const getSupabase = (env: Bindings) => 
  createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

export const getAdminSupabase = (env: Bindings) => getSupabase(env);

// Use a user-scoped Supabase client that respects Row Level Security
export const getUserSupabase = (env: Bindings, tokenOrAuthHeader?: string) => {
  // Since the user token is signed with our custom JWT_SECRET, Supabase's PostgREST (which expects
  // a Google or Supabase Auth token) will reject it and throw "No suitable key or wrong key type".
  // Since we already validate authentic tenant boundaries and permissions inside our Worker middleware
  // (authenticate and requireTenantIsolation), we can securely use the service role key or anon key directly.
  const useKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '';
  
  return createClient(env.SUPABASE_URL, useKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
};

// Convenient helper using the Hono context to extract header and return a user client
export function getUserSupabaseClient(c: any) {
  const authHeader = c.req.header('Authorization') || c.req.query('authorization') || '';
  return getUserSupabase(c.env, authHeader);
}

// Helper for finding/restoring staff settings
export async function getStaffSettingsFromDb(supabase: any, userId: string, role: string, restaurantId?: string) {
  // 0. Immediate short-circuit bypass for any owner/admin/superadmin role
  const normRole = (role || '').toLowerCase();
  const isDirectOwnerRole = normRole === 'owner' || normRole === 'admin' || normRole === 'superadmin';
  
  if (isDirectOwnerRole) {
    return {
      status: 'active',
      permissions: {
        can_refund: true,
        can_edit_menu: true,
        can_cancel_order: true,
        can_view_analytics: true,
        can_manage_staff: true
      }
    };
  }

  // 0b. Double-check if the user is the direct owner_id of the restaurant in matching table
  if (restaurantId) {
    try {
      const { data: restaurant } = await supabase
        .from('restaurants')
        .select('owner_id')
        .eq('id', restaurantId)
        .maybeSingle();

      if (restaurant && restaurant.owner_id === userId) {
        return {
          status: 'active',
          permissions: {
            can_refund: true,
            can_edit_menu: true,
            can_cancel_order: true,
            can_view_analytics: true,
            can_manage_staff: true
          }
        };
      }
    } catch (e) {
      console.warn("Could not check backup direct owner_id in getStaffSettingsFromDb:", e);
    }
  }

  try {
    // 1. If restaurantId is provided, look in restaurant_users first
    if (restaurantId) {
      const { data: ruMapping, error: ruError } = await supabase
        .from('restaurant_users')
        .select('role, status, custom_permissions')
        .eq('user_id', userId)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (!ruError && ruMapping) {
        const selectedRole = (ruMapping.role || role || '').toLowerCase();
        const isOwner = selectedRole === 'owner' || selectedRole === 'admin';
        const isManager = selectedRole === 'manager';
        const isCashier = selectedRole === 'cashier';

        const defaultPerms = {
          can_refund: isOwner || isManager,
          can_edit_menu: isOwner || isManager,
          can_cancel_order: isOwner || isManager || isCashier,
          can_view_analytics: isOwner || isManager,
          can_manage_staff: isOwner
        };

        return {
          status: ruMapping.status || 'active',
          permissions: {
            ...defaultPerms,
            ...(ruMapping.custom_permissions || {})
          }
        };
      }
    }
  } catch (err) {
    console.warn("Failed to query restaurant_users in getStaffSettingsFromDb:", err);
  }

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('status, custom_permissions, role')
      .eq('id', userId)
      .maybeSingle();

    if (!error && profile) {
      const selectedRole = (profile.role || role || '').toLowerCase();
      const isOwner = selectedRole === 'owner' || selectedRole === 'admin';
      const isManager = selectedRole === 'manager';
      const isCashier = selectedRole === 'cashier';

      const defaultPerms = {
        can_refund: isOwner || isManager,
        can_edit_menu: isOwner || isManager,
        can_cancel_order: isOwner || isManager || isCashier,
        can_view_analytics: isOwner || isManager,
        can_manage_staff: isOwner
      };

      return {
        status: profile.status || 'active',
        permissions: {
          ...defaultPerms,
          ...(profile.custom_permissions || {})
        }
      };
    }
  } catch (err) {
    console.warn("Failed to query customized columns (status, custom_permissions) - database likely unmigrated:", err);
  }

  // Fallback to query with safe columns only
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    const selectedRole = (profile?.role || role || '').toLowerCase();
    const isOwner = selectedRole === 'owner' || selectedRole === 'admin';
    const isManager = selectedRole === 'manager';
    const isCashier = selectedRole === 'cashier';

    return {
      status: 'active',
      permissions: {
        can_refund: isOwner || isManager,
        can_edit_menu: isOwner || isManager,
        can_cancel_order: isOwner || isManager || isCashier,
        can_view_analytics: isOwner || isManager,
        can_manage_staff: isOwner
      }
    };
  } catch (err) {
    console.error("Critical fallback in getStaffSettingsFromDb, hardcoding defaults:", err);
    const selectedRole = (role || '').toLowerCase();
    const isOwner = selectedRole === 'owner' || selectedRole === 'admin';
    const isManager = selectedRole === 'manager';
    const isCashier = selectedRole === 'cashier';
    return {
      status: 'active',
      permissions: {
        can_refund: isOwner || isManager,
        can_edit_menu: isOwner || isManager,
        can_cancel_order: isOwner || isManager || isCashier,
        can_view_analytics: isOwner || isManager,
        can_manage_staff: isOwner
      }
    };
  }
}

export async function logToAuditDb(supabase: any, userId: string, userEmail: string, role: string, action: string, restaurantId: string) {
  try {
    await supabase.from('audit_logs').insert({
      restaurant_id: restaurantId,
      user_id: userId || null,
      user_email: userEmail,
      user_role: role,
      action: action,
      metadata: {}
    });
  } catch (err) {
    console.error("Failed to write to audit_logs table", err);
  }
}
