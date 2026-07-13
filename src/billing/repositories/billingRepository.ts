import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin, readRegistry, writeRegistry, getOrganizationSettings, saveOrganizationSettings } from "../../server/services/dbService";
import { TenantSubscription, BillingCustomer, UsageTracking, SubscriptionEvent, PlanCode, SubscriptionStatus, PlanFeature } from "../types";
import { randomUUID } from "crypto";

export class BillingRepository {
  private supabase: SupabaseClient;

  constructor(supabase?: SupabaseClient) {
    this.supabase = supabase || supabaseAdmin;
  }

  // Plan capabilities registry dictionary
  static DEFAULT_PLAN_FEATURES: Record<PlanCode, Omit<PlanFeature, 'created_at'>> = {
    starter: {
      plan_code: 'starter',
      name: 'Starter Plan',
      max_outlets: 1,
      can_qr_order: true,
      can_basic_pos: true,
      can_kitchen_display: false,
      can_printer_support: false,
      can_staff_roles: false,
      can_ai_translation: false,
      can_advanced_analytics: false,
      can_franchise_management: false
    },
    growth: {
      plan_code: 'growth',
      name: 'Growth Plan',
      max_outlets: 3,
      can_qr_order: true,
      can_basic_pos: true,
      can_kitchen_display: true,
      can_printer_support: true,
      can_staff_roles: true,
      can_ai_translation: false,
      can_advanced_analytics: false,
      can_franchise_management: false
    },
    pro: {
      plan_code: 'pro',
      name: 'Pro Enterprise Plan',
      max_outlets: 9999,
      can_qr_order: true,
      can_basic_pos: true,
      can_kitchen_display: true,
      can_printer_support: true,
      can_staff_roles: true,
      can_ai_translation: true,
      can_advanced_analytics: true,
      can_franchise_management: true
    }
  };

  /**
   * Retrieves active plan features config
   */
  async getPlanFeature(planCode: PlanCode): Promise<PlanFeature> {
    try {
      const { data, error } = await this.supabase
        .from('plan_features')
        .select('*')
        .eq('plan_code', planCode)
        .maybeSingle();

      if (data) {
        return data as PlanFeature;
      }
    } catch (err) {
      console.warn("[BillingRepository] Exception querying plan_features table:", err);
    }
    
    // Fallback dictionary
    return {
      ...BillingRepository.DEFAULT_PLAN_FEATURES[planCode],
      created_at: new Date().toISOString()
    };
  }

  /**
   * Fetch Stripe maps to custom local tenant settings
   */
  async getBillingCustomer(tenantId: string): Promise<BillingCustomer | null> {
    try {
      const { data, error } = await this.supabase
        .from('billing_customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (data) {
        return data as BillingCustomer;
      }
    } catch (err) {
      console.warn("[BillingRepository] Failed to retrieve billing customer from database, checking fallbacks:", err);
    }

    // Inspect fallback registry structures
    const registry = readRegistry();
    if (registry[tenantId] && (registry[tenantId] as any).stripe_customer_id) {
      return {
        tenant_id: tenantId,
        stripe_customer_id: (registry[tenantId] as any).stripe_customer_id,
        email: (registry[tenantId] as any).stripe_customer_email || 'tenant@sikmatye.com',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }
    return null;
  }

  /**
   * Map database customer references
   */
  async upsertBillingCustomer(customer: Omit<BillingCustomer, 'created_at' | 'updated_at'>): Promise<BillingCustomer> {
    const timestamp = new Date().toISOString();
    const payload = {
      ...customer,
      updated_at: timestamp
    };

    try {
      const { data, error } = await this.supabase
        .from('billing_customers')
        .upsert({
          ...payload,
          created_at: timestamp
        }, { onConflict: 'tenant_id' })
        .select()
        .maybeSingle();

      if (error) throw error;
      if (data) return data as BillingCustomer;
    } catch (err) {
      console.warn("[BillingRepository] Failed writing billing customer to database, updating local json registry:", err);
    }

    const registry = readRegistry();
    if (!registry[customer.tenant_id]) {
      registry[customer.tenant_id] = {
        subscription_plan: 'free',
        status: 'active',
        features: { duitnow_payment: true, partial_payment: false, kitchen_display: true, multi_language_menu: true, socket_realtime: true },
        billing_history: [],
        api_calls_count: 50
      };
    }
    (registry[customer.tenant_id] as any).stripe_customer_id = customer.stripe_customer_id;
    (registry[customer.tenant_id] as any).stripe_customer_email = customer.email;
    writeRegistry(registry);

    return {
      ...payload,
      created_at: timestamp,
      updated_at: timestamp
    };
  }

  /**
   * Safe fetch subscription object
   */
  async getSubscription(tenantId: string): Promise<TenantSubscription | null> {
    try {
      const { data, error } = await this.supabase
        .from('subscriptions')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (data) {
        return data as TenantSubscription;
      }
    } catch (err) {
      console.warn("[BillingRepository] Failed querying subscription table, searching fallbacks:", err);
    }

    const registry = readRegistry();
    const billingMeta = registry[tenantId] as any;
    if (billingMeta && billingMeta.subscription_details) {
      return billingMeta.subscription_details as TenantSubscription;
    }
    return null;
  }

  /**
   * Write core subscription changes & force-sync capability rules
   */
  async upsertSubscription(sub: Omit<TenantSubscription, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<TenantSubscription> {
    const timestamp = new Date().toISOString();
    const recordId = sub.id || randomUUID();
    const payload = {
      ...sub,
      id: recordId,
      updated_at: timestamp
    };

    // Ensure plan features table is seeded before creating/upserting subscription
    await this.ensurePlanFeatures();

    try {
      // Direct supabase upsert
      const { data, error } = await this.supabase
        .from('subscriptions')
        .upsert({
          ...payload,
          created_at: timestamp
        }, { onConflict: 'tenant_id' })
        .select()
        .maybeSingle();

      if (error) console.warn("[Supabase Subscription Sync Error]", error.message);
    } catch (err) {
      console.warn("[BillingRepository] DB Upsert error:", err);
    }

    // Force synchronize the organization settings and local files for standard application capabilities
    await this.syncCapabilitiesAndRegistry(sub.tenant_id, sub.plan_code, sub.status, sub);

    return {
      ...payload,
      created_at: timestamp,
      updated_at: timestamp
    };
  }

  /**
   * Private helper translating Stripe Sub status to basic capabilities plan attributes
   */
  private async syncCapabilitiesAndRegistry(
    tenantId: string,
    planCode: PlanCode,
    status: SubscriptionStatus,
    subFields?: Partial<TenantSubscription>
  ) {
    const isSuspended = status === 'unpaid' || status === 'canceled';
    const activePlanId = planCode === 'pro' ? 'enterprise' : planCode === 'growth' ? 'pro' : 'free';
    
    const features = {
      duitnow_payment: true,
      partial_payment: planCode !== 'starter',
      kitchen_display: planCode !== 'starter',
      multi_language_menu: true,
      socket_realtime: true
    };

    const maxOutlets = planCode === 'pro' ? 9999 : planCode === 'growth' ? 3 : 1;

    // Save back to dbService organization_settings
    try {
      await saveOrganizationSettings(this.supabase, tenantId, {
        subscription_plan: activePlanId as any,
        status: isSuspended ? 'suspended' : 'active',
        multi_outlet_enabled: planCode !== 'starter',
        max_outlets: maxOutlets,
        franchise_mode: planCode === 'pro',
        features: features
      });
    } catch (err) {
      console.warn("[BillingRepository] Capabilities metadata sync error:", err);
    }

    // Direct JSON sync for dual-persistence rules
    const registry = readRegistry();
    if (!registry[tenantId]) {
      registry[tenantId] = {
        subscription_plan: activePlanId as any,
        status: isSuspended ? 'suspended' : 'active',
        features,
        billing_history: [],
        api_calls_count: 10
      };
    } else {
      registry[tenantId].subscription_plan = activePlanId as any;
      registry[tenantId].status = isSuspended ? 'suspended' : 'active';
      registry[tenantId].max_outlets = maxOutlets;
      registry[tenantId].multi_outlet_enabled = planCode !== 'starter';
      registry[tenantId].franchise_mode = planCode === 'pro';
      registry[tenantId].features = features;
    }

    // Store rich metadata schema
    const subDetails: TenantSubscription = {
      id: subFields?.id || randomUUID(),
      tenant_id: tenantId,
      stripe_customer_id: subFields?.stripe_customer_id || 'cus_fallback',
      stripe_subscription_id: subFields?.stripe_subscription_id || 'sub_fallback',
      stripe_price_id: subFields?.stripe_price_id || 'price_fallback',
      plan_code: planCode,
      status: status,
      current_period_start: subFields?.current_period_start || new Date().toISOString(),
      current_period_end: subFields?.current_period_end || new Date().toISOString(),
      trial_end: subFields?.trial_end !== undefined ? subFields.trial_end : null,
      cancel_at_period_end: subFields?.cancel_at_period_end || false,
      created_at: subFields?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    (registry[tenantId] as any).subscription_details = subDetails;
    writeRegistry(registry);
  }

  /**
   * Log billing event occurrences idempotently
   */
  async logEvent(event: Omit<SubscriptionEvent, 'id' | 'created_at'>): Promise<void> {
    const timestamp = new Date().toISOString();
    try {
      await this.supabase
        .from('subscription_events')
        .insert({
          ...event,
          created_at: timestamp
        });
    } catch (err) {
      console.warn("[BillingRepository] Failed logging SQL subscription event", err);
    }
  }

  /**
   * Track current usage limits and values
   */
  async getUsage(tenantId: string, metricCode: 'outlets_count' | 'translation_characters'): Promise<UsageTracking | null> {
    try {
      const { data, error } = await this.supabase
        .from('usage_tracking')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('metric_code', metricCode)
        .maybeSingle();

      if (data) return data as UsageTracking;
    } catch (err) {
      console.warn("[BillingRepository] Usage check SQL failure", err);
    }

    // Sync from internal active structures
    if (metricCode === 'outlets_count') {
      try {
        const { count, error } = await this.supabase
          .from('restaurants')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', tenantId);

        return {
          id: 'usage_outlets',
          tenant_id: tenantId,
          metric_code: 'outlets_count',
          current_usage: count || 0,
          max_limit: null,
          reset_at: null,
          updated_at: new Date().toISOString()
        };
      } catch (_) {}
    }

    return null;
  }

  /**
   * Increment metric logs
   */
  async incrementUsage(tenantId: string, metricCode: 'outlets_count' | 'translation_characters', incAmount: number = 1): Promise<void> {
    try {
      const current = await this.getUsage(tenantId, metricCode);
      const newUsage = (current?.current_usage || 0) + incAmount;
      const maxLimit = current?.max_limit || null;

      await this.supabase
        .from('usage_tracking')
        .upsert({
          tenant_id: tenantId,
          metric_code: metricCode,
          current_usage: newUsage,
          max_limit: maxLimit,
          updated_at: new Date().toISOString()
        }, { onConflict: 'tenant_id,metric_code' });
    } catch (err) {
      console.warn("[BillingRepository] Increment usage tracking error", err);
    }
  }

  /**
   * Safe seed plan features on-demand if empty to satisfy FK constraints
   */
  async ensurePlanFeatures(): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from('plan_features')
        .select('plan_code');
      
      if (!data || data.length === 0) {
        console.log("[BillingRepository] plan_features table is empty, seeding defaults...");
        const featuresToSeed = Object.keys(BillingRepository.DEFAULT_PLAN_FEATURES).map(code => ({
          plan_code: code,
          name: code === 'starter' ? 'Sikmatye Starter' : code === 'growth' ? 'Sikmatye Growth' : 'Sikmatye Pro',
          max_outlets: code === 'starter' ? 1 : code === 'growth' ? 3 : 9999,
          can_qr_order: true,
          can_basic_pos: true,
          can_kitchen_display: code !== 'starter',
          can_printer_support: code !== 'starter',
          can_staff_roles: code !== 'starter',
          can_ai_translation: code === 'pro',
          can_advanced_analytics: code === 'pro',
          can_franchise_management: code === 'pro',
          created_at: new Date().toISOString()
        }));

        const { error: seedError } = await this.supabase
          .from('plan_features')
          .insert(featuresToSeed);
        if (seedError) {
          console.error("[BillingRepository] Failed to seed plan_features:", seedError.message);
        }
      }
    } catch (err) {
      console.warn("[BillingRepository] Error checking/seeding plan_features:", err);
    }
  }
}
