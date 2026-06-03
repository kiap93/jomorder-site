-- Migration to add business-level Order Payment Mode setting
ALTER TABLE public.restaurants 
ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'pay_first';

-- Fallback for business_settings if any such table exists now or in future
CREATE TABLE IF NOT EXISTS public.business_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
  payment_mode VARCHAR(20) DEFAULT 'pay_first',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Ensure payment_mode is added to business_settings if table already existed
ALTER TABLE public.business_settings
ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'pay_first';
