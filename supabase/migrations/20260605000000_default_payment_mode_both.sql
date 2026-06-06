-- Migration to update the default payment mode for new restaurants and business settings to 'both'
ALTER TABLE public.restaurants ALTER COLUMN payment_mode SET DEFAULT 'both';

ALTER TABLE public.business_settings ALTER COLUMN payment_mode SET DEFAULT 'both';
