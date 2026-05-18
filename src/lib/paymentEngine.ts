import { supabase } from './supabase';
import { Payment, PaymentStatus } from '../types';

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
  }): Promise<Payment> {
    const response = await fetch('/api/public/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    if (!response.ok) throw new Error('Create payment failed');
    return response.json();
  },

  /**
   * Initialize a specific provider flow (DuitNow, FPX, etc)
   */
  async initializeProvider(payment: Payment): Promise<PaymentIntentResponse> {
    const response = await fetch(`/api/public/payments/${payment.id}/initialize`, {
      method: 'POST'
    });
    if (!response.ok) throw new Error('Initialize provider failed');
    return response.json();
  },

  /**
   * Poll for payment success or failure
   */
  async checkStatus(paymentId: string): Promise<PaymentStatus> {
    const response = await fetch(`/api/public/payments/${paymentId}/status`);
    if (!response.ok) throw new Error('Check status failed');
    const data = await response.json();
    return data.status;
  },

  /**
   * Simulate a successful payment (for dev/demo only)
   */
  async simulateSuccess(paymentId: string) {
    const response = await fetch(`/api/public/payments/${paymentId}/simulate-success`, {
      method: 'POST'
    });
    if (!response.ok) throw new Error('Simulate success failed');
  }
};
