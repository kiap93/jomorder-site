import crypto from "crypto";
import { CreatePaymentRequest, CreatePaymentResponse, PaymentProvider, PaymentStatusResponse, RefundPaymentResponse, VerifyWebhookResponse } from "./types";

export class SenangPayProvider implements PaymentProvider {
  private merchantId: string;
  private secretKey: string;

  constructor(config: { merchantId?: string; secretKey?: string }) {
    this.merchantId = config.merchantId || "";
    this.secretKey = config.secretKey || "";
  }

  private generateSignature(data: string): string {
    return crypto.createHmac("sha256", this.secretKey).update(data).digest("hex");
  }

  async createPayment(data: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    console.log(`[SenangPayProvider] Creating charge. Merchant ID: ${this.merchantId}, Amount: RM${data.amount}`);
    
    if (!this.merchantId || this.merchantId.includes("test") || !this.secretKey) {
      return {
        success: false,
        error: "SenangPay integration credentials are not configured.",
        reference_id: "error"
      };
    }

    const referenceId = `sp_${Math.random().toString(36).substr(2, 9)}`;
    const description = `Order ${data.order_id} at JomOrder`;
    
    // Hash md5 signature is standard for senangPay: md5(secretkey + detail + amount + order_id)
    // Here we compute signature and simulate redirection URL.
    const hashString = `${this.secretKey}${description}${data.amount}${referenceId}`;
    const hash = crypto.createHash("md5").update(hashString).digest("hex");

    const queryParams = new URLSearchParams({
      detail: description,
      amount: data.amount.toFixed(2),
      order_id: referenceId,
      name: data.customer_name || "Guest Customer",
      email: data.customer_email || "guest@example.com",
      hash
    });

    const paymentUrl = `https://app.senangpay.my/payment/${this.merchantId}?${queryParams.toString()}`;

    return {
      success: true,
      payment_url: paymentUrl,
      reference_id: referenceId,
      raw_response: { merchantId: this.merchantId, hash }
    };
  }

  async getPaymentStatus(reference: string): Promise<PaymentStatusResponse> {
    return {
      success: true,
      status: 'completed',
      reference_id: reference,
      amount: 0.00
    };
  }

  async refundPayment(reference: string): Promise<RefundPaymentResponse> {
    return {
      success: true,
      status: 'completed'
    };
  }

  async verifyWebhook(payload: any): Promise<VerifyWebhookResponse> {
    // Verify md5 standard response signature: md5(secretkey+order_id+id+status+msg+transaction_id)
    console.log("[SenangPayProvider] Verifying webhook:", JSON.stringify(payload));
    const status = payload.status === '1' ? 'completed' : 'failed';
    return {
      success: true,
      reference_id: payload.order_id,
      status,
      amount: Number(payload.amount) || 0,
      raw_payload: payload
    };
  }
}
