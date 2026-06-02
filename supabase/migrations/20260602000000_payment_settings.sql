-- Migration to support JomOrder Multi-Tenant Payment Management System
CREATE TABLE IF NOT EXISTS public.payment_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'owner' CHECK (account_type IN ('owner', 'platform')),
  enabled_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
  merchant_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_restaurant_provider UNIQUE(restaurant_id, provider)
);

-- Disable Row Level Security on payment_settings, following our standard development schema pattern
ALTER TABLE public.payment_settings DISABLE ROW LEVEL SECURITY;
