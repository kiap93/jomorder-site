-- Enterprise Payment Engine Schema
-- This schema separates order intent from financial settlement

-- Enable UUID extension if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Payment Lifecycle Enum
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        CREATE TYPE payment_status AS ENUM (
            'pending', 
            'processing', 
            'authorized', 
            'paid', 
            'failed', 
            'cancelled', 
            'expired', 
            'refunded', 
            'partially_refunded'
        );
    END IF;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Payments Table
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE,
    amount DECIMAL(12,2) NOT NULL,
    currency CHAR(3) DEFAULT 'MYR',
    status payment_status DEFAULT 'pending',
    payment_method TEXT, -- 'duitnow', 'tng', 'fpx', 'card', 'cash'
    provider TEXT, -- 'stripe', 'billplz', 'manual'
    external_id TEXT, -- Provider's reference
    metadata JSONB DEFAULT '{}',
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Payment Attempts (Track retries)
CREATE TABLE IF NOT EXISTS public.payment_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID REFERENCES public.payments(id) ON DELETE CASCADE,
    provider_response JSONB,
    status TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Payment Refunds
CREATE TABLE IF NOT EXISTS public.payment_refunds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID REFERENCES public.payments(id) ON DELETE CASCADE,
    amount DECIMAL(12,2) NOT NULL,
    reason TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'succeeded', 'failed'
    external_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Webhooks Audit
CREATE TABLE IF NOT EXISTS public.payment_webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider TEXT,
    payload JSONB,
    processed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 7. Logic: When payment is 'paid', update the order status
CREATE OR REPLACE FUNCTION handle_payment_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'paid' AND OLD.status != 'paid' THEN
        -- Update the parent order
        UPDATE public.orders 
        SET status = 'paid', 
            paid_at = NOW()
        WHERE id = NEW.order_id;
        
        -- Also set confirmed_at if it was awaiting payment (Prepaid mode)
        UPDATE public.orders
        SET confirmed_at = NOW()
        WHERE id = NEW.order_id AND confirmed_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER on_payment_paid
    AFTER UPDATE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION handle_payment_status_change();

-- 8. Security
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view own payment" ON public.payments
    FOR SELECT USING (true); -- Restricted by app query

CREATE POLICY "Admin manage payments" ON public.payments
    FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
