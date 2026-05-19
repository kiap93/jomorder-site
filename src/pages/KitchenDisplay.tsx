import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getApiUrl } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { Order, OrderStatus } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, CheckCircle2, Loader2 } from 'lucide-react';

import { flattenSelections } from '../lib/configEngine';

export function KitchenDisplay() {
  const { restId } = useParams();
  const { user, loading: loadingAuth } = useAuthStore();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (!restId || loadingAuth) return;
    if (!user) return;

    let fetchTimeout: NodeJS.Timeout;

    const fetchOrders = async () => {
      const token = useAuthStore.getState().token;
      if (!token) return;

      const timeoutTimer = setTimeout(() => {
        if (orders.length === 0) {
          console.warn("Kitchen orders fetch taking too long...");
        }
      }, 10000);

      try {
        const url = getApiUrl(`/api/restaurants/${restId}/orders?status=active`);
        console.log("KDS Fetching from:", url);
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const bodyText = await response.text();
        
        if (!response.ok) {
          console.error(`KDS fetch failed (${response.status}). Body:`, bodyText);
          throw new Error(`Failed to fetch kitchen orders (Status ${response.status})`);
        }

        let data;
        try {
          data = JSON.parse(bodyText);
        } catch (e) {
          console.error("KDS JSON parse failed. Body snippet:", bodyText.slice(0, 100));
          throw new Error("Invalid response from server");
        }
        const filteredData = data.filter((o: any) => ['pending', 'confirmed', 'cooking', 'ready'].includes(o.status));

        clearTimeout(timeoutTimer);

        if (data) {
          setOrders(data.map(o => ({
            id: o.id,
            tableId: o.table_id,
            tableName: (o as any).tables?.name || o.table_id.slice(-4).toUpperCase(),
            orderType: o.order_type,
            status: o.status as OrderStatus,
            totalPrice: parseFloat(o.total_price),
            items: o.items,
            paidAt: o.paid_at,
            createdAt: { toDate: () => new Date(o.created_at) }
          })) as any);
        }
      } catch (err) {
        console.error("KDS fetch exception:", err);
      }
    };

    const debouncedFetch = () => {
      clearTimeout(fetchTimeout);
      fetchTimeout = setTimeout(fetchOrders, 300);
    };

    fetchOrders();

    let lastFocusRefresh = 0;
    const handleFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefresh < 30000) return; // 30s throttle
      lastFocusRefresh = now;
      
      console.log("KDS: Window focused, refreshing orders...");
      fetchOrders();
    };
    window.addEventListener('focus', handleFocus);

    const channelName = `kitchen-${restId}-${Math.random().toString(36).slice(2)}`;
    const subscription = supabase
      .channel(channelName)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'orders',
        filter: `restaurant_id=eq.${restId}`
      }, () => {
        debouncedFetch();
      })
      .subscribe();

    return () => {
      clearTimeout(fetchTimeout);
      supabase.removeChannel(subscription);
      window.removeEventListener('focus', handleFocus);
    };
  }, [restId]);

  const updateStatus = async (orderId: string, status: OrderStatus) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    await fetch(getApiUrl(`/api/orders/${orderId}`), {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status, updated_at: new Date().toISOString() })
    });
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col gap-8">
      <header className="flex items-center justify-between bg-gray-900 text-white p-6 rounded-[2rem]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center">
            <Loader2 className="animate-spin text-white" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight">KITCHEN MONITOR</h1>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Active Preparations</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black font-mono">{orders.length}</div>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Open Tickets</p>
        </div>
      </header>

      <div className="flex-1 overflow-x-auto pb-4 flex gap-6 scrollbar-thin">
        <AnimatePresence>
          {orders.map(order => (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              key={order.id}
              className={`w-80 flex-shrink-0 flex flex-col rounded-[2.5rem] overflow-hidden border-2 shadow-xl ${
                order.status === 'pending' ? 'bg-white border-yellow-200' : 'bg-orange-50 border-orange-200'
              }`}
            >
              <div className={`p-6 border-b flex justify-between items-center ${
                order.status === 'pending' ? 'bg-yellow-50/50' : 'bg-orange-100/50'
              }`}>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-black text-xl text-gray-900">Table {order.tableName || order.tableId}</h3>
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase ${
                       order.orderType === 'takeaway' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {order.orderType === 'dine_in' ? 'Dine In' : order.orderType || 'Dine In'}
                    </span>
                    {(order as any).paidAt && (
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-emerald-500 text-white uppercase italic shadow-sm shadow-emerald-500/20">
                        Paid
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-400 font-mono text-xs font-bold">
                    <Clock size={12} />
                    {(order.createdAt as any).toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="bg-gray-900 text-white px-2 py-1 rounded-lg text-[10px] font-bold font-mono">
                  #{order.id.slice(-4).toUpperCase()}
                </div>
              </div>

              <div className="p-6 flex-1 space-y-4 overflow-y-auto">
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex gap-4">
                    <div className="w-8 h-8 bg-gray-900 text-white rounded-lg flex items-center justify-center font-black flex-shrink-0">
                      {item.quantity}x
                    </div>
                    <div>
                      <h4 className="font-black text-gray-900 leading-tight">
                        {item.kitchenName || item.name}
                      </h4>
                      {item.smartRenderedLines?.kds ? (
                        <div className="mt-2 space-y-1">
                          {item.smartRenderedLines.kds.map((line, i) => (
                            <p key={i} className="text-[11px] text-orange-600 font-black leading-none">{line}</p>
                          ))}
                        </div>
                      ) : item.selection ? (
                        <div className="mt-2 space-y-1">
                          {flattenSelections(item.selection).map((line, i) => (
                            <p key={i} className="text-[11px] text-gray-500 font-bold leading-none">{line}</p>
                          ))}
                        </div>
                      ) : item.options.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {item.options.map((opt, i) => (
                            <span key={i} className="bg-white text-[10px] font-bold text-gray-400 px-1.5 py-0.5 rounded-md border">
                              {opt.valueName}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-6">
                {order.status === 'pending' && (
                  <button
                    onClick={() => updateStatus(order.id, 'confirmed')}
                    className="w-full bg-yellow-400 text-yellow-950 py-4 rounded-2xl font-black text-sm hover:bg-yellow-500 transition-all shadow-lg active:scale-95"
                  >
                    ACCEPT ORDER
                  </button>
                )}
                {order.status === 'confirmed' && (
                  <button
                    onClick={() => updateStatus(order.id, 'cooking')}
                    className="w-full bg-orange-100 text-orange-900 py-4 rounded-2xl font-black text-sm hover:bg-orange-200 transition-all shadow-lg active:scale-95"
                  >
                    START COOKING
                  </button>
                )}
                {order.status === 'cooking' && (
                  <button
                    onClick={() => updateStatus(order.id, 'ready')}
                    className="w-full bg-orange-600 text-white py-4 rounded-2xl font-black text-sm hover:bg-orange-700 transition-all shadow-lg shadow-orange-200 active:scale-95 flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={18} /> MARK READY
                  </button>
                )}
                {order.status === 'ready' && (
                   <div className="text-center py-4 bg-green-50 rounded-2xl text-green-700 font-black text-xs uppercase tracking-widest border border-green-100">
                     Waiting for Handover
                   </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
