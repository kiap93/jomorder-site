// TypeScript interfaces defining public parameters for Stripe Subscription Billing in Sikmatye.

export type PlanCode = 'starter' | 'growth' | 'pro';

export type SubscriptionStatus = 
  | 'trialing' 
  | 'active' 
  | 'past_due' 
  | 'canceled' 
  | 'unpaid' 
  | 'incomplete';

export interface PlanFeature {
  plan_code: PlanCode;
  name: string;
  max_outlets: number;
  can_qr_order: boolean;
  can_basic_pos: boolean;
  can_kitchen_display: boolean;
  can_printer_support: boolean;
  can_staff_roles: boolean;
  can_ai_translation: boolean;
  can_advanced_analytics: boolean;
  can_franchise_management: boolean;
  created_at: string;
}

export interface BillingCustomer {
  tenant_id: string; // references organization UUID
  stripe_customer_id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface TenantSubscription {
  id: string;
  tenant_id: string; // references organization UUID
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  plan_code: PlanCode;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionEvent {
  id: string;
  tenant_id: string;
  event_type: string;
  stripe_event_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface UsageTracking {
  id: string;
  tenant_id: string;
  metric_code: 'outlets_count' | 'translation_characters';
  current_usage: number;
  max_limit: number | null;
  reset_at: string | null;
  updated_at: string;
}

export interface BillingOverview {
  subscription: TenantSubscription | null;
  plan: PlanFeature;
  usage: UsageTracking[];
  trialDaysLeft: number;
}
