import { useAuthStore } from "../../../store/useAuthStore";
import { BillingOverview, PlanCode } from "../types";

/**
 * Gets the standard Authorization headers with JWT token
 */
function getHeaders(): HeadersInit {
  const token = useAuthStore.getState().token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

/**
 * Client service layer connecting the frontend billing pages to Express APIs
 */
export const billingService = {
  /**
   * Fetches active plan subscription and statistics usage tracker
   */
  async getOverview(restId: string): Promise<BillingOverview> {
    const res = await fetch(`/api/billing/overview?restId=${restId}`, {
      method: "GET",
      headers: getHeaders()
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to load billing overview.");
    }

    return await res.json();
  },

  /**
   * Triggers Stripe checkout link generation
   */
  async createCheckoutSession(restId: string, plan: PlanCode): Promise<{ url: string }> {
    const res = await fetch("/api/billing/create-checkout-session", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ restaurantId: restId, plan })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to initialize checkout.");
    }

    return await res.json();
  },

  /**
   * Deploys Customer Self-Service Portal redirect link
   */
  async createPortalSession(restId: string): Promise<{ url: string }> {
    const res = await fetch("/api/billing/create-portal-session", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ restaurantId: restId })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to open Stripe Portal.");
    }

    return await res.json();
  },

  /**
   * Triggers immediate cancellation behavior
   */
  async cancelSubscription(restId: string): Promise<void> {
    const res = await fetch("/api/billing/cancel", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ restaurantId: restId })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || "Cancellation transaction failed.");
    }
  },

  /**
   * Test controller allowing instant preview of packages in sandbox limits
   */
  async simulateSandboxPlan(plan: PlanCode): Promise<void> {
    const res = await fetch("/api/billing/sandbox-simulate", {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ plan })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || "Sandbox simulation failed.");
    }
  }
};
