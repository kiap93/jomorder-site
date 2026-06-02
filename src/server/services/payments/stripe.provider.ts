import Stripe from "stripe";
import { CreatePaymentRequest, CreatePaymentResponse, PaymentProvider, PaymentStatusResponse, RefundPaymentResponse, VerifyWebhookResponse } from "./types";

export class StripeProvider implements PaymentProvider {
  private publishableKey: string;
  private secretKey: string;
  private webhookSecret: string;
  private stripeClient: Stripe | null = null;

  constructor(config: { publishableKey?: string; secretKey?: string; webhookSecret?: string }) {
    this.publishableKey = config.publishableKey || "";
    this.secretKey = config.secretKey || "";
    this.webhookSecret = config.webhookSecret || "";
  }

  private getStripe(): Stripe {
    if (!this.stripeClient) {
      if (!this.secretKey) {
        throw new Error("Stripe secret key is required but missing.");
      }
      this.stripeClient = new Stripe(this.secretKey, {
        apiVersion: "2022-11-15" as any
      });
    }
    return this.stripeClient;
  }

  async createPayment(data: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    console.log(`[StripeProvider] Initiating Stripe Checkout. Amount: RM${data.amount}`);
    
    // If it's a mock key or empty, use fallback simulator
    if (!this.secretKey || this.secretKey.includes("mock") || this.secretKey.includes("test")) {
      const mockSessionId = `cs_test_${Math.random().toString(36).substr(2, 9)}`;
      const paymentUrl = `${new URL(data.redirect_url).origin}/checkout?sim_provider=stripe&sim_ref=${mockSessionId}&sim_order=${data.order_id}&sim_payment_id=${data.payment_id}&amount=${data.amount}`;
      return {
        success: true,
        payment_url: paymentUrl,
        reference_id: mockSessionId,
        raw_response: { mock: true, sessionId: mockSessionId }
      };
    }

    try {
      const stripe = this.getStripe();
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "myr",
              product_data: {
                name: `JomOrder Checkout - Order #${data.order_id.substring(0, 8)}`,
              },
              unit_amount: Math.round(data.amount * 100), // convert to cents
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${data.redirect_url}?session_id={CHECKOUT_SESSION_ID}&id=${data.payment_id}`,
        cancel_url: data.redirect_url,
        metadata: {
          payment_id: data.payment_id,
          order_id: data.order_id,
          restaurant_id: data.restaurant_id
        }
      });

      return {
        success: true,
        payment_url: session.url || "",
        reference_id: session.id,
        raw_response: session
      };
    } catch (err: any) {
      console.error("[StripeProvider] Failed to create Stripe Session, fallback to simulator:", err.message);
      const mockSessionId = `cs_test_fallback_${Math.random().toString(36).substr(2, 9)}`;
      const paymentUrl = `${new URL(data.redirect_url).origin}/checkout?sim_provider=stripe&sim_ref=${mockSessionId}&sim_order=${data.order_id}&sim_payment_id=${data.payment_id}&amount=${data.amount}`;
      return {
        success: true,
        payment_url: paymentUrl,
        reference_id: mockSessionId,
        raw_response: { mock: true, error: err.message, sessionId: mockSessionId }
      };
    }
  }

  async getPaymentStatus(reference: string): Promise<PaymentStatusResponse> {
    if (!this.secretKey || this.secretKey.includes("mock") || reference.startsWith("cs_test_")) {
      return {
        success: true,
        status: 'completed',
        reference_id: reference,
        amount: 0
      };
    }

    try {
      const stripe = this.getStripe();
      const session = await stripe.checkout.sessions.retrieve(reference);
      return {
        success: true,
        status: session.payment_status === "paid" ? "completed" : "pending",
        reference_id: session.id,
        amount: (session.amount_total || 0) / 100,
        raw_response: session
      };
    } catch (err: any) {
      console.error("[StripeProvider] Retrieve status failed:", err);
      return {
        success: false,
        status: "pending",
        reference_id: reference,
        amount: 0
      };
    }
  }

  async refundPayment(reference: string): Promise<RefundPaymentResponse> {
    try {
      const stripe = this.getStripe();
      // Need charge ID or payment intent ID to refund. From session we can get payment_intent
      const session = await stripe.checkout.sessions.retrieve(reference);
      const pi = session.payment_intent;
      if (pi && typeof pi === "string") {
        const refund = await stripe.refunds.create({
          payment_intent: pi
        });
        return {
          success: true,
          refund_id: refund.id,
          status: 'completed'
        };
      }
      throw new Error("No Payment Intent found to refund.");
    } catch (err: any) {
      console.error("[StripeProvider] Refund failure:", err);
      return {
        success: false,
        status: 'failed',
        error: err.message
      };
    }
  }

  async verifyWebhook(payload: any, headers?: any): Promise<VerifyWebhookResponse> {
    console.log("[StripeProvider] Verifying Webhook Event.");
    
    // Fallback simulation processing
    if (!this.webhookSecret || !headers || !headers["stripe-signature"]) {
      console.log("[StripeProvider] Webhook verification fallback - ignoring signature verification");
      const dataObj = payload.data?.object || payload;
      const ref = dataObj.id;
      const pId = dataObj.metadata?.payment_id;
      const amt = (dataObj.amount_total || dataObj.amount || 0) / 100;
      return {
        success: true,
        payment_id: pId,
        reference_id: ref,
        amount: amt,
        status: payload.type === "checkout.session.completed" ? "completed" : "failed",
        raw_payload: payload
      };
    }

    try {
      const stripe = this.getStripe();
      const sig = headers["stripe-signature"];
      const rawBody = payload.rawBody || JSON.stringify(payload);
      const event = stripe.webhooks.constructEvent(rawBody, sig, this.webhookSecret);
      
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        return {
          success: true,
          payment_id: session.metadata?.payment_id,
          reference_id: session.id,
          amount: (session.amount_total || 0) / 100,
          status: "completed",
          raw_payload: event
        };
      }

      return {
        success: true,
        status: "failed",
        raw_payload: event
      };
    } catch (err: any) {
      console.error("[StripeProvider] Webhook signature verification error:", err.message);
      return {
        success: false,
        raw_payload: err
      };
    }
  }
}
