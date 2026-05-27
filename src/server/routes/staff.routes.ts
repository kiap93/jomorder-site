import { Router } from "express";
import { 
  supabaseAdmin, 
  loadFallbackDB, 
  saveFallbackDB, 
  getStaffSettings, 
  readStaffRegistry, 
  writeStaffRegistry 
} from "../services/dbService";
import { logToAudit, readAuditLogs } from "../services/auditService";
import { authenticateJWT } from "../middleware/authMiddleware";

const router = Router();

// 1. Get List of Staff
router.get("/restaurants/:restId/staff", authenticateJWT, async (req, res) => {
  const { restId } = req.params;
  const caller = (req as any).user;

  if (caller.role !== 'admin' && caller.restaurantId !== restId && caller.restaurant_id !== restId) {
    return res.status(403).json({ error: "Forbidden: You do not have access to this restaurant's staff list." });
  }

  try {
    const db = loadFallbackDB();

    // 1. Get profiles directly mapped
    const { data: profiles, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('restaurant_id', restId);

    if (error) throw error;

    // 2. Get restaurant_users mapping
    let rUsers: any[] = [];
    try {
      const { data } = await supabaseAdmin
        .from('restaurant_users')
        .select('*')
        .eq('restaurant_id', restId);
      rUsers = data || [];
    } catch (e) {
      console.warn("Could not query restaurant_users in server staff GET:", e);
    }

    // Get any profiles from rUsers
    let extraProfiles: any[] = [];
    const rUserIds = rUsers.map(ru => ru.user_id).filter(Boolean);
    if (rUserIds.length > 0) {
      try {
        const { data } = await supabaseAdmin
          .from('profiles')
          .select('*')
          .in('id', rUserIds);
        extraProfiles = data || [];
      } catch (e) {
        console.warn("Could not load associated profiles:", e);
      }
    }

    const staffMap = new Map();

    // Build from fallback DB as well for local development
    const localRUs = db.restaurant_users.filter(ru => ru.restaurant_id === restId);
    for (const ru of localRUs) {
      const lp = db.profiles.find(p => p.id === ru.user_id);
      if (lp) {
        const settings = getStaffSettings(ru.user_id, ru.role);
        staffMap.set(ru.user_id, {
          id: ru.user_id,
          email: lp.email,
          role: ru.role,
          restaurant_id: restId,
          status: settings.status,
          permissions: settings.permissions
        });
      }
    }

    const localPrimaryProfs = db.profiles.filter(p => p.restaurant_id === restId);
    for (const lp of localPrimaryProfs) {
      const settings = getStaffSettings(lp.id, lp.role);
      staffMap.set(lp.id, {
        id: lp.id,
        email: lp.email,
        role: lp.role,
        restaurant_id: restId,
        status: settings.status,
        permissions: settings.permissions
      });
    }

    // Overlay live data
    if (profiles) {
      for (const p of profiles) {
        const settings = getStaffSettings(p.id, p.role);
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
        const settings = getStaffSettings(ru.user_id, ru.role || prof.role);
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

    res.json(Array.from(staffMap.values()));
  } catch (err: any) {
    console.error("Error fetching staff:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Create Staff Member
router.post("/restaurants/:restId/staff", authenticateJWT, async (req, res) => {
  const { restId } = req.params;
  const { email, password, role, permissions } = req.body;
  const caller = (req as any).user;

  const callerSettings = getStaffSettings(caller.id, caller.role);
  const isOwnerOrAdmin = caller.role === 'admin' || caller.role === 'owner' || caller.role === 'OWNER';
  const canManageStaff = isOwnerOrAdmin || (callerSettings?.permissions?.can_manage_staff === true);

  if (!canManageStaff) {
    return res.status(403).json({ error: "Forbidden: You do not have permissions to register staff accounts." });
  }

  if (!email || !password || !role) {
    return res.status(400).json({ error: "Email, password, and role are required." });
  }

  try {
    // 1. Check if profile already exists with this email (case-insensitive check)
    let existingProfile: any = null;
    const { data: matchedProf } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .ilike('email', email)
      .maybeSingle();

    if (matchedProf) {
      existingProfile = matchedProf;
    } else {
      const db = loadFallbackDB();
      const fp = db.profiles.find((p: any) => p.email?.toLowerCase() === email.toLowerCase());
      if (fp) {
        existingProfile = fp;
      }
    }

    if (!existingProfile) {
      try {
        const { data: usersList } = await supabaseAdmin.auth.admin.listUsers();
        const existingAuthUser = usersList?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
        if (existingAuthUser) {
          existingProfile = {
            id: existingAuthUser.id,
            email: existingAuthUser.email,
            role: role,
            restaurant_id: restId
          };

          try {
            const { data: upsertedProf } = await supabaseAdmin
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
            console.warn("Could not upsert profile for existing admin auth user:", pe);
          }
        }
      } catch (authLookError) {
        console.warn("Could not list auth users to check for existing email in Express:", authLookError);
      }
    }

    if (existingProfile) {
      const userId = existingProfile.id;

      const db = loadFallbackDB();
      const inFallbackPrimary = existingProfile.restaurant_id === restId;
      const inFallbackRU = db.restaurant_users.some(ru => ru.user_id === userId && ru.restaurant_id === restId);
      
      let inLiveRU = false;
      try {
        const { data: ruMap } = await supabaseAdmin
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

      if (inFallbackPrimary || inFallbackRU || inLiveRU) {
        if (existingProfile.email?.toLowerCase() === caller.email?.toLowerCase()) {
          return res.status(400).json({ error: "You cannot add yourself (the logged-in administrator/owner) as a staff member. You already have full access. Please use a distinct/separate email address for each of your staff members." });
        }
        return res.status(400).json({ error: `The user with email "${email}" is already registered for this restaurant. If they are already listed below, you can edit their role or permissions directly using the Edit button.` });
      }

      const defaultPerms = getStaffSettings(userId, role).permissions;

      try {
        await supabaseAdmin
          .from('restaurant_users')
          .upsert({
            user_id: userId,
            restaurant_id: restId,
            role: role,
            status: 'active',
            custom_permissions: permissions || defaultPerms
          });
      } catch (err) {
        console.warn("Could not insert mapping in live DB:", err);
      }

      const fallbackRUIndex = db.restaurant_users.findIndex(ru => ru.user_id === userId && ru.restaurant_id === restId);
      if (fallbackRUIndex > -1) {
        db.restaurant_users[fallbackRUIndex].role = role;
        db.restaurant_users[fallbackRUIndex].status = 'active';
        db.restaurant_users[fallbackRUIndex].custom_permissions = permissions || defaultPerms;
      } else {
        db.restaurant_users.push({
          restaurant_id: restId,
          user_id: userId,
          role: role,
          status: 'active',
          last_entry_at: null,
          custom_permissions: permissions || defaultPerms
        });
      }
      saveFallbackDB(db);

      const registry = readStaffRegistry();
      registry[userId] = {
        status: 'active',
        permissions: permissions || defaultPerms
      };
      writeStaffRegistry(registry);

      logToAudit(caller.id, caller.email, caller.role, `Mapped existing user ${email} to restaurant ${restId} as role: ${role}`, restId);

      return res.status(201).json({
        id: userId,
        email: email,
        role: role,
        restaurant_id: restId,
        status: 'active',
        permissions: registry[userId].permissions
      });
    }

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    if (!authUser.user) {
      return res.status(500).json({ error: "Failed to create authentication user." });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: authUser.user.id,
        email,
        role,
        restaurant_id: restId
      })
      .select()
      .single();

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      throw profileError;
    }

    const registry = readStaffRegistry();
    const defaultPerms = getStaffSettings(authUser.user.id, role).permissions;
    registry[authUser.user.id] = {
      status: 'active',
      permissions: permissions || defaultPerms
    };
    writeStaffRegistry(registry);

    logToAudit(caller.id, caller.email, caller.role, `Created staff account: ${email} with role: ${role}`, restId);

    const db = loadFallbackDB();
    if (!db.profiles.some(p => p.id === authUser.user.id)) {
      db.profiles.push({
        id: authUser.user.id,
        email,
        role,
        restaurant_id: restId,
        status: 'active',
        last_entry_at: null
      });
      saveFallbackDB(db);
    }

    res.status(201).json({
      id: profile.id,
      email: profile.email,
      role: profile.role,
      restaurant_id: profile.restaurant_id,
      status: 'active',
      permissions: registry[authUser.user.id].permissions
    });
  } catch (err: any) {
    console.error("Error creating staff:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Update Staff Member (Role, Status, Custom Permissions)
router.put("/restaurants/:restId/staff/:staffId", authenticateJWT, async (req, res) => {
  const { restId, staffId } = req.params;
  const { role, status, permissions } = req.body;
  const caller = (req as any).user;

  const callerSettings = getStaffSettings(caller.id, caller.role);
  const isOwnerOrAdmin = caller.role === 'admin' || caller.role === 'owner' || caller.role === 'OWNER';
  const canManageStaff = isOwnerOrAdmin || (callerSettings?.permissions?.can_manage_staff === true);

  if (!canManageStaff) {
    return res.status(403).json({ error: "Forbidden: You do not have permissions to edit staff details." });
  }

  try {
    const { data: profile, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', staffId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!profile) return res.status(404).json({ error: "Staff member not found." });

    const isPrimary = profile.restaurant_id === restId;
    let isMapped = false;
    let existingMapping: any = null;
    try {
      const { data } = await supabaseAdmin
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
      return res.status(404).json({ error: "Staff member is not associated with this restaurant." });
    }

    let updatedProfile = { ...profile };

    if (isPrimary) {
      if (role && role !== profile.role) {
        const { data, error: updateError } = await supabaseAdmin
          .from('profiles')
          .update({ role })
          .eq('id', staffId)
          .select()
          .single();
        
        if (updateError) throw updateError;
        updatedProfile = data;
      }
    } else {
      const { data, error: mappingUpdateErr } = await supabaseAdmin
        .from('restaurant_users')
        .upsert({
          user_id: staffId,
          restaurant_id: restId,
          role: role || existingMapping?.role || profile.role,
          status: status || existingMapping?.status || 'active',
          custom_permissions: permissions || existingMapping?.custom_permissions || {}
        })
        .select()
        .single();
      if (mappingUpdateErr) throw mappingUpdateErr;
      existingMapping = data;
    }

    const registry = readStaffRegistry();
    if (!registry[staffId]) {
      registry[staffId] = {
        status: status || existingMapping?.status || 'active',
        permissions: permissions || existingMapping?.custom_permissions || getStaffSettings(staffId, role || profile.role).permissions
      };
    } else {
      if (status) registry[staffId].status = status;
      if (permissions) registry[staffId].permissions = permissions;
    }
    writeStaffRegistry(registry);

    const db = loadFallbackDB();
    if (isPrimary) {
      const fallbackPIndex = db.profiles.findIndex(p => p.id === staffId);
      if (fallbackPIndex > -1) {
        if (role) db.profiles[fallbackPIndex].role = role;
      }
    } else {
      const fallbackRUIndex = db.restaurant_users.findIndex(ru => ru.user_id === staffId && ru.restaurant_id === restId);
      if (fallbackRUIndex > -1) {
        if (role) db.restaurant_users[fallbackRUIndex].role = role;
        if (status) db.restaurant_users[fallbackRUIndex].status = status;
        if (permissions) db.restaurant_users[fallbackRUIndex].custom_permissions = permissions;
      } else {
        db.restaurant_users.push({
          restaurant_id: restId,
          user_id: staffId,
          role: role || profile.role,
          status: status || 'active',
          last_entry_at: null,
          custom_permissions: permissions || getStaffSettings(staffId, role || profile.role).permissions
        });
      }
    }
    saveFallbackDB(db);

    logToAudit(caller.id, caller.email, caller.role, `Updated staff member: ${profile.email} (Role: ${role || profile.role}, Status: ${status || registry[staffId].status})`, restId);

    res.json({
      id: updatedProfile.id,
      email: updatedProfile.email,
      role: isPrimary ? updatedProfile.role : (existingMapping?.role || profile.role),
      restaurant_id: restId,
      status: isPrimary ? registry[staffId].status : (existingMapping?.status || 'active'),
      permissions: registry[staffId].permissions
    });
  } catch (err: any) {
    console.error("Error updating staff:", err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Delete Staff Member
router.delete("/restaurants/:restId/staff/:staffId", authenticateJWT, async (req, res) => {
  const { restId, staffId } = req.params;
  const caller = (req as any).user;

  const callerSettings = getStaffSettings(caller.id, caller.role);
  const isOwnerOrAdmin = caller.role === 'admin' || caller.role === 'owner' || caller.role === 'OWNER';
  const canManageStaff = isOwnerOrAdmin || (callerSettings?.permissions?.can_manage_staff === true);

  if (!canManageStaff) {
    return res.status(403).json({ error: "Forbidden: You do not have permissions to delete staff accounts." });
  }

  try {
    const { data: profile, error: fetchError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', staffId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!profile) return res.status(404).json({ error: "Staff user not found." });

    if (caller.id === staffId) {
      return res.status(400).json({ error: "You cannot delete your own account!" });
    }

    const isPrimary = profile.restaurant_id === restId;
    let isMapped = false;
    try {
      const { data } = await supabaseAdmin
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
      return res.status(404).json({ error: "Staff member is not associated with this restaurant." });
    }

    const db = loadFallbackDB();

    if (isPrimary) {
      await supabaseAdmin.auth.admin.deleteUser(staffId);
      await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', staffId);

      db.profiles = db.profiles.filter(p => p.id !== staffId);
      db.restaurant_users = db.restaurant_users.filter(ru => ru.user_id !== staffId);
    } else {
      await supabaseAdmin
        .from('restaurant_users')
        .delete()
        .eq('user_id', staffId)
        .eq('restaurant_id', restId);

      db.restaurant_users = db.restaurant_users.filter(ru => !(ru.user_id === staffId && ru.restaurant_id === restId));
    }
    saveFallbackDB(db);

    const registry = readStaffRegistry();
    if (registry[staffId]) {
      delete registry[staffId];
      writeStaffRegistry(registry);
    }

    logToAudit(caller.id, caller.email, caller.role, `Deleted staff account mapping: ${profile.email}`, restId);

    res.json({ success: true, message: "Staff member deleted successfully." });
  } catch (err: any) {
    console.error("Error deleting staff:", err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Audit Logs
router.get("/restaurants/:restId/audit-logs", authenticateJWT, async (req, res) => {
  const { restId } = req.params;
  const caller = (req as any).user;

  if (caller.role !== 'admin' && caller.restaurantId !== restId && caller.restaurant_id !== restId) {
    return res.status(403).json({ error: "Forbidden: Unauthorized access to system audit logs." });
  }

  const logs = readAuditLogs();
  const restLogs = logs.filter(l => l.restaurant_id === restId);
  res.json(restLogs);
});

export default router;
