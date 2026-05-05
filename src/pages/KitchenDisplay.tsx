import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { collection, query, where, onSnapshot, updateDoc, doc, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Order } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, Check } from 'lucide-react';

export function KitchenDisplay() {
  const { restId } = useParams();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (!restId) return;
    const q = query(
      collection(db, 'restaurants', restId, 'orders'),
      where('status', 'in', ['pending', 'preparing']),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, (snapshot) => {
      setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Order[]);
    });
    return unsub;
  }, [restId]);

  const setReady = async (orderId: string) => {
    if (!restId) return;
    await updateDoc(doc(db, 'restaurants', restId, 'orders', orderId), { status: 'ready' });
  };

  return (
    <div className="bg-[#0f172a] min-h-screen -m-8 p-6 md:p-12 text-white">
      <div className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-4xl font-black tracking-tighter">Kitchen Display</h1>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-xs mt-2">Active Production Line • {orders.length} Orders</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono font-bold">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <div className="text-slate-500 text-sm">Station: Main Hot Kitchen</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <AnimatePresence>
          {orders.map((order, idx) => {
            const timeDiff = Math.floor((Date.now() - (order.createdAt?.toMillis() || 0)) / 60000);
            const urgencyColor = timeDiff > 15 ? 'bg-red-600' : timeDiff > 10 ? 'bg-orange-500' : 'bg-slate-800';

            return (
              <motion.div
                key={order.id}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0, x: 200 }}
                className={`${urgencyColor} rounded-3xl overflow-hidden shadow-2xl flex flex-col min-h-[400px] border border-white/5`}
              >
                <div className="p-4 flex justify-between items-center bg-black/20 border-b border-white/10">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl font-black">#{idx + 1}</span>
                    <div className="font-bold">
                      <div className="text-xs uppercase opacity-60">Table</div>
                      <div className="text-xl">{order.tableId}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-xl font-bold">
                    <Clock size={20} className="opacity-60" />
                    {timeDiff}m
                  </div>
                </div>

                <div className="p-6 flex-1 space-y-4">
                  {order.items.map((item, i) => (
                    <div key={i} className="flex gap-4 items-start">
                      <div className="bg-white text-slate-900 rounded-lg w-10 h-10 flex items-center justify-center font-black text-xl shrink-0">
                        {item.quantity}
                      </div>
                      <div>
                        <h4 className="text-xl font-bold leading-tight uppercase">{item.name}</h4>
                        {item.options.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {item.options.map((opt, oi) => (
                              <span key={oi} className="bg-black/40 px-2 py-0.5 rounded text-[10px] font-bold text-slate-300">
                                {opt.valueName}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => setReady(order.id)}
                  className="w-full bg-white/10 hover:bg-white/20 py-6 text-2xl font-black uppercase transition-colors flex items-center justify-center gap-3 border-t border-white/10"
                >
                  <Check size={32} />
                  Ready
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {orders.length === 0 && (
        <div className="h-[60vh] flex flex-col items-center justify-center text-slate-600">
          <Utensils size={120} strokeWidth={1} className="mb-6 opacity-20" />
          <h2 className="text-3xl font-black uppercase tracking-widest">No active orders</h2>
          <p className="mt-2 font-bold opacity-40">Kitchen is currently clear</p>
        </div>
      )}
    </div>
  );
}

function Utensils(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
      <path d="M7 2v20" />
      <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
    </svg>
  );
}
