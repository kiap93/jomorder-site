import { supabaseAdmin } from "../dbService";
import { BillplzProvider } from "./billplz.provider";
import { SenangPayProvider } from "./senangpay.provider";
import { CurlecProvider } from "./curlec.provider";
import { StripeProvider } from "./stripe.provider";
import { decryptConfig } from "./cryptoUtils";
import { PaymentProvider } from "./types";

export * from "./types";
export * from "./cryptoUtils";

export async function getPaymentProviderForRestaurant(restaurantId: string, encryptionKey?: string, customSupabase?: any): Promise<{ provider: PaymentProvider; providerName: string; accountType: string; enabledMethods: string[] }> {
  console.log(`[PaymentFactory] Resolving payment provider for restaurant: ${restaurantId}`);
  
  const clientToUse = customSupabase || supabaseAdmin;
  try {
    const { data: settings, error } = await clientToUse
      .from('payment_settings')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.error("[PaymentFactory] Database error pulling payment settings:", error.message);
    }

    if (settings) {
      const decryptedConfig = decryptConfig(settings.merchant_config || {}, encryptionKey);
      const providerName = (settings.provider || "stripe").toLowerCase();
      const accountType = settings.account_type || "owner";
      const enabledMethods = Array.isArray(settings.enabled_methods) ? settings.enabled_methods : [];

      console.log(`[PaymentFactory] Found active settings for provider: ${providerName}. Keys available: ${Object.keys(decryptedConfig).join(", ")}`);
      if (providerName === "stripe") {
        console.log(`[PaymentFactory] Stripe config - secretKey length: ${decryptedConfig.secretKey ? decryptedConfig.secretKey.length : 0}, startsWith sk_: ${decryptedConfig.secretKey ? decryptedConfig.secretKey.startsWith('sk_') : false}, value (masked): ${decryptedConfig.secretKey ? decryptedConfig.secretKey.substring(0, 7) + '...' : 'none'}`);
      }

      let provider: PaymentProvider;
      switch (providerName) {
        case "billplz":
          provider = new BillplzProvider({
            apiKey: decryptedConfig.apiKey,
            collectionId: decryptedConfig.collectionId,
            webhookSecret: decryptedConfig.webhookSecret
          });
          break;
        case "senangpay":
          provider = new SenangPayProvider({
            merchantId: decryptedConfig.merchantId,
            secretKey: decryptedConfig.secretKey
          });
          break;
        case "curlec":
          provider = new CurlecProvider({
            apiKey: decryptedConfig.apiKey,
            merchantId: decryptedConfig.merchantId
          });
          break;
        case "stripe":
        default:
          provider = new StripeProvider({
            publishableKey: decryptedConfig.publishableKey,
            secretKey: decryptedConfig.secretKey,
            webhookSecret: decryptedConfig.webhookSecret
          });
          break;
      }

      console.log(`[PaymentFactory] Succesfully resolved provider "${providerName}" for restaurant ${restaurantId}`);
      return { provider, providerName, accountType, enabledMethods };
    }
  } catch (err: any) {
    console.warn("[PaymentFactory] Failure reading database configuration, using default sandbox Stripe fallback:", err.message);
  }

  // Resilient system-wide sandbox fallback configuration
  console.log(`[PaymentFactory] Resilient default system-wide sandbox fallback applied for ${restaurantId}`);
  const defaultProvider = new StripeProvider({
    publishableKey: "pk_test_sample",
    secretKey: "sk_test_sample",
    webhookSecret: "whsec_sample"
  });

  return {
    provider: defaultProvider,
    providerName: "stripe",
    accountType: "owner",
    enabledMethods: ["cash", "visa", "mastercard", "fpx", "duitnow", "tng", "grabpay", "boost", "atome", "grab_paylater"]
  };
}
