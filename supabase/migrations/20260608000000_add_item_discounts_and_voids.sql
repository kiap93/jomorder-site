-- Migration: Add robust item-level discount, void, and adjustment request system
ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20) NULL,
ADD COLUMN IF NOT EXISTS discount_value DECIMAL(10,2) NULL,
ADD COLUMN IF NOT EXISTS override_price DECIMAL(10,2) NULL,
ADD COLUMN IF NOT EXISTS discount_reason TEXT NULL,
ADD COLUMN IF NOT EXISTS discounted_by UUID NULL,
ADD COLUMN IF NOT EXISTS discounted_at TIMESTAMP WITH TIME ZONE NULL,
ADD COLUMN IF NOT EXISTS void_reason TEXT NULL,
ADD COLUMN IF NOT EXISTS voided_by UUID NULL,
ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP WITH TIME ZONE NULL,
ADD COLUMN IF NOT EXISTS original_unit_price DECIMAL(10,2) NULL,
ADD COLUMN IF NOT EXISTS final_unit_price DECIMAL(10,2) NULL;

-- Populate default values for existing rows if any
UPDATE public.order_items
SET original_unit_price = COALESCE(original_unit_price, price),
    final_unit_price = COALESCE(final_unit_price, price)
WHERE original_unit_price IS NULL OR final_unit_price IS NULL;

-- Create order_item_adjustments table for manager-approved workflows
CREATE TABLE IF NOT EXISTS public.order_item_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
    order_item_id UUID REFERENCES public.order_items(id) ON DELETE CASCADE NOT NULL,
    restaurant_id UUID NULL,
    type VARCHAR(50) NOT NULL, -- 'void' or 'discount'
    discount_type VARCHAR(20) NULL,
    discount_value DECIMAL(10,2) NULL,
    override_price DECIMAL(10,2) NULL,
    reason TEXT NULL,
    requested_by UUID NULL,
    status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected
    approved_by UUID NULL,
    approved_at TIMESTAMP WITH TIME ZONE NULL,
    rejection_reason TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
