-- Migration: Create and seed Countries, Tax Profiles, and Tax Rules structures
CREATE TABLE IF NOT EXISTS public.countries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(10) UNIQUE NOT NULL,            -- MY, SG, AU, UK, US, TH
    name VARCHAR(100) NOT NULL,
    currency_code VARCHAR(10) NOT NULL,
    currency_symbol VARCHAR(10) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.tax_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    country_code VARCHAR(10) NOT NULL,
    tax_type VARCHAR(50) NOT NULL,
    tax_rate NUMERIC NOT NULL DEFAULT 0,
    is_inclusive BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.tax_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tax_profile_id UUID REFERENCES public.tax_profiles(id) ON DELETE CASCADE,
    applies_to VARCHAR(50) NOT NULL, -- 'all', 'category', 'product'
    product_category_id UUID, -- For category-specific rules if needed
    product_id UUID,          -- For product-specific rules if needed
    priority INTEGER DEFAULT 0
);

-- Disable Row Level Security as per project conventions in 20260528120000_disable_rls.sql
ALTER TABLE public.countries DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_rules DISABLE ROW LEVEL SECURITY;

-- Seed default Country profiles
INSERT INTO public.countries (code, name, currency_code, currency_symbol) VALUES
('MY', 'Malaysia', 'MYR', 'RM'),
('SG', 'Singapore', 'SGD', '$'),
('AU', 'Australia', 'AUD', '$'),
('UK', 'United Kingdom', 'GBP', '£'),
('TH', 'Thailand', 'THB', '฿'),
('US', 'United States', 'USD', '$')
ON CONFLICT (code) DO UPDATE SET 
    name = EXCLUDED.name,
    currency_code = EXCLUDED.currency_code,
    currency_symbol = EXCLUDED.currency_symbol;

-- Auto-backfill default tax profiles for currently operating restaurants based on their business settings / currency settings
INSERT INTO public.tax_profiles (business_id, name, country_code, tax_type, tax_rate, is_inclusive, is_active)
SELECT 
    r.id,
    CASE 
        WHEN COALESCE(r.currency, 'MYR') = 'SGD' THEN 'Singapore GST'
        WHEN COALESCE(r.currency, 'MYR') = 'AUD' THEN 'Australia GST'
        WHEN COALESCE(r.currency, 'MYR') = 'GBP' THEN 'UK VAT'
        WHEN COALESCE(r.currency, 'MYR') = 'USD' THEN 'US Sales Tax'
        WHEN COALESCE(r.currency, 'MYR') = 'THB' THEN 'Thailand VAT'
        ELSE 'Malaysia SST'
    END,
    CASE 
        WHEN COALESCE(r.currency, 'MYR') = 'SGD' THEN 'SG'
        WHEN COALESCE(r.currency, 'MYR') = 'AUD' THEN 'AU'
        WHEN COALESCE(r.currency, 'MYR') = 'GBP' THEN 'UK' -- mapped to UK code
        WHEN COALESCE(r.currency, 'MYR') = 'USD' THEN 'US'
        WHEN COALESCE(r.currency, 'MYR') = 'THB' THEN 'TH'
        ELSE 'MY'
    END,
    CASE 
        WHEN COALESCE(r.currency, 'MYR') = 'SGD' THEN 'GST'
        WHEN COALESCE(r.currency, 'MYR') = 'AUD' THEN 'GST'
        WHEN COALESCE(r.currency, 'MYR') = 'GBP' THEN 'VAT'
        WHEN COALESCE(r.currency, 'MYR') = 'USD' THEN 'Sales Tax'
        WHEN COALESCE(r.currency, 'MYR') = 'THB' THEN 'VAT'
        ELSE 'SST'
    END,
    COALESCE(r.sst, 6.0),
    FALSE,
    TRUE
FROM public.restaurants r
WHERE NOT EXISTS (
    SELECT 1 FROM public.tax_profiles tp WHERE tp.business_id = r.id
);
