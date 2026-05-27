import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { getSupabase, getStaffSettingsFromDb, logToAuditDb } from '../services/db_service';
import { authenticate } from '../middleware/auth';

const staffRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Staff Management - Listing staff
staffRoutes.get("/api/restaurants/:restId/staff", authenticate, async (c) => {
  const restId = c.req.param('restId');
  const caller = c.get('user');
  const supabase = getSupabase(c.env);

  if (caller.role !== 'admin' && caller.restaurantId !== restId && caller.restaurant_id !== restId) {
    return c.json({ error: "Forbidden: You do not have access to this restaurant's staff list." }, 403);
  }

  try {
    // 1. Get profiles directly mapped
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('restaurant_id', restId);

    if (error) throw error;

    // 2. Get restaurant_users mapping
    let rUsers: any[] = [];
    try {
      const { data } = await supabase
        .from('restaurant_users')
        .select('*')
        .eq('restaurant_id', restId);
      rUsers = data || [];
    } catch (e) {
      console.warn("Could not query restaurant_users in worker staff GET:", e);
    }

    // Get any profiles from rUsers
    let extraProfiles: any[] = [];
    const rUserIds = rUsers.map(ru => ru.user_id).filter(Boolean);
    if (rUserIds.length > 0) {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .in('id', rUserIds);
        extraProfiles = data || [];
      } catch (e) {
        console.warn("Could not load associated profiles:", e);
      }
    }

    const staffMap = new Map();

    // Overlay profiles
    if (profiles) {
      for (const p of profiles) {
        const settings = await getStaffSettingsFromDb(supabase, p.id, p.role, restId);
        staffMap.set(p.id, {
          id: p.id,
          email: p.email,
          role: p.role,
          restaurant_id: p.restaurant_id,
          status: settings.status,
          permissions: settings.permissions
        });
      }
    }

    for (const ru of rUsers) {
      const prof = extraProfiles.find(p => p.id === ru.user_id);
      if (prof) {
        const settings = await getStaffSettingsFromDb(supabase, ru.user_id, ru.role || prof.role, restId);
        staffMap.set(ru.user_id, {
          id: ru.user_id,
          email: prof.email,
          role: ru.role || prof.role,
          restaurant_id: restId,
          status: ru.status || settings.status,
          permissions: ru.custom_permissions || settings.permissions
        });
      }
    }

    return c.json(Array.from(staffMap.values()));
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Create staff member
staffRoutes.post("/api/restaurants/:restId/staff", authenticate, async (c) => {
  const restId = c.req.param('restId');
  const body = await c.req.json();
  const { email, password, role, permissions } = body;
  const caller = c.get('user');
  const supabase = getSupabase(c.env);

  const callerSettings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, restId);
  const isOwnerOrAdmin = caller.role === 'admin' || caller.role === 'owner' || caller.role === 'OWNER';
  const canManageStaff = isOwnerOrAdmin || (callerSettings?.permissions?.can_manage_staff === true);

  if (!canManageStaff) {
    return c.json({ error: "Forbidden: You do not have permissions to register staff accounts." }, 403);
  }

  if (!email || !password || !role) {
    return c.json({ error: "Email, password, and role are required." }, 400);
  }

  try {
    // 1. Check if profile already exists with this email (case-insensitive check)
    let existingProfile: any = null;
    const { data: matchedProf } = await supabase
      .from('profiles')
      .select('*')
      .ilike('email', email)
      .maybeSingle();

    if (matchedProf) {
      existingProfile = matchedProf;
    }

    if (!existingProfile) {
      try {
        const { data: usersList } = await supabase.auth.admin.listUsers();
        const existingAuthUser = usersList?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
        if (existingAuthUser) {
          // Yes, the user is already registered in Auth but was missing a profile mapping
          existingProfile = {
            id: existingAuthUser.id,
            email: existingAuthUser.email,
            role: role,
            restaurant_id: restId
          };

          // Auto-insert/upsert the missing profile
          try {
            const { data: upsertedProf } = await supabase
              .from('profiles')
              .upsert({
                id: existingAuthUser.id,
                email: existingAuthUser.email,
                role: role,
                restaurant_id: restId,
                status: 'active'
              })
              .select()
              .single();
            if (upsertedProf) {
              existingProfile = upsertedProf;
            }
          } catch (pe) {
            console.warn("Could not upsert profile for existing auth user:", pe);
          }
        }
      } catch (authLookError) {
        console.warn("Could not list auth users to check for existing email:", authLookError);
      }
    }

    if (existingProfile) {
      const userId = existingProfile.id;

      // Check if already mapped to this restaurant
      const inPrimary = existingProfile.restaurant_id === restId;
      let inLiveRU = false;
      try {
        const { data: ruMap } = await supabase
          .from('restaurant_users')
          .select('*')
          .eq('user_id', userId)
          .eq('restaurant_id', restId)
          .maybeSingle();
        if (ruMap) {
          inLiveRU = true;
        }
      } catch (err) {
        console.warn("Error querying restaurant_users:", err);
      }

      if (inPrimary || inLiveRU) {
        if (existingProfile.email?.toLowerCase() === caller.email?.toLowerCase()) {
          return c.json({ error: "You cannot add yourself (the logged-in administrator/owner) as a staff member. You already have full access. Please use a distinct/separate email address for each of your staff members." }, 400);
        }
        return c.json({ error: `The user with email "${email}" is already registered for this restaurant. If they are already listed below, you can edit their role or permissions directly using the Edit button.` }, 400);
      }

      // Map existing user
      const defaultSettings = await getStaffSettingsFromDb(supabase, userId, role, restId);

      try {
        await supabase
          .from('restaurant_users')
          .upsert({
            user_id: userId,
            restaurant_id: restId,
            role: role,
            status: 'active',
            custom_permissions: permissions || defaultSettings.permissions
          }, { onConflict: 'restaurant_id,user_id' });
      } catch (err) {
        console.warn("Could not insert mapping in live DB:", err);
      }

      await logToAuditDb(supabase, caller.id, caller.email, caller.role, `Mapped existing user ${email} to restaurant ${restId} as role: ${role}`, restId);

      return c.json({
        id: userId,
        email: email,
        role: role,
        restaurant_id: restId,
        status: 'active',
        permissions: permissions || defaultSettings.permissions
      }, 201);
    }

    // Creating completely new user
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) {
      return c.json({ error: authError.message }, 400);
    }

    if (!authUser.user) {
      return c.json({ error: "Failed to create authentication user." }, 500);
    }

    let profile: any = null;
    let profileError: any = null;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .upsert({
          id: authUser.user.id,
          email,
          role,
          restaurant_id: restId,
          custom_permissions: permissions || {},
          status: 'active'
        })
        .select()
        .single();

      if (error && (error.message.includes('custom_permissions') || error.message.includes('status') || error.message.includes('column') || error.message.includes('schema'))) {
        throw error;
      }
      profile = data;
      profileError = error;
    } catch (fallbackErr) {
      console.warn("Falling back to standard profiles schema insert:", fallbackErr);
      const { data, error } = await supabase
        .from('profiles')
        .upsert({
          id: authUser.user.id,
          email,
          role,
          restaurant_id: restId
        })
        .select()
        .single();
      profile = data;
      profileError = error;
    }

    if (profileError) {
      await supabase.auth.admin.deleteUser(authUser.user.id);
      throw profileError;
    }

    await logToAuditDb(supabase, caller.id, caller.email, caller.role, `Created staff account: ${email} with role: ${role}`, restId);

    const finalSettings = await getStaffSettingsFromDb(supabase, profile.id, role, restId);

    return c.json({
      id: profile.id,
      email: profile.email,
      role: profile.role,
      restaurant_id: profile.restaurant_id,
      status: 'active',
      permissions: finalSettings.permissions
    }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Update staff details
staffRoutes.put("/api/restaurants/:restId/staff/:staffId", authenticate, async (c) => {
  const restId = c.req.param('restId');
  const staffId = c.req.param('staffId');
  const body = await c.req.json();
  const { role, status, permissions } = body;
  const caller = c.get('user');
  const supabase = getSupabase(c.env);

  const callerSettings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, restId);
  const isOwnerOrAdmin = caller.role === 'admin' || caller.role === 'owner' || caller.role === 'OWNER';
  const canManageStaff = isOwnerOrAdmin || (callerSettings?.permissions?.can_manage_staff === true);

  if (!canManageStaff) {
    return c.json({ error: "Forbidden: You do not have permissions to edit staff details." }, 403);
  }

  try {
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', staffId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!profile) return c.json({ error: "Staff member not found." }, 404);

    // Verify access to this restaurant primarily or secondary
    const isPrimary = profile.restaurant_id === restId;
    let isMapped = false;
    let existingMapping: any = null;
    try {
      const { data } = await supabase
        .from('restaurant_users')
        .select('*')
        .eq('user_id', staffId)
        .eq('restaurant_id', restId)
        .maybeSingle();
      if (data) {
        isMapped = true;
        existingMapping = data;
      }
    } catch (_) {}

    if (!isPrimary && !isMapped) {
      return c.json({ error: "Staff member is not associated with this restaurant." }, 404);
    }

    let updatedProfile = { ...profile };

    if (isPrimary) {
      const updates: any = {};
      if (role) updates.role = role;

      try {
        const updatesWithCustom = { ...updates };
        if (status) updatesWithCustom.status = status;
        if (permissions) updatesWithCustom.custom_permissions = permissions;

        const { data, error } = await supabase
          .from('profiles')
          .update(updatesWithCustom)
          .eq('id', staffId)
          .select()
          .single();

        if (error && (error.message.includes('custom_permissions') || error.message.includes('status') || error.message.includes('column') || error.message.includes('schema'))) {
          throw error;
        }
        updatedProfile = data;
      } catch (fallbackErr) {
        console.warn("Falling back to basic update of profiles:", fallbackErr);
        const { data, error } = await supabase
          .from('profiles')
          .update(updates)
          .eq('id', staffId)
          .select()
          .single();
        if (error) throw error;
        updatedProfile = data;
      }
    } else {
      // Secondary workspace: update role and custom permissions on restaurant_users mapping instead
      const { data, error: mappingUpdateErr } = await supabase
        .from('restaurant_users')
        .upsert({
          user_id: staffId,
          restaurant_id: restId,
          role: role || existingMapping?.role || profile.role,
          status: status || existingMapping?.status || 'active',
          custom_permissions: permissions || existingMapping?.custom_permissions || {}
        }, { onConflict: 'restaurant_id,user_id' })
        .select()
        .single();
      if (mappingUpdateErr) throw mappingUpdateErr;
      existingMapping = data;
    }

    await logToAuditDb(supabase, caller.id, caller.email, caller.role, `Updated staff member: ${profile.email} (Role: ${role || profile.role}, Status: ${status || profile.status})`, restId);

    const finalSettings = await getStaffSettingsFromDb(supabase, staffId, role || profile.role, restId);

    return c.json({
      id: updatedProfile.id,
      email: updatedProfile.email,
      role: isPrimary ? updatedProfile.role : (existingMapping?.role || profile.role),
      restaurant_id: restId,
      status: finalSettings.status,
      permissions: finalSettings.permissions
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Delete staff mapping/account
staffRoutes.delete("/api/restaurants/:restId/staff/:staffId", authenticate, async (c) => {
  const restId = c.req.param('restId');
  const staffId = c.req.param('staffId');
  const caller = c.get('user');
  const supabase = getSupabase(c.env);

  const callerSettings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, restId);
  const isOwnerOrAdmin = caller.role === 'admin' || caller.role === 'owner' || caller.role === 'OWNER';
  const canManageStaff = isOwnerOrAdmin || (callerSettings?.permissions?.can_manage_staff === true);

  if (!canManageStaff) {
    return c.json({ error: "Forbidden: You do not have permissions to delete staff accounts." }, 403);
  }

  try {
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', staffId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!profile) return c.json({ error: "Staff user not found." }, 404);

    if (caller.id === staffId) {
      return c.json({ error: "You cannot delete your own account!" }, 400);
    }

    // Verify access to this restaurant primarily or secondary
    const isPrimary = profile.restaurant_id === restId;
    let isMapped = false;
    try {
      const { data } = await supabase
        .from('restaurant_users')
        .select('*')
        .eq('user_id', staffId)
        .eq('restaurant_id', restId)
        .maybeSingle();
      if (data) {
        isMapped = true;
      }
    } catch (_) {}

    if (!isPrimary && !isMapped) {
      return c.json({ error: "Staff member is not associated with this restaurant." }, 404);
    }

    if (isPrimary) {
      // Completely erase user only if it's their primary restaurant profile
      await supabase.auth.admin.deleteUser(staffId);
      await supabase
        .from('profiles')
        .delete()
        .eq('id', staffId);
    } else {
      // Secondary workspace: delete mapping only
      await supabase
        .from('restaurant_users')
        .delete()
        .eq('user_id', staffId)
        .eq('restaurant_id', restId);
    }

    await logToAuditDb(supabase, caller.id, caller.email, caller.role, `Deleted staff account mapping: ${profile.email}`, restId);

    return c.json({ success: true, message: "Staff member deleted successfully." });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Audit-Logs
staffRoutes.get("/api/restaurants/:restId/audit-logs", authenticate, async (c) => {
  const restId = c.req.param('restId');
  const caller = c.get('user');
  const supabase = getSupabase(c.env);

  if (caller.role !== 'admin' && caller.restaurantId !== restId && caller.restaurant_id !== restId) {
    return c.json({ error: "Forbidden: Unauthorized access to system audit logs." }, 403);
  }

  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('restaurant_id', restId)
      .order('timestamp', { ascending: false });

    if (error) throw error;
    return c.json(data || []);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default staffRoutes;
