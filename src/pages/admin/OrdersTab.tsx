import { Order, OrderItem } from '../../types';
import { RefreshCw, ShoppingBag } from 'lucide-react';
import { getOrderDisplayNo } from '../../lib/api';

interface OrdersTabProps {
  orders: (Order & { total_price?: string, created_at?: string, tables?: { name: string } })[];
  fetchData: () => void;
  t: (key: string) => string;
}

export function OrdersTab({
  orders,
  fetchData,
  t
}: OrdersTabProps) {
  return (
    <section className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100 min-h-[50vh]">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-lg font-black text-gray-900">{t('admin.recentTransactions')}</h2>
          <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mt-0.5">{t('admin.liveOrderArchive')}</p>
        </div>
        <button
          onClick={fetchData}
          className="p-2 bg-zinc-100 text-zinc-600 rounded-xl hover:bg-zinc-200"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="overflow-x-auto -mx-4 sm:-mx-5">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50/50">
              <th className="px-4 py-2.5 text-left text-[9px] font-black text-zinc-400 uppercase tracking-widest">{t('admin.orderId')}</th>
              <th className="px-3 py-2.5 text-left text-[9px] font-black text-zinc-400 uppercase tracking-widest">{t('admin.table')}</th>
              <th className="px-3 py-2.5 text-left text-[9px] font-black text-zinc-400 uppercase tracking-widest">{t('admin.items')}</th>
              <th className="px-3 py-2.5 text-left text-[9px] font-black text-zinc-400 uppercase tracking-widest">{t('admin.total')}</th>
              <th className="px-3 py-2.5 text-left text-[9px] font-black text-zinc-400 uppercase tracking-widest">{t('admin.status')}</th>
              <th className="px-4 py-2.5 text-left text-[9px] font-black text-zinc-400 uppercase tracking-widest">{t('admin.time')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-50">
            {orders.map(order => (
              <tr key={order.id} className="hover:bg-zinc-50/50 transition-colors">
                <td className="px-4 py-2">
                  <span className="font-mono font-bold text-xs text-zinc-400">#{getOrderDisplayNo(order.id, order.created_at || (order as any).createdAt)}</span>
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs font-black text-zinc-900">{t('admin.table')} {order.tables?.name || 'Walk-in'}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    {order.items?.map((item: OrderItem, i: number) => {
                      const isCancelled = item.status === 'cancelled' || item.voided;
                      return (
                        <div key={i} className="flex items-center gap-1.5 flex-wrap text-[10px] font-bold leading-tight">
                          <span className={isCancelled ? 'line-through text-red-400 font-normal' : 'text-zinc-600'}>
                            {item.quantity}x {item.name}
                          </span>
                          {isCancelled && (
                            <span className="text-[8px] font-black uppercase tracking-wider px-1 py-0.2 rounded bg-red-50 text-red-650">
                              Cancelled
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs font-black text-orange-600">RM {(parseFloat(String(order.total_price || order.totalPrice || 0)) || 0).toFixed(2)}</span>
                </td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${
                    order.status === 'completed' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                    order.status === 'cancelled' ? 'bg-red-50 text-red-600 border border-red-100' :
                    'bg-blue-50 text-blue-600 border border-blue-100'
                  }`}>
                    {order.status}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className="text-[10px] font-bold text-zinc-400">
                    {order.created_at ? new Date(order.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : ''}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && (
          <div className="py-12 text-center">
            <div className="bg-zinc-50 w-12 h-12 rounded-2xl flex items-center justify-center text-zinc-300 mx-auto mb-3">
              <ShoppingBag size={24} />
            </div>
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{t('admin.noTransactionsYet')}</p>
          </div>
        )}
      </div>
    </section>
  );
}
