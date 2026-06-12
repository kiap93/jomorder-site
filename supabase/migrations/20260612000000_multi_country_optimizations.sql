-- Migration to transform JomOrder into a multi-country, multi-currency, multi-language system

CREATE TABLE IF NOT EXISTS public.business_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    country_code VARCHAR(10) NOT NULL DEFAULT 'MY',
    currency_code VARCHAR(10) NOT NULL DEFAULT 'MYR',
    timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
    language VARCHAR(10) NOT NULL DEFAULT 'en',
    tax_type VARCHAR(50) NOT NULL DEFAULT 'SST',
    tax_rate NUMERIC NOT NULL DEFAULT 10,
    date_format VARCHAR(50) NOT NULL DEFAULT 'DD/MM/YYYY',
    payment_mode VARCHAR(20) NOT NULL DEFAULT 'both',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Fix up potential missing columns on existing business_settings table
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS country_code VARCHAR(10) DEFAULT 'MY';
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS currency_code VARCHAR(10) DEFAULT 'MYR';
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) DEFAULT 'Asia/Kuala_Lumpur';
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en';
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS tax_type VARCHAR(50) DEFAULT 'SST';
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 10;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS date_format VARCHAR(50) DEFAULT 'DD/MM/YYYY';
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'both';
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- Ensure constraints and default updates on the business_settings table
ALTER TABLE public.business_settings ALTER COLUMN country_code SET DEFAULT 'MY';
ALTER TABLE public.business_settings ALTER COLUMN currency_code SET DEFAULT 'MYR';
ALTER TABLE public.business_settings ALTER COLUMN timezone SET DEFAULT 'Asia/Kuala_Lumpur';
ALTER TABLE public.business_settings ALTER COLUMN language SET DEFAULT 'en';
ALTER TABLE public.business_settings ALTER COLUMN tax_type SET DEFAULT 'SST';
ALTER TABLE public.business_settings ALTER COLUMN tax_rate SET DEFAULT 10;
ALTER TABLE public.business_settings ALTER COLUMN date_format SET DEFAULT 'DD/MM/YYYY';
ALTER TABLE public.business_settings ALTER COLUMN payment_mode SET DEFAULT 'both';

-- Backfill existing restaurants into business_settings for backwards compatibility
INSERT INTO public.business_settings (
    business_id,
    restaurant_id,
    country_code,
    currency_code,
    timezone,
    language,
    tax_type,
    tax_rate,
    date_format,
    payment_mode
)
SELECT 
    r.id,
    r.id,
    'MY',
    COALESCE(r.currency, 'MYR'),
    'Asia/Kuala_Lumpur',
    'en',
    'SST',
    COALESCE(r.sst, 6.0),
    'DD/MM/YYYY',
    COALESCE(r.payment_mode, 'both')
FROM public.restaurants r
WHERE NOT EXISTS (
    SELECT 1 FROM public.business_settings bs WHERE bs.restaurant_id = r.id OR bs.business_id = r.id
);
