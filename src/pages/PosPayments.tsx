import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getApiUrl } from '../lib/api';

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

export function PosPayments() {
  const { restId } = useParams();
  const { user, loading: loadingAuth } = useAuthStore();
  const [tables, setTables] = useState<any[]>([]);
  const [filter, setFilter] = useState<'all' | 'outstanding'>('outstanding');
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [settlingSession, setSettlingSession] = useState<any | null>(null);

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
            ...restData,
            serviceCharge: parseFloat(restData.service_charge || 0),
            sst: parseFloat(restData.sst || 0)
          } as any);
        }

        // Fetch all tables
        const [tablesData, sessionsData] = await Promise.all([
          fetch(getApiUrl(`/api/restaurants/${restId}/tables`), fetchOptions).then(r => r.json()),
          fetch(getApiUrl(`/api/restaurants/${restId}/dining-sessions?status=active`), fetchOptions).then(r => r.json())
        ]);
        
        if (tablesData && sessionsData && !tablesData.error && !sessionsData.error) {
          const processedTables = tablesData.map((t: any) => {
            const activeSession = sessionsData.find((s: any) => s.table_id === t.id);
            let unpaidTotal = 0;
            let mainOrder = null;

            if (activeSession) {
              const allOrders = activeSession.orders || [];
              const unpaidOrders = allOrders.filter((o: any) => !o.paid_at && o.status !== 'cancelled');
              unpaidTotal = unpaidOrders.reduce((sum: number, o: any) => sum + parseFloat(o.total_price), 0);
              const sessionTotal = allOrders.reduce((sum: number, o: any) => sum + parseFloat(o.total_price), 0);
              
              const mOrder = allOrders[0];
              if (mOrder) {
                mainOrder = {
                  ...mOrder,
                  tableName: t.name,
                  totalPrice: parseFloat(mOrder.total_price),
                  sessionTotal,
                  sessionUnpaid: unpaidTotal,
                  createdAt: mOrder.created_at || new Date().toISOString()
                };
              }
            }

            return {
               ...t,
               session: activeSession,
               unpaidTotal,
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
  }, [restId]);

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
              <h1 className="text-lg font-black text-gray-900 tracking-tight leading-none uppercase italic">Settlement Hub</h1>
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
                  RM {totalOutstanding.toFixed(2)}
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

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
        {filteredTables.map(table => (
          <motion.div
            layout
            key={table.id}
            className={`bg-white rounded-lg border transition-all overflow-hidden flex flex-col ${
              table.hasUnpaid ? 'border-orange-200 shadow-md ring-1 ring-orange-500/5' : 'border-gray-100 opacity-60'
            }`}
          >
            <div className={`p-2 border-b flex justify-between items-center ${
              table.hasUnpaid ? 'bg-orange-50/50 border-orange-50' : 'bg-gray-50/50 border-gray-50'
            }`}>
              <div className="flex items-center gap-2">
                 <div className={`w-7 h-7 ${table.hasUnpaid ? 'bg-orange-600' : 'bg-gray-900'} text-white rounded flex items-center justify-center font-black text-[11px]`}>
                    {table.name}
                 </div>
                 <div className="flex flex-col">
                    <p className={`text-[9px] font-black uppercase tracking-tighter ${table.session ? 'text-gray-900' : 'text-gray-400'}`}>
                       {table.session ? (table.hasUnpaid ? 'Billed' : 'Paid') : 'Vacant'}
                    </p>
                 </div>
              </div>
            </div>

            <div className="p-3 flex-1 flex flex-col gap-2">
              <div className="flex justify-between items-center">
                 <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Unpaid</span>
                 <span className={`text-base font-black tracking-tighter tabular-nums ${table.hasUnpaid ? 'text-orange-600' : 'text-gray-900'}`}>
                   RM {parseFloat(table.unpaidTotal || 0).toFixed(2)}
                 </span>
              </div>
              
              {table.session && (
                 <div className="flex items-center gap-1.5 text-[8px] font-bold text-gray-400 uppercase">
                    <Clock size={10} />
                    <span>{Math.floor((Date.now() - new Date(table.session.created_at).getTime()) / 60000)}m</span>
                 </div>
              )}

              <div className="mt-auto pt-2">
                 <button 
                  onClick={() => setSettlingSession({ ...table.session, mainOrder: table.mainOrder })}
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
           order={settlingSession.mainOrder}
           restaurant={restaurant}
           onClose={() => setSettlingSession(null)}
           onPaymentSuccess={() => {
             setSettlingSession(null);
           }}
         />
      )}
    </div>
  );
}
