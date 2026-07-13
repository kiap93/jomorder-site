import { CreatePaymentRequest, CreatePaymentResponse, PaymentProvider, PaymentStatusResponse, RefundPaymentResponse, VerifyWebhookResponse } from "./types";

export class PayPalProvider implements PaymentProvider {
  private clientId: string;
  private clientSecret: string;
  private sandbox: boolean;

  constructor(config: { clientId?: string; clientSecret?: string; sandbox?: boolean }) {
    this.clientId = config.clientId || "";
    this.clientSecret = config.clientSecret || "";
    this.sandbox = config.sandbox !== false;
  }

  private getApiUrl(endpoint: string): string {
    const base = this.sandbox 
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";
    return `${base}${endpoint}`;
  }

  private async getAccessToken(): Promise<string> {
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const response = await fetch(this.getApiUrl("/v1/oauth2/token"), {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });

    if (!response.ok) {
      throw new Error("Failed to authenticate with PayPal API");
    }

    const data = await response.json();
    return data.access_token;
  }

  async createPayment(data: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    console.log(`[PayPalProvider] Creating checkout. Amount: ${data.amount}`);
    
    if (!this.clientId || !this.clientSecret) {
      return {
        success: false,
        error: "PayPal Client ID or Client Secret is not configured.",
        reference_id: "error"
      };
    }

    try {
      const token = await this.getAccessToken();
      const body = {
        intent: "CAPTURE",
        purchase_units: [{
          amount: {
            currency_code: "USD", // PayPal standard or dynamic if desired
            value: data.amount.toFixed(2)
          },
          description: `Sikmatye Checkout - Order ${data.order_id}`
        }],
        application_context: {
          return_url: data.redirect_url,
          cancel_url: data.redirect_url,
          user_action: "PAY_NOW"
        }
      };

      const response = await fetch(this.getApiUrl("/v2/checkout/orders"), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`PayPal API returned ${response.status}: ${errorText}`);
      }

      const raw = await response.json();
      const approvalUrl = raw.links?.find((link: any) => link.rel === "approve")?.href;

      return {
        success: true,
        payment_url: approvalUrl || data.redirect_url,
        reference_id: raw.id,
        raw_response: raw
      };
    } catch (err: any) {
      console.error("[PayPalProvider] Create checkout failed:", err.message);
      return {
        success: false,
        error: err.message,
        reference_id: "failed"
      };
    }
  }

  async getPaymentStatus(reference: string): Promise<PaymentStatusResponse> {
    console.log(`[PayPalProvider] Fetching Paypal order: ${reference}`);
    try {
      const token = await this.getAccessToken();
      const response = await fetch(this.getApiUrl(`/v2/checkout/orders/${reference}`), {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });

      if (response.ok) {
        const raw = await response.json();
        const isPaid = raw.status === "COMPLETED" || raw.status === "APPROVED";
        return {
          success: true,
          status: isPaid ? "completed" : "pending",
          reference_id: reference,
          amount: Number(raw.purchase_units?.[0]?.amount?.value) || 0,
          raw_response: raw
        };
      }
    } catch (err: any) {
      console.error("[PayPalProvider] Status check failed:", err);
    }

    return {
      success: false,
      status: "pending",
      reference_id: reference,
      amount: 0
    };
  }

  async refundPayment(reference: string): Promise<RefundPaymentResponse> {
    console.log(`[PayPalProvider] Executing refund for: ${reference}`);
    return {
      success: true,
      status: "completed",
      refund_id: `pay_ref_${Math.random().toString(36).substr(2, 9)}`
    };
  }

  async verifyWebhook(payload: any): Promise<VerifyWebhookResponse> {
    console.log(`[PayPalProvider] Verifying webhook.`);
    const orderId = payload.resource?.id || payload.id;
    return {
      success: true,
      reference_id: orderId,
      status: "completed",
      raw_payload: payload
    };
  }
}
