import { Request, Response, NextFunction } from "express";
import { BillingRepository } from "../repositories/billingRepository";
import { supabaseAdmin } from "../../server/services/dbService";
import { AuthenticatedRequest } from "../../server/middleware/authMiddleware";

const repo = new BillingRepository();

/**
 * Helper to resolve the correct organization ID (tenant_id in subscriptions table) from a restaurant ID
 */
export async function resolveOrganizationId(tenantId: string): Promise<string> {
  try {
    const { data: restData } = await supabaseAdmin
      .from("restaurants")
      .select("organization_id")
      .eq("id", tenantId)
      .maybeSingle();
    if (restData?.organization_id) {
      return restData.organization_id;
    }
  } catch (err) {
    console.warn("[SubscriptionMiddleware] Error resolving organization_id from restaurantId:", err);
  }
  return tenantId;
}

/**
 * Enterprise Subscription Enforcement Middleware
 * Implements standard SaaS states:
 * - trialing / active: Full Access
 * - past_due: Limited Access (Allows requests but appends warning flags)
 * - canceled: Read-Only Access (permits only GET requests; blocks all mutations)
 * - unpaid / suspended / expired: Blocks absolute access (402 Payment Required)
 */
export async function requireSubscriptionEnforcement(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const user = req.user;
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
    const orgId = await resolveOrganizationId(tenantId);
    let sub = await repo.getSubscription(orgId);
    
    // Auto trial bootstrap if subscription record is absent
    if (!sub) {
      const trialDays = 14;
      let registrationDate = new Date();
      
      // Fetch tenant email and created_at if possible
      let email = "business@sikmatye.com";
      try {
        const { data: restData } = await supabaseAdmin
          .from("restaurants")
          .select("name, created_at")
          .eq("id", tenantId)
          .maybeSingle();

        if (restData) {
          if (restData.created_at) {
            registrationDate = new Date(restData.created_at);
          }
          if (restData.name) {
            email = `${restData.name.toLowerCase().replace(/\s+/g, "")}@Sikmatye.com`;
          }
        } else {
          const { data: orgData } = await supabaseAdmin
            .from("organizations")
            .select("name, created_at")
            .eq("id", orgId)
            .maybeSingle();
          if (orgData) {
            if (orgData.created_at) {
              registrationDate = new Date(orgData.created_at);
            }
            if (orgData.name) {
              email = `${orgData.name.toLowerCase().replace(/\s+/g, "")}@Sikmatye.com`;
            }
          }
        }
      } catch (err) {
        console.warn("[SubscriptionMiddleware] Error fetching registration date:", err);
      }

      const trialEnd = new Date(registrationDate.getTime() + trialDays * 24 * 60 * 60 * 1000);
      
      sub = await repo.upsertSubscription({
        tenant_id: orgId,
        stripe_customer_id: "cus_mock_" + Math.random().toString(36).substr(2, 6),
        stripe_subscription_id: null,
        stripe_price_id: null,
        plan_code: "starter",
        status: "trialing",
        current_period_start: registrationDate.toISOString(),
        current_period_end: trialEnd.toISOString(),
        trial_end: trialEnd.toISOString(),
        cancel_at_period_end: false
      });
    } else if (sub.status === "trialing" && (sub.stripe_customer_id?.startsWith("cus_mock") || sub.stripe_customer_id === "cus_fallback")) {
      // Align existing mock trial subscriptions with the organization/restaurant registration date to ensure accurate countdown
      try {
        let regDate: Date | null = null;
        const { data: restData } = await supabaseAdmin
          .from("restaurants")
          .select("created_at")
          .eq("id", tenantId)
          .maybeSingle();
        if (restData?.created_at) {
          regDate = new Date(restData.created_at);
        } else {
          const { data: orgData } = await supabaseAdmin
            .from("organizations")
            .select("created_at")
            .eq("id", orgId)
            .maybeSingle();
          if (orgData?.created_at) {
            regDate = new Date(orgData.created_at);
          }
        }

        if (regDate) {
          const alignedTrialEnd = new Date(regDate.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
          if (sub.trial_end !== alignedTrialEnd) {
            sub.trial_end = alignedTrialEnd;
            sub.current_period_end = alignedTrialEnd;
            await repo.upsertSubscription(sub);
          }
        }
      } catch (err) {
        console.warn("[SubscriptionMiddleware] Error aligning existing trial dates:", err);
      }
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
      req.limitedAccess = true;
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
  const orgId = await resolveOrganizationId(tenantId);
  const sub = await repo.getSubscription(orgId);
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
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "Unauthorized session." });

    if (user.platform_role === "superadmin") {
      next();
      return;
    }

    const tenantId = (req.params.restId || req.params.restaurantId || req.query.restaurantId || user.restaurantId) as string;
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
  const orgId = await resolveOrganizationId(tenantId);
  const sub = await repo.getSubscription(orgId);
  const planCode = sub?.plan_code || "starter";
  const plan = await repo.getPlanFeature(planCode);

  try {
    const { count, error } = await supabaseAdmin
      .from("restaurants")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);

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

  const orgId = await resolveOrganizationId(tenantId);
  const usage = await repo.getUsage(orgId, "translation_characters");
  const limit = usage?.max_limit || 50000;
  const current = usage?.current_usage || 0;

  return (current + charsCount) <= limit;
}

/**
 * Middleware preventing adding physical restaurants over subscription tier capacity
 */
export async function checkOutletLimit(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const user = req.user;
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
