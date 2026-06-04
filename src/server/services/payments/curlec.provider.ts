import { CreatePaymentRequest, CreatePaymentResponse, PaymentProvider, PaymentStatusResponse, RefundPaymentResponse, VerifyWebhookResponse } from "./types";

export class CurlecProvider implements PaymentProvider {
  private apiKey: string;
  private merchantId: string;

  constructor(config: { apiKey?: string; merchantId?: string }) {
    this.apiKey = config.apiKey || "";
    this.merchantId = config.merchantId || "";
  }

  async createPayment(data: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    console.log(`[CurlecProvider] Creating payment. Merchant: ${this.merchantId}, Amount: ${data.amount}`);
    
    if (
      !this.merchantId || 
      !this.apiKey
    ) {
      return {
        success: false,
        error: "Curlec integration credentials are not configured.",
        reference_id: "error"
      };
    }

    const referenceId = `cur_${Math.random().toString(36).substr(2, 9)}`;

    // Build redirection link
    const paymentUrl = `https://checkout.curlec.com/pay?merchant=${this.merchantId}&amount=${data.amount}&ref=${referenceId}`;

    return {
      success: true,
      payment_url: paymentUrl,
      reference_id: referenceId,
      raw_response: { mock: true, referenceId }
    };
  }

  async getPaymentStatus(reference: string): Promise<PaymentStatusResponse> {
    return {
      success: true,
      status: 'completed',
      reference_id: reference,
      amount: 10.00
    };
  }

  async refundPayment(reference: string): Promise<RefundPaymentResponse> {
    return {
      success: true,
      status: 'completed'
    };
  }

  async verifyWebhook(payload: any): Promise<VerifyWebhookResponse> {
    const referenceId = payload.reference_id || payload.ref || payload.id;
    return {
      success: true,
      reference_id: referenceId,
      status: payload.status === 'success' || payload.status === 'completed' ? 'completed' : 'failed',
      amount: Number(payload.amount) || 0,
      raw_payload: payload
    };
  }
}
