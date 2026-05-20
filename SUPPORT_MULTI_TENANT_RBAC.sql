-- ====================================================================
-- PLATFORM MULTI-TENANT RBAC, STAFF ORGANIZATIONS AND AUDIT LOG SYSTEM
-- Recommended execution: Run this in your Supabase SQL Editor
-- ====================================================================

-- 1. EXTEND OR RE-CREATE PROFILES TABLE WITH RBAC FIELDWORK
-- This table maps to auth.users and provides secure workspace boundaries
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'waiter' CHECK (role IN ('owner', 'manager', 'cashier', 'kitchen', 'waiter', 'runner', 'admin')),
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    custom_permissions JSONB DEFAULT '{
        "can_refund": false,
        "can_edit_menu": false,
        "can_cancel_order": false,
        "can_view_analytics": false,
        "can_manage_staff": false
    }'::jsonb,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Ensure RLS is active on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. SECURE ORGANIZATIONAL AUDIT LOG table
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    user_email TEXT NOT NULL,
    user_role TEXT NOT NULL,
    action TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Ensure RLS is active on audit logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 3. UTILITY HELPER FUNCTION FOR IN-DATABSE PERMISSION CHECKS (RBAC)
-- Validates if a user has a specific permission standard, taking overrides into account
CREATE OR REPLACE FUNCTION public.has_staff_permission(user_uuid UUID, permission_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    user_role TEXT;
    custom_perms JSONB;
    user_status TEXT;
BEGIN
    -- Query profile elements
    SELECT role, custom_permissions, status INTO user_role, custom_perms, user_status
    FROM public.profiles
    WHERE id = user_uuid;

    -- Instantly deny suspended or missing staff
    IF user_status = 'suspended' OR user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    -- System superadmin bypasses restrictions
    IF user_role = 'admin' THEN
        RETURN TRUE;
    END IF;

    -- Check JSONB permission overrides first
    IF custom_perms ? permission_key THEN
        RETURN (custom_perms->>permission_key)::BOOLEAN;
    END IF;

    -- Default fallback static matrix based on Role definitions:
    CASE permission_key
        WHEN 'can_edit_menu' THEN
            RETURN user_role IN ('owner', 'manager');
        WHEN 'can_refund' THEN
            RETURN user_role IN ('owner', 'manager');
        WHEN 'can_cancel_order' THEN
            RETURN user_role IN ('owner', 'manager', 'cashier');
        WHEN 'can_view_analytics' THEN
            RETURN user_role IN ('owner', 'manager');
        WHEN 'can_manage_staff' THEN
            RETURN user_role = 'owner';
        ELSE
            RETURN FALSE;
    END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ====================================================================
-- 4. DATABASE ROW LEVEL SECURITY (RLS) POLICIES FOR TENANTS ISOLATION
-- ====================================================================

-- ----------------- PROFILES RLS RULES -----------------
-- Ensure a customer/QR guest never views confidential staff data, and staff only access their tenant
DROP POLICY IF EXISTS "Staff can read profile list of their organization" ON public.profiles;
CREATE POLICY "Staff can read profile list of their organization" 
ON public.profiles FOR SELECT USING (
    (restaurant_id = (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid()))
    OR 
    (id = auth.uid()) -- Allow self-read initially on onboarding/login
);

DROP POLICY IF EXISTS "Owners/Managers can mutate profiles" ON public.profiles;
CREATE POLICY "Owners/Managers can mutate profiles" 
ON public.profiles FOR ALL USING (
    id = auth.uid() 
    OR 
    (
      restaurant_id = (SELECT r.restaurant_id FROM public.profiles r WHERE r.id = auth.uid())
      AND 
      public.has_staff_permission(auth.uid(), 'can_manage_staff')
    )
);


-- ----------------- AUDIT LOGS RLS RULES -----------------
DROP POLICY IF EXISTS "Only staff can view organization audit logs" ON public.audit_logs;
CREATE POLICY "Only staff can view organization audit logs"
ON public.audit_logs FOR SELECT USING (
    restaurant_id = (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Only authenticated staff can insert audit logs" ON public.audit_logs;
CREATE POLICY "Only authenticated staff can insert audit logs"
ON public.audit_logs FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND 
    restaurant_id = (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid())
);


-- ----------------- RESTAURANT MENU ISOLATION MANAGEMENT -----------------
DROP POLICY IF EXISTS "Staff with menu permission can modify menu" ON public.menu_items;
CREATE POLICY "Staff with menu permission can modify menu"
ON public.menu_items FOR ALL USING (
    (restaurant_id = (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid())
    AND 
    public.has_staff_permission(auth.uid(), 'can_edit_menu'))
) WITH CHECK (
    (restaurant_id = (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid())
    AND 
    public.has_staff_permission(auth.uid(), 'can_edit_menu'))
);


-- ----------------- ORDERS ISOLATION MANAGEMENT -----------------
-- Allow all customers (QR Guests) to read orders safely without authentication as long as they are part of active dining sessions.
-- But restrict destructive staff actions solely to cashiers, waiters, owners, runners with appropriate RLS.

DROP POLICY IF EXISTS "Staff can manage orders inside their restaurant" ON public.orders;
CREATE POLICY "Staff can manage orders inside their restaurant"
ON public.orders FOR ALL USING (
    restaurant_id = (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid())
) WITH CHECK (
    restaurant_id = (SELECT restaurant_id FROM public.profiles WHERE id = auth.uid())
);


-- ====================================================================
-- 5. SECURE AUTO-AUDITING ACTIONS TRIGGER SCRIPT (INSERT & CANCELING ACTIONS DB SIDE)
-- ====================================================================

CREATE OR REPLACE FUNCTION public.process_order_audit_hook()
RETURNS TRIGGER AS $$
DECLARE
    caller_id UUID;
    caller_email TEXT;
    caller_role TEXT;
    action_descr TEXT;
BEGIN
    caller_id := auth.uid();
    
    -- If action was performed directly by an authenticated admin/staff, log it
    IF caller_id IS NOT NULL THEN
        SELECT email, role INTO caller_email, caller_role 
        FROM public.profiles 
        WHERE id = caller_id;
        
        IF FOUND THEN
            IF TG_OP = 'UPDATE' THEN
                IF OLD.status <> NEW.status THEN
                    action_descr := 'Changed Order status from [' || OLD.status || '] to [' || NEW.status || ']';
                    
                    INSERT INTO public.audit_logs (restaurant_id, user_id, user_email, user_role, action, metadata)
                    VALUES (
                        NEW.restaurant_id, 
                        caller_id, 
                        caller_email, 
                        caller_role, 
                        action_descr, 
                        jsonb_build_object('order_id', NEW.id, 'old_status', OLD.status, 'new_status', NEW.status)
                    );
                END IF;
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_order_audit ON public.orders;
CREATE TRIGGER trigger_order_audit
    AFTER UPDATE ON public.orders
    FOR EACH ROW
    EXECUTE PROCEDURE public.process_order_audit_hook();
