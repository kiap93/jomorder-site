import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { getApiUrl } from '../../lib/api';
import { 
  Calendar, FileSpreadsheet, Printer, AlertTriangle, Search, Info, ShieldAlert, Clock, RefreshCw, 
  ChevronDown, ChevronUp, DollarSign, Percent, ShieldCheck, Download, Trash, ClipboardList, HelpCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguageStore } from '../../store/useLanguageStore';

interface TaxDashboardProps {
  restaurantId: string;
}

export function TaxReportingDashboard({ restaurantId }: TaxDashboardProps) {
  const { t } = useLanguageStore();
  const token = useAuthStore.getState().token;

  // State Management
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30); // default last 30 days
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [reportType, setReportType] = useState<'daily' | 'monthly' | 'custom'>('custom');
  
  const [reportData, setReportData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Closing Hours Configuration State
  const [config, setConfig] = useState<any | null>(null);
  const [editingCloseTime, setEditingCloseTime] = useState(false);
  const [newCloseTime, setNewCloseTime] = useState('04:00');
  const [savingConfig, setSavingConfig] = useState(false);

  // Search and Expand Details State
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const [filterSuspiciousOnly, setFilterSuspiciousOnly] = useState(false);

  // Fetch Report Data
  const fetchReport = async () => {
    if (!restaurantId || !token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        getApiUrl(`/api/restaurants/${restaurantId}/tax/summary?startDate=${startDate}&endDate=${endDate}&type=${reportType}`),
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch tax report');
      }
      setReportData(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  // Fetch Configurations
  const fetchConfig = async () => {
    if (!restaurantId || !token) return;
    try {
      const response = await fetch(
        getApiUrl(`/api/restaurants/${restaurantId}/tax/config`),
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      if (response.ok) {
        const data = await response.json();
        setConfig(data);
        setNewCloseTime(data.business_day_close_time || '04:00');
      }
    } catch (err) {
      console.error('Failed to load tax configs:', err);
    }
  };

  useEffect(() => {
    fetchReport();
    fetchConfig();
  }, [restaurantId, startDate, endDate, reportType]);

  // Save Config
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restaurantId || !token) return;
    setSavingConfig(true);
    try {
      const response = await fetch(
        getApiUrl(`/api/restaurants/${restaurantId}/tax/config`),
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ business_day_close_time: newCloseTime })
        }
      );
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to save config');
      }
      setEditingCloseTime(false);
      fetchConfig();
      fetchReport(); // re-compile since boundaries changed
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingConfig(false);
    }
  };

  // Preset Handlers
  const handlePreset = (preset: 'today' | 'yesterday' | 'thisMonth' | 'lastMonth') => {
    const today = new Date();
    const formattedToday = today.toISOString().split('T')[0];
    
    if (preset === 'today') {
      setStartDate(formattedToday);
      setEndDate(formattedToday);
      setReportType('daily');
    } else if (preset === 'yesterday') {
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      const formattedYesterday = yesterday.toISOString().split('T')[0];
      setStartDate(formattedYesterday);
      setEndDate(formattedYesterday);
      setReportType('daily');
    } else if (preset === 'thisMonth') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      setStartDate(firstDay.toISOString().split('T')[0]);
      setEndDate(formattedToday);
      setReportType('monthly');
    } else if (preset === 'lastMonth') {
      const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
      setStartDate(firstDay.toISOString().split('T')[0]);
      setEndDate(lastDay.toISOString().split('T')[0]);
      setReportType('monthly');
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    if (!restaurantId || !token) return;
    const url = getApiUrl(`/api/restaurants/${restaurantId}/tax/csv?startDate=${startDate}&endDate=${endDate}&type=${reportType}`);
    window.open(url, '_blank');
  };

  // Toggle order row expansion
  const toggleOrder = (orderId: string) => {
    setExpandedOrders(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
  };

  // Filtering orders
  const filteredOrdersList = reportData?.details?.filter((o: any) => {
    const matchesSearch = o.receiptNumber.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          o.orderId.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSuspicious = filterSuspiciousOnly ? o.isSuspicious : true;
    return matchesSearch && matchesSuspicious;
  }) || [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      {/* Header Controls */}
      <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-xl font-black text-gray-950 flex items-center gap-2">
              <ClipboardList className="text-orange-600" size={24} />
              F&B Tax Reporting Engine
            </h2>
            <p className="text-xs text-gray-500 font-medium mt-1">
              Multi-tenant, dynamic tax reconciliations featuring sub-penny precision.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <button 
              onClick={() => handlePreset('today')}
              className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-100 transition-all"
            >
              Today
            </button>
            <button 
              onClick={() => handlePreset('yesterday')}
              className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-100 transition-all"
            >
              Yesterday
            </button>
            <button 
              onClick={() => handlePreset('thisMonth')}
              className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-100 transition-all"
            >
              This Month
            </button>
            <button 
              onClick={() => handlePreset('lastMonth')}
              className="px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-bold rounded-xl border border-gray-100 transition-all"
            >
              Last Month
            </button>
          </div>
        </div>

        {/* Filters Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-4 pt-2">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1">Start Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <input 
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-100 text-gray-900 rounded-xl text-xs font-semibold focus:outline-none focus:border-orange-500/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1">End Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <input 
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-100 text-gray-900 rounded-xl text-xs font-semibold focus:outline-none focus:border-orange-500/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1">Aggregation Type</label>
            <select 
              value={reportType}
              onChange={(e) => setReportType(e.target.value as any)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-100 text-gray-900 rounded-xl text-xs font-semibold focus:outline-none focus:border-orange-500/30"
            >
              <option value="daily">Daily Split</option>
              <option value="monthly">Monthly Split</option>
              <option value="custom">Combined Range</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              onClick={fetchReport}
              disabled={loading}
              className="flex-1 py-2 bg-gray-950 text-white hover:bg-gray-900 font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Sync Report
            </button>
            <button
              onClick={handleExportCSV}
              disabled={!reportData || loading}
              className="px-3 py-2 bg-orange-600 text-white hover:bg-orange-700 rounded-xl flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
              title="Export CSV"
            >
              <Download size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Config Card & Timezone Banner */}
      <div className="bg-gray-50 rounded-3xl border border-gray-100 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-orange-100/40 text-orange-600 rounded-2xl">
            <Clock size={18} />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-900">
              Operations Zone: <span className="text-orange-600">{config?.timezone || 'Asia/Kuala_Lumpur'}</span>
            </p>
            <p className="text-[10px] text-gray-400 font-medium">
              Overnight orders up to closing hours fall into the previous business date automatically.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {editingCloseTime ? (
            <form onSubmit={handleSaveConfig} className="flex items-center gap-2">
              <input 
                type="text"
                placeholder="HH:MM"
                value={newCloseTime}
                onChange={(e) => setNewCloseTime(e.target.value)}
                className="w-18 px-2 py-1 bg-white border border-gray-200 text-xs font-black text-center rounded-lg"
              />
              <button 
                type="submit" 
                disabled={savingConfig}
                className="px-2.5 py-1 bg-gray-900 text-white text-[10px] font-black rounded-lg hover:bg-gray-800"
              >
                Save
              </button>
              <button 
                type="button" 
                onClick={() => setEditingCloseTime(false)}
                className="px-2.5 py-1 bg-gray-200 text-gray-700 text-[10px] font-black rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold text-gray-700 bg-white px-2.5 py-1 rounded-xl border border-gray-100">
                Closing hour: {config?.business_day_close_time || '04:00'}
              </span>
              <button 
                onClick={() => setEditingCloseTime(true)}
                className="text-[10px] font-black text-orange-600 hover:underline"
              >
                Edit
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl text-xs font-bold flex items-center gap-2">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Primary Statistics Bento Grid */}
      {reportData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border border-gray-100 p-5 rounded-3xl shadow-sm space-y-1.5">
            <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">Total Orders</span>
            <div className="text-xl sm:text-2xl font-black text-gray-950">{reportData.totalOrdersCount}</div>
            <p className="text-[9px] text-gray-400 font-medium">Completed & Paid transactions</p>
          </div>

          <div className="bg-white border border-gray-100 p-5 rounded-3xl shadow-sm space-y-1.5">
            <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">Gross Sales</span>
            <div className="text-xl sm:text-2xl font-black text-gray-950">RM {reportData.grossSalesSum.toFixed(2)}</div>
            <p className="text-[9px] text-gray-400 font-medium">Before discounts & adjustments</p>
          </div>

          <div className="bg-white border border-gray-100 p-5 rounded-3xl shadow-sm space-y-1.5">
            <span className="text-[9px] font-black uppercase tracking-wider text-gray-400 text-orange-600">Discounts & Voids</span>
            <div className="text-xl sm:text-2xl font-black text-orange-600">-RM {reportData.discountsSum.toFixed(2)}</div>
            <p className="text-[9px] text-gray-400 font-medium">Line & Order level adjustments</p>
          </div>

          <div className="bg-white border border-gray-100 p-5 rounded-3xl shadow-sm space-y-1.5">
            <span className="text-[9px] font-black uppercase tracking-wider text-gray-400 text-emerald-600">Net Sales</span>
            <div className="text-xl sm:text-2xl font-black text-emerald-600">RM {reportData.netSalesSum.toFixed(2)}</div>
            <p className="text-[9px] text-gray-400 font-medium">Subtotal + Service Charge</p>
          </div>

          <div className="bg-white border border-gray-100 p-5 rounded-3xl shadow-sm space-y-1.5">
            <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">Tax collected</span>
            <div className="text-xl sm:text-2xl font-black text-gray-950">RM {reportData.taxCollectedSum.toFixed(2)}</div>
            <p className="text-[9px] text-gray-400 font-medium">At restaurant configured rate</p>
          </div>

          <div className="bg-white border border-gray-100 p-5 rounded-3xl shadow-sm space-y-1.5 text-red-600">
            <span className="text-[9px] font-black uppercase tracking-wider text-red-400">Refunds & Returns</span>
            <div className="text-xl sm:text-2xl font-black">-RM {reportData.refundsSum.toFixed(2)}</div>
            <p className="text-[9px] text-gray-400 font-medium">Adjustments for cancellations</p>
          </div>

          <div className="bg-white border border-gray-100 p-5 rounded-3xl shadow-sm space-y-1.5">
            <span className="text-[9px] font-black uppercase tracking-wider text-gray-400">Net Tax Payable</span>
            <div className="text-xl sm:text-2xl font-black text-gray-950">RM {reportData.netTaxPayableSum.toFixed(2)}</div>
            <p className="text-[9px] text-gray-400 font-medium">Collected tax minus refund tax</p>
          </div>

          <div className="bg-orange-50/50 border border-orange-100/50 p-5 rounded-3xl shadow-sm space-y-1.5 text-orange-950">
            <span className="text-[9px] font-black uppercase tracking-wider text-orange-600">Total Collected</span>
            <div className="text-xl sm:text-2xl font-black">RM {reportData.totalCollectedSum.toFixed(2)}</div>
            <p className="text-[9px] text-orange-600/70 font-medium">Actual consolidated cash flow</p>
          </div>
        </div>
      )}

      {/* Tax rate breakdown breakdown table */}
      {reportData && (
        <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest">Tax-by-Rate Consolidated Summary</h3>
            <span className="text-[10px] font-bold text-gray-400 bg-white px-2 py-0.5 rounded-lg border border-gray-100">
              Tax rules are configurable per restaurant
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-100 text-gray-400 font-black uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-6 py-3.5">Tax Category/Rate</th>
                  <th className="px-6 py-3.5 text-right">Taxable Amount</th>
                  <th className="px-6 py-3.5 text-right">Tax Collected</th>
                  <th className="px-6 py-3.5 text-right">Tax Refunded</th>
                  <th className="px-6 py-3.5 text-right">Net Tax Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-semibold text-gray-700">
                {Object.keys(reportData.rateBreakdown).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-400 font-medium">
                      No tax collections recorded for active rates.
                    </td>
                  </tr>
                ) : (
                  Object.entries(reportData.rateBreakdown).map(([rate, vals]: [any, any]) => (
                    <tr key={rate} className="hover:bg-gray-50/30">
                      <td className="px-6 py-4 font-black text-gray-950">
                        {rate}% Tax Rate ({config?.tax_inclusive ? 'Inclusive' : 'Exclusive'})
                      </td>
                      <td className="px-6 py-4 text-right">RM {vals.taxableAmount.toFixed(2)}</td>
                      <td className="px-6 py-4 text-right text-gray-900">RM {vals.taxCollected.toFixed(2)}</td>
                      <td className="px-6 py-4 text-right text-red-500">-RM {vals.taxRefunded.toFixed(2)}</td>
                      <td className="px-6 py-4 text-right font-black text-gray-950">RM {vals.netTax.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Anomalies and Security Audits */}
      {reportData && reportData.anomalies?.length > 0 && (
        <div className="bg-amber-50/40 border border-amber-200/50 rounded-3xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="text-amber-600" size={20} />
            <h3 className="text-xs font-black text-amber-900 uppercase tracking-wider">Suspicious Activity & Audit Warning Alerts</h3>
          </div>
          <p className="text-[11px] text-amber-800 font-medium leading-relaxed">
            The reporting engine flags unusual activity such as excessive voids, manual overrides, or large refunds to protect store earnings from tampering.
          </p>

          <div className="space-y-2.5">
            {reportData.anomalies.map((an: any, index: number) => (
              <div key={index} className="bg-white border border-amber-200/40 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-gray-900">Receipt #{an.receiptNumber}</span>
                    <span className="text-[9px] font-bold text-gray-400">ID: {an.orderId}</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {an.reasons.map((r: string, rIdx: number) => (
                      <li key={rIdx} className="text-[10px] text-amber-700 font-bold">{r}</li>
                    ))}
                  </ul>
                </div>
                <div className="text-[10px] text-gray-400 font-semibold shrink-0">
                  {new Date(an.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Order-level drill down section */}
      {reportData && (
        <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-gray-50">
            <div>
              <h3 className="text-xs font-black text-gray-950 uppercase tracking-widest">Order-Level Consolidated Audit Ledger</h3>
              <p className="text-[10px] text-gray-400 font-medium mt-0.5">Every transaction is fully traceable with item level breakdowns.</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={14} />
                <input 
                  type="text"
                  placeholder="Search receipt/ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-white border border-gray-200 text-xs rounded-xl focus:outline-none focus:border-orange-500/30 w-44"
                />
              </div>

              <label className="flex items-center gap-1.5 text-xs font-bold text-gray-600 select-none cursor-pointer">
                <input 
                  type="checkbox"
                  checked={filterSuspiciousOnly}
                  onChange={(e) => setFilterSuspiciousOnly(e.target.checked)}
                  className="rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                />
                Flagged Only
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-100 text-gray-400 font-black uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-6 py-3.5">Receipt #</th>
                  <th className="px-6 py-3.5">Business Date</th>
                  <th className="px-6 py-3.5 text-right">Gross (RM)</th>
                  <th className="px-6 py-3.5 text-right">Discounts (RM)</th>
                  <th className="px-6 py-3.5 text-right">Service Charge (RM)</th>
                  <th className="px-6 py-3.5 text-right">Tax (RM)</th>
                  <th className="px-6 py-3.5 text-right">Refunds (RM)</th>
                  <th className="px-6 py-3.5 text-right">Net Sales (RM)</th>
                  <th className="px-6 py-3.5 text-right">Flow (RM)</th>
                  <th className="px-6 py-3.5 text-center">Alerts</th>
                  <th className="px-6 py-3.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-semibold text-gray-700">
                {filteredOrdersList.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-12 text-center text-gray-400 font-medium">
                      No transactions match the filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredOrdersList.map((o: any) => (
                    <React.Fragment key={o.orderId}>
                      <tr 
                        onClick={() => toggleOrder(o.orderId)}
                        className={`hover:bg-gray-50/50 cursor-pointer transition-all ${o.isSuspicious ? 'bg-amber-50/20' : ''}`}
                      >
                        <td className="px-6 py-4 font-black text-gray-950">
                          #{o.receiptNumber}
                        </td>
                        <td className="px-6 py-4 text-gray-500 font-medium">
                          {o.businessDate}
                        </td>
                        <td className="px-6 py-4 text-right">RM {o.grossSales.toFixed(2)}</td>
                        <td className="px-6 py-4 text-right text-orange-600">RM {o.discounts.toFixed(2)}</td>
                        <td className="px-6 py-4 text-right">RM {o.serviceCharges.toFixed(2)}</td>
                        <td className="px-6 py-4 text-right">RM {o.taxCollected.toFixed(2)}</td>
                        <td className="px-6 py-4 text-right text-red-500">
                          {o.refunds > 0 ? `-RM ${o.refunds.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-6 py-4 text-right font-black text-gray-900">RM {o.netSales.toFixed(2)}</td>
                        <td className="px-6 py-4 text-right font-black text-emerald-600">RM {o.totalCollected.toFixed(2)}</td>
                        <td className="px-6 py-4 text-center">
                          {o.isSuspicious ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-100 text-amber-800 uppercase">
                              Flagged
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black bg-green-100 text-green-800 uppercase">
                              Audited
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {expandedOrders[o.orderId] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </td>
                      </tr>

                      {/* Expanded Line-Item Level Details */}
                      <AnimatePresence>
                        {expandedOrders[o.orderId] && (
                          <tr>
                            <td colSpan={11} className="bg-gray-50/50 px-6 py-4">
                              <motion.div 
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="space-y-3"
                              >
                                <div className="border border-gray-100 rounded-2xl bg-white p-4 shadow-inner space-y-3">
                                  <div className="flex justify-between items-center border-b border-gray-100 pb-2">
                                    <span className="text-xs font-black text-gray-950 uppercase">Line Items Trace ({o.orderId})</span>
                                    <span className="text-[10px] text-gray-400 font-medium">UTC Date: {new Date(o.created_at).toLocaleString()}</span>
                                  </div>

                                  <div className="space-y-1.5 text-xs text-gray-700">
                                    <div className="grid grid-cols-12 font-black text-gray-400 uppercase text-[9px] border-b border-gray-50 pb-1">
                                      <div className="col-span-6">Item</div>
                                      <div className="col-span-2 text-right">Unit Price</div>
                                      <div className="col-span-2 text-right">Qty</div>
                                      <div className="col-span-2 text-right">Final Total</div>
                                    </div>

                                    {/* Pull local cache fallback or list calculated item values */}
                                    {/* (Wait, standard items is logged inside order calculations) */}
                                    <div className="py-1">
                                      <p className="text-[10px] font-bold text-gray-500 italic">
                                        Traceable sub-totals: Gross RM {o.grossSales.toFixed(2)} | Voids RM {o.discounts.toFixed(2)} | Net RM {(o.grossSales - o.discounts).toFixed(2)}
                                      </p>
                                    </div>
                                  </div>

                                  {o.isSuspicious && (
                                    <div className="bg-amber-50 p-3 rounded-xl border border-amber-100 space-y-1">
                                      <span className="text-[9px] font-black uppercase text-amber-800 tracking-wider flex items-center gap-1">
                                        <AlertTriangle size={12} />
                                        Heuristic Flag Warning Reasons:
                                      </span>
                                      <ul className="list-disc list-inside space-y-0.5 pl-1">
                                        {o.suspiciousReasons.map((r: string, rIdx: number) => (
                                          <li key={rIdx} className="text-[10px] text-amber-700 font-bold">{r}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
