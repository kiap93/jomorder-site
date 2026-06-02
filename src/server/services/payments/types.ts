export interface CreatePaymentRequest {
  payment_id: string;
  order_id: string;
  restaurant_id: string;
  amount: number;
  payment_method: string;
  customer_email?: string;
  customer_name?: string;
  callback_url: string;
  redirect_url: string;
}

export interface CreatePaymentResponse {
  success: boolean;
  payment_url?: string;
  qr_code_data?: string;
  reference_id: string;
  raw_response?: any;
  error?: string;
}

export interface PaymentStatusResponse {
  success: boolean;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  reference_id: string;
  amount: number;
  raw_response?: any;
}

export interface RefundPaymentResponse {
  success: boolean;
  refund_id?: string;
  status: 'completed' | 'failed';
  error?: string;
}

export interface VerifyWebhookResponse {
  success: boolean;
  payment_id?: string;
  reference_id?: string;
  amount?: number;
  status?: 'completed' | 'failed' | 'refunded';
  raw_payload?: any;
}

export interface PaymentProvider {
  createPayment(data: CreatePaymentRequest): Promise<CreatePaymentResponse>;
  getPaymentStatus(reference: string): Promise<PaymentStatusResponse>;
  refundPayment(reference: string): Promise<RefundPaymentResponse>;
  verifyWebhook(payload: unknown, headers?: unknown): Promise<VerifyWebhookResponse>;
}
