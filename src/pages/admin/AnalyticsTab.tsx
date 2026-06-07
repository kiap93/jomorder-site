import { useState } from 'react';
import { Restaurant } from '../../types';
import { BarChart2, Tag, ShieldAlert, Users, Filter, Search, MapPin } from 'lucide-react';

interface AnalyticsTabProps {
  restaurant: Restaurant | null;
  analyticsData: {
    revenue: number; // Net Sales
    orders: number;
    avgTicket: number;
    topItems: { name: string, count: number, revenue: number }[];
    // New metrics
    grossSales?: number;
    totalDiscounts?: number;
    discountCount?: number;
    voidedItemsCount?: number;
    voidedAmount?: number;
    discountList?: {
      orderId: string;
      itemName: string;
      type: string;
      value: number;
      amount: number;
      reason: string;
      staff: string;
      date: string;
    }[];
    voidList?: {
      orderId: string;
      itemName: string;
      amount: number;
      reason: string;
      staff: string;
      date: string;
    }[];
  };
  dateRange: { start: string, end: string };
  setDateRange: (range: { start: string, end: string }) => void;
  isAnalyticsLoading: boolean;
  t: (key: string) => string;
}

export function AnalyticsTab({
  restaurant,
  analyticsData,
  dateRange,
  setDateRange,
  isAnalyticsLoading,
  t
}: AnalyticsTabProps) {
  // Filters state
  const [filterType, setFilterType] = useState<'all' | 'discount' | 'void'>('all');
  const [filterStaff, setFilterStaff] = useState<string>('all');
  const [filterReason, setFilterReason] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState<string>('');

  const currency = restaurant?.currency || 'RM';
  const grossSales = analyticsData.grossSales || 0;
  const netSales = analyticsData.revenue || 0;
  const totalDiscounts = analyticsData.totalDiscounts || 0;
  const discountCount = analyticsData.discountCount || 0;
  const voidedItemsCount = analyticsData.voidedItemsCount || 0;
  const voidedAmount = analyticsData.voidedAmount || 0;

  const rawDiscounts = analyticsData.discountList || [];
  const rawVoids = analyticsData.voidList || [];

  // Combine actions for a complete history feed
  const combinedActions = [
    ...rawDiscounts.map(d => ({ ...d, actionType: 'discount' as const, uniqueId: `disc-${d.orderId}-${d.itemName}-${d.date}` })),
    ...rawVoids.map(v => ({ ...v, actionType: 'void' as const, type: 'void', value: 0, uniqueId: `void-${v.orderId}-${v.itemName}-${v.date}` }))
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Dynamic extract of unique staff list
  const uniqueStaffList = Array.from(new Set(combinedActions.map(a => a.staff).filter(Boolean)));

  // Perform dynamic filtering
  const filteredActions = combinedActions.filter(action => {
    // Type Filter
    if (filterType !== 'all' && action.actionType !== filterType) return false;
    // Staff Filter
    if (filterStaff !== 'all' && action.staff !== filterStaff) return false;
    // Reason Search
    if (filterReason.trim() !== '' && !action.reason.toLowerCase().includes(filterReason.toLowerCase())) return false;
    // Item/Order Search
    if (filterSearch.trim() !== '') {
      const q = filterSearch.toLowerCase();
      const matchName = action.itemName.toLowerCase().includes(q);
      const matchOrder = action.orderId.toLowerCase().includes(q);
      if (!matchName && !matchOrder) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Configuration Header Row */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-gray-900 mb-0.5">{t('admin.performanceOverview')}</h2>
          <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">{t('admin.realTimeInsights')}</p>
        </div>
        <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-xl border border-gray-100 text-xs">
          <div className="flex flex-col">
            <label className="text-[8px] font-black uppercase text-gray-400 px-1">{t('admin.from')}</label>
            <input 
              type="date"
              value={dateRange.start}
              onChange={e => setDateRange({ ...dateRange, start: e.target.value })}
              className="bg-transparent border-none p-0 focus:ring-0 text-xs font-bold text-gray-700"
            />
          </div>
          <div className="w-px h-6 bg-gray-200" />
          <div className="flex flex-col">
            <label className="text-[8px] font-black uppercase text-gray-400 px-1">{t('admin.to')}</label>
            <input 
              type="date"
              value={dateRange.end}
              onChange={e => setDateRange({ ...dateRange, end: e.target.value })}
              className="bg-transparent border-none p-0 focus:ring-0 text-xs font-bold text-gray-700"
            />
          </div>
        </div>
      </div>

      {/* 6-Card Premium Metric Bento Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Card 1: Gross Sales */}
        <div className="bg-white p-4 py-5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div className="text-gray-400 text-[9px] font-black uppercase tracking-widest mb-2">Gross Sales</div>
          <div className="text-xl sm:text-2xl font-black text-gray-800">
            {currency} {grossSales.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[9px] font-bold text-gray-400 mt-1">Sum of original values</div>
        </div>

        {/* Card 2: Total Revenue / Net Sales */}
        <div className="bg-white p-4 py-5 rounded-xl shadow-sm border border-orange-100 bg-orange-50/20 flex flex-col justify-between">
          <div className="text-orange-500 text-[9px] font-black uppercase tracking-widest mb-2">Net Sales (Revenue)</div>
          <div className="text-xl sm:text-2xl font-black text-orange-600">
            {currency} {netSales.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[9px] font-bold text-orange-400 mt-1">Post-discounts and post-voids</div>
        </div>

        {/* Card 3: Total Discounts */}
        <div className="bg-white p-4 py-5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div className="text-gray-400 text-[9px] font-black uppercase tracking-widest mb-2">Total Discounts</div>
          <div className="text-xl sm:text-2xl font-black text-red-600">
            - {currency} {totalDiscounts.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[9px] font-bold text-red-400 mt-1">Applied to {discountCount} item{discountCount !== 1 ? 's' : ''}</div>
        </div>

        {/* Card 4: Voided Items */}
        <div className="bg-white p-4 py-5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div className="text-gray-400 text-[9px] font-black uppercase tracking-widest mb-2">Voided Value</div>
          <div className="text-xl sm:text-2xl font-black text-gray-900">
            {currency} {voidedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[9px] font-bold text-gray-500 mt-1">{voidedItemsCount} item{voidedItemsCount !== 1 ? 's' : ''} voided</div>
        </div>

        {/* Card 5: Total Orders */}
        <div className="bg-white p-4 py-5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div className="text-gray-400 text-[9px] font-black uppercase tracking-widest mb-2">{t('admin.totalOrders')}</div>
          <div className="text-xl sm:text-2xl font-black text-gray-900">{analyticsData.orders}</div>
          <div className="text-[9px] font-bold text-gray-400 mt-1">Active orders processed</div>
        </div>

        {/* Card 6: Average Ticket */}
        <div className="bg-white p-4 py-5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
          <div className="text-gray-400 text-[9px] font-black uppercase tracking-widest mb-2">{t('admin.avgTicket')}</div>
          <div className="text-xl sm:text-2xl font-black text-gray-900 font-mono">
            {currency} {analyticsData.avgTicket.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[9px] font-bold text-gray-400 mt-1">Per unique checkout</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top-Selling Items List Component */}
        <section className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100 lg:col-span-1">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-black text-gray-900">{t('admin.topSellingItems')}</h2>
            <div className="bg-orange-50 text-orange-600 text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">
              Popularity
            </div>
          </div>
          
          {isAnalyticsLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-orange-600"></div>
            </div>
          ) : analyticsData.topItems.length > 0 ? (
            <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
              {analyticsData.topItems.slice(0, 8).map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg border border-gray-50 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 flex items-center justify-center rounded-md font-black text-[10px] ${
                      idx === 0 ? 'bg-orange-100 text-orange-600' : 
                      idx === 1 ? 'bg-gray-100 text-gray-600' :
                      idx === 2 ? 'bg-orange-50 text-orange-400' : 
                      'text-gray-400 bg-gray-50'
                    }`}>
                      {idx + 1}
                    </span>
                    <span className="text-xs font-bold text-gray-800 line-clamp-1">{item.name}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-black text-gray-900">{item.count} items</div>
                    <div className="text-[10px] text-gray-400">{currency} {item.revenue.toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-gray-400 text-xs">
              {t('admin.noDataFound')}
            </div>
          )}
        </section>

        {/* Discount & Void Summary Section (The new audit report) */}
        <section className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100 lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
            <div>
              <h2 className="text-sm font-black text-gray-900">Discount & Void Audit Log</h2>
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400 font-bold uppercase mt-0.5">
                <MapPin size={10} className="text-gray-400" />
                <span>Outlet Location: {restaurant?.name || 'Main Outlet'}</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setFilterType('all')} 
                className={`text-[9px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider transition ${filterType === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
              >
                All
              </button>
              <button 
                onClick={() => setFilterType('discount')} 
                className={`text-[9px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider transition ${filterType === 'discount' ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-600 hover:bg-orange-100'}`}
              >
                Discounts
              </button>
              <button 
                onClick={() => setFilterType('void')} 
                className={`text-[9px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider transition ${filterType === 'void' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
              >
                Voids
              </button>
            </div>
          </div>

          {/* Interactive Filters Panel */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
            {/* Filter by Staff */}
            <div className="flex flex-col">
              <label className="text-[8px] font-black uppercase text-gray-400 mb-1 flex items-center gap-1">
                <Users size={8} /> Authorized Staff
              </label>
              <select 
                value={filterStaff}
                onChange={e => setFilterStaff(e.target.value)}
                className="bg-white border border-gray-250 rounded-lg text-xs font-bold text-gray-700 py-1 px-2 focus:ring-0 focus:outline-none"
              >
                <option value="all">All Staff</option>
                {uniqueStaffList.map(staffMember => (
                  <option key={staffMember} value={staffMember}>{staffMember}</option>
                ))}
              </select>
            </div>

            {/* Filter by Reason keywords */}
            <div className="flex flex-col">
              <label className="text-[8px] font-black uppercase text-gray-400 mb-1 flex items-center gap-1">
                <Filter size={8} /> Reason Comment
              </label>
              <input 
                type="text"
                placeholder="Search reason..."
                value={filterReason}
                onChange={e => setFilterReason(e.target.value)}
                className="bg-white border border-gray-250 rounded-lg text-xs font-bold text-gray-700 py-1 px-2 focus:ring-0 focus:outline-none"
              />
            </div>

            {/* Live Search */}
            <div className="flex flex-col">
              <label className="text-[8px] font-black uppercase text-gray-400 mb-1 flex items-center gap-1">
                <Search size={8} /> Item / Order ID
              </label>
              <input 
                type="text"
                placeholder="Order or item name..."
                value={filterSearch}
                onChange={e => setFilterSearch(e.target.value)}
                className="bg-white border border-gray-250 rounded-lg text-xs font-bold text-gray-700 py-1 px-2 focus:ring-0 focus:outline-none"
              />
            </div>
          </div>

          {/* Results table container */}
          {isAnalyticsLoading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
          ) : filteredActions.length > 0 ? (
            <div className="overflow-x-auto border border-gray-100 rounded-xl max-h-[350px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 sticky top-0 z-10 border-b border-gray-150">
                  <tr>
                    <th className="p-3 text-[9px] font-black text-gray-400 uppercase tracking-widest">Order / Item</th>
                    <th className="p-3 text-[9px] font-black text-gray-400 uppercase tracking-widest text-center">Type</th>
                    <th className="p-3 text-[9px] font-black text-gray-400 uppercase tracking-widest">Reason / Authorized By</th>
                    <th className="p-3 text-[9px] font-black text-gray-400 uppercase tracking-widest text-right">Impact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs text-gray-700 bg-white">
                  {filteredActions.map(action => (
                    <tr key={action.uniqueId} className="hover:bg-gray-50">
                      <td className="p-3">
                        <div className="font-bold text-gray-900 line-clamp-1">{action.itemName}</div>
                        <div className="text-[8px] font-bold text-gray-400 font-mono uppercase">Order #{action.orderId.substring(0, 8)}...</div>
                        <div className="text-[8px] text-gray-400 mt-0.5">{new Date(action.date).toLocaleString()}</div>
                      </td>
                      <td className="p-3 text-center">
                        {action.actionType === 'discount' ? (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider bg-orange-100 text-orange-700">
                            <Tag size={8} /> Disc ({action.type})
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider bg-red-100 text-red-700">
                            <ShieldAlert size={8} /> Voided
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="italic text-gray-600 line-clamp-1 font-medium select-all">"{action.reason}"</div>
                        <div className="text-[9px] font-bold text-gray-800 mt-0.5">By: {action.staff}</div>
                      </td>
                      <td className="p-3 text-right font-black text-gray-950 font-mono">
                        {action.actionType === 'discount' ? (
                          <span className="text-red-600">-{currency} {action.amount.toFixed(2)}</span>
                        ) : (
                          <span className="text-gray-500 font-medium">({currency} {action.amount.toFixed(2)})</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-gray-400 text-xs italic">
              No discounts or voids match the current filters.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
