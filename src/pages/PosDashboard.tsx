import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Order, OrderStatus } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Filter, Check, X, Clock } from 'lucide-react';

import { flattenSelections } from '../lib/configEngine';

export function PosDashboard() {
  const { restId } = useParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<string>('active');
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null);

  useEffect(() => {
    if (!restId) return;

    let fetchTimeout: NodeJS.Timeout;

    // 1. Initial Fetch
    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, tables(name)')
        .eq('restaurant_id', restId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching POS orders:', error);
        return;
      }

      if (data) {
        setOrders(data.map(o => ({
          id: o.id,
          tableId: o.table_id,
          tableName: (o as any).tables?.name || o.table_id.slice(-4).toUpperCase(),
          orderType: o.order_type,
          status: o.status as OrderStatus,
          totalPrice: parseFloat(o.total_price),
          paymentMethod: o.payment_method,
          items: o.items,
          paid_at: o.paid_at,
          createdAt: { toDate: () => new Date(o.created_at) }
        })) as any);
      }
    };

    const debouncedFetch = () => {
      clearTimeout(fetchTimeout);
      fetchTimeout = setTimeout(fetchOrders, 300);
    };

    fetchOrders();

    // 2. Refresh on Focus
    const handleFocus = () => {
      fetchOrders();
    };
    window.addEventListener('focus', handleFocus);

    // 3. Realtime Subscription
    const channelName = `pos-${restId}`;
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
    await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId);
  };

  const closeSession = async (sessionId: string, tableId: string) => {
    // 1. Mark session as completed
    await supabase
      .from('dining_sessions')
      .update({ status: 'completed', closed_at: new Date().toISOString() })
      .eq('id', sessionId);

    // 2. Clear the table
    await supabase
      .from('tables')
      .update({ status: 'available', current_session_id: null })
      .eq('id', tableId);
  };

  const filteredOrders = orders.filter(o => {
    if (filter === 'active') return o.status !== 'completed' && o.status !== 'cancelled';
    if (filter === 'paid') return !!(o as any).paid_at;
    return o.status === filter;
  });

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight capitalize">{filter} Orders</h1>
          <p className="text-gray-500 text-sm font-medium">Managing restaurant operations</p>
        </div>
        <div className="flex gap-2 bg-gray-100 p-1.5 rounded-2xl overflow-x-auto scrollbar-none">
          {['active', 'paid', 'pending', 'confirmed', 'cooking', 'ready', 'served', 'completed', 'cancelled'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-xs font-bold capitalize whitespace-nowrap transition-all ${
                filter === f ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <AnimatePresence>
          {filteredOrders.map(order => (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              key={order.id}
              className="bg-white rounded-3xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-md transition-shadow flex flex-col"
            >
              <div className="p-5 border-b flex justify-between items-center bg-gray-50/50">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="bg-gray-900 text-white rounded-lg px-2 py-0.5 text-xs font-bold font-mono">
                      {order.id.slice(-4).toUpperCase()}
                    </span>
                    <h3 className="font-bold text-gray-900">Table {order.tableName || order.tableId}</h3>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                      {(order.createdAt as any).toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase ${
                       order.orderType === 'takeaway' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {order.orderType || 'dine-in'}
                    </span>
                    {(order as any).paid_at ? (
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase bg-emerald-100 text-emerald-700">
                        PAID
                      </span>
                    ) : (
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase bg-orange-100 text-orange-700">
                        UNPAID
                      </span>
                    )}
                  </div>
                </div>
                <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                  order.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                  order.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                  order.status === 'cooking' ? 'bg-orange-100 text-orange-700' :
                  order.status === 'ready' ? 'bg-green-100 text-green-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {order.status}
                </div>
              </div>

              <div className="p-5 flex-1 space-y-3">
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-start">
                    <div className="flex gap-3">
                      <span className="font-black text-sm text-gray-900 bg-gray-100 px-1.5 rounded-md h-fit">
                        {item.quantity}x
                      </span>
                      <div>
                        <h4 className="text-sm font-bold text-gray-800 leading-none">{item.name}</h4>
                        {item.smartRenderedLines?.customer ? (
                          <div className="mt-1 space-y-0.5">
                            {item.smartRenderedLines.customer.map((line, i) => (
                              <p key={i} className="text-[10px] text-gray-400 font-bold leading-tight">{line}</p>
                            ))}
                          </div>
                        ) : item.selection ? (
                          <div className="mt-1 space-y-0.5">
                            {flattenSelections(item.selection).map((line, i) => (
                              <p key={i} className="text-[10px] text-gray-400 font-bold leading-tight">{line}</p>
                            ))}
                          </div>
                        ) : item.options.length > 0 ? (
                          <p className="text-[10px] text-gray-400 mt-1 italic">
                            {item.options.map(o => o.valueName).join(', ')}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-5 pt-0 mt-auto">
                <div className="flex justify-between items-center mb-4 pt-4 border-t border-gray-50">
                  <span className="text-xs font-bold text-gray-400 uppercase">Total amount</span>
                  <span className="text-lg font-black text-gray-900">RM {(order.totalPrice || 0).toFixed(2)}</span>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    {order.status === 'pending' && (
                      <button
                        onClick={() => updateStatus(order.id, 'confirmed')}
                        className="flex-1 bg-yellow-400 text-yellow-950 py-3 rounded-xl font-bold text-xs hover:bg-yellow-500 transition-colors"
                      >
                        Accept Order
                      </button>
                    )}
                    {order.status === 'confirmed' && (
                      <button
                        onClick={() => updateStatus(order.id, 'cooking')}
                        className="flex-1 bg-orange-100 text-orange-900 py-3 rounded-xl font-bold text-xs hover:bg-orange-200 transition-colors"
                      >
                        Start Cooking
                      </button>
                    )}
                    {order.status === 'cooking' && (
                      <button
                        onClick={() => updateStatus(order.id, 'ready')}
                        className="flex-1 bg-orange-600 text-white py-3 rounded-xl font-bold text-xs hover:bg-orange-700 transition-colors"
                      >
                        Mark Ready
                      </button>
                    )}
                    {order.status === 'ready' && (
                      <button
                        onClick={() => updateStatus(order.id, 'served')}
                        className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold text-xs hover:bg-blue-700 transition-colors"
                      >
                        {order.orderType === 'takeaway' ? 'Picked Up' : 'Served'}
                      </button>
                    )}
                    {order.status === 'served' && (
                      <button
                        onClick={() => updateStatus(order.id, 'completed')}
                        className="flex-1 bg-zinc-900 text-white py-3 rounded-xl font-bold text-xs hover:bg-black transition-colors"
                      >
                        Complete Order
                      </button>
                    )}
                    {(order.status === 'completed' || order.status === 'cancelled') && (order as any).session_id && (
                      <button
                        onClick={() => closeSession((order as any).session_id, (order as any).table_id)}
                        className="flex-1 bg-zinc-100 text-zinc-900 py-3 rounded-xl font-bold text-xs hover:bg-zinc-200 transition-colors border border-zinc-200"
                      >
                        Clear Table
                      </button>
                    )}
                    {!(order as any).paid_at && order.status !== 'cancelled' && order.status !== 'completed' && (
                      <button
                        onClick={async () => {
                          const now = new Date().toISOString();
                          await supabase.from('orders').update({ 
                            paid_at: now,
                            payment_method: 'counter',
                            status: (order.status === 'ready' || order.status === 'served') ? 'completed' : order.status
                          }).eq('id', order.id);
                        }}
                        className="flex-1 bg-emerald-500 text-white py-3 rounded-xl font-bold text-xs hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20"
                      >
                        Paid (Cash)
                      </button>
                    )}
                    {confirmingCancel === order.id ? (
                      <div className="flex gap-1 animate-in fade-in slide-in-from-right-2 duration-300">
                        <button
                          onClick={() => {
                            updateStatus(order.id, 'cancelled');
                            setConfirmingCancel(null);
                          }}
                          className="px-4 py-3 bg-red-500 text-white rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-red-600 transition-all shadow-lg active:scale-95"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmingCancel(null)}
                          className="p-3 bg-gray-100 text-gray-400 rounded-xl hover:bg-gray-200 transition-colors"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingCancel(order.id)}
                        className="p-3 bg-gray-100 text-gray-500 rounded-xl hover:bg-red-50 hover:text-red-500 transition-colors"
                        title="Cancel Order"
                      >
                        <X size={18} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
