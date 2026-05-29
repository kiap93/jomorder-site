-- ====================================================================
-- FIX FOR INFINITE RECURSION IN PROFILES TABLE ROW LEVEL SECURITY (RLS)
-- Run this block inside your Supabase SQL Editor to resolve the 500 error.
-- ====================================================================

-- 1. Create a non-recursive SECURITY DEFINER helper function.
-- Security Definer overrides RLS constraints within the subquery execution context,
-- avoiding recursion loops on the public.profiles table.
CREATE OR REPLACE FUNCTION public.get_user_restaurant_id(user_uuid UUID)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
    v_restaurant_id UUID;
BEGIN
    SELECT restaurant_id INTO v_restaurant_id FROM public.profiles WHERE id = user_uuid;
    RETURN v_restaurant_id;
END;
$$;


-- 2. Drop stale recursive policies on public.profiles and build non-recursive equivalents
DROP POLICY IF EXISTS "Staff can read profile list of their organization" ON public.profiles;
CREATE POLICY "Staff can read profile list of their organization" 
ON public.profiles FOR SELECT USING (
    (restaurant_id = public.get_user_restaurant_id(auth.uid()))
    OR 
    (id = auth.uid()) -- Allow self-read initially on onboarding/login
);

DROP POLICY IF EXISTS "Owners/Managers can mutate profiles" ON public.profiles;
CREATE POLICY "Owners/Managers can mutate profiles" 
ON public.profiles FOR ALL USING (
    id = auth.uid() 
    OR 
    (
      restaurant_id = public.get_user_restaurant_id(auth.uid())
      AND 
      public.has_staff_permission(auth.uid(), 'can_manage_staff')
    )
);


-- 3. Fix recursive references inside Audit Logs and Multi-Tenant Isolation
DROP POLICY IF EXISTS "Only staff can view organization audit logs" ON public.audit_logs;
CREATE POLICY "Only staff can view organization audit logs"
ON public.audit_logs FOR SELECT USING (
    restaurant_id = public.get_user_restaurant_id(auth.uid())
);

DROP POLICY IF EXISTS "Only authenticated staff can insert audit logs" ON public.audit_logs;
CREATE POLICY "Only authenticated staff can insert audit logs"
ON public.audit_logs FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND 
    restaurant_id = public.get_user_restaurant_id(auth.uid())
);


-- 4. Fix recursive references inside Menu Items
DROP POLICY IF EXISTS "Staff with menu permission can modify menu" ON public.menu_items;
CREATE POLICY "Staff with menu permission can modify menu"
ON public.menu_items FOR ALL USING (
    (restaurant_id = public.get_user_restaurant_id(auth.uid())
    AND 
    public.has_staff_permission(auth.uid(), 'can_edit_menu'))
) WITH CHECK (
    (restaurant_id = public.get_user_restaurant_id(auth.uid())
    AND 
    public.has_staff_permission(auth.uid(), 'can_edit_menu'))
);


-- 5. Fix recursive references inside Orders
DROP POLICY IF EXISTS "Staff can manage orders inside their restaurant" ON public.orders;
CREATE POLICY "Staff can manage orders inside their restaurant"
ON public.orders FOR ALL USING (
    restaurant_id = public.get_user_restaurant_id(auth.uid())
) WITH CHECK (
    restaurant_id = public.get_user_restaurant_id(auth.uid())
);

-- ====================================================================
-- ALTERNATIVE FIX: IF YOU REQUESTED TO REMOVE SUPABASE RLS ENTIRELY, 
-- USE THIS STATEMENT TO INSTANTLY DISABLE RLS ACROSS ALL YOUR TABLES:
-- ====================================================================
-- ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.audit_logs DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.menu_items DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.orders DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.combo_groups DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.categories DISABLE ROW LEVEL SECURITY;
