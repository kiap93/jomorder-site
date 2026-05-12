import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Order, OrderStatus } from '../types';
import { motion } from 'motion/react';
import { ChefHat, CheckCircle2, Clock, MapPin, Plus } from 'lucide-react';
import { flattenSelections } from '../lib/configEngine';

export function OrderTracker() {
  const { orderId, restId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId || !restId) return;
    localStorage.setItem(`last_order_${restId}`, orderId);

    const fetchOrder = async () => {
      const { data } = await supabase
        .from('orders')
        .select('*, tables!table_id(name)')
        .eq('id', orderId)
        .single();

      if (data) {
        setOrder({
          id: data.id,
          tableId: data.table_id,
          tableName: (data as any).tables?.name || data.table_id.slice(-4).toUpperCase(),
          orderType: data.order_type || 'dine-in',
          status: data.status as OrderStatus,
          totalPrice: parseFloat(data.total_price),
          items: data.items,
          createdAt: { toDate: () => new Date(data.created_at) }
        } as any);
      }
      setLoading(false);
    };

    fetchOrder();

    const subscription = supabase
      .channel(`order-${orderId}`)
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'orders',
        filter: `id=eq.${orderId}`
      }, () => {
        fetchOrder();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [orderId]);

  if (loading) return <div className="h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div></div>;
  if (!order) return <div className="p-20 text-center font-bold">Order not found.</div>;

  const steps: OrderStatus[] = ['pending', 'confirmed', 'cooking', 'ready', 'served', 'completed'];
  const currentIndex = steps.indexOf(order.status);

  const getStatusInfo = (status: OrderStatus) => {
    switch (status) {
      case 'pending': return { icon: Clock, text: 'Order Sent', color: 'text-yellow-500' };
      case 'confirmed': return { icon: CheckCircle2, text: 'Accepted', color: 'text-blue-500' };
      case 'cooking': return { icon: ChefHat, text: 'Cooking Now', color: 'text-orange-500' };
      case 'ready': return { icon: CheckCircle2, text: 'Ready', color: 'text-green-500' };
      case 'served': return { icon: CheckCircle2, text: order.orderType === 'takeaway' ? 'Picked Up' : 'Served', color: 'text-gray-900' };
      case 'completed': return { icon: CheckCircle2, text: 'Enjoy!', color: 'text-gray-900' };
      default: return { icon: Clock, text: 'Wait...', color: 'text-gray-400' };
    }
  };

  const statusInfo = getStatusInfo(order.status);

  return (
    <div className="max-w-md mx-auto min-h-[80vh] flex flex-col items-center justify-center p-6 bg-white text-center">
      <div className="w-24 h-24 bg-orange-50 rounded-[2.5rem] flex items-center justify-center mb-8 relative">
        <statusInfo.icon size={48} className={`animate-pulse ${statusInfo.color}`} />
        <div className="absolute -bottom-2 -right-2 bg-gray-900 text-white w-8 h-8 rounded-full flex items-center justify-center font-black text-xs">
          #{order.id.slice(-4).toUpperCase()}
        </div>
      </div>

      <h1 className="text-4xl font-black text-gray-900 tracking-tighter mb-2">{statusInfo.text}</h1>
      <p className="text-gray-400 font-medium mb-12">Table {order.tableName || order.tableId} • RM {order.totalPrice.toFixed(2)}</p>

      {/* Progress Bar */}
      <div className="w-full relative py-8 px-4">
        <div className="h-2 bg-gray-100 w-full rounded-full absolute top-1/2 left-0 -translate-y-1/2" />
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${(currentIndex / (steps.length - 1)) * 100}%` }}
          className="h-2 bg-orange-500 rounded-full absolute top-1/2 left-0 -translate-y-1/2" 
        />
        
        <div className="relative flex justify-between w-full">
          {steps.map((step, idx) => {
            const StepIcon = getStatusInfo(step).icon;
            const isActive = idx <= currentIndex;
            return (
              <div key={idx} className="flex flex-col items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                  isActive ? 'bg-orange-500 text-white shadow-lg shadow-orange-100' : 'bg-white border-2 border-gray-100 text-gray-200'
                }`}>
                  <StepIcon size={20} />
                </div>
                <span className={`text-[8px] font-black uppercase tracking-widest ${isActive ? 'text-gray-900' : 'text-gray-300'}`}>{step}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Order Details */}
      <div className="mt-12 bg-gray-50 p-6 rounded-[2rem] w-full text-left pb-24">
        <h3 className="font-bold text-zinc-900 mb-6 flex items-center gap-2">
          <MapPin size={18} className="text-zinc-400" /> 
          <span className="text-sm uppercase tracking-wider">Order Summary</span>
        </h3>
        <div className="space-y-4">
          {order.items.map((item, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex justify-between items-center group">
                <div className="flex items-center gap-3">
                  <span className="font-black text-orange-600 bg-orange-100/50 w-7 h-7 flex items-center justify-center rounded-lg text-xs">
                    {item.quantity}x
                  </span>
                  <span className="font-bold text-sm text-gray-700">{item.name}</span>
                </div>
                <span className="font-mono text-xs font-bold text-gray-400">RM {(item.price * item.quantity).toFixed(2)}</span>
              </div>
              {item.smartRenderedLines?.customer ? (
                <div className="pl-10 space-y-0.5">
                  {item.smartRenderedLines.customer.map((line, i) => (
                    <p key={i} className="text-[10px] text-gray-400 font-medium italic leading-none whitespace-pre-wrap">{line}</p>
                  ))}
                </div>
              ) : item.selection ? (
                <div className="pl-10 space-y-0.5">
                  {flattenSelections(item.selection).map((line, i) => (
                    <p key={i} className="text-[10px] text-gray-400 font-medium italic leading-none whitespace-pre-wrap">{line}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-8 pt-6 border-t border-gray-200 flex justify-between items-center">
            <span className="text-sm font-black text-gray-900">Total Charged</span>
            <span className="text-xl font-black text-orange-600">RM {order.totalPrice.toFixed(2)}</span>
        </div>
      </div>
      
      <button
        onClick={() => navigate(`/restaurant/${restId}/table/${order.tableId}`)}
        className="mt-8 mb-4 w-full bg-gray-900 text-white py-6 rounded-[2.5rem] font-black text-lg hover:bg-black transition-all shadow-xl flex items-center justify-center gap-3 active:scale-[0.98]"
      >
        <Plus size={20} />
        Add More Items
      </button>

      <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">
        Need help? Ask our staff
      </p>
    </div>
  );
}
