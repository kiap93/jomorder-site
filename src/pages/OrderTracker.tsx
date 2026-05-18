import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import { Order, OrderStatus } from '../types';
import { motion } from 'motion/react';
import { ChefHat, CheckCircle2, Clock, MapPin, Plus, Receipt } from 'lucide-react';
import { flattenSelections } from '../lib/configEngine';

export function OrderTracker() {
  const { orderId, restId, tableId, sessionId } = useParams();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId || !restId || !tableId) return;
    localStorage.setItem(`last_order_${restId}_${tableId}`, orderId);

    const fetchSessionData = async () => {
      try {
        // Resolve table UUID if tableId is a slug
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tableId || '');
        let actualTableId = tableId;

        if (!isUuid && tableId) {
          const tRes = await fetch(`/api/public/tables/${tableId}?restId=${restId}`);
          if (tRes.ok) {
            const tData = await tRes.json();
            if (tData) actualTableId = tData.id;
          }
        }

        // 1. Get the current order to find session_id
        const orderRes = await fetch(`/api/public/orders/${orderId}?sessionId=${sessionId}`);
        if (!orderRes.ok) throw new Error("Order not found");
        const mainOrder = await orderRes.json();

        if (!mainOrder) {
          setLoading(false);
          return;
        }

        // 2. If it has a session, fetch all orders in that session
        let allOrders = [mainOrder];
        const targetSessionId = sessionId || mainOrder.session_id;
        
        if (targetSessionId) {
          const sRes = await fetch(`/api/public/dining-sessions/${targetSessionId}/orders`);
          if (sRes.ok) {
            const sessionOrders = await sRes.json();
            if (sessionOrders) allOrders = sessionOrders;
          }
        }

      setOrders(allOrders.map(o => ({
        id: o.id,
        tableId: o.table_id,
        tableName: (o as any).tables?.name || o.table_id.slice(-4).toUpperCase(),
        orderType: o.order_type === 'dine_in' ? 'dine_in' : (o.order_type || 'dine_in'),
        status: o.status as OrderStatus,
        totalPrice: parseFloat(o.total_price),
        paymentMethod: o.payment_method || 'counter',
        items: o.items,
        paid_at: o.paid_at,
        session_status: (o as any).dining_sessions?.status,
        createdAt: { toDate: () => new Date(o.created_at) }
      })) as any);

      } catch (err) {
        console.error('Fetch session data failed:', err);
      } finally {
        setLoading(false);
      }
    };


    fetchSessionData();
  }, [orderId, restId]);

  if (loading) return <div className="h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div></div>;
  if (orders.length === 0) return <div className="p-20 text-center font-bold">Order not found.</div>;

  const currentOrder = orders.find(o => o.id === orderId) || orders[orders.length - 1];
  const sessionStatus = (currentOrder as any).session_status;
  const isSessionClosed = sessionStatus === 'closed' || sessionStatus === 'expired' || sessionStatus === 'replaced';

  const steps: OrderStatus[] = ['pending', 'confirmed', 'cooking', 'ready', 'served', 'completed'];
  const currentIndex = steps.indexOf(currentOrder.status);

  const getStatusInfo = (status: OrderStatus) => {
    switch (status) {
      case 'pending': return { icon: Clock, text: 'Order Sent', color: 'text-yellow-500' };
      case 'confirmed': return { icon: CheckCircle2, text: 'Accepted', color: 'text-blue-500' };
      case 'cooking': return { icon: ChefHat, text: 'Cooking Now', color: 'text-orange-500' };
      case 'ready': return { icon: CheckCircle2, text: 'Ready', color: 'text-green-500' };
      case 'served': return { icon: CheckCircle2, text: currentOrder.orderType === 'takeaway' ? 'Picked Up' : 'Served', color: 'text-gray-900' };
      case 'completed': return { icon: CheckCircle2, text: 'Enjoy!', color: 'text-gray-900' };
      default: return { icon: Clock, text: 'Wait...', color: 'text-gray-400' };
    }
  };

  const statusInfo = getStatusInfo(currentOrder.status);
  
  const unpaidOrders = orders.filter(o => !o.paid_at && o.status !== 'cancelled');
  const totalPrice = orders.reduce((sum, o) => sum + (o.status !== 'cancelled' ? o.totalPrice : 0), 0);
  const unpaidTotal = unpaidOrders.reduce((sum, o) => sum + o.totalPrice, 0);
  
  const isUnpaid = unpaidTotal > 0;
  const isCompleted = orders.every(o => o.status === 'completed' || o.status === 'cancelled') && !isUnpaid;

  return (
    <div className="max-w-md mx-auto min-h-screen p-6 bg-white pb-32">
      {/* Session Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="text-left">
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Table {currentOrder.tableName}</p>
          <h2 className="text-sm font-bold text-zinc-900">Session History</h2>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Total Bill</p>
          <h2 className="text-sm font-bold text-orange-600">RM {(totalPrice || 0).toFixed(2)}</h2>
        </div>
      </div>
      {isUnpaid && (
        <div className="w-full bg-orange-600 p-6 rounded-[2.5rem] mb-12 flex flex-col items-center shadow-2xl shadow-orange-600/30">
          <div className="flex items-center gap-2 mb-4 bg-white/10 px-3 py-1 rounded-full text-[10px] font-black text-white uppercase tracking-widest">
            <Clock size={12} />
            <span>Unpaid Balance</span>
          </div>
          <h2 className="text-4xl font-black text-white mb-6 tracking-tighter">RM {(unpaidTotal || 0).toFixed(2)}</h2>
          <button 
            onClick={() => navigate(`/restaurant/${restId}/table/${tableId}/order/${currentOrder.id}/checkout`)}
            className="w-full h-14 bg-white text-orange-600 rounded-2xl text-sm font-black uppercase tracking-wider hover:bg-orange-50 transition-all shadow-xl active:scale-[0.98]"
          >
            Pay Now (Online)
          </button>
          <p className="mt-4 text-[10px] font-bold text-white/50 uppercase tracking-widest">Processing via DuitNow/TNG</p>
        </div>
      )}

      {isCompleted && (
        <div className="w-full bg-emerald-500 p-8 rounded-[2.5rem] mb-12 flex flex-col items-center shadow-2xl shadow-emerald-500/20">
          <div className="w-16 h-16 bg-white/20 text-white rounded-full flex items-center justify-center mb-4">
            <CheckCircle2 size={32} />
          </div>
          <h2 className="text-2xl font-black text-white mb-2">Dining Complete</h2>
          <p className="text-white/80 text-sm font-medium mb-6 text-center">Your session is settled. Hope to see you again!</p>
          <div className="w-full bg-white rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex justify-between items-center text-[10px] font-black text-zinc-400 uppercase tracking-widest">
              <span>Final Settlement</span>
              <span className="text-emerald-600">PAID</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-zinc-900">Total Charged</span>
              <span className="text-sm font-mono font-bold text-zinc-900">RM {(totalPrice || 0).toFixed(2)}</span>
            </div>
            <button 
              onClick={() => navigate(`/restaurant/${restId}/table/${tableId}/order/${orderId}/success`)}
              className="mt-2 text-[10px] font-black text-emerald-600 uppercase tracking-widest hover:underline flex items-center justify-center gap-1"
            >
              <Receipt size={12} />
              View Digital Receipt
            </button>
          </div>
          <button
            onClick={() => {
              const tableId = orders[0]?.tableId;
              if (tableId) {
                navigate(`/restaurant/${restId}/table/${tableId}`);
              } else {
                navigate(`/restaurant/${restId}`);
              }
            }}
            className="w-full h-14 bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all mt-6 shadow-lg shadow-emerald-700/20"
          >
            Order More / New Session
          </button>
        </div>
      )}

      <div className="flex flex-col items-center text-center">
        <div className="w-24 h-24 bg-orange-50 rounded-[2.5rem] flex items-center justify-center mb-8 relative">
          <statusInfo.icon size={48} className={`${currentOrder.status === 'cooking' ? 'animate-pulse' : ''} ${statusInfo.color}`} />
          <div className="absolute -bottom-2 -right-2 bg-gray-900 text-white w-8 h-8 rounded-full flex items-center justify-center font-black text-xs">
            #{currentOrder.id.slice(-4).toUpperCase()}
          </div>
        </div>

        <h1 className="text-4xl font-black text-gray-900 tracking-tighter mb-2">{statusInfo.text}</h1>
        <p className="text-gray-400 font-medium mb-12 capitalize">{currentOrder.status} order status</p>

        {/* Progress Bar for Current Order */}
        <div className="w-full relative py-8 px-4 mb-12">
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
                <div key={idx} className="flex flex-col items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                    isActive ? 'bg-orange-500 text-white' : 'bg-white border-2 border-gray-100 text-gray-200'
                  }`}>
                    <StepIcon size={14} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* List of all orders in session */}
      <div className="space-y-4">
        {orders.map((o, sessionIdx) => (
          <div key={o.id} className={`bg-gray-50 rounded-3xl p-5 border ${o.id === orderId ? 'border-orange-200 bg-orange-50/30' : 'border-gray-100'}`}>
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-white bg-zinc-900 px-2 py-0.5 rounded-full">#{o.id.slice(-4).toUpperCase()}</span>
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Order {sessionIdx + 1}</span>
              </div>
              <span className={`text-[10px] font-black uppercase tracking-widest ${o.paid_at ? 'text-emerald-600' : 'text-orange-600'}`}>
                {o.paid_at ? 'Paid' : 'Unpaid'}
              </span>
            </div>
            
            <div className="space-y-3">
              {o.items.map((item, idx) => (
                <div key={idx} className="space-y-1">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-black text-zinc-900">{item.quantity}x</span>
                      <span className="text-xs font-bold text-zinc-700">{item.name}</span>
                    </div>
                    <span className="text-[10px] font-bold text-zinc-400">RM {((item.price || 0) * (item.quantity || 1)).toFixed(2)}</span>
                  </div>
                  {item.smartRenderedLines?.customer && (
                    <div className="pl-7 space-y-0.5">
                      {item.smartRenderedLines.customer.map((line, i) => (
                        <p key={i} className="text-[10px] text-gray-400 font-medium leading-none">{line}</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            <div className="mt-4 pt-4 border-t border-dashed border-zinc-200 flex justify-between items-center">
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Order Total</span>
                <span className="text-sm font-black text-zinc-900">RM {(o.totalPrice || 0).toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
      
      {!isSessionClosed && (
        <button
          onClick={() => navigate(`/restaurant/${restId}/table/${currentOrder.tableId}`)}
          className="mt-8 mb-4 w-full bg-gray-900 text-white py-6 rounded-[2.5rem] font-black text-lg hover:bg-black transition-all shadow-xl flex items-center justify-center gap-3 active:scale-[0.98]"
        >
          <Plus size={20} />
          Add More Items
        </button>
      )}

      <p className="text-xs text-gray-400 font-bold uppercase tracking-widest text-center">
        Need help? Ask our staff
      </p>
    </div>
  );
}
