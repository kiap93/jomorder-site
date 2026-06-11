import { SupabaseClient } from "@supabase/supabase-js";
import { BillingRepository } from "../repositories/billingRepository";
import { getStripeClient, PLAN_PRICES, getPlanCodeFromPriceId } from "./stripe";
import { TenantSubscription, PlanCode, SubscriptionStatus } from "../types";
import { supabaseAdmin } from "../../server/services/dbService";

export class BillingService {
  private repo: BillingRepository;
  private supabaseClient: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabaseClient = supabaseClient || supabaseAdmin;
    this.repo = new BillingRepository(this.supabaseClient);
  }

  /**
   * Safe retrieval of active subscription and features overview for a tenant
   */
  async getTenantBillingOverview(tenantId: string) {
    let subscription = await this.repo.getSubscription(tenantId);
    
    // Auto-bootstrap a 14-day trial if no subscription at all exists
    if (!subscription) {
      subscription = await this.bootstrapTrial(tenantId);
    } else if (subscription.status === "trialing" && (subscription.stripe_customer_id?.startsWith("cus_mock") || subscription.stripe_customer_id === "cus_fallback")) {
      // Align existing mock trial subscriptions with the organization registration date to ensure accurate countdown
      try {
        const { data } = await this.supabaseClient
          .from("organizations")
          .select("created_at")
          .eq("id", tenantId)
          .maybeSingle();
        if (data?.created_at) {
          const regDate = new Date(data.created_at);
          const alignedTrialEnd = new Date(regDate.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
          if (subscription.trial_end !== alignedTrialEnd) {
            subscription.trial_end = alignedTrialEnd;
            subscription.current_period_end = alignedTrialEnd;
            // Persist the corrected trial dates
            await this.repo.upsertSubscription(subscription);
          }
        }
      } catch (err) {
        console.warn("[BillingService] Error aligning existing trial dates:", err);
      }
    }

    const plan = await this.repo.getPlanFeature(subscription.plan_code);
    
    // Query metrics usage
    const outletsUsage = await this.repo.getUsage(tenantId, "outlets_count");
    const translationUsage = await this.repo.getUsage(tenantId, "translation_characters");

    const usageLimits = [
      outletsUsage || {
        id: "usage_outlets",
        tenant_id: tenantId,
        metric_code: "outlets_count" as const,
        current_usage: 0,
        max_limit: plan.max_outlets,
        reset_at: null,
        updated_at: new Date().toISOString()
      },
      translationUsage || {
        id: "usage_translation",
        tenant_id: tenantId,
        metric_code: "translation_characters" as const,
        current_usage: 0,
        max_limit: plan.can_ai_translation ? 50000 : 0,
        reset_at: null,
        updated_at: new Date().toISOString()
      }
    ];

    // Calculate trial days remaining
    let trialDaysLeft = 0;
    if (subscription.status === "trialing" && subscription.trial_end) {
      const diffTime = new Date(subscription.trial_end).getTime() - Date.now();
      trialDaysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (trialDaysLeft < 0) trialDaysLeft = 0;
    }

    return {
      subscription,
      plan,
      usage: usageLimits,
      trialDaysLeft
    };
  }

  /**
   * Bootstrap immediate 14-day free trial on signup if missing
   */
  async bootstrapTrial(tenantId: string): Promise<TenantSubscription> {
    const trialDays = 14;
    let registrationDate = new Date();
    
    // Fetch tenant email and created_at if possible
    let email = "business@jomorder.com";
    try {
      const { data } = await this.supabaseClient
        .from("organizations")
        .select("name, created_at")
        .eq("id", tenantId)
        .maybeSingle();
      if (data?.name) {
        // Construct simulated email or retrieve from contact
        email = `${data.name.toLowerCase().replace(/\s+/g, "")}@jomorder.com`;
      }
      if (data?.created_at) {
        registrationDate = new Date(data.created_at);
      }
    } catch (_) {}

    const trialEnd = new Date(registrationDate.getTime() + trialDays * 24 * 60 * 60 * 1000);

    console.log(`[BillingService] Bootstrapping 14-day trial plan 'starter' for Tenant: ${tenantId}, starting from registration: ${registrationDate.toISOString()}`);

    return await this.repo.upsertSubscription({
      tenant_id: tenantId,
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
  }

  /**
   * Generate Checkout URL for the user
   */
  async createCheckoutSession(tenantId: string, planCode: PlanCode, email: string, returnUrl: string) {
    const stripe = getStripeClient();
    const config = PLAN_PRICES[planCode];

    if (!config) {
      throw new Error(`Invalid plan code specified: ${planCode}`);
    }

    // Check if customer mapped
    let customerId = "";
    const customerMap = await this.repo.getBillingCustomer(tenantId);
    if (customerMap) {
      customerId = customerMap.stripe_customer_id;
    } else {
      // Create Stripe customer
      try {
        const customer = await stripe.customers.create({
          email,
          metadata: { tenant_id: tenantId }
        });
        customerId = customer.id;
        await this.repo.upsertBillingCustomer({
          tenant_id: tenantId,
          stripe_customer_id: customerId,
          email
        });
      } catch (err) {
        console.warn("[BillingService] Stripe customer creation fallback:", err);
        customerId = "cus_mock_" + Math.random().toString(36).substr(2, 6);
      }
    }

    // Configure subscription data including 14-day trial if no existing payment history
    const existingSub = await this.repo.getSubscription(tenantId);
    const hasConsumedTrialBefore = existingSub && existingSub.stripe_subscription_id !== null;
    
    const subscriptionData: Record<string, unknown> = {
      metadata: { tenant_id: tenantId, plan_code: planCode }
    };

    if (!hasConsumedTrialBefore) {
      // 14 days full trial on checkout
      subscriptionData.trial_period_days = 14;
    }

    try {
      const session = await stripe.checkout.sessions.create({
        customer: customerId.startsWith("cus_mock") ? undefined : customerId,
        customer_email: customerId.startsWith("cus_mock") ? email : undefined,
        payment_method_types: ["card"],
        mode: "subscription",
        line_items: [
          {
            price: config.priceId.startsWith("price_JomOrder") ? undefined : config.priceId,
            price_data: config.priceId.startsWith("price_JomOrder") ? {
              currency: "myr",
              product_data: {
                name: `JomOrder ${config.planName}`,
                description: `Monthly recurring subscription for ${config.planName}`,
              },
              unit_amount: Math.round(config.priceAmount * 100),
              recurring: { interval: "month" }
            } : undefined,
            quantity: 1
          }
        ],
        subscription_data: subscriptionData,
        success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}&billing_status=success`,
        cancel_url: `${returnUrl}?billing_status=cancelled`,
        metadata: { tenant_id: tenantId, plan_code: planCode }
      });

      return { url: session.url };
    } catch (err: any) {
      console.error("[BillingService] Failed to create checkout session on Stripe:", err.message);
      
      // Local Sandbox Simulation URL for dev previews
      const mockCheckoutUrl = `${returnUrl}?session_id=cs_test_${Math.random().toString(36).substr(2, 9)}&simulate_plan=${planCode}`;
      return { url: mockCheckoutUrl };
    }
  }

  /**
   * Billing Custom Portal Session link creator
   */
  async createPortalSession(tenantId: string, returnUrl: string) {
    const stripe = getStripeClient();
    let customerMap = await this.repo.getBillingCustomer(tenantId);

    const ensureCustomer = async (): Promise<any> => {
      let email = "business@jomorder.com";
      try {
        const { data } = await this.supabaseClient
          .from("organizations")
          .select("name")
          .eq("id", tenantId)
          .maybeSingle();
        if (data?.name) {
          email = `${data.name.toLowerCase().replace(/\s+/g, "")}@jomorder.com`;
        }
      } catch (_) {}

      const customer = await stripe.customers.create({
        email,
        metadata: { tenant_id: tenantId }
      });
      return await this.repo.upsertBillingCustomer({
        tenant_id: tenantId,
        stripe_customer_id: customer.id,
        email
      });
    };

    if (!customerMap || customerMap.stripe_customer_id.includes("mock") || customerMap.stripe_customer_id.includes("fallback")) {
      customerMap = await ensureCustomer();
    }

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerMap!.stripe_customer_id,
        return_url: returnUrl
      });
      return { url: session.url };
    } catch (err: any) {
      console.warn("[BillingService] Stripe Client Portal Exception first attempt:", err.message);
      
      // If the customer didn't exist in stripe (e.g. invalid template ID or deleted), reconstruct and retry
      if (err.message?.includes("No such customer") || err.message?.includes("customer_invalid")) {
        try {
          console.log("[BillingService] Customer stale in Stripe. Re-creating...");
          customerMap = await ensureCustomer();
          const session = await stripe.billingPortal.sessions.create({
            customer: customerMap!.stripe_customer_id,
            return_url: returnUrl
          });
          return { url: session.url };
        } catch (retryErr: any) {
          throw new Error(`Stripe Portal activation failed: ${retryErr.message}`);
        }
      }
      
      throw err;
    }
  }

  /**
   * Safe immediate cancel
   */
  async cancelSubscription(tenantId: string): Promise<TenantSubscription> {
    const subscription = await this.repo.getSubscription(tenantId);
    if (!subscription) {
      throw new Error("No subscription found for this tenant.");
    }

    const stripe = getStripeClient();
    if (subscription.stripe_subscription_id && !subscription.stripe_subscription_id.startsWith("sub_fallback")) {
      try {
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          cancel_at_period_end: true
        });
      } catch (err) {
        console.warn("[BillingService] Cancel Stripe error, falling back locally:", err);
      }
    }

    const { id, created_at, updated_at, ...subscriptionData } = subscription;

    return await this.repo.upsertSubscription({
      ...subscriptionData,
      cancel_at_period_end: true,
      status: "canceled"
    });
  }

  /**
   * Apply proration upgrade
   */
  async upgradeSubscription(tenantId: string, targetPlan: PlanCode): Promise<TenantSubscription> {
    const subscription = await this.repo.getSubscription(tenantId);
    if (!subscription) {
      throw new Error("No subscription found to upgrade.");
    }

    const stripe = getStripeClient();
    const newPriceConfig = PLAN_PRICES[targetPlan];

    if (subscription.stripe_subscription_id && !subscription.stripe_subscription_id.startsWith("sub_fallback")) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
        const itemSecId = stripeSub.items.data[0].id;
        
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          proration_behavior: "always_invoice",
          items: [{
            id: itemSecId,
            price: newPriceConfig.priceId
          }]
        });
      } catch (err) {
        console.warn("[BillingService] Upgrade Stripe API error, updating locally:", err);
      }
    }

    const { id: subId, created_at: subCreatedAt, updated_at: subUpdatedAt, ...subData } = subscription;

    return await this.repo.upsertSubscription({
      ...subData,
      plan_code: targetPlan,
      status: "active",
      stripe_price_id: newPriceConfig.priceId
    });
  }
}
