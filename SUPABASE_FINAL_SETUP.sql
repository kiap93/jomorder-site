-- ==========================================
-- SUPABASE UNIFIED SETUP SCRIPT
-- RUN THIS IN YOUR SUPABASE SQL EDITOR
-- ==========================================

-- 1. CASH TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS public.cash_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    cashier_id UUID NOT NULL REFERENCES public.profiles(id),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id),
    device_id TEXT,
    amount_due NUMERIC(15, 2) NOT NULL,
    cash_received NUMERIC(15, 2) NOT NULL,
    change_given NUMERIC(15, 2) NOT NULL,
    rounding_adjustment NUMERIC(15, 2) DEFAULT 0.00,
    status TEXT CHECK (status IN ('calculating', 'awaiting_confirmation', 'confirmed', 'completed', 'voided')) DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT now(),
    metadata JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin and Staff can manage cash transactions" ON public.cash_transactions;
CREATE POLICY "Admin and Staff can manage cash transactions"
ON public.cash_transactions FOR ALL TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'staff')
        AND (restaurant_id = public.cash_transactions.restaurant_id)
    )
);

-- 2. DINING SESSION ENGINE UPDATES
ALTER TABLE public.dining_sessions 
ADD COLUMN IF NOT EXISTS payment_mode TEXT CHECK (payment_mode IN ('prepaid', 'postpaid', 'hybrid')) DEFAULT 'postpaid',
ADD COLUMN IF NOT EXISTS fulfillment_type TEXT CHECK (fulfillment_type IN ('dine_in', 'takeaway', 'delivery', 'kiosk')) DEFAULT 'dine_in',
ADD COLUMN IF NOT EXISTS total_amount NUMERIC(15, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(15, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS session_type TEXT CHECK (session_type IN ('qr', 'pos', 'kiosk')) DEFAULT 'qr',
ADD COLUMN IF NOT EXISTS table_name_snapshot TEXT;

-- 3. UPDATED RESOLVER FUNCTION (5 Parameters)
DROP FUNCTION IF EXISTS public.resolve_dining_session(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.resolve_dining_session(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.resolve_dining_session(UUID, UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.resolve_dining_session(
    p_restaurant_id UUID,
    p_table_id UUID,
    p_device_info TEXT DEFAULT NULL,
    p_client_token TEXT DEFAULT NULL,
    p_fulfillment TEXT DEFAULT 'dine_in'
) RETURNS TABLE (
    session_id UUID,
    token TEXT,
    session_status TEXT,
    is_new BOOLEAN
) AS $$
DECLARE
    v_session_id UUID;
    v_token TEXT;
    v_status TEXT;
    v_is_new BOOLEAN := false;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tables WHERE id = p_table_id AND restaurant_id = p_restaurant_id) THEN
        RAISE EXCEPTION 'Invalid table or restaurant target';
    END IF;

    IF p_client_token IS NOT NULL AND p_client_token != '' THEN
        SELECT id, session_token, status INTO v_session_id, v_token, v_status
        FROM public.dining_sessions
        WHERE session_token = p_client_token
          AND table_id = p_table_id
          AND status IN ('active', 'awaiting_payment')
        LIMIT 1;

        IF v_session_id IS NOT NULL THEN
            UPDATE public.dining_sessions SET last_activity_at = now() WHERE id = v_session_id;
            RETURN QUERY SELECT v_session_id, v_token, v_status, false;
            RETURN;
        END IF;
    END IF;

    SELECT id, session_token, status INTO v_session_id, v_token, v_status
    FROM public.dining_sessions
    WHERE table_id = p_table_id 
      AND restaurant_id = p_restaurant_id
      AND status = 'active'
      AND last_activity_at > (now() - interval '2 hours')
    ORDER BY started_at DESC 
    LIMIT 1;

    IF v_session_id IS NULL THEN
        UPDATE public.dining_sessions SET status = 'replaced', closed_at = now() 
        WHERE table_id = p_table_id AND status = 'active';

        v_token := lower(encode(gen_random_bytes(16), 'hex'));
        v_is_new := true;

        INSERT INTO public.dining_sessions (
            restaurant_id, 
            table_id, 
            session_token, 
            status, 
            fulfillment_type,
            created_by_device,
            table_name_snapshot
        )
        VALUES (
            p_restaurant_id, 
            p_table_id, 
            v_token, 
            'active', 
            p_fulfillment,
            p_device_info,
            (SELECT name FROM public.tables WHERE id = p_table_id)
        )
        RETURNING id, session_token, status INTO v_session_id, v_token, v_status;
    END IF;

    RETURN QUERY SELECT v_session_id, v_token, v_status, v_is_new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
