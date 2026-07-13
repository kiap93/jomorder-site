import Stripe from "stripe";
import dotenv from "dotenv";

dotenv.config();

let stripeInstance: Stripe | null = null;
let activeApiKey: string | null = null;

/**
 * Lazy initializer for secure standard Node-based stripe calls.
 * This ensures the server never crashes on startup if secret keys are missing.
 */
export function getStripeClient(apiKey?: string): Stripe {
  const secretKey = apiKey || process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  if (!stripeInstance || activeApiKey !== secretKey) {
    stripeInstance = new Stripe(secretKey, {
      apiVersion: "2022-11-15" as any,
    });
    activeApiKey = secretKey;
  }
  return stripeInstance;
}

// Plan Prices Map dictionary (RM monthly rates)
export const PLAN_PRICES = {
  starter: {
    priceId: process.env.STRIPE_PRICE_STARTER || "price_Sikmatye_Starter_RM18",
    priceAmount: 18.00,
    currency: "MYR",
    planName: "Starter Plan"
  },
  growth: {
    priceId: process.env.STRIPE_PRICE_GROWTH || "price_Sikmatye_Growth_RM38",
    priceAmount: 38.00,
    currency: "MYR",
    planName: "Growth Plan"
  },
  pro: {
    priceId: process.env.STRIPE_PRICE_PRO || "price_Sikmatye_Pro_RM98",
    priceAmount: 98.00,
    currency: "MYR",
    planName: "Pro Enterprise Plan"
  }
};

export const PLAN_CODES: ("starter" | "growth" | "pro")[] = ["starter", "growth", "pro"];

/**
 * Returns plan code corresponding to a price ID
 */
export function getPlanCodeFromPriceId(priceId: string): "starter" | "growth" | "pro" {
  if (priceId === PLAN_PRICES.pro.priceId) return "pro";
  if (priceId === PLAN_PRICES.growth.priceId) return "growth";
  return "starter";
}
