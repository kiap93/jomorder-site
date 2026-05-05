import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { collection, query, onSnapshot, updateDoc, doc, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Order, OrderStatus } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Filter, Check, X, Clock } from 'lucide-react';

export function PosDashboard() {
  const { restId } = useParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    if (!restId) return;
    const q = query(
      collection(db, 'restaurants', restId, 'orders'),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snapshot) => {
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Order[]);
    });
    return unsub;
  }, [restId]);

  const updateStatus = async (orderId: string, status: OrderStatus) => {
    if (!restId) return;
    await updateDoc(doc(db, 'restaurants', restId, 'orders', orderId), { status });
  };

  const filteredOrders = orders.filter(o => {
    if (filter === 'all') return o.status !== 'completed' && o.status !== 'cancelled';
    return o.status === filter;
  });

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl shadow-sm">
        <div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight">Active Orders</h1>
          <p className="text-gray-500 text-sm">Managing live restaurant traffic</p>
        </div>
        <div className="flex gap-2 bg-gray-100 p-1.5 rounded-2xl">
          {['all', 'pending', 'preparing', 'ready'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-bold capitalize transition-all ${
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
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              key={order.id}
              className="bg-white rounded-3xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-md transition-shadow flex flex-col"
            >
              {/* Order Header */}
              <div className="p-5 border-b flex justify-between items-center bg-gray-50/50">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="bg-gray-900 text-white rounded-lg px-2 py-0.5 text-xs font-bold font-mono">
                      {order.id.slice(-4).toUpperCase()}
                    </span>
                    <h3 className="font-bold text-gray-900">Table {order.tableId}</h3>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-widest font-bold">
                    {order.createdAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                  order.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                  order.status === 'preparing' ? 'bg-orange-100 text-orange-700' :
                  'bg-blue-100 text-blue-700'
                }`}>
                  {order.status}
                </div>
              </div>

              {/* Order Items */}
              <div className="p-5 flex-1 space-y-3">
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-start">
                    <div className="flex gap-3">
                      <span className="font-black text-sm text-orange-600 bg-orange-50 px-1.5 rounded-md h-fit">
                        {item.quantity}
                      </span>
                      <div>
                        <h4 className="text-sm font-bold text-gray-800 leading-none">{item.name}</h4>
                        <p className="text-[10px] text-gray-400 mt-1 italic">
                          {item.options.map(o => o.valueName).join(', ')}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Order Footer & Actions */}
              <div className="p-5 pt-0 mt-auto">
                <div className="flex justify-between items-center mb-4 pt-4 border-t border-gray-50">
                  <span className="text-xs font-bold text-gray-400 uppercase">Total amount</span>
                  <span className="text-lg font-black text-gray-900">RM {order.totalPrice.toFixed(2)}</span>
                </div>
                <div className="flex gap-2">
                  {order.status === 'pending' && (
                    <button
                      onClick={() => updateStatus(order.id, 'preparing')}
                      className="flex-1 bg-gray-900 text-white py-3 rounded-xl font-bold text-xs hover:bg-black transition-colors"
                    >
                      Start Cooking
                    </button>
                  )}
                  {order.status === 'preparing' && (
                    <button
                      onClick={() => updateStatus(order.id, 'ready')}
                      className="flex-1 bg-orange-600 text-white py-3 rounded-xl font-bold text-xs hover:bg-orange-700 transition-colors"
                    >
                      Mark as Ready
                    </button>
                  )}
                  {order.status === 'ready' && (
                    <button
                      onClick={() => updateStatus(order.id, 'completed')}
                      className="flex-1 bg-green-600 text-white py-3 rounded-xl font-bold text-xs hover:bg-green-700 transition-colors"
                    >
                      Complete Order
                    </button>
                  )}
                  <button
                    onClick={() => updateStatus(order.id, 'cancelled')}
                    className="p-3 bg-gray-100 text-gray-500 rounded-xl hover:bg-red-50 hover:text-red-500 transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
