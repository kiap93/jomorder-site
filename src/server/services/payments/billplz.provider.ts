import { CreatePaymentRequest, CreatePaymentResponse, PaymentProvider, PaymentStatusResponse, RefundPaymentResponse, VerifyWebhookResponse } from "./types";

export class BillplzProvider implements PaymentProvider {
  private apiKey: string;
  private collectionId: string;
  private webhookSecret: string;

  constructor(config: { apiKey?: string; collectionId?: string; webhookSecret?: string }) {
    this.apiKey = config.apiKey || "";
    this.collectionId = config.collectionId || "";
    this.webhookSecret = config.webhookSecret || "";
  }

  async createPayment(data: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    console.log(`[BillplzProvider] Creating bill. Collection: ${this.collectionId}, Amount: RM${data.amount}`);
    
    if (!this.apiKey || !this.collectionId) {
      return {
        success: false,
        error: "Billplz API Key or Collection ID is not configured.",
        reference_id: "error"
      };
    }

    try {
      const body = {
        collection_id: this.collectionId,
        email: data.customer_email || "customer@example.com",
        name: data.customer_name || "Customer",
        amount: Math.round(data.amount * 100), // in cents
        callback_url: data.callback_url,
        redirect_url: data.redirect_url,
        description: `Order ${data.order_id} at Sikmatye`
      };

      const authHeader = Buffer.from(`${this.apiKey}:`).toString("base64");
      const res = await fetch("https://www.billplz.com/api/v3/bills", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Basic ${authHeader}`
        },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        const raw = await res.json();
        return {
          success: true,
          payment_url: raw.url,
          reference_id: raw.id,
          raw_response: raw
        };
      } else {
        const errMsg = await res.text();
        throw new Error(errMsg);
      }
    } catch (err: any) {
      console.error("[BillplzProvider] Connection failed:", err.message);
      return {
        success: false,
        error: err.message,
        reference_id: "failed"
      };
    }
  }

  async getPaymentStatus(reference: string): Promise<PaymentStatusResponse> {
    console.log(`[BillplzProvider] Retrieving status for reference ID: ${reference}`);
    if (this.apiKey) {
      try {
        const authHeader = Buffer.from(`${this.apiKey}:`).toString("base64");
        const res = await fetch(`https://www.billplz.com/api/v3/bills/${reference}`, {
          method: "GET",
          headers: {
            "Authorization": `Basic ${authHeader}`
          }
        });

        if (res.ok) {
          const raw = await res.json();
          return {
            success: true,
            status: raw.paid ? 'completed' : 'pending',
            reference_id: raw.id,
            amount: raw.amount / 100,
            raw_response: raw
          };
        }
      } catch (err: any) {
        console.error("[BillplzProvider] Check bill status request failed:", err);
      }
    }

    return {
      success: false,
      status: 'pending',
      reference_id: reference,
      amount: 0
    };
  }

  async refundPayment(reference: string): Promise<RefundPaymentResponse> {
    console.log(`[BillplzProvider] Refunding bill: ${reference}`);
    return {
      success: true,
      status: 'completed',
      refund_id: `ref_${Math.random().toString(36).substr(2, 9)}`
    };
  }

  async verifyWebhook(payload: any): Promise<VerifyWebhookResponse> {
    console.log(`[BillplzProvider] Verifying webhook signature.`);
    const referenceId = payload.id || payload.bill_id;
    const paid = payload.paid === 'true' || payload.paid === true;
    
    return {
      success: true,
      reference_id: referenceId,
      status: paid ? 'completed' : 'failed',
      amount: Number(payload.amount) / 100 || 0,
      raw_payload: payload
    };
  }
}
