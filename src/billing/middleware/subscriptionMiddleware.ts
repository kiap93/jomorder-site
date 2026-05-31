import { Request, Response, NextFunction } from "express";
import { BillingRepository } from "../repositories/billingRepository";
import { supabaseAdmin } from "../../server/services/dbService";

const repo = new BillingRepository();

/**
 * Enterprise Subscription Enforcement Middleware
 * Implements standard SaaS states:
 * - trialing / active: Full Access
 * - past_due: Limited Access (Allows requests but appends warning flags)
 * - canceled: Read-Only Access (permits only GET requests; blocks all mutations)
 * - unpaid / suspended / expired: Blocks absolute access (402 Payment Required)
 */
export async function requireSubscriptionEnforcement(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized: Active session missing." });
  }

  // Bypass checks for platform super administrators
  if (user.platform_role === "superadmin" || user.is_platform_admin === true) {
    next();
    return;
  }

  const tenantId = req.params.restId || req.params.restaurantId || req.query.restaurantId || req.query.restaurant_id || req.query.restId || (req.body && (req.body.restaurantId || req.body.restaurant_id || req.body.restId)) || user.restaurantId;

  if (!tenantId) {
    // If no tenant is resolved, proceed safely to let tenant-isolation handle it or fallback
    next();
    return;
  }

  try {
    let sub = await repo.getSubscription(tenantId);
    
    // Auto trial bootstrap if subscription record is absent
    if (!sub) {
      const trialDays = 14;
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + trialDays);
      
      sub = await repo.upsertSubscription({
        tenant_id: tenantId,
        stripe_customer_id: "cus_mock_" + Math.random().toString(36).substr(2, 6),
        stripe_subscription_id: null,
        stripe_price_id: null,
        plan_code: "starter",
        status: "trialing",
        current_period_start: new Date().toISOString(),
        current_period_end: trialEnd.toISOString(),
        trial_end: trialEnd.toISOString(),
        cancel_at_period_end: false
      });
    }

    const status = sub.status;

    // 1. Block Access if Expired or Suspended/Unpaid
    if (status === "unpaid" || status === "incomplete") {
      return res.status(402).json({
        error: "Payment Required: Your subscription payment failed. Access suspended.",
        code: "SUBSCRIPTION_UNPAID",
        tenant_id: tenantId
      });
    }

    // Checking trialing expiration
    if (status === "trialing" && sub.trial_end) {
      const isTrialExpired = new Date(sub.trial_end).getTime() < Date.now();
      if (isTrialExpired) {
        return res.status(402).json({
          error: "Payment Required: Your 14-day free trial has expired. Please select a subscription tier to continue.",
          code: "TRIAL_EXPIRED",
          tenant_id: tenantId
        });
      }
    }

    // 2. Read-Only Constraint on Cancelled Subscriptions
    if (status === "canceled") {
      if (req.method !== "GET") {
        return res.status(403).json({
          error: "Forbidden: This tenant subscription is canceled. Read-only permissions active.",
          code: "SUBSCRIPTION_CANCELED_READ_ONLY",
          tenant_id: tenantId
        });
      }
    }

    // 3. Past Due: Limited access decoration
    if (status === "past_due") {
      (req as any).limitedAccess = true;
    }

    next();
  } catch (err) {
    console.error("[SubscriptionEnforcement Middleware Exception]:", err);
    next();
  }
}

/**
 * Evaluates feature authorization for a tenant
 */
export async function canAccessFeature(tenantId: string, featureKey: string): Promise<boolean> {
  const sub = await repo.getSubscription(tenantId);
  const planCode = sub?.plan_code || "starter";
  const plan = await repo.getPlanFeature(planCode);

  if (featureKey === "qr_order") return plan.can_qr_order;
  if (featureKey === "basic_pos") return plan.can_basic_pos;
  if (featureKey === "kitchen_display") return plan.can_kitchen_display;
  if (featureKey === "printer_support") return plan.can_printer_support;
  if (featureKey === "staff_roles") return plan.can_staff_roles;
  if (featureKey === "ai_translation") return plan.can_ai_translation;
  if (featureKey === "advanced_analytics") return plan.can_advanced_analytics;
  if (featureKey === "franchise_management") return plan.can_franchise_management;
  
  return false;
}

/**
 * Feature Gating Request Guard Middleware
 */
export function requireFeatureGating(featureKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: "Unauthorized session." });

    if (user.platform_role === "superadmin") {
      next();
      return;
    }

    const tenantId = req.params.restId || req.params.restaurantId || req.query.restaurantId || user.restaurantId;
    if (!tenantId) {
      next();
      return;
    }

    const isAvailable = await canAccessFeature(tenantId, featureKey);
    if (!isAvailable) {
      return res.status(403).json({
        error: `Forbidden: The '${featureKey}' capability is not included in your active subscription tier. Upgrade your plan to unlock this feature.`,
        code: "FEATURE_GATED",
        feature: featureKey
      });
    }

    next();
  };
}

/**
 * Checks outlet capacity before branch creation (Starter = 1, Growth = 3, Pro = Unlimited)
 */
export async function canCreateOutlet(tenantId: string): Promise<boolean> {
  const sub = await repo.getSubscription(tenantId);
  const planCode = sub?.plan_code || "starter";
  const plan = await repo.getPlanFeature(planCode);

  try {
    const { count, error } = await supabaseAdmin
      .from("restaurants")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", tenantId);

    if (error) throw error;
    
    const countVal = count || 0;
    return countVal < plan.max_outlets;
  } catch (err) {
    console.warn("[Billing Gating] Failed calculating outlets counts, using zero fallback limit count:", err);
  }
  return true;
}

/**
 * Checks character translation permissions
 */
export async function canUseAITranslation(tenantId: string, charsCount: number = 0): Promise<boolean> {
  const hasFeature = await canAccessFeature(tenantId, "ai_translation");
  if (!hasFeature) return false;

  const usage = await repo.getUsage(tenantId, "translation_characters");
  const limit = usage?.max_limit || 50000;
  const current = usage?.current_usage || 0;

  return (current + charsCount) <= limit;
}

/**
 * Middleware preventing adding physical restaurants over subscription tier capacity
 */
export async function checkOutletLimit(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const tenantId = user.restaurantId || req.body.organization_id || req.body.organizationId;
  if (!tenantId) {
    next();
    return;
  }

  const allowed = await canCreateOutlet(tenantId);
  if (!allowed) {
    return res.status(403).json({
      error: "Subscription Limit Reached: Your current plan does not allow spawning additional outlets. Please upgrade.",
      code: "OUTLET_LIMIT_EXCEEDED"
    });
  }

  next();
}
