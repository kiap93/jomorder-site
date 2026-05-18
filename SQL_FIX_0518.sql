-- ==========================================
-- SUPABASE FIX: MISSING COLUMNS & ORDER TRACKING
-- RUN THIS IN YOUR SUPABASE SQL EDITOR
-- ==========================================

-- 1. Addition of missing columns to 'orders'
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.dining_sessions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'dine_in',
ADD COLUMN IF NOT EXISTS payment_id TEXT,
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
ADD COLUMN IF NOT EXISTS session_token TEXT;

-- 2. Unique constraint for idempotency
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_idempotency_key_key') THEN
        ALTER TABLE public.orders ADD CONSTRAINT orders_idempotency_key_key UNIQUE (idempotency_key);
    END IF;
END $$;

-- 3. Update Order Placement Function (v3)
CREATE OR REPLACE FUNCTION public.place_order_v3(
    p_restaurant_id UUID,
    p_table_id UUID,
    p_session_id UUID,
    p_session_token TEXT,
    p_order_type TEXT,
    p_items JSONB,
    p_total_price NUMERIC,
    p_payment_method TEXT,
    p_idempotency_key TEXT
) RETURNS JSONB AS $$
DECLARE
    v_order_id UUID;
BEGIN
    -- 0. Token Validation (Secure Guest Verification)
    IF NOT EXISTS (
        SELECT 1 FROM public.dining_sessions 
        WHERE id = p_session_id AND session_token = p_session_token
        AND status IN ('active', 'awaiting_payment', 'paid')
    ) THEN
        RETURN jsonb_build_object('order_id', NULL, 'message', 'Invalid or expired dining session');
    END IF;

    -- 1. Insert Order
    INSERT INTO public.orders (
        restaurant_id, table_id, session_id, order_type, items, 
        total_price, payment_method, idempotency_key, session_token, status
    )
    VALUES (
        p_restaurant_id, p_table_id, p_session_id, p_order_type, p_items, 
        p_total_price, p_payment_method, p_idempotency_key, p_session_token, 'pending'
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_order_id;

    -- 2. Mark basket as submitted (Atomic)
    IF v_order_id IS NOT NULL THEN
        UPDATE public.baskets 
        SET status = 'submitted', updated_at = now() 
        WHERE session_id = p_session_id AND status = 'active';
        
        -- Update session status to awaiting_payment if dine_in and currently active
        IF p_order_type = 'dine_in' THEN
            UPDATE public.dining_sessions SET status = 'awaiting_payment' WHERE id = p_session_id AND status = 'active';
        END IF;
    ELSE
        -- If already exists, return the existing one (idempotency)
        SELECT id INTO v_order_id FROM public.orders WHERE idempotency_key = p_idempotency_key;
    END IF;

    RETURN jsonb_build_object('order_id', v_order_id, 'status', 'success');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Harden View Policies for Tracker
DROP POLICY IF EXISTS "Everyone can view orders." ON public.orders;
CREATE POLICY "Everyone can view orders." ON public.orders FOR SELECT USING (
    -- Guests can view if they are part of the session
    EXISTS (
      SELECT 1 FROM public.dining_sessions ds 
      WHERE ds.id = orders.session_id 
      AND ds.status NOT IN ('closed', 'replaced', 'expired')
    )
    OR auth.role() = 'authenticated'
);
