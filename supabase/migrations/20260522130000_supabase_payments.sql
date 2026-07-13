-- Sikmatye Payment Engine Schema
-- Handles transactions, lifecycle, and audit trials

-- 1. Payments Table
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'MYR',
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, processing, authorized, paid, failed, cancelled, expired, refunded
    payment_method VARCHAR(50) NOT NULL, -- duitnow, tng, fpx, card, cash
    provider VARCHAR(50) NOT NULL, -- paynet, stripe, adyen, internal
    external_id VARCHAR(255), -- Provider's transaction reference
    metadata JSONB DEFAULT '{}'::jsonb,
    idempotency_key TEXT UNIQUE, -- Unique idempotency key column for replay protection
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure idempotency_key exists on any existing tables
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

-- 2. Payment Attempts Table (Audit Log)
CREATE TABLE IF NOT EXISTS public.payment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL, -- initiated, success, fail, webhook_received
    provider_response JSONB DEFAULT '{}'::jsonb,
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Row Level Security (RLS)
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

-- 4. Policies
-- Public QR ordering needs to be able to create, read and update payments (for simulation)
DROP POLICY IF EXISTS "Allow public insert payments" ON public.payments;
CREATE POLICY "Allow public insert payments" ON public.payments
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public select payments" ON public.payments;
CREATE POLICY "Allow public select payments" ON public.payments
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public update payments" ON public.payments;
CREATE POLICY "Allow public update payments" ON public.payments
    FOR UPDATE USING (true) WITH CHECK (true);

-- Admin Management
DROP POLICY IF EXISTS "Admins manage all payments" ON public.payments;
CREATE POLICY "Admins manage all payments" ON public.payments
    FOR ALL USING (
        auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin')
    );

-- Payment Attempts Policies
DROP POLICY IF EXISTS "Allow public insert attempts" ON public.payment_attempts;
CREATE POLICY "Allow public insert attempts" ON public.payment_attempts
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public select attempts" ON public.payment_attempts;
CREATE POLICY "Allow public select attempts" ON public.payment_attempts
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public update attempts" ON public.payment_attempts;
CREATE POLICY "Allow public update attempts" ON public.payment_attempts
    FOR UPDATE USING (true) WITH CHECK (true);

-- 5. Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_restaurant_id ON public.payments(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_attempts_payment_id ON public.payment_attempts(payment_id);

-- 6. Updated At Trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_payments_updated_at ON public.payments;
CREATE TRIGGER update_payments_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
