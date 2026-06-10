import { Router, Response } from "express";
import { authenticateJWT, requireTenantIsolation, AuthenticatedRequest } from "../../server/middleware/authMiddleware";
import { BillingService } from "../services/billingService";
import { PlanCode } from "../types";
import { BillingRepository } from "../repositories/billingRepository";

const router = Router();
const service = new BillingService();
const repo = new BillingRepository();

/**
 * GET /api/billing/overview
 * Fetches tenant's active tier limitations, statistics count, stripe details
 */
router.get("/billing/overview", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized: Active session missing." });
  }
  const tenantId = user.restaurantId || (user as any).restaurant_id || req.query.restId as string;

  if (!tenantId) {
    return res.status(400).json({ error: "Missing active restaurant workspace coordinates in context." });
  }

  try {
    const overview = await service.getTenantBillingOverview(tenantId);
    res.json(overview);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load billing metrics dashboard.", details: err.message });
  }
});

/**
 * POST /api/billing/create-checkout-session
 * High-grade secure checkout controller
 */
router.post("/billing/create-checkout-session", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized: Active session missing." });
  }
  const tenantId = user.restaurantId || (user as any).restaurant_id || req.body.restaurantId;
  const { plan } = req.body;

  if (!tenantId) {
    return res.status(400).json({ error: "No active restaurant workspace context identified." });
  }

  if (!plan) {
    return res.status(400).json({ error: "You must specify a target subscription plan." });
  }

  const email = user.email || "client@jomorder.com";
  // The frontend billing panel URL to return back to once stripe checkout completes 
  let origin = req.body.origin || req.headers.origin;
  if (!origin) {
    const referer = req.headers.referer;
    if (referer) {
      try {
        origin = new URL(referer as string).origin;
      } catch (_) {}
    }
  }
  if (!origin) {
    const host = req.headers.host || "localhost:3000";
    const protocol = req.secure || (req.headers["x-forwarded-proto"] === "https") ? "https" : "http";
    origin = `${protocol}://${host}`;
  }
  const returnUrl = `${origin as string}/restaurant/${tenantId}/billing`;

  try {
    const result = await service.createCheckoutSession(tenantId, plan as PlanCode, email, returnUrl);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Stripe connection failed.", details: err.message });
  }
});

/**
 * POST /api/billing/create-portal-session
 * Accesses Stripe Customer self-service dashboard
 */
router.post("/billing/create-portal-session", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized: Active session missing." });
  }
  const tenantId = user.restaurantId || (user as any).restaurant_id || req.body.restaurantId;

  if (!tenantId) {
    return res.status(400).json({ error: "No active restaurant workspace." });
  }

  let origin = req.body.origin || req.headers.origin;
  if (!origin) {
    const referer = req.headers.referer;
    if (referer) {
      try {
        origin = new URL(referer as string).origin;
      } catch (_) {}
    }
  }
  if (!origin) {
    const host = req.headers.host || "localhost:3000";
    const protocol = req.secure || (req.headers["x-forwarded-proto"] === "https") ? "https" : "http";
    origin = `${protocol}://${host}`;
  }
  const returnUrl = `${origin as string}/restaurant/${tenantId}/billing`;

  try {
    const result = await service.createPortalSession(tenantId, returnUrl);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "Failed creating Stripe Billing Portal redirect session.", details: err.message });
  }
});

/**
 * POST /api/billing/upgrade
 * Support instantaneous plan shifts and change records
 */
router.post("/billing/upgrade", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized: Active session missing." });
  }
  const tenantId = user.restaurantId || (user as any).restaurant_id || req.body.restaurantId;
  const { plan } = req.body;

  if (!tenantId) return res.status(400).json({ error: "Restaurant context missing." });
  if (!plan) return res.status(400).json({ error: "Target plan required." });

  try {
    const updated = await service.upgradeSubscription(tenantId, plan as PlanCode);
    res.json({ success: true, subscription: updated });
  } catch (err: any) {
    res.status(500).json({ error: "Modification of subscription failed.", details: err.message });
  }
});

/**
 * POST /api/billing/cancel
 * Halts period billing cycles
 */
router.post("/billing/cancel", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized: Active session missing." });
  }
  const tenantId = user.restaurantId || (user as any).restaurant_id || req.body.restaurantId;

  if (!tenantId) return res.status(400).json({ error: "Workspace context ID missing." });

  try {
    const cancelled = await service.cancelSubscription(tenantId);
    res.json({ success: true, subscription: cancelled });
  } catch (err: any) {
    res.status(500).json({ error: "Cancellation transaction aborted.", details: err.message });
  }
});

/**
 * POST /api/billing/sandbox-simulate
 * Simulation bridge enabling interactive testing of starter, growth, and pro packages in preview tabs
 */
router.post("/billing/sandbox-simulate", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized: Active session missing." });
  }
  const tenantId = user.restaurantId || (user as any).restaurant_id;
  const { plan } = req.body;

  if (!tenantId) {
    return res.status(400).json({ error: "Workspace context missing." });
  }

  const targetPlan = (plan || "starter") as PlanCode;

  try {
    // Generate simulated subscription
    const trialEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const result = await repo.upsertSubscription({
      tenant_id: tenantId,
      stripe_customer_id: "cus_simulated_preview",
      stripe_subscription_id: "sub_simulated_preview_" + Math.random().toString(36).substr(2, 6),
      stripe_price_id: "price_simulated_" + targetPlan,
      plan_code: targetPlan,
      status: "active",
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      trial_end: null,
      cancel_at_period_end: false
    });

    res.json({ success: true, subscription: result });
  } catch (err: any) {
    res.status(500).json({ error: "Sandbox synchronization exception", details: err.message });
  }
});

export default router;
