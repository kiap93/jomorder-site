-- ==========================================
-- JOMORDER STRIPE SUBSCRIPTION BILLING SCHEMA
-- Production-Grade Multi-Tenant SaaS PostgreSQL
-- ==========================================

-- 1. SAAS SUBSCRIPTION PLAN DICTIONARY
CREATE TABLE IF NOT EXISTS public.plan_features (
    plan_code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    max_outlets INTEGER NOT NULL DEFAULT 1,
    can_qr_order BOOLEAN NOT NULL DEFAULT FALSE,
    can_basic_pos BOOLEAN NOT NULL DEFAULT FALSE,
    can_kitchen_display BOOLEAN NOT NULL DEFAULT FALSE,
    can_printer_support BOOLEAN NOT NULL DEFAULT FALSE,
    can_staff_roles BOOLEAN NOT NULL DEFAULT FALSE,
    can_ai_translation BOOLEAN NOT NULL DEFAULT FALSE,
    can_advanced_analytics BOOLEAN NOT NULL DEFAULT FALSE,
    can_franchise_management BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Seed Plan Features metadata
INSERT INTO public.plan_features (plan_code, name, max_outlets, can_qr_order, can_basic_pos, can_kitchen_display, can_printer_support, can_staff_roles, can_ai_translation, can_advanced_analytics, can_franchise_management)
VALUES 
('starter', 'JomOrder Starter', 1, TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE),
('growth', 'JomOrder Growth', 3, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, FALSE, FALSE),
('pro', 'JomOrder Pro', 9999, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE)
ON CONFLICT (plan_code) DO UPDATE SET
    name = EXCLUDED.name,
    max_outlets = EXCLUDED.max_outlets,
    can_qr_order = EXCLUDED.can_qr_order,
    can_basic_pos = EXCLUDED.can_basic_pos,
    can_kitchen_display = EXCLUDED.can_kitchen_display,
    can_printer_support = EXCLUDED.can_printer_support,
    can_staff_roles = EXCLUDED.can_staff_roles,
    can_ai_translation = EXCLUDED.can_ai_translation,
    can_advanced_analytics = EXCLUDED.can_advanced_analytics,
    can_franchise_management = EXCLUDED.can_franchise_management;


-- 2. BILLING CUSTOMERS MAPPING TABLE
CREATE TABLE IF NOT EXISTS public.billing_customers (
    tenant_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    stripe_customer_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);


-- 3. TENANT SUBSCRIPTIONS TABLE
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
    stripe_customer_id TEXT NOT NULL,
    stripe_subscription_id TEXT UNIQUE,
    stripe_price_id TEXT,
    plan_code TEXT NOT NULL REFERENCES public.plan_features(plan_code) DEFAULT 'starter',
    status TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete')),
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    trial_end TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);


-- 4. SUBSCRIPTION EVENT TELEMETRY LOGS
CREATE TABLE IF NOT EXISTS public.subscription_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
    event_type TEXT NOT NULL,
    stripe_event_id TEXT,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);


-- 5. USAGE METRICS ANALYZER
CREATE TABLE IF NOT EXISTS public.usage_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
    metric_code TEXT NOT NULL, -- 'outlets_count', 'translation_characters'
    current_usage INTEGER NOT NULL DEFAULT 0,
    max_limit INTEGER,
    reset_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (tenant_id, metric_code)
);
