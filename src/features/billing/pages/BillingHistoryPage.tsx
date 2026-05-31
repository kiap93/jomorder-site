import React from "react";
import { ArrowLeft, Clock, FileText, CheckCircle2 } from "lucide-react";
import { TenantSubscription } from "../types";

export interface BillingHistoryPageProps {
  subscription: TenantSubscription | null;
  onBack: () => void;
}

export function BillingHistoryPage({ subscription, onBack }: BillingHistoryPageProps) {
  // Simulate active billing invoice logs linked to actual client data
  const simulatedInvoices = [
    {
      id: "INV-9281-01",
      date: new Date().toISOString().split("T")[0],
      description: `JomOrder Plan Subscription Renewal - ${subscription?.plan_code?.toUpperCase() || "STARTER"}`,
      amount: subscription?.plan_code === "pro" ? "RM98.00" : subscription?.plan_code === "growth" ? "RM38.00" : "RM18.00",
      status: "paid",
      receiptUrl: "#"
    },
    {
      id: "INV-8120-14",
      date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      description: "JomOrder Onboarding Trial Bootstrap Session",
      amount: "RM0.00",
      status: "trial_invoice",
      receiptUrl: "#"
    }
  ];

  return (
    <div className="space-y-6">
      {/* Top navbar */}
      <div className="flex items-center space-x-3 mb-2">
        <button 
          onClick={onBack}
          className="p-1 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-850 dark:hover:bg-zinc-800 transition active:scale-95"
        >
          <ArrowLeft size={16} className="text-zinc-650" />
        </button>
        <div>
          <h2 className="text-xl font-bold font-sans text-zinc-900 dark:text-zinc-100">Invoices & Billing History</h2>
          <p className="text-sm text-zinc-500">Track and download your subscription invoices.</p>
        </div>
      </div>

      {/* History table */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-zinc-50/50 dark:bg-zinc-950/20">
          <div className="flex items-center space-x-2">
            <Clock size={16} className="text-indigo-500" />
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Past Statements</span>
          </div>
          <span className="text-xs font-mono text-zinc-500">Customer ID: {subscription?.stripe_customer_id || "N/A"}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/30 text-zinc-500 text-xs uppercase font-sans">
                <th className="p-4">Invoice ID</th>
                <th className="p-4">Billing Date</th>
                <th className="p-4">Description</th>
                <th className="p-4 text-right">Amount charged</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {simulatedInvoices.map((inv) => (
                <tr 
                  key={inv.id} 
                  className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50/20 last:border-b-0 text-zinc-700 dark:text-zinc-300"
                >
                  <td className="p-4 font-mono font-bold text-xs text-zinc-500">{inv.id}</td>
                  <td className="p-4 font-mono text-xs">{inv.date}</td>
                  <td className="p-4 font-sans font-medium">{inv.description}</td>
                  <td className="p-4 text-right font-mono font-semibold">{inv.amount}</td>
                  <td className="p-4 align-middle text-center">
                    <span className={`inline-flex items-center space-x-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      inv.status === "paid" 
                        ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300" 
                        : "bg-zinc-100 text-zinc-650 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}>
                      {inv.status === "paid" && <CheckCircle2 size={12} className="mr-1 shrink-0" />}
                      {inv.status === "paid" ? "Paid" : "Sandbox Trial"}
                    </span>
                  </td>
                  <td className="p-4">
                    <button 
                      type="button"
                      disabled
                      className="inline-flex items-center space-x-1.5 text-xs text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-not-allowed font-medium"
                    >
                      <FileText size={13} />
                      <span>Download PDF</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
