import { Payment, PaymentStatus } from '../types';
import { apiClient } from './apiClient';
import { logger } from './logger';

export interface PaymentIntentResponse {
  paymentId: string;
  provider: string;
  paymentMethod: string;
  qrData?: string; // For DuitNow/TNG checkout QR code rendering
  redirectUrl?: string; // For Stripe Checkout/FPX redirection
}

/**
 * Enterprise Multi-Tenant Payment Engine for Restaurant POS + QR Ordering
 * Connects directly to our dynamic adapters and webhooks
 */
export const paymentEngine = {
  /**
   * Create a new payment record for an order
   */
  async createPayment(params: {
    restaurantId: string;
    orderId: string;
    amount: number;
    method: string;
    provider: string;
    idempotencyKey?: string;
  }): Promise<Payment> {
    logger.log(`[PaymentEngine] Calling /api/payments/create for order ${params.orderId} and method ${params.method}`);
    
    const res = await apiClient.post<any>('/api/payments/create', {
      order_id: params.orderId,
      payment_method: params.method
    });
    
    // Map response back to the standard front-end Payment contract
    return {
      id: res.payment_id,
      restaurant_id: params.restaurantId,
      order_id: params.orderId,
      amount: params.amount,
      payment_method: params.method,
      provider: res.provider || params.provider,
      status: 'pending',
      idempotency_key: res.reference_id,
      metadata: { 
        checkout_url: res.payment_url || res.redirect_url 
      }
    } as any;
  },

  /**
   * Initialize a specific provider flow (DuitNow, FPX, Stripe and Redirect or render QR)
   */
  async initializeProvider(payment: Payment): Promise<PaymentIntentResponse> {
    const metadata = (payment as any).metadata || {};
    const checkoutUrl = metadata.checkout_url;
    
    // Decide whether to view as QR Code or Redirection
    const isQrCode = payment.payment_method === 'tng' || payment.payment_method === 'duitnow';
    
    // If checkoutUrl is present and we're using a Stripe sandbox, automatically redirect for smooth payments.
    if (checkoutUrl && !isQrCode && typeof window !== 'undefined') {
      logger.log(`[PaymentEngine] Instantly redirecting user to: ${checkoutUrl}`);
      // In non-iframe or standard browser, trigger location transfer.
      setTimeout(() => {
        try {
          if (window.top && window.top !== window) {
            window.top.location.href = checkoutUrl;
          } else {
            window.location.href = checkoutUrl;
          }
        } catch (e) {
          window.location.href = checkoutUrl;
        }
      }, 100);
    }

    return {
      paymentId: payment.id,
      provider: payment.provider,
      paymentMethod: payment.payment_method,
      qrData: isQrCode ? (checkoutUrl || `https://jomorder.my/pay/mock-qr?id=${payment.id}`) : undefined,
      redirectUrl: !isQrCode ? checkoutUrl : undefined
    };
  },

  /**
   * Poll for payment success or failure using our database checking
   */
  async checkStatus(paymentId: string): Promise<PaymentStatus> {
    try {
      const data = await apiClient.get<any>(`/api/payments/status/${paymentId}`);
      return data.status as any;
    } catch (err) {
      console.error("[PaymentEngine] Check status query failed, assuming pendingState:", err);
      return 'pending';
    }
  }
};
