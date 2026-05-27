import { createClient } from '@supabase/supabase-js';
import { Bindings } from '../types';

// Use Supabase Admin (service role)
export const getSupabase = (env: Bindings) => 
  createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Helper for finding/restoring staff settings
export async function getStaffSettingsFromDb(supabase: any, userId: string, role: string, restaurantId?: string) {
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
        const selectedRole = ruMapping.role || role;
        const isOwner = selectedRole === 'owner' || selectedRole === 'admin' || selectedRole === 'OWNER';
        const isManager = selectedRole === 'manager' || selectedRole === 'MANAGER';
        const isCashier = selectedRole === 'cashier' || selectedRole === 'CASHIER';

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
      const selectedRole = profile.role || role;
      const isOwner = selectedRole === 'owner' || selectedRole === 'admin' || selectedRole === 'OWNER';
      const isManager = selectedRole === 'manager' || selectedRole === 'MANAGER';
      const isCashier = selectedRole === 'cashier' || selectedRole === 'CASHIER';

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

    const selectedRole = profile?.role || role;
    const isOwner = selectedRole === 'owner' || selectedRole === 'admin' || selectedRole === 'OWNER';
    const isManager = selectedRole === 'manager' || selectedRole === 'MANAGER';
    const isCashier = selectedRole === 'cashier' || selectedRole === 'CASHIER';

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
    const isOwner = role === 'owner' || role === 'admin' || role === 'OWNER';
    const isManager = role === 'manager' || role === 'MANAGER';
    const isCashier = role === 'cashier' || role === 'CASHIER';
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
