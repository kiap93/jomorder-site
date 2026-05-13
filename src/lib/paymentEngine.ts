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
    const { data, error } = await supabase
      .from('payments')
      .insert({
        restaurant_id: params.restaurantId,
        order_id: params.orderId,
        amount: params.amount,
        payment_method: params.method,
        provider: params.provider,
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Initialize a specific provider flow (DuitNow, FPX, etc)
   */
  async initializeProvider(payment: Payment): Promise<PaymentIntentResponse> {
    // Audit attempt
    await supabase.from('payment_attempts').insert({
      payment_id: payment.id,
      status: 'initiated'
    });

    // Strategy Pattern for Providers
    switch (payment.payment_method) {
      case 'duitnow':
      case 'tng':
        // Generate a simulated QR Data
        return {
          paymentId: payment.id,
          provider: payment.provider,
          paymentMethod: payment.payment_method,
          qrData: `00020101021126600010com.paynet.qr0111MY123456780211MY123456780303001520400005303458540${payment.amount.toFixed(2)}5802MY5907POS_SAAS6008Lumpur6105500006304`
        };
      
      case 'fpx':
      case 'card':
        return {
          paymentId: payment.id,
          provider: payment.provider,
          paymentMethod: payment.payment_method,
          redirectUrl: '/simulated-gateway'
        };

      default:
        throw new Error(`Unsupported payment method: ${payment.payment_method}`);
    }
  },

  /**
   * Poll for payment success or failure
   */
  async checkStatus(paymentId: string): Promise<PaymentStatus> {
    const { data, error } = await supabase
      .from('payments')
      .select('status')
      .eq('id', paymentId)
      .single();

    if (error) throw error;
    return data.status;
  },

  /**
   * Simulate a successful payment (for dev/demo only)
   */
  async simulateSuccess(paymentId: string) {
    // 1. Get the payment and its associated order
    const { data: payment, error: fetchError } = await supabase
      .from('payments')
      .select('order_id')
      .eq('id', paymentId)
      .single();
    
    if (fetchError) throw fetchError;

    const paidAt = new Date().toISOString();

    // 2. Update payment status
    const { error: payError } = await supabase
      .from('payments')
      .update({ 
        status: 'paid',
        paid_at: paidAt,
        external_id: `SIM_${Math.random().toString(36).substring(7).toUpperCase()}`
      })
      .eq('id', paymentId);

    if (payError) throw payError;

    // 3. Update order status (Sync Business Rule: Paid Payment -> Paid Order)
    // We update paid_at and change status to 'sent_to_kitchen' if it was 'pending'
    const { error: orderError } = await supabase
      .from('orders')
      .update({ 
        paid_at: paidAt,
        status: 'confirmed' // Auto-accept paid orders
      })
      .eq('id', payment?.order_id);

    if (orderError) throw orderError;

    // 4. Log success attempt
    await supabase.from('payment_attempts').insert({
      payment_id: paymentId,
      status: 'success',
      provider_response: { mode: 'simulation', timestamp: paidAt }
    });
  }
};
