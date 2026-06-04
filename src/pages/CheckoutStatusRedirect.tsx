import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getApiUrl } from '../lib/api';

export function CheckoutStatusRedirect() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [statusText, setStatusText] = useState("Verifying payment transaction...");

  useEffect(() => {
    const handleRedirect = async () => {
      try {
        const orderId = searchParams.get('order_id') || searchParams.get('orderId') || searchParams.get('sim_order');
        const paymentId = searchParams.get('id') || searchParams.get('payment_id') || searchParams.get('sim_payment_id');
        const sessionId = searchParams.get('session_id') || searchParams.get('sessionId');

        let targetOrderId = orderId;
        const pId = paymentId;

        // If we only have a paymentId, let's fetch the status to resolve orderId
        if (!targetOrderId && pId) {
          setStatusText("Resolving transaction status...");
          const statusRes = await fetch(getApiUrl(`/api/payments/status/${pId}`));
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            targetOrderId = statusData.order_id;
          }
        }

        if (targetOrderId) {
          setStatusText("Loading order details...");
          const orderRes = await fetch(getApiUrl(`/api/public/orders/${targetOrderId}`));
          if (orderRes.ok) {
            const orderData = await orderRes.json();
            const restId = orderData.restaurant_id;
            const tableId = orderData.table_id || 'default';
            const sId = orderData.session_id || sessionId || '';

            setStatusText("Returning to restaurant menu...");
            // Redirect to success receipt page, which has a beautiful "Back to Menu" link
            if (sId) {
              navigate(`/restaurant/${restId}/table/${tableId}/session/${sId}/order/${targetOrderId}/success`, { replace: true });
            } else {
              navigate(`/restaurant/${restId}/table/${tableId}/order/${targetOrderId}/success`, { replace: true });
            }
            return;
          }
        }

        // Ultimate fallbacks
        setStatusText("Redirecting back to menu...");
        navigate('/');
      } catch (err) {
        console.error("Error in CheckoutStatusRedirect:", err);
        navigate('/');
      }
    };

    handleRedirect();
  }, [searchParams, navigate]);

  return (
    <div className="h-screen bg-zinc-950 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-12 h-12 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin mb-4" />
      <p className="text-zinc-500 font-bold text-[10px] tracking-widest uppercase">{statusText}</p>
    </div>
  );
}
