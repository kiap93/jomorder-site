import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { indexedDbStorage } from '../lib/indexedDbStorage';
import { guestSupabase as supabase } from '../lib/supabase';

import { Order } from '../types';
import { OrderStatus } from '../enums';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChefHat, 
  CheckCircle2, 
  Clock, 
  Plus, 
  Receipt, 
  ChevronDown, 
  ChevronUp, 
  Bell, 
  HelpCircle, 
  Wallet, 
  Utensils, 
  Sparkles,
  ArrowRight,
  Info
} from 'lucide-react';
import { getApiUrl, getOrderDisplayNo } from '../lib/api';
import { useLanguageStore } from '../store/useLanguageStore';

export function OrderTracker() {
  const { orderId, restId, tableId, sessionId } = useParams();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [paymentSettings, setPaymentSettings] = useState<{ provider?: string; enabled_methods?: string[] } | null>(null);
  const { t } = useLanguageStore();

  const [callingStaff, setCallingStaff] = useState(false);
  const [staffCalledMessage, setStaffCalledMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId || !restId || !tableId) return;
    indexedDbStorage.setItem(`last_order_${restId}_${tableId}`, orderId);

    let activeChannel: any = null;

    const fetchSessionData = async () => {
      try {
        // Fetch public payment settings
        try {
          const settingsRes = await fetch(getApiUrl(`/api/restaurants/${restId}/public-payment-settings`));
          if (settingsRes.ok) {
            const settingsData = await settingsRes.json();
            setPaymentSettings(settingsData);
          }
        } catch (settingsErr) {
          console.error('[OrderTracker] Fetch payment settings failed:', settingsErr);
        }

        // Resolve table UUID if tableId is a slug
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tableId || '');
        let actualTableId = tableId;

        if (!isUuid && tableId) {
          const tRes = await fetch(getApiUrl(`/api/public/tables/${tableId}?restId=${restId}`));
          if (tRes.ok) {
            const tData = await tRes.json();
            if (tData) actualTableId = tData.id;
          }
        }

        // 1. Get the current order to find session_id
        const orderRes = await fetch(getApiUrl(`/api/public/orders/${orderId}?sessionId=${sessionId}`));
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
          const sRes = await fetch(getApiUrl(`/api/public/dining-sessions/${targetSessionId}/orders`));
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
          session_id: o.session_id,
          session_status: (o as any).dining_sessions?.status,
          createdAt: { toDate: () => new Date(o.created_at) }
        })) as any);

        // Setup real-time listener if not already initialized
        if (!activeChannel) {
          const channelName = `tracker-${orderId}-${Math.random().toString(36).slice(2)}`;
          const filter = targetSessionId 
            ? `session_id=eq.${targetSessionId}` 
            : `id=eq.${orderId}`;

          activeChannel = supabase
            .channel(channelName)
            .on('postgres_changes', {
              event: '*',
              schema: 'public',
              table: 'orders',
              filter: filter
            }, () => {
              console.log(`[OrderTracker] Real-time order change detected! Refreshing data...`);
              fetchSessionData();
            })
            .subscribe();
        }

      } catch (err) {
        console.error('Fetch session data failed:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSessionData();

    const handleFocus = () => {
      console.log("[OrderTracker] Window focused, refreshing tracker data...");
      fetchSessionData();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      if (activeChannel) {
        supabase.removeChannel(activeChannel);
      }
      window.removeEventListener('focus', handleFocus);
    };
  }, [orderId, restId, tableId, sessionId]);

  if (loading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-orange-600 dark:border-orange-500 mb-4" />
        <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Loading your order journey...</p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-zinc-50 dark:bg-zinc-950">
        <div className="p-4 bg-red-100 dark:bg-red-950/30 rounded-full text-red-500 mb-4">
          <Info size={32} />
        </div>
        <h2 className="text-lg font-black text-zinc-900 dark:text-zinc-100">Order Journey Missing</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 max-w-sm">We couldn't retrieve records for this order ID in our dining base. Contact counter support if this persists.</p>
        <button 
          onClick={() => navigate(`/restaurant/${restId}/table/${tableId}`)}
          className="mt-6 px-6 py-3 bg-zinc-900 hover:bg-black dark:bg-zinc-805 dark:hover:bg-zinc-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition"
        >
          Return to Menu
        </button>
      </div>
    );
  }

  const currentOrder = orders.find(o => o.id === orderId) || orders[orders.length - 1];
  const sessionStatus = (currentOrder as any).session_status;
  const isSessionClosed = sessionStatus === 'closed' || sessionStatus === 'expired' || sessionStatus === 'replaced';

  // Calculations for general layout
  const unpaidOrders = orders.filter(o => !o.paid_at && o.status !== OrderStatus.CANCELLED);
  const totalPrice = orders.reduce((sum, o) => sum + (o.status !== OrderStatus.CANCELLED ? o.totalPrice : 0), 0);
  const unpaidTotal = unpaidOrders.reduce((sum, o) => sum + o.totalPrice, 0);
  const isUnpaid = unpaidTotal > 0;
  const isCompleted = orders.every(o => o.status === OrderStatus.COMPLETED || o.status === OrderStatus.CANCELLED) && !isUnpaid;

  const isCashOnly = paymentSettings?.provider === 'none' || 
    (paymentSettings?.enabled_methods?.length === 1 && paymentSettings?.enabled_methods[0] === 'cash') ||
    (paymentSettings && !paymentSettings.provider);

  // Status mapping
  const getStatusBadgeConfig = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.PENDING:
        return { text: 'Received', bg: 'bg-blue-50 text-blue-750 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-100/50 dark:border-blue-900/30' };
      case OrderStatus.CONFIRMED:
        return { text: 'Accepted', bg: 'bg-indigo-50 text-indigo-750 dark:bg-indigo-950/40 dark:text-indigo-400 border border-indigo-100/50 dark:border-indigo-900/30' };
      case OrderStatus.COOKING:
        return { text: 'Preparing', bg: 'bg-orange-50 text-orange-750 dark:bg-orange-950/40 dark:text-orange-400 border border-orange-100/50 dark:border-orange-900/30' };
      case OrderStatus.READY:
        return { text: 'Ready', bg: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-100/50 dark:border-emerald-900/30' };
      case OrderStatus.SERVED:
      case OrderStatus.COMPLETED:
        return { text: 'Completed', bg: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/30' };
      case OrderStatus.CANCELLED:
        return { text: 'Cancelled', bg: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border border-red-100/50 dark:border-red-900/30' };
      default:
        return { text: 'Unknown', bg: 'bg-zinc-100 text-zinc-600' };
    }
  };

  const currentDisplayNo = getOrderDisplayNo(currentOrder.id, currentOrder.createdAt);
  const currentTableLabel = currentOrder.tableName;

  const handleCallStaff = async () => {
    setCallingStaff(true);
    setStaffCalledMessage(null);
    
    try {
      // Connect and send a broadcast message to the staff channel
      const channel = supabase.channel(`assistance-${restId}`);
      await channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.send({
            type: 'broadcast',
            event: 'assistance_requested',
            payload: {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              tableId: tableId,
              tableName: currentTableLabel,
              restId: restId,
              orderId: orderId,
              timestamp: new Date().toISOString()
            }
          });
          supabase.removeChannel(channel);
        }
      });
    } catch (err) {
      console.error('[OrderTracker] Failed to broadcast assistance request:', err);
    }

    setTimeout(() => {
      setCallingStaff(false);
      setStaffCalledMessage(`🛎 A team representative has been dispatched to Table ${currentTableLabel}. We'll be with you shortly!`);
    }, 1200);
  };

  // Grouping orders for clean sections: Active (anything not Completed/Cancelled) & Past History
  const activeOrders = orders.filter(o => o.status !== OrderStatus.COMPLETED && o.status !== OrderStatus.CANCELLED);
  const historyOrders = orders.filter(o => o.status === OrderStatus.COMPLETED || o.status === OrderStatus.CANCELLED);

  const getOrderTimeStr = (createdAt: any) => {
    if (!createdAt) return 'Just Now';
    try {
      const date = typeof createdAt.toDate === 'function' ? createdAt.toDate() : new Date(createdAt);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return 'Just Now';
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 pb-20 font-sans selection:bg-orange-500 selection:text-white">
      {/* 1. Page Header (Sticky top section, compact, soft shadow) */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-b border-zinc-100 dark:border-zinc-800 shadow-sm transition-colors duration-200">
        <div className="max-w-2xl mx-auto px-5 py-3 sm:py-4 flex items-center justify-between">
          <div className="text-left">
            <h1 className="text-lg sm:text-xl font-black tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              My Orders 
              <span className="text-xs font-bold text-orange-500 bg-orange-50 dark:bg-orange-950/50 px-2.5 py-0.5 rounded-full">
                Table {currentTableLabel}
              </span>
            </h1>
            <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mt-0.5">
              Track your order status in real time
            </p>
          </div>
          
          <div className="text-right">
            <p className="text-[9px] font-black tracking-widest text-zinc-400 uppercase">
              Cumulative Bill
            </p>
            <p className="text-base font-black text-orange-600 dark:text-orange-500">
              RM {(totalPrice || 0).toFixed(2)}
            </p>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-2xl mx-auto px-4 mt-6 space-y-6">

        {/* 2. Unified Payment Summary Banner */}
        {isUnpaid && (
          <div className="overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800 shadow-sm rounded-3xl p-5 sm:p-6 text-left transition-colors">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                  <Clock size={12} className="text-zinc-500" />
                  Unpaid Balance
                </span>
                <p className="text-3xl font-black text-zinc-900 dark:text-white mt-2">
                  RM {(unpaidTotal || 0).toFixed(2)}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  Settle session bill securely from your table
                </p>
              </div>

              {isCashOnly ? (
                /* Dynamic cash only warning style */
                <div className="flex-1 max-w-sm sm:max-w-xs flex gap-3 p-4 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900/30 rounded-2xl items-center text-xs font-bold uppercase tracking-wider text-yellow-800 dark:text-yellow-400">
                  <span className="text-2xl">💵</span>
                  <div>
                    <p className="text-zinc-850 dark:text-zinc-200 leading-tight">Cash Payment Required</p>
                    <p className="text-[10px] text-zinc-450 dark:text-zinc-400 mt-0.5 lowercase font-medium tracking-normal">Cash only. Please pay at the counter.</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2 shrink-0">
                  <button 
                    onClick={() => {
                      const activeSessionId = (currentOrder as any)?.session_id || sessionId;
                      if (activeSessionId) {
                        navigate(`/restaurant/${restId}/table/${tableId}/session/${activeSessionId}/order/${currentOrder.id}/checkout`);
                      } else {
                        navigate(`/restaurant/${restId}/table/${tableId}/order/${currentOrder.id}/checkout`);
                      }
                    }}
                    className="h-12 px-6 bg-orange-600 hover:bg-orange-500 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-orange-600/10 active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <span>Pay Now (Online)</span>
                    <ArrowRight size={14} />
                  </button>
                  <p className="text-center text-[9px] font-black uppercase tracking-widest text-zinc-400">
                    Supports DuitNow QR / TNG
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3. Fully Completed Session Success Banner */}
        {isCompleted && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 p-6 rounded-[2rem] text-center space-y-4">
            <div className="w-12 h-12 bg-emerald-500 text-white rounded-2xl flex items-center justify-center mx-auto shadow-md shadow-emerald-500/20">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <h2 className="text-lg font-black text-emerald-950 dark:text-emerald-400">Dining Complete</h2>
              <p className="text-zinc-500 dark:text-zinc-400 text-xs font-medium mt-1 max-w-sm mx-auto">
                Your table session is fully settled and verified. Thank you for dining with us!
              </p>
            </div>
            
            <div className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-800 rounded-2xl p-4 max-w-md mx-auto flex items-center justify-between text-xs">
              <div className="text-left">
                <p className="font-bold text-zinc-400 uppercase tracking-wider text-[9px]">Settle Status</p>
                <p className="font-black text-emerald-600 dark:text-emerald-400 text-sm mt-0.5">FULLY RESOLVED</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-zinc-400 uppercase tracking-wider text-[9px]">Bill Total</p>
                <p className="font-black text-zinc-900 dark:text-zinc-100 text-sm mt-0.5">RM {(totalPrice || 0).toFixed(2)}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
              <button 
                onClick={() => navigate(`/restaurant/${restId}/table/${tableId}/order/${orderId}/success`)}
                className="inline-flex items-center justify-center gap-1.5 px-4 h-11 border border-zinc-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-bold text-zinc-750 dark:text-zinc-200 rounded-xl hover:bg-zinc-50 transition"
              >
                <Receipt size={14} />
                View Digital Receipt
              </button>
              
              <button
                onClick={() => {
                  const tableId = orders[0]?.tableId;
                  if (tableId) {
                    navigate(`/restaurant/${restId}/table/${tableId}`);
                  } else {
                    navigate(`/restaurant/${restId}`);
                  }
                }}
                className="inline-flex items-center justify-center px-5 h-11 bg-emerald-600 text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-emerald-700 transition"
              >
                Order More / New Session
              </button>
            </div>
          </div>
        )}

        {/* 4. Active Orders Section */}
        {activeOrders.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400 flex items-center justify-between px-1">
              <span>Active Orders ({activeOrders.length})</span>
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
            </h3>

            {activeOrders.map((o) => {
              const displayNum = getOrderDisplayNo(o.id, o.createdAt);
              const statusConf = getStatusBadgeConfig(o.status);

              return (
                <div 
                  key={o.id} 
                  className={`bg-white dark:bg-zinc-900 border ${
                    o.id === orderId 
                      ? 'border-orange-500 dark:border-orange-500 ring-1 ring-orange-500/20' 
                      : 'border-zinc-200/60 dark:border-zinc-800'
                  } shadow-sm rounded-3xl p-5 sm:p-6 text-left transition-all duration-300`}
                >
                  {/* Order Card Header */}
                  <div className="flex items-start justify-between gap-4 border-b border-zinc-150 dark:border-zinc-800/80 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-zinc-900 dark:text-white">
                          Order #{displayNum}
                        </span>
                      </div>
                      <p className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500 mt-1 uppercase tracking-wide">
                        Placed on {getOrderTimeStr(o.createdAt)}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest ${statusConf.bg}`}>
                        {statusConf.text}
                      </span>
                    </div>
                  </div>

                  {/* Order Items section */}
                  <div className="py-4 space-y-3.5">
                    <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
                      Ordered Items
                    </p>
                    
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-805">
                      {o.items.map((item, idx) => (
                        <div key={idx} className="py-2.5 flex items-start gap-3 first:pt-0 last:pb-0">
                          <span className="text-sm font-black text-orange-500 w-6">
                            {item.quantity}×
                          </span>
                          
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-zinc-850 dark:text-zinc-150 leading-tight">
                              {item.name}
                            </p>
                            {item.smartRenderedLines?.customer && (
                              <div className="mt-1 space-y-0.5 pl-1 border-l-2 border-zinc-200 dark:border-zinc-800">
                                {item.smartRenderedLines.customer.map((line, i) => (
                                  <p key={i} className="text-[10px] text-zinc-400 font-medium leading-tight">
                                    {line}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>

                          <span className="text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 shrink-0">
                            RM {((item.price || 0) * (item.quantity || 1)).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Card footer summary total price */}
                  <div className="pt-4 border-t border-zinc-150 dark:border-zinc-800/80 flex justify-between items-center text-xs">
                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                      Order Subtotal
                    </span>
                    <span className="text-sm font-black text-zinc-900 dark:text-zinc-100">
                      RM {(o.totalPrice || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 5. Optional Past Order History Section */}
        {historyOrders.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400 px-1">
              Past Orders ({historyOrders.length})
            </h3>

            <div className="space-y-3">
              {historyOrders.map((o) => {
                const displayNum = getOrderDisplayNo(o.id, o.createdAt);
                const statusConf = getStatusBadgeConfig(o.status);

                return (
                  <div 
                    key={o.id} 
                    className="bg-zinc-100/50 dark:bg-zinc-900/40 border border-zinc-200/40 dark:border-zinc-900/60 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-left transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">
                          Order #{displayNum}
                        </span>
                        <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${statusConf.bg}`}>
                          {statusConf.text}
                        </span>
                        {o.paid_at && (
                          <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 px-1.5 py-0.5 rounded uppercase tracking-wider">
                            Paid
                          </span>
                        )}
                      </div>
                      
                      <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 mt-1">
                        Settle amount: <span className="font-bold text-zinc-800 dark:text-zinc-200">RM {o.totalPrice.toFixed(2)}</span> ({o.items?.length || 0} items)
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/restaurant/${restId}/table/${tableId}/order/${o.id}/success`)}
                        className="text-[10px] font-black uppercase tracking-wider text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 py-1.5 px-3 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-white dark:hover:bg-zinc-900 transition"
                      >
                        Receipt
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 6. Dynamic Assistance Action & Request Assistance Panel */}
        <section className="bg-white dark:bg-zinc-900 border border-zinc-150 dark:border-zinc-805/85 rounded-3xl p-5 sm:p-6 text-center space-y-4">
          <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-801 text-zinc-650 dark:text-zinc-350 rounded-2xl flex items-center justify-center mx-auto">
            <HelpCircle size={20} />
          </div>
          <div>
            <h4 className="text-sm font-extrabold text-zinc-900 dark:text-zinc-50">Need Assistance?</h4>
            <p className="text-[11px] text-zinc-400 mt-1 max-w-xs mx-auto">
              Our floor staff is available. Tap below to immediately notify a waiter to table {currentTableLabel}.
            </p>
          </div>

          <button
            onClick={handleCallStaff}
            disabled={callingStaff}
            className="inline-flex items-center justify-center gap-2 h-11 px-6 border border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 hover:bg-zinc-55 dark:hover:bg-zinc-800 text-xs font-black uppercase tracking-wider text-zinc-750 dark:text-zinc-200 rounded-xl transition duration-150 disabled:opacity-50"
          >
            <Bell size={13} className={callingStaff ? 'animate-bounce text-orange-500' : ''} />
            <span>{callingStaff ? 'Dispatching...' : 'Request Assistance'}</span>
          </button>

          <AnimatePresence>
            {staffCalledMessage && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-3 p-3 bg-orange-500/10 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 rounded-xl text-[11px] font-bold text-center leading-relaxed"
              >
                {staffCalledMessage}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* 7. Footer controls / Extra action list */}
        {!isSessionClosed && (
          <div className="pt-2 text-center">
            <button
              onClick={() => navigate(`/restaurant/${restId}/table/${currentOrder.tableId}`)}
              className="w-full inline-flex items-center justify-center gap-2 bg-zinc-950 hover:bg-zinc-850 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-950 h-14 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl transition-all active:scale-[0.98]"
            >
              <Plus size={18} />
              <span>Add More Items</span>
            </button>
          </div>
        )}

      </main>
    </div>
  );
}
