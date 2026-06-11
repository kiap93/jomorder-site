import React, { useState, useEffect } from "react";
import { CreditCard, ShieldCheck, HelpCircle, Activity, ExternalLink, Sliders, Layers, RefreshCw, AlertTriangle, Sparkles, Building2, Globe } from "lucide-react";
import { useAuthStore } from "../../../store/useAuthStore";
import { billingService } from "../services/billingService";
import { BillingOverview, PlanCode } from "../types";
import { UpgradePlanModal } from "./UpgradePlanModal";
import { BillingHistoryPage } from "./BillingHistoryPage";

export function BillingPage() {
  const { profile } = useAuthStore();
  const restId = profile?.restaurantId;

  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Modals & Navigation Toggles
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [isViewHistoryOpen, setIsViewHistoryOpen] = useState(false);
  
  // Status feedback elements
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billingStatus = params.get("billing_status");

    const syncRedirectParams = async () => {
      if (!restId) return;
      try {
        setLoading(true);
        if (billingStatus === "success") {
          setSuccessMsg("Payment completed successfully! Your JomOrder subscription has been updated.");
          const newUrl = window.location.pathname;
          window.history.replaceState({}, document.title, newUrl);
        } else if (billingStatus === "cancelled") {
          setError("Subscription checkout process was cancelled.");
          const newUrl = window.location.pathname;
          window.history.replaceState({}, document.title, newUrl);
        }
      } catch (err: any) {
        console.error("Error processing redirected params:", err);
        setError(err.message || "Failed to update subscription from redirection query.");
      } finally {
        loadOverview();
      }
    };

    if (restId) {
      if (billingStatus) {
        syncRedirectParams();
      } else {
        loadOverview();
      }
    }
  }, [restId]);

  const loadOverview = async () => {
    try {
      setLoading(true);
      setError(null);
      if (restId) {
        const data = await billingService.getOverview(restId);
        setOverview(data);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load active SaaS billing metrics.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPlan = async (planCode: PlanCode) => {
    if (!restId) return;
    setActionLoading("checkout");
    setSuccessMsg(null);
    try {
      // Create Stripe checkout redirect
      const result = await billingService.createCheckoutSession(restId, planCode);
      if (result?.url) {
        // Redirect browser to either Stripe standard sandbox or our fallback simulation URLs
        window.location.href = result.url;
      }
    } catch (err: any) {
      setError(err.message || "Checkout redirect failed.");
    } finally {
      setActionLoading(null);
      setIsUpgradeModalOpen(false);
    }
  };

  const handleOpenPortal = async () => {
    if (!restId) return;
    setActionLoading("portal");
    setError(null);
    try {
      const result = await billingService.createPortalSession(restId);
      if (result?.url) {
        window.location.href = result.url;
      }
    } catch (err: any) {
      setError("Stripe self-service dashboard unavailable. Ensure Stripe customer is active.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelSub = async () => {
    if (!restId) return;
    if (!confirm("Are you sure you want to cancel your JomOrder subscription? Access limits will revert on period ends.")) return;
    
    setActionLoading("cancel");
    setError(null);
    try {
      await billingService.cancelSubscription(restId);
      setSuccessMsg("Subscription canceled successfully.");
      await loadOverview();
    } catch (err: any) {
      setError(err.message || "Cancellation failed.");
    } finally {
      setActionLoading(null);
    }
  };



  if (!restId) {
    return (
      <div className="p-8 text-center bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl max-w-lg mx-auto mt-12">
        <AlertTriangle className="mx-auto text-amber-500 mb-4" size={40} />
        <h3 className="text-lg font-bold">No Workspace Selected</h3>
        <p className="text-sm text-zinc-500 mt-2">Please switch into a restaurant brand workspace first to manage subscription billing parameters.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-3">
        <RefreshCw size={24} className="text-indigo-500 animate-spin" />
        <p className="text-zinc-500 text-sm">Querying Stripe matrices & limits dictionary...</p>
      </div>
    );
  }

  if (isViewHistoryOpen && overview) {
    return (
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <BillingHistoryPage 
          subscription={overview.subscription} 
          onBack={() => setIsViewHistoryOpen(false)} 
        />
      </div>
    );
  }

  const sub = overview?.subscription;
  const currentPlan = sub?.plan_code || "starter";
  const limits = overview?.plan;
  const trialDaysLeft = overview?.trialDaysLeft || 0;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8">
      
      {/* Alert feeds */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-red-800 dark:text-red-300 rounded-xl flex items-start space-x-3 text-sm">
          <AlertTriangle className="shrink-0 mt-0.5" size={18} />
          <div className="flex-1">
            <span className="font-semibold">SaaS Gating System Error:</span> {error}
          </div>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-250 dark:border-emerald-900/30 text-emerald-800 dark:text-emerald-300 rounded-xl flex items-start space-x-3 text-sm">
          <ShieldCheck className="shrink-0 mt-0.5" size={18} />
          <div className="flex-1">
            <span className="font-semibold">Success:</span> {successMsg}
          </div>
        </div>
      )}

      {/* Header section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-100 dark:border-zinc-850 pb-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-zinc-950 dark:text-zinc-50 font-sans">JomOrder SaaS Subscription Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Manage your corporate billing plans, scale locations capacity, and toggle AI translations interfaces.
          </p>
        </div>
        
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={() => setIsViewHistoryOpen(true)}
            className="px-4 py-2 text-sm font-semibold border border-zinc-200 dark:border-zinc-800 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-950 text-zinc-650 transition active:scale-95"
          >
            Invoice Statements
          </button>
          
          <button
            type="button"
            onClick={() => setIsUpgradeModalOpen(true)}
            className="px-4 py-2 text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-600/10 transition active:scale-95"
          >
            Switch/Upgrade Subscription
          </button>
        </div>
      </div>

      {/* Grid containing core status and usage meters */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Card: Plan Summary */}
        <div className="lg:col-span-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs uppercase font-bold tracking-wider text-zinc-400 font-mono">Current Tier</span>
              {sub?.status === "trialing" && (
                <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-500 border border-amber-500/20">
                  {trialDaysLeft} Days Trial Left
                </span>
              )}
              {sub?.status === "active" && (
                <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-500 border border-emerald-500/20">
                  Active Member
                </span>
              )}
              {sub?.status === "past_due" && (
                <span className="rounded bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-500 border border-red-500/20 animate-pulse">
                  Payment Failed
                </span>
              )}
            </div>

            <div>
              <h2 className="text-3xl font-black font-sans uppercase text-zinc-900 dark:text-zinc-100 mt-1">
                {currentPlan.toUpperCase()}
              </h2>
              <p className="text-zinc-500 text-sm mt-1">
                {currentPlan === "pro" 
                  ? "Full enterprise scaling with unlimited capabilities." 
                  : currentPlan === "growth" 
                  ? "Collaborative multi-outlet operational settings." 
                  : "Perfect for single cashier diners."}
              </p>
            </div>

            <div className="border-t border-zinc-100 dark:border-zinc-800/80 my-4 pt-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Auto Renew Date:</span>
                <span className="font-mono text-zinc-800 dark:text-zinc-200">
                  {sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Stripe Customer mapping:</span>
                <span className="font-mono text-xs text-zinc-550 truncate max-w-[140px]" title={sub?.stripe_customer_id}>
                  {sub?.stripe_customer_id || "None"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Recur rate amount:</span>
                <span className="font-sans font-extrabold text-zinc-800 dark:text-zinc-100 text-base">
                  {currentPlan === "pro" ? "RM98.00" : currentPlan === "growth" ? "RM38.00" : "RM18.00"}
                  <span className="text-xs text-zinc-400 font-normal"> /mo</span>
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-3 mt-6">
            <button
              onClick={handleOpenPortal}
              disabled={actionLoading === "portal"}
              type="button"
              className="w-full inline-flex justify-center items-center space-x-2 py-2.5 bg-zinc-950 hover:bg-zinc-850 dark:bg-zinc-50 dark:hover:bg-zinc-150 dark:text-zinc-900 text-white font-bold rounded-xl text-sm transition active:scale-95 disabled:opacity-50"
            >
              <CreditCard size={16} />
              <span>{actionLoading === "portal" ? "Generating..." : "Stripe Payment Portal"}</span>
              <ExternalLink size={12} className="opacity-80" />
            </button>

            {sub?.status !== "trialing" && (
              <button
                onClick={handleCancelSub}
                disabled={actionLoading === "cancel" || sub?.status === "canceled"}
                type="button"
                className="w-full text-center text-xs font-semibold py-1.5 text-zinc-500 hover:text-red-600 transition"
              >
                {sub?.status === "canceled" ? "Subscription Canceled" : "Cancel recurring cycles"}
              </button>
            )}
          </div>
        </div>

        {/* Center / Right Cards: Usage Meters Gating */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Active Limit Meters */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-6">
            <div className="flex items-center space-x-2">
              <Activity size={18} className="text-indigo-500" />
              <h3 className="font-bold text-base text-zinc-900 dark:text-zinc-50 uppercase font-sans">Active Capacity Allocation Meters</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Meter 1: Outlets */}
              <div className="border border-zinc-150 dark:border-zinc-850 bg-zinc-50/40 dark:bg-zinc-950/20 p-5 rounded-2xl space-y-3">
                <div className="flex justify-between text-sm">
                  <div className="flex items-center space-x-2">
                    <Building2 className="text-zinc-400" size={16} />
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">Outlets Capacity</span>
                  </div>
                  <span className="font-mono text-zinc-550">
                    {overview?.usage.find(u => u.metric_code === "outlets_count")?.current_usage || 0} / {limits?.max_outlets === 9999 ? "Unlimited" : limits?.max_outlets || 1}
                  </span>
                </div>
                
                {/* Visual progress bar */}
                <div className="w-full bg-zinc-200/50 dark:bg-zinc-800 h-2.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-indigo-500 h-full rounded-full transition-all"
                    style={{ 
                      width: `${Math.min(
                        100, 
                        ((overview?.usage.find(u => u.metric_code === "outlets_count")?.current_usage || 0) / (limits?.max_outlets || 1)) * 100
                      )}%` 
                    }} 
                  />
                </div>
                <p className="text-xs text-zinc-500">
                  Starter: 1 brand outlet maximum limit. Upgrade to Scale.
                </p>
              </div>

              {/* Meter 2: Translations */}
              <div className="border border-zinc-150 dark:border-zinc-850 bg-zinc-50/40 dark:bg-zinc-950/20 p-5 rounded-2xl space-y-3">
                <div className="flex justify-between text-sm">
                  <div className="flex items-center space-x-2">
                    <Globe className="text-zinc-400" size={16} />
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">AI Global Translation Character Cap</span>
                  </div>
                  <span className="font-mono text-zinc-550">
                    {overview?.usage.find(u => u.metric_code === "translation_characters")?.current_usage || 0} / {limits?.can_ai_translation ? "50,000" : "0 (Locked)"}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-zinc-200/50 dark:bg-zinc-800 h-2.5 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${limits?.can_ai_translation ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-800'}`}
                    style={{ 
                      width: `${limits?.can_ai_translation 
                        ? Math.min(100, ((overview?.usage.find(u => u.metric_code === "translation_characters")?.current_usage || 0) / 50000) * 100) 
                        : 0}%` 
                    }} 
                  />
                </div>
                <p className="text-xs text-zinc-500">
                  AI Translation with dynamic menu sync features require JomOrder Pro.
                </p>
              </div>
            </div>
          </div>



        </div>
      </div>

      {/* Tiers choosing modal overlay */}
      <UpgradePlanModal 
        isOpen={isUpgradeModalOpen}
        onClose={() => setIsUpgradeModalOpen(false)}
        currentPlanCode={currentPlan}
        onSelectPlan={handleSelectPlan}
      />

    </div>
  );
}
