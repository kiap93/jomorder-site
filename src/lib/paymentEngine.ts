import { Payment, PaymentStatus } from '../types';
import { apiClient } from './apiClient';

export interface PaymentIntentResponse {
  paymentId: string;
  provider: string;
  paymentMethod: string;
  qrData?: string; // For DuitNow/TNG simulation
  redirectUrl?: string; // For FPX/Card simulation
}

/**
 * Enterprise Payment Engine for Restaurant POS + QR Ordering
 * Handles lifecycle, retries, and provider abstractions
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
    const { idempotencyKey, ...restParams } = params;
    return apiClient.post<Payment>('/api/public/payments', {
      ...restParams,
      idempotencyKey,
      idempotency_key: idempotencyKey // Send both styles
    });
  },

  /**
   * Initialize a specific provider flow (DuitNow, FPX, etc)
   */
  async initializeProvider(payment: Payment): Promise<PaymentIntentResponse> {
    return apiClient.post<PaymentIntentResponse>(`/api/public/payments/${payment.id}/initialize`);
  },

  /**
   * Poll for payment success or failure
   */
  async checkStatus(paymentId: string): Promise<PaymentStatus> {
    const data = await apiClient.get<any>(`/api/public/payments/${paymentId}/status`);
    return data.status;
  },

  /**
   * Simulate a successful payment (for dev/demo only)
   */
  async simulateSuccess(paymentId: string): Promise<void> {
    await apiClient.post(`/api/public/payments/${paymentId}/simulate-success`);
  }
};
