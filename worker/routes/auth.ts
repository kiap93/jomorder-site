import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { getSupabase, getStaffSettingsFromDb } from '../services/db_service';
import { getOrganizationSettings } from '../services/tenant_service';
import { signJWT, verifyGoogleToken } from '../auth/jwt';
import { authenticate } from '../middleware/auth';
import { LoginSchema, RegisterSchema } from '../../src/lib/validation';

const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Login
authRoutes.post('/api/login', async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }
  const { email, password } = parsed.data;
  const envAdminEmail = c.env.ADMIN_USER_EMAIL;
  const envAdminPass = c.env.ADMIN_USER_PASSWORD;

  // Check for configuration values OR fallback to dev-friendly standard superadmin details
  const isAdminEnvMatch = envAdminEmail && email === envAdminEmail && password === envAdminPass;
  const isDevAdminMatch = (email === "admin@saas.com" && password === "admin123") || 
                         (email === "test@example.com" && password === "password123") ||
                         (email && email.toLowerCase() === "kiap93.kmj@gmail.com" && password === "admin123");

  if (isAdminEnvMatch || isDevAdminMatch) {
    let { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (!profile) {
      const newAdminId = crypto.randomUUID();
      const { data: inserted, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: newAdminId,
          email: email,
          role: 'admin',
          status: 'active'
        })
        .select()
        .single();
      
      if (!insertError && inserted) {
        profile = inserted;
      } else {
        profile = {
          id: newAdminId,
          email: email,
          role: 'admin',
          status: 'active'
        };
      }
    }

    const enrichedUser = {
      id: profile.id,
      email: profile.email,
      role: profile.role || 'admin',
      platform_role: 'superadmin',
      is_platform_admin: true,
      restaurantId: profile.restaurant_id || null,
      status: 'active',
      permissions: {
        can_refund: true,
        can_edit_menu: true,
        can_cancel_order: true,
        can_view_analytics: true,
        can_manage_staff: true
      }
    };

    const token = await signJWT(enrichedUser, c.env.JWT_SECRET);
    return c.json({ token, user: enrichedUser });
  }

  try {
    const { data: authData } = await supabase.auth.signInWithPassword({ email, password });

    if (authData?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authData.user.id)
        .maybeSingle();
      
      if (profile) {
        if (profile.status === 'suspended') {
          return c.json({ error: 'Your staff account has been suspended by the administrator.' }, 403);
        }
        
        const settings = await getStaffSettingsFromDb(supabase, profile.id, profile.role, profile.restaurant_id);
        const enrichedUser = {
          id: profile.id, 
          email: profile.email, 
          role: profile.role,
          restaurantId: profile.restaurant_id,
          status: settings.status,
          permissions: settings.permissions
        };

        const token = await signJWT(enrichedUser, c.env.JWT_SECRET);
        return c.json({ token, user: enrichedUser });
      }
    }

    return c.json({ error: 'Invalid credentials' }, 401);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Register
authRoutes.post('/api/register', async (c) => {
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0].message }, 400);
  }
  const { email, password } = parsed.data;

  try {
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) return c.json({ error: authError.message }, 400);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authUser.user.id,
        email: email,
        role: 'staff',
      })
      .select()
      .single();

    if (profileError) {
      await supabase.auth.admin.deleteUser(authUser.user.id);
      return c.json({ error: profileError.message }, 500);
    }

    const token = await signJWT({ 
      id: profile.id, 
      email: profile.email, 
      role: profile.role,
      restaurantId: profile.restaurant_id 
    }, c.env.JWT_SECRET);

    return c.json({ token, user: profile });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Google login
authRoutes.post('/api/google-login', async (c) => {
  const supabase = getSupabase(c.env);
  const { idToken } = await c.req.json();
  const clientId = c.env.GOOGLE_CLIENT_ID;

  if (!idToken) return c.json({ error: 'Missing token' }, 400);

  const payload = await verifyGoogleToken(idToken, clientId);
  if (!payload || !payload.email) {
    return c.json({ error: 'Google authentication failed' }, 401);
  }

  const email = payload.email as string;
  let userPayload: any = null;

  const isAdminEmail = (c.env.ADMIN_USER_EMAIL && email === c.env.ADMIN_USER_EMAIL) || 
                       email === "admin@saas.com" || 
                       email === "test@example.com" || 
                       (email && email.toLowerCase() === "kiap93.kmj@gmail.com");

  if (isAdminEmail) {
    let { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (!profile) {
      const newAdminId = crypto.randomUUID();
      const { data: inserted, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: newAdminId,
          email: email,
          role: 'admin',
          status: 'active'
        })
        .select()
        .single();
      
      if (!insertError && inserted) {
        profile = inserted;
      } else {
        profile = {
          id: newAdminId,
          email: email,
          role: 'admin',
          status: 'active'
        };
      }
    }

    userPayload = {
      id: profile.id,
      email: profile.email,
      role: profile.role || 'admin',
      platform_role: 'superadmin',
      is_platform_admin: true,
      restaurantId: profile.restaurant_id || null,
      status: 'active',
      permissions: {
        can_refund: true,
        can_edit_menu: true,
        can_cancel_order: true,
        can_view_analytics: true,
        can_manage_staff: true
      }
    };
  } else {
    let { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (!profile) {
      // Auto-register google user
      let authUserId: string | null = null;
      try {
        const { data: usersList } = await supabase.auth.admin.listUsers();
        const existingAuthUser = usersList?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());

        if (existingAuthUser) {
          authUserId = existingAuthUser.id;
        } else {
          const dummyPassword = crypto.randomUUID();
          const { data: newAuth, error: createError } = await supabase.auth.admin.createUser({
            email,
            password: dummyPassword,
            email_confirm: true
          });

          if (createError) throw createError;
          if (newAuth?.user) {
            authUserId = newAuth.user.id;
          }
        }

        if (authUserId) {
          const { data: newProfile, error: profileError } = await supabase
            .from('profiles')
            .insert({
              id: authUserId,
              email: email,
              role: 'staff',
            })
            .select()
            .single();

          if (profileError) throw profileError;
          profile = newProfile;
        }
      } catch (err: any) {
        console.error("Auto-registration failed:", err);
      }
    }

    if (profile) {
      if (profile.status === 'suspended') {
        return c.json({ error: 'Your staff account has been suspended by the administrator.' }, 403);
      }
      
      const settings = await getStaffSettingsFromDb(supabase, profile.id, profile.role, profile.restaurant_id);
      userPayload = {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        restaurantId: profile.restaurant_id,
        status: settings.status,
        permissions: settings.permissions
      };
    }
  }

  if (!userPayload) {
    return c.json({ error: 'User not authorized' }, 403);
  }

  const token = await signJWT(userPayload, c.env.JWT_SECRET);
  return c.json({ token, user: userPayload });
});

// GET /api/me
authRoutes.get('/api/me', authenticate, async (c) => {
  const user = c.get('user');
  if (user && user.is_platform_admin !== true) {
    const supabase = getSupabase(c.env);
    const settings = await getStaffSettingsFromDb(supabase, user.id, user.role, user.restaurantId);
    if (settings.status === 'suspended') {
      return c.json({ error: "Your staff account has been suspended by the administrator." }, 403);
    }
    return c.json({
      ...user,
      status: settings.status,
      permissions: settings.permissions
    });
  }
  return c.json(user);
});

// GET /api/my-workspaces
authRoutes.get('/api/my-workspaces', authenticate, async (c) => {
  const user = c.get('user');
  const supabase = getSupabase(c.env);

  if (user.is_platform_admin === true) {
    try {
      const { data: orgs } = await supabase.from('organizations').select('*');
      const { data: rests } = await supabase.from('restaurants').select('*');
      return c.json({
        organizations: orgs || [],
        restaurants: (rests || []).map((r: any) => ({
          ...r,
          role: 'admin',
          status: 'active',
          permissions: {
            can_refund: true,
            can_edit_menu: true,
            can_cancel_order: true,
            can_view_analytics: true,
            can_manage_staff: true
          }
        }))
      });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  try {
    const { data: mappedUsers, error: mappedError } = await supabase
      .from('restaurant_users')
      .select('restaurant_id, role, status, custom_permissions, restaurants:restaurant_id(*)')
      .eq('user_id', user.id);

    const { data: profile } = await supabase
      .from('profiles')
      .select('restaurant_id, role, status, custom_permissions, restaurants:restaurant_id(*)')
      .eq('id', user.id)
      .maybeSingle();

    const workspacesMap = new Map();

    if (mappedUsers) {
      for (const m of mappedUsers) {
        if (m.restaurants) {
          workspacesMap.set(m.restaurant_id, {
            ...m.restaurants,
            role: m.role,
            status: m.status,
            permissions: m.custom_permissions || {}
          });
        }
      }
    }

    if (profile && profile.restaurant_id && profile.restaurants) {
      if (!workspacesMap.has(profile.restaurant_id)) {
        workspacesMap.set(profile.restaurant_id, {
          ...profile.restaurants,
          role: profile.role,
          status: profile.status || 'active',
          permissions: profile.custom_permissions || {}
        });
      }
    }

    const restaurantsList = Array.from(workspacesMap.values());
    const orgIds = restaurantsList.map((r: any) => r.organization_id).filter(Boolean);
    
    // Also fetch organizations the user belongs to directly from organization_users
    let userDirectOrgIds: any[] = [];
    try {
      const { data: directMemberships } = await supabase
        .from('organization_users')
        .select('organization_id')
        .eq('user_id', user.id);
      if (directMemberships) {
        userDirectOrgIds = directMemberships.map((m: any) => m.organization_id);
      }
    } catch (mErr) {
      console.warn("Could not query organization_users table (may not exist or permission issues):", mErr);
    }

    const allOrgIds = Array.from(new Set([...orgIds, ...userDirectOrgIds]));
    let organizationsList: any[] = [];
    if (allOrgIds.length > 0) {
      const { data: orgs } = await supabase
        .from('organizations')
        .select('*')
        .in('id', allOrgIds);
      if (orgs) {
        organizationsList = orgs;
      }
    }

    const enrichedOrgs = await Promise.all(organizationsList.map(async (org: any) => {
      const settings = await getOrganizationSettings(supabase, org.id);
      return {
        ...org,
        max_outlets: settings.max_outlets,
        multi_outlet_enabled: settings.multi_outlet_enabled,
        subscription_plan: settings.subscription_plan
      };
    }));

    return c.json({
      organizations: enrichedOrgs,
      restaurants: restaurantsList
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// POST /api/switch-workspace/:restaurantId
authRoutes.post('/api/switch-workspace/:restaurantId', authenticate, async (c) => {
  const user = c.get('user');
  const restaurantId = c.req.param('restaurantId');
  const supabase = getSupabase(c.env);

  if (user.is_platform_admin === true) {
    try {
      const { data: r } = await supabase.from('restaurants').select('*').eq('id', restaurantId).maybeSingle();
      if (!r) return c.json({ error: "Restaurant not found." }, 404);
      const guestPay = {
        id: user.id,
        email: user.email,
        role: 'admin',
        platform_role: 'superadmin',
        is_platform_admin: true,
        restaurantId: r.id
      };
      const token = await signJWT(guestPay, c.env.JWT_SECRET);
      return c.json({ token, user: guestPay });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  }

  try {
    let role = '';
    let status = 'active';
    let customPerms: any = {};

    const { data: mapping } = await supabase
      .from('restaurant_users')
      .select('*')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();

    if (mapping) {
      role = mapping.role;
      status = mapping.status;
      customPerms = mapping.custom_permissions;
    } else {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (profile) {
        role = profile.role;
        status = profile.status || 'active';
        customPerms = profile.custom_permissions;
      } else {
        return c.json({ error: "Forbidden: You do not have access to this workspace." }, 403);
      }
    }

    if (status === 'suspended') {
      return c.json({ error: "Your account is suspended in this workspace." }, 403);
    }

    const isOwner = role === 'owner' || role === 'admin' || role === 'OWNER';
    const isManager = role === 'manager' || role === 'MANAGER';
    const isCashier = role === 'cashier' || role === 'CASHIER';

    const permissions = {
      can_refund: isOwner || isManager,
      can_edit_menu: isOwner || isManager,
      can_cancel_order: isOwner || isManager || isCashier,
      can_view_analytics: isOwner || isManager,
      can_manage_staff: isOwner,
      ...(customPerms || {})
    };

    const enriched = {
      id: user.id,
      email: user.email,
      role: role,
      restaurantId: restaurantId,
      status: status,
      permissions: permissions
    };

    const token = await signJWT(enriched, c.env.JWT_SECRET);
    return c.json({ token, user: enriched });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// PATCH /api/organizations/:id
authRoutes.patch('/api/organizations/:id', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { name, company_register_number } = await c.req.json();
  const supabase = getSupabase(c.env);

  try {
    if (user.is_platform_admin !== true) {
      const { data: member, error: memberErr } = await supabase
        .from('organization_users')
        .select('*')
        .eq('organization_id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!member || (member.role !== 'owner' && member.role !== 'manager')) {
        return c.json({ error: "Forbidden: You do not have owner/manager access to this organization." }, 403);
      }
    }

    const updatePayload: any = { name };
    if (company_register_number !== undefined) {
      updatePayload.company_register_number = company_register_number;
    }

    const { data: updatedOrg, error: updateErr } = await supabase
      .from('organizations')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (updateErr) {
      // Dynamic fallback if column doesn't exist
      if (updateErr.code === '42703' || (updateErr.message && updateErr.message.includes('column') && updateErr.message.includes('does not exist'))) {
        console.warn(`company_register_number column doesn't exist yet, updating name only.`);
        const { data: updatedOrg2, error: updateErr2 } = await supabase
          .from('organizations')
          .update({ name })
          .eq('id', id)
          .select()
          .maybeSingle();

        if (updateErr2) throw updateErr2;
        return c.json({ 
          ...updatedOrg2, 
          company_register_number, // local value passed back
          warn: "Column company_register_number missing. Please execute: ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS company_register_number TEXT;"
        });
      }
      return c.json({ error: updateErr.message }, 500);
    }

    return c.json(updatedOrg);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// POST /api/onboarding/create-org-workspace
authRoutes.post('/api/onboarding/create-org-workspace', authenticate, async (c) => {
  const user = c.get('user');
  const dbUserId = user.id;
  const { orgName, workspaceName, orgId: reqOrgId } = await c.req.json();
  const supabase = getSupabase(c.env);

  if (!workspaceName) {
    return c.json({ error: "Workspace (Restaurant) name is required." }, 400);
  }

  try {
    let orgId = reqOrgId || null;

    if (!orgId && orgName && orgName.trim()) {
      const { data: org, error: orgErr } = await supabase
        .from('organizations')
        .insert({ name: orgName.trim() })
        .select()
        .single();
      
      if (orgErr) throw orgErr;
      orgId = org.id;

      await supabase.from('organization_users').insert({
        organization_id: orgId,
        user_id: dbUserId,
        role: 'owner'
      });
    }

    let insertData: any = {
      name: workspaceName.trim(),
      currency: 'MYR',
      service_charge: 6.0,
      sst: 10.0,
      owner_id: dbUserId
    };

    if (orgId) {
      insertData.organization_id = orgId;

      // BUSINESS RULE / SAAS CAPABILITY LIMIT CHECK
      const settings = await getOrganizationSettings(supabase, orgId);

      if (settings.status === 'suspended') {
        return c.json({
          error: "Capability Restriction: This organization has been suspended. Additional branch creation or configuration updates are blocked. Please contact platform superadmin."
        }, 403);
      }

      // Count existing physical outlets (restaurants) linked to this organization
      const { count: existingCount, error: countErr } = await supabase
        .from('restaurants')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId);

      if (countErr) {
        console.warn("[Capability Check] Failed to query branch count:", countErr.message);
      }

      const branchCount = existingCount || 0;

      if (branchCount >= settings.max_outlets) {
        return c.json({
          error: `Capability Restriction: Your organization has reached the maximum threshold of ${settings.max_outlets} branch outlets allowed under your current ${settings.subscription_plan?.toUpperCase()} plan. Please upgrade your business plan to provision more outlets.`
        }, 403);
      }

      if (branchCount >= 1 && !settings.multi_outlet_enabled) {
        return c.json({
          error: `Capability Restriction: Multiple branch creation is restricted. Your current ${settings.subscription_plan?.toUpperCase()} plan only permits a single operational outlet. Please upgrade to Pro or Enterprise.`
        }, 403);
      }
    }

    let restaurant;
    let restErr;

    const attempt1 = await supabase
      .from('restaurants')
      .insert(insertData)
      .select()
      .single();

    if (attempt1.error) {
      if (insertData.organization_id) {
        delete insertData.organization_id;
        const attempt2 = await supabase
          .from('restaurants')
          .insert(insertData)
          .select()
          .single();
        
        if (attempt2.error) {
          restErr = attempt2.error;
        } else {
          restaurant = attempt2.data;
        }
      } else {
        restErr = attempt1.error;
      }
    } else {
      restaurant = attempt1.data;
    }

    if (restErr) throw restErr;

    await supabase
      .from('profiles')
      .upsert({
        id: dbUserId,
        email: user.email,
        restaurant_id: restaurant.id,
        role: 'owner',
        updated_at: new Date().toISOString()
      });

    try {
      await supabase.from('restaurant_users').insert({
        restaurant_id: restaurant.id,
        user_id: dbUserId,
        role: 'owner',
        status: 'active',
        custom_permissions: {
          can_refund: true,
          can_edit_menu: true,
          can_cancel_order: true,
          can_view_analytics: true,
          can_manage_staff: true
        }
      });
    } catch (mErr) {
      console.warn("Could not insert to restaurant_users - table may not be migrated yet:", mErr);
    }

    const enriched = {
      id: user.id,
      email: user.email,
      role: 'owner',
      restaurantId: restaurant.id,
      status: 'active',
      permissions: {
        can_refund: true,
        can_edit_menu: true,
        can_cancel_order: true,
        can_view_analytics: true,
        can_manage_staff: true
      }
    };

    const token = await signJWT(enriched, c.env.JWT_SECRET);
    return c.json({ token, user: enriched });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default authRoutes;
