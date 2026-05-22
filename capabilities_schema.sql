-- ==========================================
-- CAPABILITY-BASED MULTI-TENANT ARCHITECTURE
-- Production-Grade PostgreSQL Schema
-- ==========================================

-- 1. SAAS PLANS & TIERS TABLE
-- Definition of packages, limits, and system capabilities.
CREATE TABLE IF NOT EXISTS public.saas_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    max_outlets INTEGER NOT NULL DEFAULT 1 CHECK (max_outlets >= 1),
    multi_outlet_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    franchise_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    price_myr NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    features JSONB NOT NULL DEFAULT '{
        "duitnow_payment": true,
        "partial_payment": false,
        "kitchen_display": true,
        "multi_language_menu": true,
        "socket_realtime": true
    }'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

COMMENT ON TABLE public.saas_plans IS 'Stores SaaS plans and tier limitations that superadmins configure.';

-- Seed Standard SaaS Tiers
INSERT INTO public.saas_plans (id, name, max_outlets, multi_outlet_enabled, franchise_mode_enabled, price_myr, features)
VALUES 
('free', 'Standard Free SLA', 1, FALSE, FALSE, 0.00, '{"duitnow_payment": true, "partial_payment": false, "kitchen_display": true, "multi_language_menu": true, "socket_realtime": true}'),
('pro', 'Pro Merchant Plan', 5, TRUE, FALSE, 199.00, '{"duitnow_payment": true, "partial_payment": true, "kitchen_display": true, "multi_language_menu": true, "socket_realtime": true}'),
('enterprise', 'Enterprise VIP / Franchise HQ', 99, TRUE, TRUE, 499.00, '{"duitnow_payment": true, "partial_payment": true, "kitchen_display": true, "multi_language_menu": true, "socket_realtime": true}')
ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name,
    max_outlets = EXCLUDED.max_outlets,
    multi_outlet_enabled = EXCLUDED.multi_outlet_enabled,
    franchise_mode_enabled = EXCLUDED.franchise_mode_enabled,
    price_myr = EXCLUDED.price_myr,
    features = EXCLUDED.features;


-- 2. CORPORATE GROUPS: ORGANIZATIONS
-- The legal/billing entity owning one or more physical outlets.
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    company_register_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

COMMENT ON TABLE public.organizations IS 'Stores corporate clients who own operational brands and retail accounts.';


-- 3. CAPABILITY CONTROLLER: ORGANIZATION SETTINGS
-- Holds SaaS capability matrices per Organization (Business level overrides).
CREATE TABLE IF NOT EXISTS public.organization_settings (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    subscription_plan TEXT NOT NULL DEFAULT 'free' REFERENCES public.saas_plans(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    multi_outlet_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    max_outlets INTEGER NOT NULL DEFAULT 1 CHECK (max_outlets >= 1),
    franchise_mode BOOLEAN NOT NULL DEFAULT FALSE,
    features JSONB NOT NULL DEFAULT '{
        "duitnow_payment": true,
        "partial_payment": false,
        "kitchen_display": true,
        "multi_language_menu": true,
        "socket_realtime": true
    }'::jsonb,
    api_calls_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

COMMENT ON TABLE public.organization_settings IS 'Stores capabilities, plan limits, and feature permissions at the business level.';


-- 4. OPERATIONAL OUTLETS: RESTAURANTS (BRANCHES)
-- Each physical outlet represents a separate workspace, but belongs to an Organization.
CREATE TABLE IF NOT EXISTS public.restaurants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'MYR',
    service_charge NUMERIC(4, 2) NOT NULL DEFAULT 6.00,
    sst NUMERIC(4, 2) NOT NULL DEFAULT 10.00,
    owner_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

COMMENT ON TABLE public.restaurants IS 'Stores the retail branch outlets that belong to an organization and serve tables.';


-- 5. STAFF BOUNDARIES: REPRESENTING GLOBAL SYSTEM ROLES (RBAC)
-- - Superadmin: System operations
-- - Organization Owner: Strategic business-level operations across outlets
-- - Branch staff: Day-to-day operations confined to specific retail outlets

-- User mapping to Organizations
CREATE TABLE IF NOT EXISTS public.organization_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'manager', 'member', 'billing')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(organization_id, user_id)
);

-- User mapping to specific Branch Outlets with fine-grained operational parameters
CREATE TABLE IF NOT EXISTS public.restaurant_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role TEXT NOT NULL DEFAULT 'waiter' CHECK (role IN ('owner', 'manager', 'cashier', 'kitchen', 'waiter', 'runner', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    custom_permissions JSONB NOT NULL DEFAULT '{
        "can_refund": false,
        "can_edit_menu": false,
        "can_cancel_order": false,
        "can_view_analytics": false,
        "can_manage_staff": false
    }'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(restaurant_id, user_id)
);


-- ==================================================
-- 6. TRIGGER AUTOMATION FOR INCEPTION CAPABILITIES
-- Every new organization automatically provisions default plan level parameters!
-- ==================================================

CREATE OR REPLACE FUNCTION public.auto_provision_org_settings()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.organization_settings (
        organization_id, 
        subscription_plan, 
        status, 
        multi_outlet_enabled, 
        max_outlets, 
        franchise_mode, 
        features
    )
    VALUES (
        NEW.id,
        'free',
        'active',
        FALSE,
        1,
        FALSE,
        '{
            "duitnow_payment": true,
            "partial_payment": false,
            "kitchen_display": true,
            "multi_language_menu": true,
            "socket_realtime": true
        }'::jsonb
    )
    ON CONFLICT (organization_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER tr_auto_provision_org_settings
    AFTER INSERT ON public.organizations
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_provision_org_settings();
