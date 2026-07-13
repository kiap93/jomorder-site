import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { getSupabase, getStaffSettingsFromDb, logToAuditDb } from '../services/db_service';
import { authenticate } from '../middleware/auth';
import { generateTaxReport, convertReportToCSV, getRestaurantConfig } from '../../src/server/services/taxReportingService';

const taxRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// GET /api/restaurants/:restId/tax/summary
taxRoutes.get("/api/restaurants/:restId/tax/summary", authenticate, async (c) => {
  const restId = c.req.param('restId');
  const caller = c.get('user');
  const supabase = getSupabase(c.env);

  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const type = (c.req.query('type') as 'daily' | 'monthly' | 'custom') || 'custom';

  if (!startDate || !endDate) {
    return c.json({ error: "Parameters startDate and endDate are required." }, 400);
  }

  try {
    // 1. Authorization & Tenant Isolation Checks
    if (caller.role !== 'admin' && caller.restaurantId !== restId && caller.restaurant_id !== restId) {
      // Check if user has explicit restaurant mapping
      const settings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, restId);
      if (settings.status === 'suspended') {
        return c.json({ error: "Forbidden: Your account is suspended." }, 403);
      }
      
      const hasPermission = settings.permissions.can_view_analytics === true;
      if (!hasPermission) {
        return c.json({ error: "Forbidden: You do not have permission to view tax analytics." }, 403);
      }
    }

    const summary = await generateTaxReport(restId, startDate, endDate, type, supabase);
    return c.json(summary);
  } catch (err: any) {
    console.error("[Worker TaxRoutes] Error compiling tax report summary:", err);
    return c.json({ error: err?.message || "Internal server error" }, 500);
  }
});

// GET /api/restaurants/:restId/tax/csv
taxRoutes.get("/api/restaurants/:restId/tax/csv", authenticate, async (c) => {
  const restId = c.req.param('restId');
  const caller = c.get('user');
  const supabase = getSupabase(c.env);

  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const type = (c.req.query('type') as 'daily' | 'monthly' | 'custom') || 'custom';

  if (!startDate || !endDate) {
    return c.json({ error: "Parameters startDate and endDate are required." }, 400);
  }

  try {
    // 1. Authorization & Tenant Isolation Checks
    if (caller.role !== 'admin' && caller.restaurantId !== restId && caller.restaurant_id !== restId) {
      // Check if user has explicit restaurant mapping
      const settings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, restId);
      if (settings.status === 'suspended') {
        return c.json({ error: "Forbidden: Your account is suspended." }, 403);
      }
      
      const hasPermission = settings.permissions.can_view_analytics === true;
      if (!hasPermission) {
        return c.json({ error: "Forbidden: You do not have permission to view tax analytics." }, 403);
      }
    }

    const summary = await generateTaxReport(restId, startDate, endDate, type, supabase);
    const csv = convertReportToCSV(summary);

    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", `attachment; filename="tax_report_${restId}_${startDate}_to_${endDate}.csv"`);
    return c.body(csv);
  } catch (err: any) {
    console.error("[Worker TaxRoutes] Error compiling CSV tax report:", err);
    return c.json({ error: err?.message || "Internal server error" }, 500);
  }
});

// GET /api/restaurants/:restId/tax/config
taxRoutes.get("/api/restaurants/:restId/tax/config", authenticate, async (c) => {
  const restId = c.req.param('restId');
  const caller = c.get('user');
  const supabase = getSupabase(c.env);

  try {
    // 1. Authorization & Tenant Isolation Checks
    if (caller.role !== 'admin' && caller.restaurantId !== restId && caller.restaurant_id !== restId) {
      // Check if user has explicit restaurant mapping
      const settings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, restId);
      if (settings.status === 'suspended') {
        return c.json({ error: "Forbidden: Your account is suspended." }, 403);
      }
      
      const hasPermission = settings.permissions.can_view_analytics === true;
      if (!hasPermission) {
        return c.json({ error: "Forbidden: You do not have permission to view tax analytics." }, 403);
      }
    }

    const config = await getRestaurantConfig(restId, supabase);
    return c.json(config);
  } catch (err: any) {
    console.error("[Worker TaxRoutes] Error fetching tax config:", err);
    return c.json({ error: err?.message || "Internal server error" }, 500);
  }
});

// POST /api/restaurants/:restId/tax/config
taxRoutes.post("/api/restaurants/:restId/tax/config", authenticate, async (c) => {
  const restId = c.req.param('restId');
  const caller = c.get('user');
  const supabase = getSupabase(c.env);
  const body = await c.req.json();
  const { business_day_close_time } = body;

  if (!business_day_close_time || !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(business_day_close_time)) {
    return c.json({ error: "Invalid business_day_close_time. Must match HH:MM format." }, 400);
  }

  try {
    // 1. Authorization & Tenant Isolation Checks
    // Post config update requires owner, manager or superadmin
    const isOwnerOrAdmin = caller.role === 'admin' || caller.role === 'owner' || caller.role === 'superadmin';
    if (!isOwnerOrAdmin) {
      if (caller.restaurantId !== restId && caller.restaurant_id !== restId) {
        return c.json({ error: "Forbidden: You do not have permission to manage setting config." }, 403);
      }
      const settings = await getStaffSettingsFromDb(supabase, caller.id, caller.role, restId);
      if (settings.status === 'suspended') {
        return c.json({ error: "Forbidden: Your account is suspended." }, 403);
      }
      
      const hasManagePermission = caller.role === 'manager';
      if (!hasManagePermission) {
        return c.json({ error: "Forbidden: You do not have permission to manage settings." }, 403);
      }
    }

    // Find business settings ID or record
    const { data: businessSettings, error: selectErr } = await supabase
      .from('business_settings')
      .select('*')
      .eq('restaurant_id', restId)
      .maybeSingle();

    if (selectErr) throw selectErr;

    if (businessSettings) {
      const { error: updateErr } = await supabase
        .from('business_settings')
        .update({ business_day_close_time })
        .eq('restaurant_id', restId);
      if (updateErr) throw updateErr;
    } else {
      const { error: insertErr } = await supabase
        .from('business_settings')
        .insert({
          restaurant_id: restId,
          business_id: restId,
          business_day_close_time
        });
      if (insertErr) throw insertErr;
    }

    if (caller && caller.email) {
      await logToAuditDb(
        supabase,
        caller.id,
        caller.email,
        caller.role,
        `Updated F&B business closing hour to ${business_day_close_time}`,
        restId
      );
    }

    return c.json({ success: true, business_day_close_time });
  } catch (err: any) {
    console.error("[Worker TaxRoutes] Error updating business hours closing time configuration:", err);
    return c.json({ error: err?.message || "Internal server error" }, 500);
  }
});

export default taxRoutes;
