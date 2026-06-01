import { Restaurant } from '../../types';
import { BarChart2 } from 'lucide-react';

interface AnalyticsTabProps {
  restaurant: Restaurant | null;
  analyticsData: {
    revenue: number;
    orders: number;
    avgTicket: number;
    topItems: { name: string, count: number, revenue: number }[];
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
  return (
    <div className="space-y-4">
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-gray-900 mb-0.5">{t('admin.performanceOverview')}</h2>
          <p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest">{t('admin.realTimeInsights')}</p>
        </div>
        <div className="flex items-center gap-2 bg-gray-55 p-1.5 rounded-xl border border-gray-100 text-xs">
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 py-5 rounded-xl shadow-sm border border-gray-100 text-center">
          <div className="text-gray-400 text-[9px] font-black uppercase tracking-widest mb-2">{t('admin.totalRevenue')}</div>
          <div className="text-xl sm:text-2xl font-black text-gray-900">
            {restaurant?.currency} {analyticsData.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-white p-4 py-5 rounded-xl shadow-sm border border-gray-100 text-center">
          <div className="text-gray-400 text-[9px] font-black uppercase tracking-widest mb-2">{t('admin.totalOrders')}</div>
          <div className="text-xl sm:text-2xl font-black text-gray-900">{analyticsData.orders}</div>
        </div>
        <div className="bg-white p-4 py-5 rounded-xl shadow-sm border border-gray-100 text-center">
          <div className="text-gray-400 text-[9px] font-black uppercase tracking-widest mb-2">{t('admin.avgTicket')}</div>
          <div className="text-xl sm:text-2xl font-black text-gray-900">
            {restaurant?.currency} {analyticsData.avgTicket.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      <section className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-black text-gray-900">{t('admin.topSellingItems')}</h2>
          <div className="bg-orange-50 text-orange-600 text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-wider">
            {t('admin.sortedByPopularity')}
          </div>
        </div>
        
        {isAnalyticsLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
          </div>
        ) : analyticsData.topItems.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-150">
                  <th className="pb-2 text-[9px] font-black text-gray-400 uppercase tracking-widest">{t('admin.rank')}</th>
                  <th className="pb-2 text-[9px] font-black text-gray-400 uppercase tracking-widest">Item Name</th>
                  <th className="pb-2 text-[9px] font-black text-gray-400 uppercase tracking-widest text-center">{t('admin.ordersCount')}</th>
                  <th className="pb-2 text-[9px] font-black text-gray-400 uppercase tracking-widest text-right">{t('admin.revenue')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 text-sm">
                {analyticsData.topItems.map((item, idx) => (
                  <tr key={idx} className="group hover:bg-gray-55/50">
                    <td className="py-2.5">
                      <span className={`w-6 h-6 flex items-center justify-center rounded-lg font-black text-[11px] ${
                        idx === 0 ? 'bg-orange-100 text-orange-600' : 
                        idx === 1 ? 'bg-gray-100 text-gray-600' :
                        idx === 2 ? 'bg-orange-55 text-orange-400 border border-orange-100' : 
                        'text-gray-300'
                      }`}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="py-2.5 font-bold text-gray-900">{item.name}</td>
                    <td className="py-2.5 text-center font-bold text-gray-600">{item.count}</td>
                    <td className="py-2.5 text-right font-black text-gray-950">
                      {restaurant?.currency} {item.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-12 text-center space-y-3">
            <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto text-gray-300">
              <BarChart2 size={24} />
            </div>
            <div>
              <p className="font-black text-gray-900 text-sm">{t('admin.noDataFound')}</p>
              <p className="text-gray-400 text-[10px] font-bold uppercase tracking-widest mt-0.5">{t('admin.trySelectingDifferent')}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
