import { Request, Response } from "express";
import { getStripeClient, getPlanCodeFromPriceId } from "../services/stripe";
import { BillingRepository } from "../repositories/billingRepository";
import { SubscriptionStatus } from "../types";

const repo = new BillingRepository();

/**
 * Production-grade Webhook Router to securely digest event feeds from stripe
 */
export async function handleStripeWebhook(req: Request, res: Response) {
  const stripe = getStripeClient();
  const signature = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: any;

  // 1. Signature Security Validation
  if (webhookSecret && signature) {
    try {
      const rawBody = (req as any).rawBody;
      if (!rawBody) {
        throw new Error("Raw body stream missing. Configure express.json verify context first.");
      }
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: any) {
      console.error(`[WEBHOOK SIGNATURE VERIFICATION FAILED]: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // If webhook secret isn't specified or we are testing locally in the developer sandbox,
    // we bypass verification and allow testing simulated Stripe structures directly
    console.warn("[WEBHOOK SECURITY WARNING] Webhook secret not defined or signature absent. Processing mock payload body directly.");
    event = req.body;
  }

  const stripeEventId = event.id;
  const eventType = event.type;
  
  console.log(`[STRIPE WEBHOOK RECEIVED] Event ID: ${stripeEventId} | Type: ${eventType}`);

  try {
    switch (eventType) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const tenantId = session.metadata?.tenant_id || session.client_reference_id;
        const targetPlan = session.metadata?.plan_code || "starter";
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        if (tenantId) {
          await repo.logEvent({
            tenant_id: tenantId,
            event_type: eventType,
            stripe_event_id: stripeEventId,
            payload: session
          });

          // Save Stripe Customer details
          await repo.upsertBillingCustomer({
            tenant_id: tenantId,
            stripe_customer_id: customerId,
            email: session.customer_details?.email || "billing@sikmatye.com"
          });

          // Retrieve active subscription parameters to get actual trial and period bounds
          let trialEnd: string | null = null;
          let currentPeriodStart = new Date().toISOString();
          let currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          let stripePriceId = null;

          if (subscriptionId && !subscriptionId.startsWith("sub_mock")) {
            try {
              const subObj = (await stripe.subscriptions.retrieve(subscriptionId)) as any;
              trialEnd = subObj.trial_end ? new Date(subObj.trial_end * 1000).toISOString() : null;
              currentPeriodStart = new Date(subObj.current_period_start * 1000).toISOString();
              currentPeriodEnd = new Date(subObj.current_period_end * 1000).toISOString();
              stripePriceId = subObj.items.data[0].price.id;
            } catch (_) {}
          }

          // Active upsert with isolated state parameters
          await repo.upsertSubscription({
            tenant_id: tenantId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            stripe_price_id: stripePriceId,
            plan_code: targetPlan,
            status: trialEnd ? "trialing" : "active",
            current_period_start: currentPeriodStart,
            current_period_end: currentPeriodEnd,
            trial_end: trialEnd,
            cancel_at_period_end: false
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;

        // Trace tenant ID from Stripe Customer Metadata
        let tenantId = subscription.metadata?.tenant_id;
        if (!tenantId) {
          try {
            const customerObj = await stripe.customers.retrieve(customerId) as any;
            tenantId = customerObj.metadata?.tenant_id;
          } catch (_) {}
        }

        if (tenantId) {
          await repo.logEvent({
            tenant_id: tenantId,
            event_type: eventType,
            stripe_event_id: stripeEventId,
            payload: subscription
          });

          const priceId = subscription.items.data[0].price.id;
          const planCode = getPlanCodeFromPriceId(priceId);
          const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null;
          const status = subscription.status as SubscriptionStatus;

          await repo.upsertSubscription({
            tenant_id: tenantId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            stripe_price_id: priceId,
            plan_code: planCode,
            status: status === "trialing" ? "trialing" : status === "active" ? "active" : status,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            trial_end: trialEnd,
            cancel_at_period_end: subscription.cancel_at_period_end || false
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;
        let tenantId = subscription.metadata?.tenant_id;

        if (!tenantId) {
          try {
            const customerObj = await stripe.customers.retrieve(customerId) as any;
            tenantId = customerObj.metadata?.tenant_id;
          } catch (_) {}
        }

        if (tenantId) {
          await repo.logEvent({
            tenant_id: tenantId,
            event_type: eventType,
            stripe_event_id: stripeEventId,
            payload: subscription
          });

          await repo.upsertSubscription({
            tenant_id: tenantId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            stripe_price_id: subscription.items.data[0].price.id,
            plan_code: "starter",
            status: "canceled",
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            trial_end: null,
            cancel_at_period_end: true
          });
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription as string;
        const customerId = invoice.customer as string;

        if (subscriptionId) {
          // Sync active status on database level
          let tenantId = invoice.subscription_details?.metadata?.tenant_id;
          if (!tenantId) {
            try {
              const subObj = (await stripe.subscriptions.retrieve(subscriptionId)) as any;
              tenantId = subObj.metadata?.tenant_id;
            } catch (_) {}
          }

          if (tenantId) {
            await repo.logEvent({
              tenant_id: tenantId,
              event_type: eventType,
              stripe_event_id: stripeEventId,
              payload: invoice
            });

            const currentSub = await repo.getSubscription(tenantId);
            if (currentSub) {
              await repo.upsertSubscription({
                ...currentSub,
                status: "active",
                current_period_start: new Date(invoice.period_start * 1000).toISOString(),
                current_period_end: new Date(invoice.period_end * 1000).toISOString()
              });
            }
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription as string;
        if (subscriptionId) {
          let tenantId = invoice.subscription_details?.metadata?.tenant_id;
          if (!tenantId) {
            try {
              const subObj = (await stripe.subscriptions.retrieve(subscriptionId)) as any;
              tenantId = subObj.metadata?.tenant_id;
            } catch (_) {}
          }

          if (tenantId) {
            await repo.logEvent({
              tenant_id: tenantId,
              event_type: eventType,
              stripe_event_id: stripeEventId,
              payload: invoice
            });

            const currentSub = await repo.getSubscription(tenantId);
            if (currentSub) {
              await repo.upsertSubscription({
                ...currentSub,
                status: "past_due"
              });
            }
          }
        }
        break;
      }

      default:
        console.log(`[STRIPE WEBHOOK] Unhandled event category: ${eventType}`);
    }

    res.status(200).json({ received: true, id: stripeEventId });
  } catch (err: any) {
    console.error(`[WEBHOOK PROCESSING EXCEPTION]: ${err.message}`);
    res.status(500).json({ error: "Webhook processing error", details: err.message });
  }
}
