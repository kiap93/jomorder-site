import { SupabaseClient } from "@supabase/supabase-js";
import { BillingRepository } from "../repositories/billingRepository";
import { getStripeClient, PLAN_PRICES } from "./stripe";
import { TenantSubscription, PlanCode } from "../types";
import { supabaseAdmin } from "../../server/services/dbService";

export class BillingService {
  private repo: BillingRepository;
  private supabaseClient: SupabaseClient;
  private stripeApiKey?: string;

  constructor(supabaseClient?: SupabaseClient, stripeApiKey?: string) {
    this.supabaseClient = supabaseClient || supabaseAdmin;
    this.repo = new BillingRepository(this.supabaseClient);
    this.stripeApiKey = stripeApiKey;
  }

  /**
   * Helper to resolve the correct organization ID (tenant_id in subscriptions table) from a restaurant ID
   */
  async resolveOrganizationId(tenantId: string): Promise<string> {
    try {
      const { data: restData } = await this.supabaseClient
        .from("restaurants")
        .select("organization_id")
        .eq("id", tenantId)
        .maybeSingle();
      if (restData?.organization_id) {
        return restData.organization_id;
      }
    } catch (err) {
      console.warn("[BillingService] Error resolving organization_id from restaurantId:", err);
    }
    return tenantId;
  }

  /**
   * Safe retrieval of active subscription and features overview for a tenant
   */
  async getTenantBillingOverview(tenantId: string) {
    const dbTenantId = await this.resolveOrganizationId(tenantId);
    let subscription = await this.repo.getSubscription(dbTenantId);
    
    // Auto-bootstrap a 14-day trial if no subscription at all exists
    if (!subscription) {
      subscription = await this.bootstrapTrial(tenantId, dbTenantId);
    } else if (subscription.status === "trialing" && (subscription.stripe_customer_id?.startsWith("cus_mock") || subscription.stripe_customer_id === "cus_fallback")) {
      // Align existing mock trial subscriptions with the organization/restaurant registration date to ensure accurate countdown
      try {
        let regDate: Date | null = null;
        const { data: restData } = await this.supabaseClient
          .from("restaurants")
          .select("created_at")
          .eq("id", tenantId)
          .maybeSingle();
        if (restData?.created_at) {
          regDate = new Date(restData.created_at);
        } else {
          const { data: orgData } = await this.supabaseClient
            .from("organizations")
            .select("created_at")
            .eq("id", dbTenantId)
            .maybeSingle();
          if (orgData?.created_at) {
            regDate = new Date(orgData.created_at);
          }
        }

        if (regDate) {
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
    const outletsUsage = await this.repo.getUsage(dbTenantId, "outlets_count");
    const translationUsage = await this.repo.getUsage(dbTenantId, "translation_characters");

    const usageLimits = [
      outletsUsage || {
        id: "usage_outlets",
        tenant_id: dbTenantId,
        metric_code: "outlets_count" as const,
        current_usage: 0,
        max_limit: plan.max_outlets,
        reset_at: null,
        updated_at: new Date().toISOString()
      },
      translationUsage || {
        id: "usage_translation",
        tenant_id: dbTenantId,
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

    // Fetch live invoices from Stripe if customer exists and is not mock, otherwise generate dynamic statements
    let invoices: any[] = [];
    try {
      const customerMap = await this.repo.getBillingCustomer(dbTenantId);
      if (customerMap && customerMap.stripe_customer_id && 
          !customerMap.stripe_customer_id.startsWith("cus_mock") && 
          customerMap.stripe_customer_id !== "cus_fallback") {
        const stripe = getStripeClient(this.stripeApiKey);
        const stripeInvoices = await stripe.invoices.list({
          customer: customerMap.stripe_customer_id,
          limit: 20
        });
        invoices = stripeInvoices.data.map((inv: any) => ({
          id: inv.id,
          number: inv.number || inv.id,
          date: new Date(inv.created * 1000).toISOString().split("T")[0],
          description: inv.description || `Sikmatye Plan Subscription Renewal - ${subscription?.plan_code?.toUpperCase() || "STARTER"}`,
          amount: `${inv.currency ? inv.currency.toUpperCase() : "RM"}${(inv.total / 100).toFixed(2)}`,
          status: inv.status === "paid" ? "paid" : "trial_invoice",
          receiptUrl: inv.invoice_pdf || inv.hosted_invoice_url || "#",
          isMock: false,
          planCode: subscription.plan_code
        }));
      }
    } catch (err) {
      console.warn("[BillingService] Error fetching live Stripe invoices, falling back to simulated history:", err);
    }

    if (invoices.length === 0) {
      invoices = this.generateDynamicInvoices(subscription);
    }

    return {
      subscription,
      plan,
      usage: usageLimits,
      trialDaysLeft,
      invoices
    };
  }

  /**
   * Generate realistic past statements derived from active database subscription parameters
   */
  generateDynamicInvoices(subscription: TenantSubscription) {
    const list: any[] = [];
    const planName = subscription.plan_code === "pro" ? "Pro Enterprise Plan" : subscription.plan_code === "growth" ? "Growth Plan" : "Starter Plan";
    const planRate = subscription.plan_code === "pro" ? "RM98.00" : subscription.plan_code === "growth" ? "RM38.00" : "RM18.00";
    
    const startDateStr = subscription.current_period_start || new Date().toISOString();
    const startDate = new Date(startDateStr);

    if (subscription.status === "trialing") {
      list.push({
        id: `INV-TRIAL-${subscription.tenant_id.slice(0, 4).toUpperCase()}`,
        number: `INV-TRIAL-${subscription.tenant_id.slice(0, 4).toUpperCase()}`,
        date: startDate.toISOString().split("T")[0],
        description: "Sikmatye Onboarding Trial Bootstrap Session",
        amount: "RM0.00",
        status: "trial_invoice",
        receiptUrl: "#",
        isMock: true,
        planCode: subscription.plan_code
      });
    } else {
      // Current Month renewal
      list.push({
        id: `INV-${startDate.getFullYear()}${(startDate.getMonth() + 1).toString().padStart(2, '0')}-${subscription.tenant_id.slice(0, 4).toUpperCase()}`,
        number: `INV-${startDate.getFullYear()}${(startDate.getMonth() + 1).toString().padStart(2, '0')}-${subscription.tenant_id.slice(0, 4).toUpperCase()}`,
        date: startDate.toISOString().split("T")[0],
        description: `Sikmatye Plan Subscription Renewal - ${planName}`,
        amount: planRate,
        status: "paid",
        receiptUrl: "#",
        isMock: true,
        planCode: subscription.plan_code
      });

      // Previous Month renewal (30 days ago)
      const prevDate = new Date(startDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      list.push({
        id: `INV-${prevDate.getFullYear()}${(prevDate.getMonth() + 1).toString().padStart(2, '0')}-${subscription.tenant_id.slice(0, 4).toUpperCase()}`,
        number: `INV-${prevDate.getFullYear()}${(prevDate.getMonth() + 1).toString().padStart(2, '0')}-${subscription.tenant_id.slice(0, 4).toUpperCase()}`,
        date: prevDate.toISOString().split("T")[0],
        description: `Sikmatye Plan Subscription Renewal - ${planName}`,
        amount: planRate,
        status: "paid",
        receiptUrl: "#",
        isMock: true,
        planCode: subscription.plan_code
      });

      // Original Trial Invoice
      const trialDate = new Date(startDate.getTime() - 44 * 24 * 60 * 60 * 1000);
      list.push({
        id: `INV-TRIAL-${subscription.tenant_id.slice(0, 4).toUpperCase()}`,
        number: `INV-TRIAL-${subscription.tenant_id.slice(0, 4).toUpperCase()}`,
        date: trialDate.toISOString().split("T")[0],
        description: "Sikmatye Onboarding Trial Bootstrap Session",
        amount: "RM0.00",
        status: "trial_invoice",
        receiptUrl: "#",
        isMock: true,
        planCode: subscription.plan_code
      });
    }

    return list;
  }

  /**
   * Bootstrap immediate 14-day free trial on signup if missing
   */
  async bootstrapTrial(tenantId: string, orgId: string): Promise<TenantSubscription> {
    const trialDays = 14;
    let registrationDate = new Date();
    
    // Fetch tenant email and created_at if possible
    let email = "business@sikmatye.com";
    try {
      const { data: restData } = await this.supabaseClient
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
        const { data: orgData } = await this.supabaseClient
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
      console.warn("[BillingService] Error fetching registration date:", err);
    }

    const trialEnd = new Date(registrationDate.getTime() + trialDays * 24 * 60 * 60 * 1000);

    console.log(`[BillingService] Bootstrapping 14-day trial plan 'starter' for Tenant: ${orgId}, starting from registration: ${registrationDate.toISOString()}`);

    return await this.repo.upsertSubscription({
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
  }

  /**
   * Generate Checkout URL for the user
   */
  async createCheckoutSession(tenantId: string, planCode: PlanCode, email: string, returnUrl: string) {
    const dbTenantId = await this.resolveOrganizationId(tenantId);
    const stripe = getStripeClient(this.stripeApiKey);
    const config = PLAN_PRICES[planCode];

    if (!config) {
      throw new Error(`Invalid plan code specified: ${planCode}`);
    }

    // Check if customer mapped
    let customerId = "";
    const customerMap = await this.repo.getBillingCustomer(dbTenantId);
    if (customerMap) {
      customerId = customerMap.stripe_customer_id;
    } else {
      // Create Stripe customer
      try {
        const customer = await stripe.customers.create({
          email,
          metadata: { tenant_id: dbTenantId }
        });
        customerId = customer.id;
        await this.repo.upsertBillingCustomer({
          tenant_id: dbTenantId,
          stripe_customer_id: customerId,
          email
        });
      } catch (err) {
        console.warn("[BillingService] Stripe customer creation fallback:", err);
        customerId = "cus_mock_" + Math.random().toString(36).substr(2, 6);
      }
    }

    // Configure subscription data including 14-day trial if no existing payment history
    const existingSub = await this.repo.getSubscription(dbTenantId);
    const hasConsumedTrialBefore = existingSub && existingSub.stripe_subscription_id !== null;
    
    const subscriptionData: Record<string, unknown> = {
      metadata: { tenant_id: dbTenantId, plan_code: planCode }
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
            price: config.priceId.startsWith("price_Sikmatye") || config.priceId.startsWith("price_Sikmatye") ? undefined : config.priceId,
            price_data: config.priceId.startsWith("price_Sikmatye") || config.priceId.startsWith("price_Sikmatye") ? {
              currency: "myr",
              product_data: {
                name: `Sikmatye ${config.planName}`,
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
        metadata: { tenant_id: dbTenantId, plan_code: planCode }
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
    const dbTenantId = await this.resolveOrganizationId(tenantId);
    const stripe = getStripeClient(this.stripeApiKey);
    let customerMap = await this.repo.getBillingCustomer(dbTenantId);

    const ensureCustomer = async (): Promise<any> => {
      let email = "business@sikmatye.com";
      try {
        const { data } = await this.supabaseClient
          .from("organizations")
          .select("name")
          .eq("id", dbTenantId)
          .maybeSingle();
        if (data?.name) {
          email = `${data.name.toLowerCase().replace(/\s+/g, "")}@Sikmatye.com`;
        }
      } catch (_) {}

      const customer = await stripe.customers.create({
        email,
        metadata: { tenant_id: dbTenantId }
      });
      return await this.repo.upsertBillingCustomer({
        tenant_id: dbTenantId,
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
    const dbTenantId = await this.resolveOrganizationId(tenantId);
    const subscription = await this.repo.getSubscription(dbTenantId);
    if (!subscription) {
      throw new Error("No subscription found for this tenant.");
    }

    const stripe = getStripeClient(this.stripeApiKey);
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
    const dbTenantId = await this.resolveOrganizationId(tenantId);
    const subscription = await this.repo.getSubscription(dbTenantId);
    if (!subscription) {
      throw new Error("No subscription found to upgrade.");
    }

    const stripe = getStripeClient(this.stripeApiKey);
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
