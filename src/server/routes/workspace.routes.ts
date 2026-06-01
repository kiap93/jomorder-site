import { Router } from "express";
import jwt from "jsonwebtoken";
import { 
  supabaseAdmin, 
  loadFallbackDB, 
  saveFallbackDB, 
  JWT_SECRET, 
  getOrganizationSettings, 
  getTenantRegistry, 
  getStaffSettings, 
  readStaffRegistry, 
  writeStaffRegistry 
} from "../services/dbService";
import { authenticateJWT, AuthenticatedRequest } from "../middleware/authMiddleware";

const router = Router();

// Debug restaurants info
router.get('/debug-restaurants', async (req, res) => {
  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
    if (!supabaseUrl) {
      return res.status(500).json({ error: "Missing VITE_SUPABASE_URL" });
    }

    const headers: Record<string, string> = {
      'apikey': supabaseAnonKey
    };
    const response = await fetch(`${supabaseUrl}/rest/v1/`, { headers });
    const spec = await response.json();
    if (spec && spec.definitions && spec.definitions.restaurants) {
      return res.json({
        message: "Found schema definition",
        columns: Object.keys(spec.definitions.restaurants.properties || {}),
        properties: spec.definitions.restaurants.properties
      });
    }
    return res.status(404).json({ error: "Restaurants definition not found" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 1. Get all organizations and restaurants the user has access to
router.get('/my-workspaces', authenticateJWT, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;

  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (user.is_platform_admin === true) {
    try {
      const { data: orgs } = await supabaseAdmin.from('organizations').select('*');
      const { data: rests } = await supabaseAdmin.from('restaurants').select('*');
      return res.json({
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
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const db = loadFallbackDB();

    let mappedUsers: any[] = [];
    try {
      const { data } = await supabaseAdmin
        .from('restaurant_users')
        .select('*, restaurants:restaurant_id(*)')
        .eq('user_id', user.id);
      mappedUsers = data || [];
    } catch (e) {
      console.warn("Supabase restaurant_users fetch failed:", e);
    }

    let profile: any = null;
    try {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('*, restaurants:restaurant_id(*)')
        .eq('id', user.id)
        .maybeSingle();
      profile = data;
    } catch (e) {
      console.warn("Supabase profiles fetch failed:", e);
    }

    const workspacesMap = new Map();

    // Load from local fallback DB first
    const userFallbackRUs = db.restaurant_users.filter(ru => ru.user_id === user.id);
    for (const ru of userFallbackRUs) {
      const relatedRest = db.restaurants.find(r => r.id === ru.restaurant_id);
      if (relatedRest) {
        workspacesMap.set(ru.restaurant_id, {
          ...relatedRest,
          role: ru.role,
          status: ru.status,
          permissions: ru.custom_permissions || {},
          last_entry_at: ru.last_entry_at || ru.custom_permissions?.last_entry_at || null
        });
      }
    }

    const userFallbackProfile = db.profiles.find(p => p.id === user.id);
    if (userFallbackProfile && userFallbackProfile.restaurant_id) {
      const relatedRest = db.restaurants.find(r => r.id === userFallbackProfile.restaurant_id);
      if (relatedRest && !workspacesMap.has(userFallbackProfile.restaurant_id)) {
        workspacesMap.set(userFallbackProfile.restaurant_id, {
          ...relatedRest,
          role: userFallbackProfile.role,
          status: userFallbackProfile.status || 'active',
          permissions: userFallbackProfile.custom_permissions || {},
          last_entry_at: userFallbackProfile.last_entry_at || userFallbackProfile.custom_permissions?.last_entry_at || null
        });
      }
    }

    // Process live db rows on top
    if (mappedUsers) {
      for (const m of mappedUsers) {
        if (m.restaurants) {
          const entryTime = m.last_entry_at || m.custom_permissions?.last_entry_at || null;
          const existing = workspacesMap.get(m.restaurant_id);
          workspacesMap.set(m.restaurant_id, {
            ...m.restaurants,
            role: m.role,
            status: m.status,
            permissions: m.custom_permissions || {},
            last_entry_at: entryTime || existing?.last_entry_at || null
          });
        }
      }
    }

    if (profile && profile.restaurant_id && profile.restaurants) {
      const existing = workspacesMap.get(profile.restaurant_id);
      if (!workspacesMap.has(profile.restaurant_id)) {
        workspacesMap.set(profile.restaurant_id, {
          ...profile.restaurants,
          role: profile.role,
          status: profile.status || 'active',
          permissions: profile.custom_permissions || {},
          last_entry_at: profile.last_entry_at || profile.custom_permissions?.last_entry_at || existing?.last_entry_at || null
        });
      }
    }

    const restaurantsList = Array.from(workspacesMap.values());
    const orgIds = restaurantsList.map((r: any) => r.organization_id).filter(Boolean);
    
    // Also fetch of organizations the user belongs to directly from organization_users
    let userDirectOrgIds: any[] = [];
    
    // Load from fallback DB organizations as well
    const fallbackOUs = db.organization_users.filter(ou => ou.user_id === user.id);
    userDirectOrgIds = fallbackOUs.map(ou => ou.organization_id);

    try {
      const { data: directMemberships } = await supabaseAdmin
        .from('organization_users')
        .select('organization_id')
        .eq('user_id', user.id);
      if (directMemberships) {
        userDirectOrgIds = Array.from(new Set([...userDirectOrgIds, ...directMemberships.map((m: any) => m.organization_id)]));
      }
    } catch (mErr) {
      console.warn("Could not query organization_users table (may not exist or permission issues):", mErr);
    }

    const allOrgIds = Array.from(new Set([...orgIds, ...userDirectOrgIds]));
    let organizationsList: any[] = [];

    // Prioritize fallback DB org details first
    organizationsList = db.organizations.filter(o => allOrgIds.includes(o.id));

    if (allOrgIds.length > 0) {
      try {
        const { data: orgs } = await supabaseAdmin
          .from('organizations')
          .select('*')
          .in('id', allOrgIds);
        if (orgs) {
          for (const o of orgs) {
            if (!organizationsList.some(ex => ex.id === o.id)) {
              organizationsList.push(o);
            }
          }
        }
      } catch (err) {
        console.warn("Could not query organizations from live DB:", err);
      }
    }

    const enrichedOrgs = await Promise.all(organizationsList.map(async (org: any) => {
      const settings = await getOrganizationSettings(supabaseAdmin, org.id);
      return {
        ...org,
        max_outlets: settings.max_outlets,
        multi_outlet_enabled: settings.multi_outlet_enabled,
        subscription_plan: settings.subscription_plan
      };
    }));

    return res.json({
      organizations: enrichedOrgs,
      restaurants: restaurantsList
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// 2. Switch active workspace (issues a new signed JWT with targeted restaurant credentials safely)
router.post('/switch-workspace/:restaurantId', authenticateJWT, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const restaurantId = req.params.restaurantId;

  const db = loadFallbackDB();

  const dbUserId = user.id;

  if (user.platform_role === 'superadmin') {
    try {
      let r = db.restaurants.find(item => item.id === restaurantId);
      if (!r) {
        const { data } = await supabaseAdmin.from('restaurants').select('*').eq('id', restaurantId).maybeSingle();
        r = data;
      }
      if (!r) return res.status(404).json({ error: "Restaurant not found." });
      const guestPay = {
        id: dbUserId,
        email: user.email,
        role: 'admin',
        platform_role: 'superadmin',
        is_platform_admin: true,
        restaurantId: r.id
      };
      const token = jwt.sign(guestPay, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, user: guestPay });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    let role = '';
    let status = 'active';
    let customPerms: any = {};

    // Check fallback DB first
    const fallbackRU = db.restaurant_users.find(ru => ru.user_id === dbUserId && ru.restaurant_id === restaurantId);
    if (fallbackRU) {
      role = fallbackRU.role;
      status = fallbackRU.status;
      customPerms = fallbackRU.custom_permissions;
    } else {
      const fallbackProfile = db.profiles.find(p => p.id === dbUserId && p.restaurant_id === restaurantId);
      if (fallbackProfile) {
        role = fallbackProfile.role;
        status = fallbackProfile.status || 'active';
        customPerms = fallbackProfile.custom_permissions;
      }
    }

    // Try Supabase fallback if not found in local cache
    if (!role) {
      try {
        const { data: mapping } = await supabaseAdmin
          .from('restaurant_users')
          .select('*')
          .eq('user_id', dbUserId)
          .eq('restaurant_id', restaurantId)
          .maybeSingle();

        if (mapping) {
          role = mapping.role;
          status = mapping.status;
          customPerms = mapping.custom_permissions;
        } else {
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', dbUserId)
            .eq('restaurant_id', restaurantId)
            .maybeSingle();

          if (profile) {
            role = profile.role;
            status = profile.status || 'active';
            customPerms = profile.custom_permissions;
          }
        }
      } catch (dbErr) {
        console.warn("Supabase lookup in switch-workspace failed, ignoring:", dbErr);
      }
    }

    if (!role) {
      return res.status(403).json({ error: "Forbidden: You do not have access to this workspace." });
    }

    if (status === 'suspended') {
      return res.status(403).json({ error: "Your account is suspended in this workspace." });
    }

    let organizationId: string | null = null;
    const fallbackRest = db.restaurants.find((r: any) => r.id === restaurantId);
    if (fallbackRest) {
      organizationId = fallbackRest.organization_id || null;
    }

    if (!organizationId) {
      try {
        const { data: dbRest } = await supabaseAdmin
          .from('restaurants')
          .select('organization_id')
          .eq('id', restaurantId)
          .maybeSingle();
        if (dbRest) {
          organizationId = dbRest.organization_id || null;
        }
      } catch (err) {
        console.warn("Could not load organization_id from supabaseAdmin in switch-workspace:", err);
      }
    }

    const lowerRole = role ? role.toLowerCase() : '';
    const isOwnerOrAdmin = lowerRole === 'owner' || lowerRole === 'admin' || lowerRole === 'superadmin';
    const isManager = lowerRole === 'manager';
    const isCashier = lowerRole === 'cashier';
    const isKitchen = lowerRole === 'kitchen';
    const isRunner = lowerRole === 'runner';

    const permissions = {
      can_refund: isOwnerOrAdmin || isManager,
      can_edit_menu: isOwnerOrAdmin || isManager,
      can_cancel_order: isOwnerOrAdmin || isManager || isCashier,
      can_view_analytics: isOwnerOrAdmin || isManager,
      can_manage_staff: isOwnerOrAdmin,
      can_access_pos: isOwnerOrAdmin || isManager || isCashier,
      can_access_kds: isOwnerOrAdmin || isManager || isKitchen || isCashier,
      can_view_reports: isOwnerOrAdmin || isManager,
      ...(customPerms || {})
    };

    const enriched = {
      id: dbUserId,
      email: user.email,
      role: role,
      restaurantId: restaurantId,
      organizationId: organizationId,
      status: status,
      permissions: permissions
    };

    const now = new Date().toISOString();
    
    // Save locally
    const fallbackRUIndex = db.restaurant_users.findIndex(ru => ru.user_id === dbUserId && ru.restaurant_id === restaurantId);
    if (fallbackRUIndex > -1) {
      db.restaurant_users[fallbackRUIndex].last_entry_at = now;
    } else {
      db.restaurant_users.push({
        restaurant_id: restaurantId,
        user_id: dbUserId,
        role: role || 'waiter',
        status: status || 'active',
        last_entry_at: now
      });
    }

    const fallbackProfileIndex = db.profiles.findIndex(p => p.id === dbUserId);
    if (fallbackProfileIndex > -1) {
      db.profiles[fallbackProfileIndex].last_entry_at = now;
    }
    saveFallbackDB(db);

    // Save in live Supabase - attempt both direct column and JSONB fallback
    try {
      const { error: directErr } = await supabaseAdmin
        .from('restaurant_users')
        .update({ last_entry_at: now })
        .eq('user_id', dbUserId)
        .eq('restaurant_id', restaurantId);

      if (directErr) {
        console.warn("[DB] last_entry_at column update failed in restaurant_users, trying custom_permissions fallback:", directErr);
        const { data: currentRU } = await supabaseAdmin
          .from('restaurant_users')
          .select('custom_permissions')
          .eq('user_id', dbUserId)
          .eq('restaurant_id', restaurantId)
          .maybeSingle();

        const updatedPerms = {
          ...(currentRU?.custom_permissions || {}),
          last_entry_at: now
        };

        await supabaseAdmin
          .from('restaurant_users')
          .update({ custom_permissions: updatedPerms })
          .eq('user_id', dbUserId)
          .eq('restaurant_id', restaurantId);
      }
    } catch (e) {
      console.warn("[DB] Failed to save entry timestamp in restaurant_users:", e);
    }

    try {
      const { error: profileErr } = await supabaseAdmin
        .from('profiles')
        .update({ last_entry_at: now })
        .eq('id', dbUserId);

      if (profileErr) {
        console.warn("[DB] profiles.last_entry_at column update failed, trying custom_permissions:", profileErr);
        const { data: currentProf } = await supabaseAdmin
          .from('profiles')
          .select('custom_permissions')
          .eq('id', dbUserId)
          .maybeSingle();

        const updatedPerms = {
          ...(currentProf?.custom_permissions || {}),
          last_entry_at: now
        };

        await supabaseAdmin
          .from('profiles')
          .update({ custom_permissions: updatedPerms })
          .eq('id', dbUserId);
      }
    } catch (e) {
      console.warn("[DB] Failed to save profile entry timestamp:", e);
    }

    const token = jwt.sign(enriched, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user: enriched });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Update Organization Name & Company Register Number
router.patch('/organizations/:id', authenticateJWT, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { id } = req.params;
  const { name, company_register_number } = req.body;

  try {
    if (user.is_platform_admin !== true) {
      const { data: member, error: memberErr } = await supabaseAdmin
        .from('organization_users')
        .select('*')
        .eq('organization_id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!member || (member.role !== 'owner' && member.role !== 'manager')) {
        return res.status(403).json({ error: "Forbidden: You do not have owner/manager access to this organization." });
      }
    }

    const updatePayload: any = { name };
    if (company_register_number !== undefined) {
      updatePayload.company_register_number = company_register_number;
    }

    const { data: updatedOrg, error: updateErr } = await supabaseAdmin
      .from('organizations')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (updateErr) {
      if (updateErr.code === '42703' || (updateErr.message && updateErr.message.includes('column') && updateErr.message.includes('does not exist'))) {
        console.warn(`company_register_number column doesn't exist yet, updating name only.`);
        const { data: updatedOrg2, error: updateErr2 } = await supabaseAdmin
          .from('organizations')
          .update({ name })
          .eq('id', id)
          .select()
          .maybeSingle();

        if (updateErr2) throw updateErr2;
        return res.json({ 
          ...updatedOrg2, 
          company_register_number,
          warn: "Column company_register_number missing. Please execute: ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS company_register_number TEXT;"
        });
      }
      throw updateErr;
    }

    return res.json(updatedOrg);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Complete onboarding combo for Multi-Organization / Restaurant
router.post('/onboarding/create-org-workspace', authenticateJWT, async (req, res) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const dbUserId = user.id;
  const { orgName, workspaceName, orgId: reqOrgId } = req.body;

  if (!workspaceName) {
    return res.status(400).json({ error: "Workspace (Restaurant) name is required." });
  }

  try {
    let orgId = reqOrgId || null;
    const db = loadFallbackDB();

    if (!orgId && orgName && orgName.trim()) {
      let org: any = null;
      try {
        const { data, error: orgErr } = await supabaseAdmin
          .from('organizations')
          .insert({ name: orgName.trim() })
          .select()
          .single();
        
        if (orgErr) throw orgErr;
        org = data;
        orgId = org.id;
      } catch (err) {
        console.warn("Using fallback for organization insertion:", err);
        orgId = `org_${Date.now()}`;
        org = {
          id: orgId,
          name: orgName.trim(),
          created_at: new Date().toISOString()
        };
      }

      if (!db.organizations.some(o => o.id === orgId)) {
        db.organizations.push(org);
      }
      if (!db.organization_users.some(ou => ou.organization_id === orgId && ou.user_id === user.id)) {
        db.organization_users.push({
          organization_id: orgId,
          user_id: user.id,
          role: 'owner'
        });
      }
      saveFallbackDB(db);

      try {
        await supabaseAdmin.from('organization_users').insert({
          organization_id: orgId,
          user_id: dbUserId,
          role: 'owner'
        });
      } catch (e) {}
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
    }

    let restaurant: any = null;
    let restErr: any = null;

    try {
      const attempt1 = await supabaseAdmin
        .from('restaurants')
        .insert(insertData)
        .select()
        .single();

      if (attempt1.error) {
        if (insertData.organization_id) {
          delete insertData.organization_id;
          const attempt2 = await supabaseAdmin
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
    } catch (e) {
      restErr = e;
    }

    if (restErr || !restaurant) {
      console.warn("Using fallback for restaurant insertion:", restErr);
      restaurant = {
        id: `rest_${Date.now()}`,
        name: workspaceName.trim(),
        currency: 'MYR',
        service_charge: 6.0,
        sst: 10.0,
        owner_id: user.id,
        organization_id: orgId
      };
    }

    const db2 = loadFallbackDB();
    if (!db2.restaurants.some(r => r.id === restaurant.id)) {
      db2.restaurants.push(restaurant);
    }
    saveFallbackDB(db2);

    try {
      await supabaseAdmin
        .from('profiles')
        .upsert({
          id: dbUserId,
          email: user.email,
          restaurant_id: restaurant.id,
          role: 'owner',
          updated_at: new Date().toISOString()
        });
    } catch (e) {}

    try {
      await supabaseAdmin.from('restaurant_users').insert({
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

    const db3 = loadFallbackDB();
    if (!db3.profiles.some(p => p.id === user.id)) {
      db3.profiles.push({
        id: user.id,
        email: user.email,
        restaurant_id: restaurant.id,
        role: 'owner',
        updated_at: new Date().toISOString()
      });
    } else {
      const existing = db3.profiles.find(p => p.id === user.id);
      if (existing) {
        existing.restaurant_id = restaurant.id;
        existing.role = 'owner';
      }
    }

    if (!db3.restaurant_users.some(ru => ru.restaurant_id === restaurant.id && ru.user_id === user.id)) {
      db3.restaurant_users.push({
        restaurant_id: restaurant.id,
        user_id: user.id,
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
    }
    saveFallbackDB(db3);

    const enriched = {
      id: dbUserId,
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

    const token = jwt.sign(enriched, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user: enriched });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Restaurants (Generic)
router.get("/restaurants/:id", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('restaurants')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch("/restaurants/:id", authenticateJWT, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('restaurants')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .maybeSingle();
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default router;
