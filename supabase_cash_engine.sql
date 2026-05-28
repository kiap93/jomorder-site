-- Cash Settlement & Cashier Decision Engine Schema
-- Part of the Payment Engine for accurate cash handling and audit trails.

CREATE TABLE IF NOT EXISTS public.cash_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    cashier_id UUID NOT NULL REFERENCES public.profiles(id),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id),
    device_id TEXT, -- For terminal tracking
    
    amount_due NUMERIC(15, 2) NOT NULL,
    cash_received NUMERIC(15, 2) NOT NULL,
    change_given NUMERIC(15, 2) NOT NULL,
    
    -- Rounding adjustment (e.g. 5 sen rounding in Malaysia)
    rounding_adjustment NUMERIC(15, 2) DEFAULT 0.00,
    
    status TEXT CHECK (status IN ('calculating', 'awaiting_confirmation', 'confirmed', 'completed', 'voided')) DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- Audit metadata
    metadata JSONB DEFAULT '{}'::jsonb
);

-- RLS for Cash Transactions
ALTER TABLE public.cash_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and Staff can manage cash transactions"
ON public.cash_transactions
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'staff')
        AND (restaurant_id = public.cash_transactions.restaurant_id)
    )
);

-- Trigger to log cash drawer events if needed
CREATE OR REPLACE FUNCTION public.log_cash_payment()
RETURNS TRIGGER AS $$
BEGIN
    -- This function could integrate with a hardware management table or log
    -- For now, just ensuring consistency
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_log_cash_payment ON public.cash_transactions;
CREATE TRIGGER tr_log_cash_payment
    AFTER INSERT ON public.cash_transactions
    FOR EACH ROW EXECUTE FUNCTION public.log_cash_payment();
