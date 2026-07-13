import React from "react";
import { ArrowLeft, Clock, FileText, CheckCircle2, Download } from "lucide-react";
import { jsPDF } from "jspdf";
import { TenantSubscription, Invoice } from "../types";

export interface BillingHistoryPageProps {
  subscription: TenantSubscription | null;
  invoices: Invoice[];
  onBack: () => void;
}

export function BillingHistoryPage({ subscription, invoices, onBack }: BillingHistoryPageProps) {
  
  const handleDownloadPdf = (inv: Invoice) => {
    if (!inv.isMock && inv.receiptUrl && inv.receiptUrl !== "#") {
      // For real Stripe invoices, download via standard anchor open
      const a = document.createElement("a");
      a.href = inv.receiptUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
      return;
    }

    // Otherwise, generate a beautiful, professional corporate PDF invoice client-side
    const doc = new jsPDF();
    
    // Header banner (deep dark brand theme)
    doc.setFillColor(31, 41, 55); 
    doc.rect(0, 0, 210, 35, "F");
    
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("Sikmatye Invoice Statement", 14, 22);
    
    // Status Badge
    const isTrial = inv.status === "trial" || inv.status === "trial_invoice";
    if (isTrial) {
      doc.setFillColor(107, 114, 128); // gray
    } else {
      doc.setFillColor(16, 185, 129); // emerald green
    }
    doc.rect(145, 12, 50, 11, "F");
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(isTrial ? "TRIAL ACCOUNT" : "PAID & POSTED", 152, 19);
    
    // Corporate From details
    doc.setTextColor(55, 65, 81);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("FROM:", 14, 48);
    doc.setFont("helvetica", "normal");
    doc.text("Sikmatye SaaS F&B Systems Ltd.", 14, 54);
    doc.text("Level 18, Mercu 2, KL Eco City", 14, 60);
    doc.text("59200 Kuala Lumpur, Malaysia", 14, 66);
    doc.text("Email: billing@sikmatye.com", 14, 72);
    
    // Bill To details
    doc.setFont("helvetica", "bold");
    doc.text("BILL TO (TENANT):", 110, 48);
    doc.setFont("helvetica", "normal");
    doc.text(`Organization ID: ${subscription?.tenant_id || "N/A"}`, 110, 54);
    doc.text(`Customer Ref: ${subscription?.stripe_customer_id || "N/A"}`, 110, 60);
    doc.text(`Current Plan: ${subscription?.plan_code?.toUpperCase() || "STARTER"}`, 110, 66);
    
    // Separator line
    doc.setDrawColor(229, 231, 235);
    doc.line(14, 80, 196, 80);
    
    // Invoice details line
    doc.setFont("helvetica", "bold");
    doc.text("Invoice Number:", 14, 89);
    doc.setFont("helvetica", "normal");
    doc.text(inv.id, 48, 89);
    
    doc.setFont("helvetica", "bold");
    doc.text("Billing Date:", 110, 89);
    doc.setFont("helvetica", "normal");
    doc.text(inv.date, 145, 89);
    
    doc.line(14, 96, 196, 96);
    
    // Table Header
    doc.setFillColor(243, 244, 246);
    doc.rect(14, 104, 182, 8, "F");
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("ITEM DESCRIPTION", 18, 109);
    doc.text("QTY", 130, 109);
    doc.text("RATE", 150, 109);
    doc.text("TOTAL", 175, 109);
    
    // Table Row
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(inv.description, 18, 120);
    doc.text("1", 132, 120);
    doc.text(inv.amount, 150, 120);
    doc.text(inv.amount, 175, 120);
    
    doc.line(14, 128, 196, 128);
    
    // Subtotals and totals block
    doc.setFont("helvetica", "bold");
    doc.text("Subtotal:", 125, 138);
    doc.setFont("helvetica", "normal");
    doc.text(inv.amount, 175, 138);
    
    doc.setFont("helvetica", "bold");
    doc.text("Sales Tax (SST 0%):", 125, 145);
    doc.setFont("helvetica", "normal");
    doc.text("RM0.00", 175, 145);
    
    doc.setDrawColor(31, 41, 55);
    doc.line(125, 150, 196, 150);
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Total Charged:", 125, 157);
    doc.text(inv.amount, 175, 157);
    
    // Method & terms footer
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(107, 114, 128);
    doc.text(`Payment Clearing: Credit Card / Automated Sandbox Transaction`, 14, 175);
    doc.text(`Transaction Status: Settled & Reconciled`, 14, 181);
    
    doc.setDrawColor(229, 231, 235);
    doc.line(14, 190, 196, 190);
    
    doc.setFont("helvetica", "oblique");
    doc.setFontSize(10);
    doc.setTextColor(75, 85, 99);
    doc.text("Thank you for choosing Sikmatye! Helping your corporate F&B brand grow and scale efficiently.", 14, 201);
    
    // Trigger download
    doc.save(`Invoice-${inv.id}.pdf`);
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Top navbar */}
      <div className="flex items-center space-x-3 mb-2">
        <button 
          onClick={onBack}
          className="p-1 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-850 dark:hover:bg-zinc-800 transition active:scale-95"
        >
          <ArrowLeft size={16} className="text-zinc-650" />
        </button>
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Invoices & Billing History</h2>
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
          {invoices.length === 0 ? (
            <div className="p-8 text-center text-zinc-500 text-sm">
              No statement history available.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/30 text-zinc-500 text-xs uppercase font-sans">
                  <th className="p-4">Invoice ID</th>
                  <th className="p-4">Billing Date</th>
                  <th className="p-4">Description</th>
                  <th className="p-4 text-right">Amount charged</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
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
                    <td className="p-4 text-center">
                      <button 
                        type="button"
                        onClick={() => handleDownloadPdf(inv)}
                        className="inline-flex items-center space-x-1.5 text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 font-medium bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/30 dark:hover:bg-indigo-900/40 px-3 py-1.5 rounded-lg transition active:scale-95"
                      >
                        <Download size={13} />
                        <span>Download PDF</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
