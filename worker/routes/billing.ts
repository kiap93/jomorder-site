import { Hono } from 'hono';
import { Bindings, Variables } from '../types';
import { authenticate } from '../middleware/auth';
import { BillingService } from '../../src/billing/services/billingService';
import { BillingRepository } from '../../src/billing/repositories/billingRepository';
import { PlanCode } from '../../src/billing/types';

const billingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const service = new BillingService();
const repo = new BillingRepository();

/**
 * GET /api/billing/overview
 * Fetches tenant's active tier limitations, statistics count, stripe details
 */
billingRoutes.get("/api/billing/overview", authenticate, async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: "Unauthorized: Active session missing." }, 401);
  }
  
  const tenantId = user.restaurantId || user.restaurant_id || c.req.query('restId');

  if (!tenantId) {
    return c.json({ error: "Missing active restaurant workspace coordinates in context." }, 400);
  }

  try {
    const overview = await service.getTenantBillingOverview(tenantId);
    return c.json(overview);
  } catch (err: any) {
    return c.json({ error: "Failed to load billing metrics dashboard.", details: err.message }, 500);
  }
});

/**
 * POST /api/billing/create-checkout-session
 * High-grade secure checkout controller
 */
billingRoutes.post("/api/billing/create-checkout-session", authenticate, async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: "Unauthorized: Active session missing." }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const tenantId = user.restaurantId || user.restaurant_id || body.restaurantId;
  const plan = body.plan;

  if (!tenantId) {
    return c.json({ error: "No active restaurant workspace context identified." }, 400);
  }

  if (!plan) {
    return c.json({ error: "You must specify a target subscription plan." }, 400);
  }

  const email = user.email || "client@jomorder.com";
  let origin = body.origin || c.req.header('origin');
  if (!origin) {
    const referer = c.req.header('referer');
    if (referer) {
      try {
        origin = new URL(referer).origin;
      } catch (_) {}
    }
  }
  if (!origin) {
    const host = c.req.header('host') || "localhost:3000";
    const protocol = c.req.url.startsWith("https") ? "https" : "http";
    origin = `${protocol}://${host}`;
  }
  const returnUrl = `${origin}/restaurant/${tenantId}/billing`;

  try {
    const result = await service.createCheckoutSession(tenantId, plan as PlanCode, email, returnUrl);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: "Stripe connection failed.", details: err.message }, 500);
  }
});

/**
 * POST /api/billing/create-portal-session
 * Accesses Stripe Customer self-service dashboard
 */
billingRoutes.post("/api/billing/create-portal-session", authenticate, async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: "Unauthorized: Active session missing." }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const tenantId = user.restaurantId || user.restaurant_id || body.restaurantId;

  if (!tenantId) {
    return c.json({ error: "No active restaurant workspace." }, 400);
  }

  let origin = body.origin || c.req.header('origin');
  if (!origin) {
    const referer = c.req.header('referer');
    if (referer) {
      try {
        origin = new URL(referer).origin;
      } catch (_) {}
    }
  }
  if (!origin) {
    const host = c.req.header('host') || "localhost:3000";
    const protocol = c.req.url.startsWith("https") ? "https" : "http";
    origin = `${protocol}://${host}`;
  }
  const returnUrl = `${origin}/restaurant/${tenantId}/billing`;

  try {
    const result = await service.createPortalSession(tenantId, returnUrl);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: "Failed creating Stripe Billing Portal redirect session.", details: err.message }, 500);
  }
});

/**
 * POST /api/billing/upgrade
 * Support instantaneous plan shifts and change records
 */
billingRoutes.post("/api/billing/upgrade", authenticate, async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: "Unauthorized: Active session missing." }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const tenantId = user.restaurantId || user.restaurant_id || body.restaurantId;
  const plan = body.plan;

  if (!tenantId) return c.json({ error: "Restaurant context missing." }, 400);
  if (!plan) return c.json({ error: "Target plan required." }, 400);

  try {
    const updated = await service.upgradeSubscription(tenantId, plan as PlanCode);
    return c.json({ success: true, subscription: updated });
  } catch (err: any) {
    return c.json({ error: "Modification of subscription failed.", details: err.message }, 500);
  }
});

/**
 * POST /api/billing/cancel
 * Halts period billing cycles
 */
billingRoutes.post("/api/billing/cancel", authenticate, async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: "Unauthorized: Active session missing." }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const tenantId = user.restaurantId || user.restaurant_id || body.restaurantId;

  if (!tenantId) return c.json({ error: "Workspace context ID missing." }, 400);

  try {
    const cancelled = await service.cancelSubscription(tenantId);
    return c.json({ success: true, subscription: cancelled });
  } catch (err: any) {
    return c.json({ error: "Cancellation transaction aborted.", details: err.message }, 500);
  }
});

/**
 * POST /api/billing/sandbox-simulate
 * Simulation bridge disabled in production mode.
 */
billingRoutes.post("/api/billing/sandbox-simulate", authenticate, async (c) => {
  return c.json({ error: "Sandbox simulation is disabled in production." }, 403);
});

export default billingRoutes;
