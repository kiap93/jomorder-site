-- ====================================================================
-- PUBLIC SELECT PERMISSIONS FOR TRANSLATIONS IN SUPABASE
-- Run this inside your Supabase SQL Editor if translation tables have RLS enabled.
-- ====================================================================

-- 1. Ensure RLS is enabled on translation tables (Standard behaviour)
ALTER TABLE public.global_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.franchise_translations ENABLE ROW LEVEL SECURITY;

-- 2. Create Public Select policies so that users/guests can load translations.
DROP POLICY IF EXISTS "Public read global translations" ON public.global_translations;
CREATE POLICY "Public read global translations" ON public.global_translations 
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read tenant translations" ON public.tenant_translations;
CREATE POLICY "Public read tenant translations" ON public.tenant_translations 
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read branch translations" ON public.branch_translations;
CREATE POLICY "Public read branch translations" ON public.branch_translations 
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read franchise translations" ON public.franchise_translations;
CREATE POLICY "Public read franchise translations" ON public.franchise_translations 
FOR SELECT USING (true);

-- 3. Alternatively, if you want to bypass RLS entirely for all localizations:
-- ALTER TABLE public.global_translations DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.tenant_translations DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.branch_translations DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.franchise_translations DISABLE ROW LEVEL SECURITY;
