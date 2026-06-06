-- Migration to add robust Order Item Cancellation system

-- 1. Create order_items table to store single or split order items
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
    menu_item_id UUID NULL,
    name TEXT NOT NULL,
    price NUMERIC NOT NULL,
    quantity INTEGER NOT NULL,
    options JSONB DEFAULT '[]'::jsonb,
    special_instructions TEXT,
    status VARCHAR(50) DEFAULT 'pending', -- pending, accepted, preparing, ready, served, completed, cancelled
    cancelled_at TIMESTAMP WITH TIME ZONE NULL,
    cancelled_by UUID NULL, -- References profiles(id)
    cancelled_by_type VARCHAR(50) NULL, -- 'staff' or 'customer'
    cancellation_reason TEXT NULL,
    original_quantity INTEGER NOT NULL,
    cancelled_quantity INTEGER DEFAULT 0,
    refund_status VARCHAR(50) DEFAULT 'none', -- none, pending, processing, refunded, failed
    refund_amount DECIMAL(10,2) DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create order_item_refunds table
CREATE TABLE IF NOT EXISTS public.order_item_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
    order_item_id UUID REFERENCES public.order_items(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending', -- none, pending, processing, refunded, failed
    payment_provider VARCHAR(50) DEFAULT 'none',
    provider_refund_id VARCHAR(255) NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create order_item_events table
CREATE TABLE IF NOT EXISTS public.order_item_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
    order_item_id UUID REFERENCES public.order_items(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL, -- ITEM_CANCELLED, ITEM_PARTIALLY_CANCELLED, ITEM_REFUNDED, ITEM_RESTORED
    created_by UUID NULL, -- References profiles(id) or null (system/customer)
    created_by_role VARCHAR(50) NOT NULL, -- owner, manager, cashier, waiter, customer
    old_status VARCHAR(50) NULL,
    new_status VARCHAR(50) NULL,
    reason TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Extend business_settings table with order item cancellation parameters
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS allow_customer_cancel BOOLEAN DEFAULT TRUE;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS allow_cancel_after_accept BOOLEAN DEFAULT FALSE;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS allow_partial_cancel BOOLEAN DEFAULT TRUE;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS require_cancel_reason BOOLEAN DEFAULT TRUE;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS auto_refund_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS cancellation_time_limit_minutes INTEGER DEFAULT 5;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS notify_staff_on_cancel BOOLEAN DEFAULT TRUE;
ALTER TABLE public.business_settings ADD COLUMN IF NOT EXISTS notify_customer_on_cancel BOOLEAN DEFAULT TRUE;
