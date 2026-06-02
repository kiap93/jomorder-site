/**
 * Fine-grained Role-Based Access Control (RBAC) definitions and resolver helpers.
 * Fully type-safe and offline-friendly.
 */

export type UserRole =
  | 'superadmin'
  | 'owner'
  | 'manager'
  | 'cashier'
  | 'waiter'
  | 'kitchen'
  | 'runner'
  | 'admin';

export type PermissionCode =
  | 'orders.view'
  | 'kitchen.view'
  | 'orders.prepare'
  | 'orders.bump'
  | 'orders.ready'
  | 'payments.view'
  | 'payments.refund'
  | 'reports.view'
  | 'users.manage'
  | 'settings.manage';

export interface Permission {
  code: PermissionCode;
  description: string;
}

export interface Role {
  name: UserRole;
  description: string;
  permissions: PermissionCode[];
}

export interface UserSession {
  id: string;
  email: string;
  role: UserRole;
  restaurantId: string;
  platform_role?: string | null;
  organizationId?: string | null;
}

export interface WorkspaceMembership {
  id: string;
  email: string;
  role: UserRole;
  restaurantId: string;
  status: 'active' | 'suspended';
  created_at?: string;
  user_id?: string;
}

// Client-side static definitions mapping roles to absolute default permission codes
export const ROLE_PERMISSIONS: Record<string, PermissionCode[]> = {
  super_admin: [
    'orders.view', 'kitchen.view', 'orders.prepare', 'orders.bump', 'orders.ready',
    'payments.view', 'payments.refund', 'reports.view', 'users.manage', 'settings.manage'
  ],
  superadmin: [
    'orders.view', 'kitchen.view', 'orders.prepare', 'orders.bump', 'orders.ready',
    'payments.view', 'payments.refund', 'reports.view', 'users.manage', 'settings.manage'
  ],
  owner: [
    'orders.view', 'kitchen.view', 'orders.prepare', 'orders.bump', 'orders.ready',
    'payments.view', 'payments.refund', 'reports.view', 'users.manage', 'settings.manage'
  ],
  admin: [
    'orders.view', 'kitchen.view', 'orders.prepare', 'orders.bump', 'orders.ready',
    'payments.view', 'payments.refund', 'reports.view', 'users.manage', 'settings.manage'
  ],
  manager: [
    'orders.view', 'kitchen.view', 'orders.prepare', 'orders.bump', 'orders.ready',
    'payments.view', 'payments.refund', 'reports.view', 'users.manage', 'settings.manage'
  ],
  cashier: [
    'orders.view', 'orders.bump', 'orders.ready', 'payments.view'
  ],
  waiter: [
    'orders.view', 'orders.bump', 'orders.ready'
  ],
  kitchen: [
    'kitchen.view', 'orders.prepare', 'orders.bump', 'orders.ready'
  ],
  runner: [
    'orders.view', 'orders.bump', 'orders.ready'
  ]
};

/**
 * Checks if a user has a specific permission based on their role and custom overrides.
 * High resiliency: handles both camelCase / UPPERCASE role variations.
 */
export function hasPermission(
  role: string | undefined | null,
  permission: PermissionCode,
  customPermissions?: Record<string, boolean> | null
): boolean {
  if (!role) return false;

  const normalizedRole = role.toLowerCase().replace('_', '') as string;
  
  // Platform Super Admins have absolute global bypass
  if (normalizedRole === 'superadmin') {
    return true;
  }

  // Handle explicit custom overrides if present in tenant registry or profiles
  if (customPermissions) {
    // Translate standard permission code to custom permissions JSON key if applicable
    if (permission === 'payments.refund' && customPermissions.can_refund !== undefined) {
      return !!customPermissions.can_refund;
    }
    if (permission === 'settings.manage' && customPermissions.can_edit_menu !== undefined) {
      return !!customPermissions.can_edit_menu;
    }
    if (permission === 'reports.view' && customPermissions.can_view_analytics !== undefined) {
      return !!customPermissions.can_view_analytics;
    }
    if (permission === 'users.manage' && customPermissions.can_manage_staff !== undefined) {
      return !!customPermissions.can_manage_staff;
    }
    if (permission === 'orders.bump' && customPermissions.can_cancel_order !== undefined) {
      // Bumping is allowed; cancellers possess extra power but bumping is basic
      return true;
    }
  }

  const roleMapKey = role.toLowerCase();
  const permissions = ROLE_PERMISSIONS[roleMapKey] || [];
  
  return permissions.includes(permission);
}
