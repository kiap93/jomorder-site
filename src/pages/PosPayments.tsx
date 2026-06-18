import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getApiUrl, getOrderDisplayNo } from '../lib/api';
import { useLanguageStore } from '../store/useLanguageStore';
import { formatCurrency } from '../lib/localization';

import { useAuthStore } from '../store/useAuthStore';
import { Order, OrderStatus, Restaurant } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Banknote, 
  Search, 
  Filter, 
  CreditCard, 
  ChevronRight, 
  Clock, 
  AlertCircle,
  LayoutGrid
} from 'lucide-react';
import { PaymentWorkspace } from '../components/PaymentWorkspace';

interface ApisTable {
  id: string;
  name: string;
  status: 'available' | 'occupied';
  restaurant_id: string;
}

interface ApisOrderOption {
  optionName: string;
  valueName: string;
  priceDelta: number;
}

interface ApisOrderItem {
  id?: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  options: ApisOrderOption[];
  discount?: any;
}

interface ApisOrder {
  id: string;
  total_price: string;
  status: OrderStatus;
  paid_at?: string;
  created_at: string;
  items: ApisOrderItem[];
  discount?: any;
}

interface ApisDiningSession {
  id: string;
  restaurant_id: string;
  table_id: string;
  status: string;
  created_at: string;
  orders?: ApisOrder[];
}

interface ProcessedTable extends ApisTable {
  session: ApisDiningSession | null;
  unpaidTotal: number;
  sessionTotal: number;
  hasUnpaid: boolean;
  mainOrder: (Order & { sessionTotal: number; sessionUnpaid: number; tableName: string }) | null;
}

export function PosPayments() {
  const { restId } = useParams();
  const { t } = useLanguageStore();
  const { user, loading: loadingAuth } = useAuthStore();
  const [tables, setTables] = useState<ProcessedTable[]>([]);
  const [filter, setFilter] = useState<'all' | 'outstanding'>('outstanding');
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [settlingSession, setSettlingSession] = useState<ProcessedTable | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!restId || loadingAuth) return;
    if (!user) return;

    const fetchData = async () => {
      const token = useAuthStore.getState().token;
      if (!token) return;

      setLoading(true);
      try {
        const fetchOptions = {
          headers: { 'Authorization': `Bearer ${token}` }
        };

        // Fetch Restaurant
        const restRes = await fetch(getApiUrl(`/api/restaurants/${restId}`), fetchOptions);
        if (restRes.ok) {
          const restData = await restRes.json();
          setRestaurant({
            id: restData.id,
            name: restData.name,
            currency: restData.currency || 'RM',
            serviceCharge: parseFloat(restData.service_charge || 0) / 100,
            sst: (() => {
              const activeProfile = restData.tax_profiles?.find((tp: any) => tp.is_active);
              const rawRate = activeProfile 
                ? parseFloat(activeProfile.tax_rate || 0) 
                : (restData.business_settings?.tax_rate !== undefined 
                    ? parseFloat(String(restData.business_settings.tax_rate)) 
                    : parseFloat(restData.sst || 0));
              return rawRate >= 1.0 ? rawRate / 100 : rawRate;
            })(),
            franchiseId: restData.franchise_id,
            business_settings: restData.business_settings,
            tax_profiles: restData.tax_profiles
          });
        }

        // Fetch all tables
        const [tablesData, sessionsData] = await Promise.all([
          fetch(getApiUrl(`/api/restaurants/${restId}/tables`), fetchOptions).then(r => r.json()),
          fetch(getApiUrl(`/api/restaurants/${restId}/dining-sessions?status=active`), fetchOptions).then(r => r.json())
        ]);
        
        if (tablesData && sessionsData && !tablesData.error && !sessionsData.error) {
          const processedTables: ProcessedTable[] = (tablesData as ApisTable[]).map((t) => {
            const tableSessions = (sessionsData as ApisDiningSession[])
              .filter((s) => s.table_id === t.id)
              .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
            
            const activeSession = tableSessions.find((s) => s.status === 'active' || s.status === 'awaiting_payment') || tableSessions[0] || null;
            let unpaidTotal = 0;
            let sessionTotal = 0;
            let mainOrder: (Order & { sessionTotal: number; sessionUnpaid: number; tableName: string }) | null = null;

            if (activeSession) {
              const allOrders = activeSession.orders || [];
              const unpaidOrders = allOrders.filter((o) => !o.paid_at && o.status !== 'cancelled');
              unpaidTotal = unpaidOrders.reduce((sum: number, o) => sum + parseFloat(o.total_price), 0);
              sessionTotal = allOrders.reduce((sum: number, o) => sum + parseFloat(o.total_price), 0);
              
              const mOrder = allOrders[0];
              if (mOrder) {
                mainOrder = {
                  id: mOrder.id,
                  tableId: t.id,
                  tableName: t.name,
                  orderType: 'dine_in',
                  status: mOrder.status,
                  paymentMethod: 'counter',
                  totalPrice: parseFloat(mOrder.total_price),
                  sessionId: activeSession.id,
                  session_id: activeSession.id,
                  sessionTotal,
                  sessionUnpaid: unpaidTotal,
                  createdAt: mOrder.created_at || new Date().toISOString(),
                  updatedAt: mOrder.created_at || new Date().toISOString(),
                  items: mOrder.items as any
                };
              }
            }

            return {
               ...t,
               session: activeSession,
               unpaidTotal,
               sessionTotal,
               hasUnpaid: unpaidTotal > 0,
               mainOrder
            };
          });
          setTables(processedTables);
        }
      } catch (err) {
        console.error("Failed to fetch data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [restId, refreshKey]);

  const filteredTables = tables.filter(t => {
    if (filter === 'outstanding') return t.hasUnpaid;
    return true;
  });

  const totalOutstanding = tables.reduce((sum, t) => sum + (t.unpaidTotal || 0), 0);
  const occupiedCount = tables.filter(t => t.session).length;

  if (loading) return (
    <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
    </div>
  );

  return (
    <div className="space-y-4">
      <header className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-md flex items-center justify-center shadow-inner border border-emerald-200/50">
               <Banknote size={18} />
            </div>
            <div>
              <h1 className="text-lg font-black text-gray-900 tracking-tight leading-none uppercase italic">{t('common.settlementHub')}</h1>
              <p className="text-gray-500 text-[9px] font-black uppercase tracking-widest mt-1">Live Billing Traffic</p>
            </div>
          </div>
          
          <div className="flex bg-gray-100 p-0.5 rounded-lg">
            <div className="px-4 py-1.5 bg-white rounded-md shadow-sm border border-gray-100 flex gap-6">
              <div>
                <span className="text-[8px] font-black text-emerald-600 uppercase tracking-widest block leading-none mb-0.5 text-center">Occupancy</span>
                <span className="text-base font-black text-gray-900 tabular-nums tracking-tighter block text-center">
                  {occupiedCount}/{tables.length}
                </span>
              </div>
              <div className="w-px bg-gray-100" />
              <div>
                <span className="text-[8px] font-black text-orange-600 uppercase tracking-widest block leading-none mb-0.5 text-center">Outstanding</span>
                <span className="text-base font-black text-gray-900 tabular-nums tracking-tighter block text-center">
                  {formatCurrency(totalOutstanding, restaurant?.currency)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-4 pt-4 border-t border-gray-50">
          <button 
            onClick={() => setFilter('outstanding')}
            className={`px-4 py-1.5 rounded-md font-black text-[9px] uppercase tracking-widest transition-all ${
              filter === 'outstanding' ? 'bg-gray-900 text-white shadow-lg' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            Outstanding ({tables.filter(t => t.hasUnpaid).length})
          </button>
          <button 
            onClick={() => setFilter('all')}
            className={`px-4 py-1.5 rounded-md font-black text-[9px] uppercase tracking-widest transition-all ${
              filter === 'all' ? 'bg-gray-900 text-white shadow-lg' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            All Tables ({tables.length})
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredTables.map(table => (
          <motion.div
            layout
            key={table.id}
            className={`bg-white rounded-lg border transition-all overflow-hidden flex flex-col ${
              table.hasUnpaid 
                ? 'border-orange-200 shadow-md ring-1 ring-orange-500/5' 
                : (table.session 
                    ? 'border-emerald-200 shadow-md ring-1 ring-emerald-500/5 bg-emerald-50/5' 
                    : 'border-gray-100 opacity-60')
            }`}
          >
            <div className={`p-2.5 border-b flex justify-between items-center ${
              table.hasUnpaid 
                ? 'bg-orange-50/50 border-orange-50' 
                : (table.session 
                    ? 'bg-emerald-50/30 border-emerald-50' 
                    : 'bg-gray-50/50 border-gray-50')
            }`}>
              <div className="flex justify-between items-center w-full">
                 <span className="text-sm font-black text-slate-800 uppercase tracking-tight">{table.name}</span>
                 <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter border ${
                   table.session 
                     ? (table.hasUnpaid 
                         ? 'bg-orange-600 text-white border-orange-600' 
                         : 'bg-emerald-600 text-white border-emerald-600') 
                     : 'bg-zinc-100 text-zinc-650 border-zinc-200'
                 }`}>
                    {table.session ? (table.hasUnpaid ? 'Billed' : 'Paid') : 'Vacant'}
                 </span>
              </div>
            </div>

            <div className="p-3 md:flex-1 flex flex-col gap-2">
              <div className="flex justify-between items-center">
                 <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">
                   {table.session ? (table.hasUnpaid ? 'Unpaid' : 'Paid') : 'Unpaid'}
                 </span>
                 <span className={`text-base font-black tracking-tighter tabular-nums ${
                   table.hasUnpaid 
                     ? 'text-orange-600' 
                     : (table.session 
                         ? 'text-emerald-600' 
                         : 'text-gray-900')
                 }`}>
                   {formatCurrency(table.session ? (table.hasUnpaid ? table.unpaidTotal : table.sessionTotal) : 0, restaurant?.currency)}
                 </span>
              </div>
              
              {table.session && (
                 <div className="flex items-center gap-1.5 text-[8px] font-bold text-gray-400 uppercase">
                    <Clock size={10} />
                    <span>{Math.floor((Date.now() - new Date(table.session.created_at).getTime()) / 60000)}m</span>
                 </div>
              )}

              {table.session && table.session.orders && table.session.orders.length > 0 && (
                <div className="mt-1 pt-2 border-t border-gray-100 space-y-1.5 md:flex-1 overflow-y-auto max-h-[160px] scrollbar-thin">
                  <p className="text-[8px] font-black text-zinc-400 uppercase tracking-wider mb-1">Orders ({table.session.orders.length})</p>
                  {table.session.orders.map((order) => {
                    const isOrderCancelled = order.status === 'cancelled';
                    const isOrderPaid = !!order.paid_at;
                    const oPrice = parseFloat(order.total_price) || 0;
                    
                    // Check order-level or item-level discount presence
                    const hasOrderDiscount = order.discount && order.discount.value > 0;
                    const hasItemDiscount = order.items?.some((item: any) => item.discount && item.discount.value > 0);
                    const hasAnyDiscount = hasOrderDiscount || hasItemDiscount;

                    let discountLabel = "";
                    if (hasOrderDiscount) {
                      discountLabel = order.discount.type === 'percentage' 
                        ? `${order.discount.value}%` 
                        : formatCurrency(order.discount.value, restaurant?.currency);
                    } else if (hasItemDiscount) {
                      discountLabel = "Items";
                    }

                    return (
                      <div key={order.id} className="text-[10px] bg-slate-50/50 p-1.5 rounded-md border border-gray-100 flex flex-col gap-0.5 leading-none shadow-sm/5">
                        <div className="flex justify-between items-center">
                          <span className="font-extrabold text-gray-700">Ord #{getOrderDisplayNo(order.id, order.created_at || (order as any).createdAt)}</span>
                          <span className={`font-mono text-[10px] font-bold ${
                            isOrderPaid ? 'text-emerald-600' : isOrderCancelled ? 'text-zinc-400 line-through' : 'text-zinc-900 font-extrabold'
                          }`}>
                            {formatCurrency(oPrice, restaurant?.currency)}
                          </span>
                        </div>
                        
                        <div className="flex items-center justify-between mt-0.5">
                          <span className={`px-1 py-0.2 rounded-sm text-[8px] font-black uppercase tracking-tighter ${
                            isOrderPaid 
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' 
                              : isOrderCancelled 
                                ? 'bg-zinc-150 text-zinc-500' 
                                : 'bg-orange-50 text-orange-800 border border-orange-100'
                          }`}>
                            {isOrderPaid ? 'Paid' : isOrderCancelled ? 'Void' : 'Unpaid'}
                          </span>
                          
                          {hasAnyDiscount && (
                            <span className="bg-orange-100 text-orange-800 px-1 py-0.5 rounded-sm font-black text-[8px] leading-none flex items-center gap-0.5">
                              🏷️ {discountLabel}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-auto pt-2">
                 <button 
                  onClick={() => setSettlingSession(table)}
                  disabled={!table.hasUnpaid}
                  className={`w-full h-8 rounded-md font-black text-[9px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                    table.hasUnpaid 
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm' 
                    : 'bg-gray-100 text-gray-300'
                  }`}
                 >
                   <CreditCard size={12} />
                   Settle
                 </button>
              </div>
            </div>
          </motion.div>
        ))}

        {filteredTables.length === 0 && (
          <div className="col-span-full py-12 text-center flex flex-col items-center border border-dashed border-gray-200 rounded-lg">
             <Banknote size={24} className="text-gray-200 mb-2" />
             <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">No outstanding bills</p>
          </div>
        )}
      </div>

      {settlingSession && restaurant && (
         <PaymentWorkspace 
           order={settlingSession.mainOrder!}
           restaurant={restaurant}
           onClose={() => setSettlingSession(null)}
           onPaymentSuccess={() => {
             setSettlingSession(null);
             setRefreshKey(prev => prev + 1);
           }}
         />
      )}
    </div>
  );
}
