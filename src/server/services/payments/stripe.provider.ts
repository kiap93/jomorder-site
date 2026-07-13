import Stripe from "stripe";
import { CreatePaymentRequest, CreatePaymentResponse, PaymentProvider, PaymentStatusResponse, RefundPaymentResponse, VerifyWebhookResponse } from "./types";
import { supabaseAdmin } from "../dbService";

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
    
    if (
      !this.secretKey || 
      this.secretKey === "mock" || 
      this.secretKey === "mock_secret" || 
      this.secretKey === "sk_test_sample"
    ) {
      return {
        success: false,
        error: "Stripe Secret Key is not configured for this restaurant.",
        reference_id: "error"
      };
    }

    // Load organization_id to map to tenantId
    let tenantId = data.restaurant_id;
    try {
      const { data: rest } = await supabaseAdmin
        .from('restaurants')
        .select('organization_id')
        .eq('id', data.restaurant_id)
        .maybeSingle();
      if (rest?.organization_id) {
        tenantId = rest.organization_id;
      }
    } catch (dbErr: any) {
      console.warn("[StripeProvider] Could not load organization_id from database:", dbErr.message);
    }

    try {
      const stripe = this.getStripe();
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card", "fpx"],
        line_items: [
          {
            price_data: {
              currency: "myr",
              product_data: {
                name: `Sikmatye Checkout - Order #${data.order_id.substring(0, 8)}`,
              },
              unit_amount: Math.round(data.amount * 100), // convert to cents
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${data.redirect_url}${data.redirect_url.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}&id=${data.payment_id}`,
        cancel_url: `${data.redirect_url}${data.redirect_url.includes('?') ? '&' : '?'}status=cancelled`,
        metadata: {
          payment_id: data.payment_id,
          order_id: data.order_id,
          restaurant_id: data.restaurant_id,
          orderId: data.order_id,
          tenantId: tenantId,
          workspaceId: data.restaurant_id
        },
        payment_intent_data: {
          metadata: {
            payment_id: data.payment_id,
            order_id: data.order_id,
            restaurant_id: data.restaurant_id,
            orderId: data.order_id,
            tenantId: tenantId,
            workspaceId: data.restaurant_id
          }
        }
      });

      return {
        success: true,
        payment_url: session.url || "",
        reference_id: session.id,
        raw_response: session
      };
    } catch (err: any) {
      console.error("[StripeProvider] Failed to create Stripe Session:", err.message);
      return {
        success: false,
        error: err.message,
        reference_id: "failed"
      };
    }
  }

  async getPaymentStatus(reference: string): Promise<PaymentStatusResponse> {
    if (
      !this.secretKey || 
      this.secretKey === "mock" || 
      this.secretKey === "mock_secret" ||
      this.secretKey === "sk_test_sample" ||
      reference.startsWith("cs_test_")
    ) {
      return {
        success: false,
        status: 'pending',
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
    
    try {
      const stripe = this.getStripe();
      const sig = headers ? headers["stripe-signature"] : null;
      if (!sig) {
        throw new Error("Missing stripe-signature header");
      }
      if (!this.webhookSecret || this.webhookSecret === "whsec_sample") {
        throw new Error("Stripe Webhook Secret is not configured");
      }
      const rawBody = payload.rawBody || (typeof payload === 'string' ? payload : JSON.stringify(payload));
      const event = stripe.webhooks.constructEvent(rawBody, sig, this.webhookSecret);
      
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        return {
          success: true,
          payment_id: session.metadata?.payment_id || undefined,
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
