import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getApiUrl, getOrderDisplayNo } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { Order, Restaurant } from '../types';
import { OrderStatus, OrderType } from '../enums';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Filter, Check, X, Clock, Banknote, Printer } from 'lucide-react';
import { CashCalculator } from '../components/CashCalculator';
import { PaymentWorkspace } from '../components/PaymentWorkspace';
import { flattenSelections } from '../lib/configEngine';
import { offlineService } from '../lib/offlineService';
import { useLanguageStore } from '../store/useLanguageStore';
import { printerService } from '../services/printerService';

export function PosDashboard() {
  const { restId } = useParams();
  const { user, loading: loadingAuth } = useAuthStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const { t } = useLanguageStore();
  
  const filter = searchParams.get('filter') || 'active';
  const setFilter = (newFilter: string) => {
    setSearchParams({ filter: newFilter });
  };
  
  const [confirmingCancel, setConfirmingCancel] = useState<string | null>(null);
  const [settlingOrder, setSettlingOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    if (!restId || loadingAuth) return;
    if (!user) return;

    // Fetch Restaurant Details
    const token = useAuthStore.getState().token;
    if (!token) return;

    fetch(getApiUrl(`/api/restaurants/${restId}`), {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data && !data.error) {
          setRestaurant({
            id: data.id,
            name: data.name,
            currency: data.currency,
            serviceCharge: parseFloat(data.service_charge) / 100,
            sst: parseFloat(data.sst) / 100,
            franchiseId: data.franchise_id
          } as any);
        }
      });

    let fetchTimeout: NodeJS.Timeout;
    let loadingTimer: NodeJS.Timeout;

    // 1. Initial Fetch
    const fetchOrders = async () => {
      // Set a safety timeout to stop loading spinner even if query hangs
      loadingTimer = setTimeout(() => {
        setLoading(false);
        if (orders.length === 0) {
          setError("Data fetch is taking longer than expected. Please check your connection or refresh.");
        }
      }, 10000);

      try {
        const url = getApiUrl(`/api/restaurants/${restId}/orders`);
        console.log("Fetching orders from:", url);
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
          const bodyText = await response.text();
          let errorData;
          try {
            errorData = JSON.parse(bodyText);
          } catch (e) {
            console.error("Failed to parse error JSON. Body:", bodyText);
            throw new Error(`Server returned status ${response.status}: ${bodyText.slice(0, 50)}`);
          }
          throw new Error(errorData.error || `Failed to fetch orders (Status ${response.status})`);
        }

        const bodyText = await response.text();
        let data;
        try {
          data = JSON.parse(bodyText);
        } catch (e) {
          console.error("JSON parse failed. Body snippet:", bodyText.slice(0, 100));
          throw new Error(`Invalid JSON response: ${bodyText.slice(0, 50)}`);
        }

        clearTimeout(loadingTimer);

        if (data) {
          const fetchedOrders = data.map((o: any) => ({
            id: o.id,
            tableId: o.table_id,
            tableName: (o as any).tables?.name || o.table_id?.slice(-4).toUpperCase() || 'TAKEAWAY',
            orderType: o.order_type,
            status: o.status as OrderStatus,
            totalPrice: parseFloat(o.total_price),
            paidAmount: ((o as any).payments || []).reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0),
            paymentMethod: o.payment_method,
            items: o.items,
            paid_at: o.paid_at,
            createdAt: o.created_at,
            sessionId: o.session_id
          }));

          setOrders(fetchedOrders);
          setError(null);

          // Silent persistent sync of loaded orders into IndexedDB for offline queries!
          try {
            await offlineService.repository.saveOrders(fetchedOrders.map((o: any) => ({
              id: o.id,
              table_id: o.tableId,
              status: o.status,
              total_amount: o.totalPrice,
              items: o.items,
              p_session_id: o.sessionId,
              created_at: o.createdAt,
              updated_at: new Date().toISOString(),
              version: 1
            })));
          } catch (persistErr) {
            console.warn("Cached orders save non-fatal IndexedDB error", persistErr);
          }
        }
      } catch (err: any) {
        console.warn("Fetch orders exception, attempting fallback to cached IndexedDB:", err);
        clearTimeout(loadingTimer);
        try {
          const cachedOrders = await offlineService.getLocalOrders();
          if (cachedOrders && cachedOrders.length > 0) {
            setOrders(cachedOrders.map(o => ({
              id: o.id,
              tableId: o.table_id || '',
              tableName: o.table_id ? o.table_id.slice(-4).toUpperCase() : 'TAKEAWAY',
              orderType: 'dine_in',
              status: o.status as OrderStatus,
              totalPrice: o.total_amount || 0,
              paidAmount: o.status === 'completed' ? (o.total_amount || 0) : 0,
              paymentMethod: 'cash',
              items: o.items || [],
              paid_at: o.status === 'completed' ? new Date().toISOString() : undefined,
              createdAt: o.created_at,
              sessionId: o.p_session_id || ''
            })) as any);
            setError(null);
          } else {
            setError(err.message || "Working Offline: No order records found in current cache.");
          }
        } catch (dbErr) {
          console.error("IndexedDB error walking cached orders:", dbErr);
          setError(err.message || "An unexpected error occurred");
        }
      } finally {
        setLoading(false);
      }
    };

    const debouncedFetch = () => {
      clearTimeout(fetchTimeout);
      fetchTimeout = setTimeout(fetchOrders, 300);
    };

    fetchOrders();

    // 2. Refresh on Focus
    let lastFocusRefresh = 0;
    const handleFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefresh < 30000) return; // 30s throttle
      lastFocusRefresh = now;
      
      console.log("POS: Window focused, refreshing orders...");
      fetchOrders();
    };
    window.addEventListener('focus', handleFocus);

    // 3. Realtime Subscription
    const channelName = `pos-${restId}-${Math.random().toString(36).slice(2)}`;
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
  }, [restId, refreshTrigger]);

  const updateStatus = async (orderId: string, status: OrderStatus) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    // Optimistically update the status in local state for instant real-time response!
    setOrders(prevOrders =>
      prevOrders.map(o => o.id === orderId ? { ...o, status } : o)
    );

    try {
      const response = await fetch(getApiUrl(`/api/orders/${orderId}`), {
        method: 'PATCH',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status, updated_at: new Date().toISOString() })
      });
      if (!response.ok) {
        console.error("Failed to update status on server:", await response.text());
        // Trigger a background refetch to correct any drift
        setRefreshTrigger(prev => prev + 1);
      } else {
        // Trigger a fresh state sync to match the backend perfect source of truth
        setRefreshTrigger(prev => prev + 1);
      }
    } catch (err) {
      console.error("Error updating status:", err);
      setRefreshTrigger(prev => prev + 1);
    }
  };

  const closeSession = async (sessionId: string, tableId: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    // 1. Mark session as closed
    await fetch(getApiUrl(`/api/dining-sessions/${sessionId}`), {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'closed', closed_at: new Date().toISOString() })
    });

    // 2. Clear the table status
    await fetch(getApiUrl(`/api/tables/${tableId}`), {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ current_session_id: null, status: 'available' })
    });
  };

  const [printingOrders, setPrintingOrders] = useState<Record<string, boolean>>({});

  const handlePrintOrderKOT = async (order: Order) => {
    if (!restaurant?.id) return;
    setPrintingOrders(prev => ({ ...prev, [order.id]: true }));
    try {
      // Find if there is an existing print job for this order in Supabase
      const { data: jobs, error } = await supabase
        .from('print_jobs')
        .select('*')
        .eq('order_id', order.id);

      if (jobs && jobs.length > 0) {
        // We found existing jobs! Print each one through printerService
        for (const j of jobs) {
          const formattedJob = {
            id: j.id,
            restaurantId: j.restaurant_id,
            orderId: j.order_id,
            printerId: j.printer_id,
            idempotencyKey: j.idempotency_key,
            type: j.type as any,
            status: j.status as any,
            retries: j.retries,
            payload: j.payload,
            reprintCount: j.reprint_count || 0,
            createdAt: j.created_at,
            updatedAt: j.updated_at
          };
          const html = printerService.renderKOTHtml(formattedJob.payload);
          await printerService.printHtml(html);
        }
      } else {
        // No existing jobs, format and push queue with autoPrint = true
        await printerService.routeAndQueueOrder(restaurant.id, order, undefined, true);
      }
    } catch (err) {
      console.error("Failed to print KOT from POS dashboard, using fallback", err);
      try {
        await printerService.routeAndQueueOrder(restaurant.id, order, undefined, true);
      } catch (fallbackErr) {
        console.error("Fallback KOT print failed too", fallbackErr);
      }
    } finally {
      setPrintingOrders(prev => ({ ...prev, [order.id]: false }));
    }
  };

  const filteredOrders = orders.filter(o => {
    if (filter === 'active') return o.status !== 'completed' && o.status !== 'cancelled';
    if (filter === 'paid') return !!(o as any).paid_at;
    if (filter === 'payments') return o.status !== 'completed' && o.status !== 'cancelled' && ((o as any).paidAmount || 0) < o.totalPrice;
    return o.status === filter;
  });

  if (loading && orders.length === 0) return (
    <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
      <p className="text-gray-400 font-bold text-xs uppercase tracking-widest animate-pulse">{t('pos.scanningOrders')}</p>
    </div>
  );

  if (error && orders.length === 0) return (
    <div className="h-[60vh] flex flex-col items-center justify-center p-8 text-center bg-white rounded-[3rem] border border-gray-100 shadow-sm mx-4">
      <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-6 font-black text-4xl">!</div>
      <h2 className="text-2xl font-black text-gray-900 mb-2">{t('pos.error')}</h2>
      <p className="text-gray-500 font-medium mb-8 max-w-xs mx-auto">{error}</p>
      <button 
        onClick={() => window.location.reload()}
        className="bg-gray-900 text-white px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-black transition-all shadow-xl"
      >
        {t('pos.refresh')}
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-3 rounded-lg shadow-sm border border-gray-100">
         <div>
          <h1 className="text-lg font-black text-gray-900 tracking-tight capitalize leading-none mb-1">
            {t('pos.queue', { filter: t(`status.${filter}`) || filter })}
          </h1>
          <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest leading-none">{t('pos.opsMonitor')}</p>
        </div>
        <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg overflow-x-auto scrollbar-none">
          {['active', 'paid', 'pending', 'confirmed', 'cooking', 'ready', 'served', 'completed', 'cancelled'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-tighter transition-all ${
                filter === f ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t(`status.${f}`) || f}
            </button>
          ))}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
        <AnimatePresence>
          {filteredOrders.map(order => (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              key={order.id}
              className="bg-white rounded-lg overflow-hidden border border-gray-100 shadow-sm hover:shadow-md transition-shadow flex flex-col"
            >
              <div className="p-2 border-b flex justify-between items-center bg-gray-50/50">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="bg-gray-900 text-white rounded px-1.5 py-0.5 text-[9px] font-black font-mono leading-none">
                      #{getOrderDisplayNo(order.id, order.createdAt)}
                    </span>
                    <h3 className="font-black text-gray-900 text-[11px] uppercase tracking-tighter">T-{order.tableName || order.tableId}</h3>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <p className="text-[9px] text-gray-400 uppercase tracking-widest font-black leading-none">
                      {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase leading-none border ${
                       order.orderType === OrderType.TAKEAWAY ? 'bg-purple-50 text-purple-700 border-purple-100' : 'bg-green-50 text-green-700 border-green-100'
                    }`}>
                      {order.orderType === OrderType.DINE_IN ? t('pos.dineIn') : t('pos.takeaway')}
                    </span>
                    {(order as any).paid_at && (
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-emerald-500 text-white uppercase leading-none italic shadow-sm shadow-emerald-500/20">
                        {t('pos.paid')}
                      </span>
                    )}
                  </div>
                </div>
                <div className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter border ${
                  order.status === OrderStatus.PENDING ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                  order.status === OrderStatus.CONFIRMED ? 'bg-blue-50 text-blue-700 border-blue-200' :
                  order.status === OrderStatus.COOKING ? 'bg-orange-50 text-orange-700 border-orange-200' :
                  order.status === OrderStatus.READY ? 'bg-green-50 text-green-700 border-green-200' :
                  'bg-gray-50 text-gray-700 border-gray-200'
                }`}>
                  {t(`status.${order.status}`) || order.status}
                </div>
              </div>

              <div className="p-3 flex-1 space-y-2">
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-start border-b border-gray-50 pb-1.5 last:border-0 last:pb-0">
                    <div className="flex gap-2">
                      <span className="font-black text-[11px] text-gray-900 bg-gray-100 px-1 rounded h-fit leading-tight mt-0.5">
                        {item.quantity}
                      </span>
                      <div>
                        <h4 className="text-[11px] font-bold text-gray-800 leading-tight">{item.name}</h4>
                        {item.smartRenderedLines?.customer ? (
                          <div className="mt-0.5 space-y-0">
                            {item.smartRenderedLines.customer.map((line, i) => (
                              <p key={i} className="text-[9px] text-gray-400 font-bold leading-[1.3]">{line}</p>
                            ))}
                          </div>
                        ) : item.selection ? (
                          <div className="mt-0.5 space-y-0">
                            {flattenSelections(item.selection).map((line, i) => (
                              <p key={i} className="text-[9px] text-gray-400 font-bold leading-[1.3]">{line}</p>
                            ))}
                          </div>
                        ) : item.options.length > 0 ? (
                          <p className="text-[9px] text-gray-400 mt-0.5 italic leading-[1.3]">
                            {item.options.map(o => o.valueName).join(', ')}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 pt-0 mt-auto bg-gray-50/10">
                <div className="flex justify-between items-center mb-2 pt-2 border-t border-gray-100">
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                    {(order as any).paidAmount > 0 && (order as any).paidAmount < order.totalPrice ? t('pos.due') : t('pos.sum')}
                  </span>
                  <div className="text-right">
                    <span className="text-sm font-black text-gray-900 tabular-nums">
                      RM {((order as any).paidAmount > 0 && (order as any).paidAmount < order.totalPrice ? order.totalPrice - (order as any).paidAmount : order.totalPrice).toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-1.5">
                    {order.status === OrderStatus.PENDING && (
                      <button
                        onClick={() => updateStatus(order.id, OrderStatus.CONFIRMED)}
                        className="flex-1 h-8 bg-yellow-400 text-yellow-950 rounded font-black text-[10px] uppercase tracking-tighter hover:bg-yellow-500 transition-colors shadow-sm"
                      >
                        {t('pos.accept')}
                      </button>
                    )}
                    {order.status === OrderStatus.CONFIRMED && (
                      <button
                        onClick={() => updateStatus(order.id, OrderStatus.COOKING)}
                        className="flex-1 h-8 bg-blue-100 text-blue-900 rounded font-black text-[10px] uppercase tracking-tighter hover:bg-blue-200 transition-colors"
                      >
                        {t('pos.cook')}
                      </button>
                    )}
                    {order.status === OrderStatus.COOKING && (
                      <button
                        onClick={() => updateStatus(order.id, OrderStatus.READY)}
                        className="flex-1 h-8 bg-orange-600 text-white rounded font-black text-[10px] uppercase tracking-tighter hover:bg-orange-700 transition-colors shadow-sm shadow-orange-600/10"
                      >
                        {t('pos.ready')}
                      </button>
                    )}
                    {order.status === OrderStatus.READY && (
                      <button
                        onClick={() => updateStatus(order.id, OrderStatus.SERVED)}
                        className="flex-1 h-8 bg-emerald-600 text-white rounded font-black text-[10px] uppercase tracking-tighter hover:bg-emerald-700 transition-colors shadow-sm shadow-emerald-600/10"
                      >
                        {order.orderType === OrderType.TAKEAWAY ? t('pos.pickup') : t('pos.serve')}
                      </button>
                    )}
                    {order.status === OrderStatus.SERVED && (
                      <button
                        onClick={() => updateStatus(order.id, OrderStatus.COMPLETED)}
                        className="flex-1 h-8 bg-zinc-900 text-white rounded font-black text-[10px] uppercase tracking-tighter hover:bg-black transition-colors"
                      >
                        {t('pos.done')}
                      </button>
                    )}
                    {(order.status === OrderStatus.COMPLETED || order.status === OrderStatus.CANCELLED || order.status === OrderStatus.SERVED) && (order as any).session_id && (
                      <button
                        onClick={() => closeSession((order as any).session_id, (order as any).table_id)}
                        className="flex-1 h-8 bg-zinc-900 text-white rounded font-black text-[10px] uppercase tracking-tighter hover:bg-black transition-colors shadow-sm"
                      >
                        {t('pos.close')}
                      </button>
                    )}
                    {!(order as any).paid_at && order.status !== OrderStatus.CANCELLED && order.status !== OrderStatus.COMPLETED && (
                      <button
                        onClick={() => setSettlingOrder(order)}
                        className="flex-1 h-8 bg-emerald-100 text-emerald-800 rounded font-black text-[10px] uppercase tracking-tighter hover:bg-emerald-200 transition-colors flex items-center justify-center gap-1 border border-emerald-200/50"
                      >
                        <Banknote size={12} />
                        {t('pos.pay')}
                      </button>
                    )}
                    {confirmingCancel === order.id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                            updateStatus(order.id, OrderStatus.CANCELLED);
                            setConfirmingCancel(null);
                          }}
                          className="px-2 h-8 bg-red-600 text-white rounded font-black text-[9px] uppercase tracking-widest"
                        >
                          {t('pos.cancel')}
                        </button>
                        <button
                          onClick={() => setConfirmingCancel(null)}
                          className="w-8 h-8 bg-gray-100 text-gray-400 rounded flex items-center justify-center"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingCancel(order.id)}
                        className="w-8 h-8 bg-gray-50 text-gray-400 rounded border border-gray-100 flex items-center justify-center hover:text-red-500 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {order.status !== OrderStatus.CANCELLED && (
                    <button
                      onClick={() => handlePrintOrderKOT(order)}
                      disabled={printingOrders[order.id]}
                      className="w-full h-8 bg-orange-50 hover:bg-orange-100 text-orange-900 border border-orange-200/50 rounded font-black text-[10px] uppercase tracking-tighter flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 shadow-xs"
                    >
                      <Printer size={12} className={printingOrders[order.id] ? "animate-spin" : ""} />
                      {printingOrders[order.id] ? "Printing..." : "Print KOT"}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {settlingOrder && restaurant && (
        <PaymentWorkspace 
          order={settlingOrder}
          restaurant={restaurant}
          onClose={() => setSettlingOrder(null)}
          onPaymentSuccess={() => {
            setSettlingOrder(null);
            // Refresh logic is already handled by realtime subscription
          }}
        />
      )}
    </div>
  );
}
