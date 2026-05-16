import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { motion } from 'motion/react';
import { 
  CheckCircle2, 
  Download, 
  ChevronRight, 
  Home, 
  Receipt,
  Star
} from 'lucide-react';
import { Restaurant, Order } from '../types';

export function PaymentSuccess() {
  const { restId, tableId, orderId } = useParams();
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: orderData } = await supabase
          .from('orders')
          .select('session_id')
          .eq('id', orderId)
          .single();

        if (orderData?.session_id) {
          const [restRes, ordersRes] = await Promise.all([
            supabase.from('restaurants').select('*').eq('id', restId).single(),
            supabase.from('orders').select('*').eq('session_id', orderData.session_id).order('created_at', { ascending: true })
          ]);
          
          setRestaurant(restRes.data as any);
          setOrders((ordersRes.data || []).map(o => ({
            ...o,
            totalPrice: parseFloat(o.total_price),
            createdAt: o.created_at
          })) as any);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [restId, orderId]);

  if (loading) return (
    <div className="h-screen bg-zinc-950 flex flex-col items-center justify-center p-8">
      <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-4" />
    </div>
  );

  const totalPaid = orders.reduce((sum, o) => sum + (o.paid_at ? (o.totalPrice || 0) : 0), 0);

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans selection:bg-emerald-500/30">
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-emerald-600/20 blur-[120px] -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-600/10 blur-[120px] translate-y-1/2 -translate-x-1/2" />
      </div>

      <main className="relative z-10 px-6 py-12 max-w-lg mx-auto flex flex-col items-center text-center">
        {/* Success Animation */}
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-24 h-24 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mb-8 relative"
        >
          <CheckCircle2 size={48} strokeWidth={2.5} />
          <motion.div
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1.2 }}
            transition={{ delay: 0.5, duration: 1, repeat: Infinity, repeatType: "reverse" }}
            className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl"
          />
        </motion.div>

        <motion.div
           initial={{ y: 20, opacity: 0 }}
           animate={{ y: 0, opacity: 1 }}
           transition={{ delay: 0.2 }}
        >
          <h1 className="text-3xl font-black mb-2 tracking-tighter uppercase italic">Payment Received</h1>
          <p className="text-zinc-500 text-sm font-medium mb-8">Thank you for dining at <span className="text-zinc-300">{restaurant?.name}</span></p>
        </motion.div>

        {/* Amount Card */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="w-full bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 rounded-[3rem] p-10 mb-8 overflow-hidden relative"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
          <div className="flex flex-col items-center gap-1 mb-10">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Total Settlement</p>
            <h2 className="text-5xl font-black tabular-nums tracking-tight">
              RM <span className="text-white">{totalPaid.toFixed(2)}</span>
            </h2>
          </div>

          <div className="space-y-4 text-left">
            <div className="flex justify-between items-center text-[11px] font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-800 pb-3">
               <span>Item Summary</span>
               <span>Amount</span>
            </div>
            <div className="max-h-40 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
              {orders.filter(o => o.paid_at).map(o => (
                <div key={o.id} className="flex justify-between items-center text-[12px]">
                   <div className="flex flex-col">
                      <span className="text-zinc-300 font-bold tracking-tight">Order #{o.id.slice(-4).toUpperCase()}</span>
                      <span className="text-zinc-600 text-[10px] uppercase font-black tracking-tighter">
                         {new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                   </div>
                   <span className="text-zinc-400 font-black">RM {(o.totalPrice || 0).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="pt-4 mt-2 border-t border-dashed border-zinc-800 flex justify-between items-center">
               <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Transaction Verified</span>
               </div>
               <div className="flex items-center gap-1 text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded text-[10px] font-bold">
                  <Receipt size={10} />
                  <span>REF: {orderId?.slice(0, 8).toUpperCase()}</span>
               </div>
            </div>
          </div>
        </motion.div>

        {/* Action Grid */}
        <div className="grid grid-cols-2 gap-4 w-full mb-12">
           <button className="h-16 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-95 transition-all group">
              <Download size={18} className="text-zinc-400 group-hover:text-emerald-500 transition-colors" />
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Get Receipt</span>
           </button>
           <Link 
              to={`/restaurant/${restId}/table/${tableId}`}
              className="h-16 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-95 transition-all group"
           >
              <Home size={18} className="text-zinc-400 group-hover:text-orange-500 transition-colors" />
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Back to Menu</span>
           </Link>
        </div>

        {/* Feedback Section */}
        <div className="w-full bg-orange-600/5 border border-orange-600/20 rounded-3xl p-6 flex flex-col items-center">
           <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-500 mb-4 text-center">How was your experience?</p>
           <div className="flex gap-4">
              {[1, 2, 3, 4, 5].map(i => (
                <button key={i} className="text-orange-900 hover:text-orange-500 transition-colors">
                   <Star size={24} fill={i <= 4 ? "currentColor" : "none"} />
                </button>
              ))}
           </div>
        </div>

        <div className="mt-12 text-center text-[10px] font-bold text-zinc-600 tracking-widest uppercase flex items-center justify-center gap-4">
           <span>Securely Processed</span>
           <div className="w-1.5 h-1.5 bg-zinc-800 rounded-full" />
           <span>256-BIT AES</span>
        </div>
      </main>
    </div>
  );
}
