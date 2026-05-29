-- 20260529120000_rbac_schema.sql
-- Production-grade RBAC tables to enable future franchise, multi-role users, and tenant-scoped permissions

CREATE TABLE IF NOT EXISTS public.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES public.permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(tenant_id, user_id, role_id)
);

-- Seed basic roles
INSERT INTO public.roles (name, description) VALUES
('super_admin', 'System level operator bypass'),
('owner', 'Organization strategic operator'),
('manager', 'Branch outlet manager with staff management capability'),
('cashier', 'In-store cashier cashiering and billing operator'),
('waiter', 'Serving and floor team member'),
('kitchen', 'Kitchen display preparer with preparation capabilities')
ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;

-- Seed basic permissions
INSERT INTO public.permissions (code, description) VALUES
('orders.view', 'Allows viewing incoming client orders'),
('orders.prepare', 'Allows preparing queue orders at the KDS'),
('orders.bump', 'Bumps order in progress list to preparation status'),
('orders.ready', 'Finishes dishes and ready-alerts waiter servers'),
('payments.view', 'Enables view in ledger reports on paid status indicators'),
('payments.refund', 'Forces financial operations callback on cancellations'),
('reports.view', 'Discovers business tracking charts, summaries, analytics'),
('users.manage', 'Discharges, hires and configures staff login credentials settings'),
('settings.manage', 'Toggles hardware configurations, branch options and features')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

-- Link roles with permissions
-- Kitchen role gets only prepare/bump/ready/orders.view
-- Manager/owner/super_admin get everything
-- Cashier gets orders.view, orders.bump, orders.ready, payments.view
-- Waiter gets orders.view, orders.bump, orders.ready

DO $$
DECLARE
    role_sa UUID;
    role_ow UUID;
    role_ma UUID;
    role_ca UUID;
    role_wa UUID;
    role_ki UUID;
    p_ov UUID;
    p_op UUID;
    p_ob UUID;
    p_or UUID;
    p_pv UUID;
    p_pr UUID;
    p_rv UUID;
    p_um UUID;
    p_sm UUID;
BEGIN
    SELECT id INTO role_sa FROM public.roles WHERE name = 'super_admin';
    SELECT id INTO role_ow FROM public.roles WHERE name = 'owner';
    SELECT id INTO role_ma FROM public.roles WHERE name = 'manager';
    SELECT id INTO role_ca FROM public.roles WHERE name = 'cashier';
    SELECT id INTO role_wa FROM public.roles WHERE name = 'waiter';
    SELECT id INTO role_ki FROM public.roles WHERE name = 'kitchen';

    SELECT id INTO p_ov FROM public.permissions WHERE code = 'orders.view';
    SELECT id INTO p_op FROM public.permissions WHERE code = 'orders.prepare';
    SELECT id INTO p_ob FROM public.permissions WHERE code = 'orders.bump';
    SELECT id INTO p_or FROM public.permissions WHERE code = 'orders.ready';
    SELECT id INTO p_pv FROM public.permissions WHERE code = 'payments.view';
    SELECT id INTO p_pr FROM public.permissions WHERE code = 'payments.refund';
    SELECT id INTO p_rv FROM public.permissions WHERE code = 'reports.view';
    SELECT id INTO p_um FROM public.permissions WHERE code = 'users.manage';
    SELECT id INTO p_sm FROM public.permissions WHERE code = 'settings.manage';

    -- SA/Owner/Manager Mapping (All permissions)
    IF role_sa IS NOT NULL AND p_ov IS NOT NULL THEN
        INSERT INTO public.role_permissions (role_id, permission_id) VALUES
        (role_sa, p_ov), (role_sa, p_op), (role_sa, p_ob), (role_sa, p_or), (role_sa, p_pv), (role_sa, p_pr), (role_sa, p_rv), (role_sa, p_um), (role_sa, p_sm),
        (role_ow, p_ov), (role_ow, p_op), (role_ow, p_ob), (role_ow, p_or), (role_ow, p_pv), (role_ow, p_pr), (role_ow, p_rv), (role_ow, p_um), (role_ow, p_sm),
        (role_ma, p_ov), (role_ma, p_op), (role_ma, p_ob), (role_ma, p_or), (role_ma, p_pv), (role_ma, p_pr), (role_ma, p_rv), (role_ma, p_um), (role_ma, p_sm)
        ON CONFLICT DO NOTHING;
    END IF;

    -- Cashier Mapping
    IF role_ca IS NOT NULL AND p_ov IS NOT NULL THEN
        INSERT INTO public.role_permissions (role_id, permission_id) VALUES
        (role_ca, p_ov), (role_ca, p_ob), (role_ca, p_or), (role_ca, p_pv)
        ON CONFLICT DO NOTHING;
    END IF;

    -- Waiter Mapping
    IF role_wa IS NOT NULL AND p_ov IS NOT NULL THEN
        INSERT INTO public.role_permissions (role_id, permission_id) VALUES
        (role_wa, p_ov), (role_wa, p_ob), (role_wa, p_or)
        ON CONFLICT DO NOTHING;
    END IF;

    -- Kitchen Mapping
    IF role_ki IS NOT NULL AND p_ov IS NOT NULL THEN
        INSERT INTO public.role_permissions (role_id, permission_id) VALUES
        (role_ki, p_ov), (role_ki, p_op), (role_ki, p_ob), (role_ki, p_or)
        ON CONFLICT DO NOTHING;
    END IF;
END $$;
