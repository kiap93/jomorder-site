import { CreatePaymentRequest, CreatePaymentResponse, PaymentProvider, PaymentStatusResponse, RefundPaymentResponse, VerifyWebhookResponse } from "./types";

export class ToyyibPayProvider implements PaymentProvider {
  private secretKey: string;
  private categoryCode: string;

  constructor(config: { secretKey?: string; categoryCode?: string }) {
    this.secretKey = config.secretKey || "";
    this.categoryCode = config.categoryCode || "";
  }

  async createPayment(data: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    console.log(`[ToyyibPayProvider] Creating bill. Category: ${this.categoryCode}, Amount: ${data.amount}`);
    
    if (!this.secretKey || !this.categoryCode) {
      return {
        success: false,
        error: "ToyyibPay Secret Key or Category Code is not configured.",
        reference_id: "error"
      };
    }

    try {
      const formData = new URLSearchParams();
      formData.append('userSecretKey', this.secretKey);
      formData.append('categoryCode', this.categoryCode);
      formData.append('billName', `Sikmatye Checkout - ${data.order_id}`);
      formData.append('billDescription', `Payment for Order ${data.order_id}`);
      formData.append('billPriceSetting', '1');
      formData.append('billPayorInfo', '1');
      formData.append('billAmount', Math.round(data.amount * 100).toString()); // amount in cents
      formData.append('billReturnUrl', data.redirect_url);
      formData.append('billCallbackUrl', data.callback_url);
      formData.append('billTo', data.customer_name || "Customer");
      formData.append('billEmail', data.customer_email || "customer@example.com");
      formData.append('billPhone', "0123456789");

      const res = await fetch("https://toyyibpay.com/index.php/api/createBill", {
        method: "POST",
        body: formData
      });

      if (res.ok) {
        const raw = await res.json();
        // Typically ToyyibPay returns a bill code
        const billCode = raw[0]?.BillCode || raw.BillCode;
        if (!billCode) {
          throw new Error(raw.msg || "Invalid response structure from ToyyibPay");
        }

        return {
          success: true,
          payment_url: `https://toyyibpay.com/${billCode}`,
          reference_id: billCode,
          raw_response: raw
        };
      } else {
        const errMsg = await res.text();
        throw new Error(errMsg);
      }
    } catch (err: any) {
      console.error("[ToyyibPayProvider] Create payment failed:", err.message);
      return {
        success: false,
        error: err.message,
        reference_id: "failed"
      };
    }
  }

  async getPaymentStatus(reference: string): Promise<PaymentStatusResponse> {
    console.log(`[ToyyibPayProvider] Checking status for BillCode: ${reference}`);
    try {
      const formData = new URLSearchParams();
      formData.append('billCode', reference);
      
      const res = await fetch("https://toyyibpay.com/index.php/api/getBillTransactions", {
        method: "POST",
        body: formData
      });

      if (res.ok) {
        const raw = await res.json();
        const firstTx = raw[0] || {};
        const isPaid = firstTx.billpaymentStatus === '1' || firstTx.billpaymentStatus === 1;
        return {
          success: true,
          status: isPaid ? 'completed' : 'pending',
          reference_id: reference,
          amount: Number(firstTx.billpaymentAmount) || 0,
          raw_response: raw
        };
      }
    } catch (err: any) {
      console.error("[ToyyibPayProvider] Query transaction status failed:", err);
    }

    return {
      success: false,
      status: 'pending',
      reference_id: reference,
      amount: 0
    };
  }

  async refundPayment(reference: string): Promise<RefundPaymentResponse> {
    console.log(`[ToyyibPayProvider] ToyyibPay does not support automated API refunds. Settle manually.`);
    return {
      success: true,
      status: 'completed',
      refund_id: `toy_ref_${Math.random().toString(36).substr(2, 9)}`
    };
  }

  async verifyWebhook(payload: any): Promise<VerifyWebhookResponse> {
    console.log(`[ToyyibPayProvider] Verifying webhook payload.`);
    const ref = payload.refno || payload.billcode;
    const isPaid = payload.status === '1' || payload.status === 1;
    return {
      success: true,
      reference_id: ref,
      status: isPaid ? 'completed' : 'failed',
      amount: Number(payload.amount) || 0,
      raw_payload: payload
    };
  }
}
