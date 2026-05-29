-- Remove Rate Limiter if it was applied
DROP TRIGGER IF EXISTS tr_order_rate_limit ON public.orders;
DROP FUNCTION IF EXISTS check_order_rate_limit();
