import React, { useState } from "react";
import { X, Check } from "lucide-react";
import { PlanCode } from "../types";

export interface UpgradePlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlanCode: PlanCode;
  onSelectPlan: (planCode: PlanCode) => void;
}

export function UpgradePlanModal({ isOpen, onClose, currentPlanCode, onSelectPlan }: UpgradePlanModalProps) {
  const [submittingPlan, setSubmittingPlan] = useState<PlanCode | null>(null);

  if (!isOpen) return null;

  const cards = [
    {
      code: "starter" as PlanCode,
      name: "Starter",
      amount: 18,
      desc: "Perfect for single outlet bootstrapping.",
      features: [
        "1 Operational Outlet max",
        "QR Mobile Ordering included",
        "Basic Cashier POS system",
        "Standard Email SLA"
      ],
      color: "border-zinc-200 dark:border-zinc-800",
      badgeColor: "bg-zinc-100 text-zinc-800"
    },
    {
      code: "growth" as PlanCode,
      name: "Growth",
      amount: 38,
      desc: "Best for growing regional diners.",
      features: [
        "Up to 3 operational outlets",
        "Kitchen Display System (KDS)",
        "Thermal Printer POS support",
        "Granular Staff Role Limits",
        "24/7 Priority support channel"
      ],
      color: "border-blue-500 ring-2 ring-blue-500/10",
      badgeColor: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
      popular: true
    },
    {
      code: "pro" as PlanCode,
      name: "Pro",
      amount: 98,
      desc: "HQ Controls & High Performance AI.",
      features: [
        "Unlimited outlet generation",
        "Instant AI Language Translation",
        "Advanced Analytics & Charts",
        "Franchise Brand management",
        "Dedicated architect account manager"
      ],
      color: "border-indigo-500 ring-2 ring-indigo-500/15",
      badgeColor: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300"
    }
  ];

  const handleSelect = async (planCode: PlanCode) => {
    setSubmittingPlan(planCode);
    try {
      await onSelectPlan(planCode);
    } finally {
      setSubmittingPlan(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Background overlay */}
      <div className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm" onClick={onClose} />

      {/* Frame */}
      <div className="relative w-full max-w-5xl bg-white dark:bg-zinc-900 border border-zinc-250 dark:border-zinc-800 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-100 dark:border-zinc-800">
          <div>
            <h3 className="text-xl font-bold font-sans text-zinc-950 dark:text-zinc-50">Select Your Sikmatye Subscription Plan</h3>
            <p className="text-sm text-zinc-500">Accelerate your retail workflows. Change tiers anytime.</p>
          </div>
          <button 
            type="button" 
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content of Cards */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {cards.map((card) => {
              const isActive = currentPlanCode === card.code;
              return (
                <div 
                  key={card.code}
                  className={`flex flex-col relative rounded-2xl border bg-zinc-50/50 dark:bg-zinc-950/30 p-6 transition-all ${card.color} ${isActive ? 'bg-zinc-100/30 dark:bg-zinc-900/40' : ''}`}
                >
                  {card.popular && (
                    <span className="absolute top-0 right-6 -translate-y-1/2 rounded-full bg-blue-500 px-3 py-0.5 text-xs font-semibold text-white">
                      Popular
                    </span>
                  )}
                  
                  <div className="mb-4">
                    <span className={`inline-block rounded px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase ${card.badgeColor}`}>
                      {card.name}
                    </span>
                  </div>

                  <div className="flex items-baseline mb-2">
                    <span className="text-3xl font-extrabold text-zinc-900 dark:text-zinc-50 font-mono">RM{card.amount}</span>
                    <span className="text-zinc-500 text-sm ml-1">/month</span>
                  </div>

                  <p className="text-xs text-zinc-500 py-1 min-h-[40px]">{card.desc}</p>
                  
                  {/* Features checklist */}
                  <ul className="my-6 space-y-3 flex-1 text-sm text-zinc-650 dark:text-zinc-400">
                    {card.features.map((feat, idx) => (
                      <li key={idx} className="flex items-start">
                        <Check size={16} className="text-emerald-500 mr-2 mt-0.5 shrink-0" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Pricing action CTA */}
                  <button
                    type="button"
                    disabled={isActive || submittingPlan !== null}
                    onClick={() => handleSelect(card.code)}
                    className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] ${
                      isActive 
                        ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500 cursor-not-allowed'
                        : submittingPlan === card.code
                        ? 'bg-zinc-200 text-zinc-500 cursor-wait'
                        : card.code === "pro"
                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/10'
                        : 'bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-900 text-white'
                    }`}
                  >
                    {isActive ? "Your Active Plan" : "Subscribe / Shift Plan"}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-8 text-center p-4 bg-zinc-50 dark:bg-zinc-900/60 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
            <p className="text-xs text-zinc-500">
              ⚡ Upgrades take effect immediately with proration sheets. All rates are charged in RM. Backed by secure 256-bit Stripe checkout sheets.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
