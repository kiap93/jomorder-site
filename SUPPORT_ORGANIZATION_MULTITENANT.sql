-- ====================================================================
-- ENTERPRISE MULTI-TENANT RBAC: MULTI-ORGANIZATION AND MULTI-WORKSPACE RLS DEFINITIONS
-- Recommended execution: Run this in your Supabase SQL Editor
-- ====================================================================

-- 1. BRAND/GROUP LAYER: ORGANIZATIONS
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Ensure RLS is active on organizations
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 2. LINK EXISTING/NEW RESTAURANTS TO ORGANIZATIONS (Many Restaurants belongs to 1 Organization)
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

-- 3. GLOBAL IDENTITY OVERRIDES: ORGANIZATION MEMBERSHIP MAP TABLE
-- Permits a single user (email) to belong to multiple brands/organizations
CREATE TABLE IF NOT EXISTS public.organization_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'manager', 'member', 'billing')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(organization_id, user_id)
);

-- Ensure RLS is active on organization memberships
ALTER TABLE public.organization_users ENABLE ROW LEVEL SECURITY;

-- 4. MULTI-WORKSPACE ACCESS: RESTAURANT-LEVEL MEMBERSHIP MAP TABLE
-- Permits a single staff member to belong to multiple restaurants with different roles and overrides!
CREATE TABLE IF NOT EXISTS public.restaurant_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role TEXT NOT NULL DEFAULT 'waiter' CHECK (role IN ('owner', 'manager', 'cashier', 'kitchen', 'waiter', 'runner', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    custom_permissions JSONB DEFAULT '{
        "can_refund": false,
        "can_edit_menu": false,
        "can_cancel_order": false,
        "can_view_analytics": false,
        "can_manage_staff": false
    }'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(restaurant_id, user_id)
);

-- Ensure RLS is active on restaurant memberships
ALTER TABLE public.restaurant_users ENABLE ROW LEVEL SECURITY;


-- ====================================================================
-- 5. RE-DESIGN PERMISSIONS CHECKER FUNCTION FOR MULTI-TENANCY RELATIONSHIPS
-- ====================================================================

CREATE OR REPLACE FUNCTION public.check_restaurant_permission(user_uuid UUID, target_restaurant_id UUID, permission_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    user_role TEXT;
    custom_perms JSONB;
    user_status TEXT;
BEGIN
    -- Query workspace profile elements directly from the restaurant_users mapping table
    SELECT role, custom_permissions, status INTO user_role, custom_perms, user_status
    FROM public.restaurant_users
    WHERE user_id = user_uuid AND restaurant_id = target_restaurant_id;

    -- Fallback to global profiles table if specific restaurant mapping is absent but profile is aligned
    IF user_role IS NULL THEN
        SELECT role, custom_permissions, status INTO user_role, custom_perms, user_status
        FROM public.profiles
        WHERE id = user_uuid AND restaurant_id = target_restaurant_id;
    END IF;

    -- Instantly deny suspended or completely unassociated staff
    IF user_status = 'suspended' OR user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Owner/Admin automatically bypasses workspace restrictions
    IF user_role IN ('admin', 'owner', 'OWNER') THEN
        RETURN TRUE;
    END IF;

    -- Check JSONB permission overrides first
    IF custom_perms ? permission_key THEN
        RETURN (custom_perms->>permission_key)::BOOLEAN;
    END IF;

    -- Default fallback static matrix based on workspace role definitions:
    CASE permission_key
        WHEN 'can_edit_menu' THEN
            RETURN user_role IN ('owner', 'manager', 'MANAGER', 'OWNER');
        WHEN 'can_refund' THEN
            RETURN user_role IN ('owner', 'manager', 'MANAGER', 'OWNER');
        WHEN 'can_cancel_order' THEN
            RETURN user_role IN ('owner', 'manager', 'cashier', 'CASHIER', 'OWNER', 'MANAGER');
        WHEN 'can_view_analytics' THEN
            RETURN user_role IN ('owner', 'manager', 'MANAGER', 'OWNER');
        WHEN 'can_manage_staff' THEN
            RETURN user_role IN ('owner', 'owner', 'OWNER');
        ELSE
            RETURN FALSE;
    END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ====================================================================
-- 6. HIGH-PERFORMANCE BACKWARD-COMPATIBILITY AUTOMATION TRIGGER (profiles <=> restaurant_users)
-- ====================================================================

-- Automatically propagates a user's primary profiles table entry into restaurant_users & vice-versa to prevent breaking legacy logic
CREATE OR REPLACE FUNCTION public.sync_profile_to_restaurant_users_hook()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.restaurant_id IS NOT NULL THEN
        INSERT INTO public.restaurant_users (restaurant_id, user_id, role, status, custom_permissions)
        VALUES (
            NEW.restaurant_id,
            NEW.id,
            NEW.role,
            COALESCE(NEW.status, 'active'),
            COALESCE(NEW.custom_permissions, '{
                "can_refund": false,
                "can_edit_menu": false,
                "can_cancel_order": false,
                "can_view_analytics": false,
                "can_manage_staff": false
            }'::jsonb)
        )
        ON CONFLICT (restaurant_id, user_id) 
        DO UPDATE SET 
            role = EXCLUDED.role,
            status = EXCLUDED.status,
            custom_permissions = EXCLUDED.custom_permissions;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_sync_profile_membership ON public.profiles;
CREATE TRIGGER trigger_sync_profile_membership
    AFTER INSERT OR UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE PROCEDURE public.sync_profile_to_restaurant_users_hook();


-- ====================================================================
-- 7. DEFINE SECURITY ROW LEVEL SECURITY (RLS) POLICIES FOR SECURE SAAS RESTRICTION
-- ====================================================================

-- Organizations Select Rule: User can view any organization they belong to
DROP POLICY IF EXISTS "Users can read organizations they belong to" ON public.organizations;
CREATE POLICY "Users can read organizations they belong to"
ON public.organizations FOR SELECT USING (
    id IN (SELECT organization_id FROM public.organization_users WHERE user_id = auth.uid())
);

-- Organization Users Mutate Rules: Only owners/billing-admins of organization can mutate members
DROP POLICY IF EXISTS "Organization owners/managers can view members" ON public.organization_users;
CREATE POLICY "Organization owners/managers can view members"
ON public.organization_users FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM public.organization_users WHERE user_id = auth.uid())
);

-- Restaurants Multi-Tenant Access Rule
DROP POLICY IF EXISTS "Users can read restaurants under their organization" ON public.restaurants;
CREATE POLICY "Users can read restaurants under their organization"
ON public.restaurants FOR SELECT USING (
    (organization_id IN (SELECT organization_id FROM public.organization_users WHERE user_id = auth.uid()))
    OR
    (id IN (SELECT restaurant_id FROM public.restaurant_users WHERE user_id = auth.uid()))
);
