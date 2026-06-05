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
        const restParamId = searchParams.get('restaurant_id') || searchParams.get('restaurantId');
        const tableParamId = searchParams.get('table_id') || searchParams.get('tableId');
        const isCancelled = searchParams.get('status') === 'cancelled' || searchParams.get('billing_status') === 'cancelled';

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

        // Helper function to handle redirect to checkout
        const redirectToCheckout = (rId: string | null, tId: string | null, sId: string | null, oId: string | null) => {
          if (rId) {
            const finalTable = tId || 'default';
            const finalOrderId = oId || 'prepaid';
            if (sId) {
              navigate(`/restaurant/${rId}/table/${finalTable}/session/${sId}/order/${finalOrderId}/checkout`, { replace: true });
            } else {
              navigate(`/restaurant/${rId}/table/${finalTable}/order/${finalOrderId}/checkout`, { replace: true });
            }
            return true;
          }
          return false;
        };

        // Helper function to handle fallback direction to menu if checkout is not available
        const redirectToCustomerMenu = (rId: string | null, tId: string | null, sId: string | null) => {
          if (rId) {
            const finalTable = tId || 'default';
            if (sId) {
              navigate(`/restaurant/${rId}/table/${finalTable}/session/${sId}`, { replace: true });
            } else {
              navigate(`/restaurant/${rId}/table/${finalTable}`, { replace: true });
            }
            return true;
          }
          return false;
        };

        if (isCancelled) {
          setStatusText("Payment cancelled. Returning to checkout...");
          if (targetOrderId) {
            const orderRes = await fetch(getApiUrl(`/api/public/orders/${targetOrderId}`));
            if (orderRes.ok) {
              const orderData = await orderRes.json();
              const restId = orderData.restaurant_id;
              const tableId = orderData.table_id || 'default';
              const sId = orderData.session_id || sessionId || '';
              if (redirectToCheckout(restId, tableId, sId, targetOrderId)) return;
            }
          }
          if (redirectToCheckout(restParamId, tableParamId, sessionId, targetOrderId)) return;
          if (redirectToCustomerMenu(restParamId, tableParamId, sessionId)) return;
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
        if (redirectToCustomerMenu(restParamId, tableParamId, sessionId)) return;

        setStatusText("Redirecting back to menu...");
        navigate('/');
      } catch (err) {
        console.error("Error in CheckoutStatusRedirect:", err);
        // Try fallback to parameters first
        const restParamId = searchParams.get('restaurant_id') || searchParams.get('restaurantId');
        const tableParamId = searchParams.get('table_id') || searchParams.get('tableId');
        const sessionId = searchParams.get('session_id') || searchParams.get('sessionId');
        if (restParamId) {
          const finalTable = tableParamId || 'default';
          if (sessionId) {
            navigate(`/restaurant/${restParamId}/table/${finalTable}/session/${sessionId}`, { replace: true });
          } else {
            navigate(`/restaurant/${restParamId}/table/${finalTable}`, { replace: true });
          }
        } else {
          navigate('/');
        }
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
