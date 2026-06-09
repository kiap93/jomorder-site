-- ====================================================================
-- FIX FOR ROW LEVEL SECURITY (RLS) INFINITE RECURSION IN ORGANIZATION TABLES
-- Run this block inside your Supabase SQL Editor to resolve the 500 error.
-- ====================================================================

-- 1. Complete RLS disabling on tenancy mapping tables to align with the May 28 "remove RLS" directive
ALTER TABLE IF EXISTS public.organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.organization_users DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.restaurant_users DISABLE ROW LEVEL SECURITY;

-- 2. Create high-performance, non-recursive SECURITY DEFINER helper function for organization lookups
-- Since SECURITY DEFINER functions run with the privileges of the defining user (bypassing RLS),
-- they break any infinite recursion chains on public.organization_users and public.restaurant_users.
CREATE OR REPLACE FUNCTION public.get_user_organization_ids(user_uuid UUID)
RETURNS SETOF UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY 
    SELECT organization_id 
    FROM public.organization_users 
    WHERE user_id = user_uuid;
END;
$$;

-- Create high-performance, non-recursive SECURITY DEFINER helper function for restaurant user lookups
CREATE OR REPLACE FUNCTION public.get_user_restaurant_ids(user_uuid UUID)
RETURNS SETOF UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY 
    SELECT restaurant_id 
    FROM public.restaurant_users 
    WHERE user_id = user_uuid;
END;
$$;


-- 3. Re-create organization_users policies with the non-recursive helper to prevent future loops if RLS is enabled
DROP POLICY IF EXISTS "Organization owners/managers can view members" ON public.organization_users;
CREATE POLICY "Organization owners/managers can view members"
ON public.organization_users FOR SELECT USING (
    organization_id IN (SELECT public.get_user_organization_ids(auth.uid()))
);


-- 4. Re-create organizations policies with the non-recursive helper to prevent future loops if RLS is enabled
DROP POLICY IF EXISTS "Users can read organizations they belong to" ON public.organizations;
CREATE POLICY "Users can read organizations they belong to"
ON public.organizations FOR SELECT USING (
    id IN (SELECT public.get_user_organization_ids(auth.uid()))
);


-- 5. Re-create restaurants policies with the non-recursive helpers to prevent future loops if RLS is enabled
DROP POLICY IF EXISTS "Users can read restaurants under their organization" ON public.restaurants;
CREATE POLICY "Users can read restaurants under their organization"
ON public.restaurants FOR SELECT USING (
    (organization_id IN (SELECT public.get_user_organization_ids(auth.uid())))
    OR
    (id IN (SELECT public.get_user_restaurant_ids(auth.uid())))
);
