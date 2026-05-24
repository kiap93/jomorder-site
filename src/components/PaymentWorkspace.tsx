import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Banknote, 
  CreditCard, 
  QrCode, 
  Split, 
  Ticket, 
  UserCircle, 
  History, 
  ChevronRight, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  ShieldCheck, 
  ArrowLeft,
  Clock,
  Printer,
  ChevronDown,
  ChevronUp,
  Receipt,
  RotateCcw,
  LayoutGrid,
  Wallet,
  Smartphone,
  Lock,
  Unlock,
  Terminal,
  MoreVertical,
  Minus,
  Plus
} from 'lucide-react';
import { getApiUrl } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useLanguageStore } from '../store/useLanguageStore';
import { Order, Restaurant, Payment, PaymentStatus } from '../types';
import { useAuthStore } from '../store/useAuthStore';
import { CashCalculator } from './CashCalculator';

interface PaymentWorkspaceProps {
  order: Order;
  restaurant: Restaurant;
  onClose: () => void;
  onPaymentSuccess: () => void;
}

type PaymentMethodType = 'cash' | 'card' | 'qr' | 'ewallet' | 'split' | 'voucher' | 'house';

interface PaymentAttempt {
  id: string;
  method: string;
  amount: number;
  status: PaymentStatus;
  timestamp: string;
  provider?: string;
  errorCode?: string;
}

export function PaymentWorkspace({ order, restaurant, onClose, onPaymentSuccess }: PaymentWorkspaceProps) {
  const { t } = useLanguageStore();
  const { profile } = useAuthStore();
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodType>('cash');
  const [attempts, setAttempts] = useState<PaymentAttempt[]>([]);
  const [sessionOrders, setSessionOrders] = useState<Order[]>([]);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLocked, setIsLocked] = useState(true); // Terminal locking simulation
  
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  
  const sessionId = (order as any).sessionId || (order as any).session_id;

  useEffect(() => {
    if (sessionId) {
      fetchSessionOrders();
    } else {
      setSessionOrders([order]);
    }
  }, [order.id, sessionId]);

  const fetchSessionOrders = async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    setIsLoadingSession(true);
    try {
      const response = await fetch(getApiUrl(`/api/dining-sessions/${sessionId}/orders`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("Failed to fetch session orders");
      const data = await response.json();
      
      if (data) {
        setSessionOrders(data.map((o: any) => ({
          ...o,
          totalPrice: parseFloat(o.total_price || o.totalPrice || 0),
          paidAmount: (o.payments || []).reduce((sum: number, p: any) => sum + parseFloat(p.amount), 0)
        })));
      }
    } catch (err) {
      console.error("Failed to fetch session orders:", err);
    } finally {
      setIsLoadingSession(false);
    }
  };

  // Amounts aggregated for the session (Only unpaid orders as requested)
  const totalAmount = useMemo(() => {
    if (sessionOrders.length > 0) {
      return sessionOrders
        .filter(o => !o.paid_at)
        .reduce((sum, o) => {
          const price = o.totalPrice || 0;
          return sum + price;
        }, 0);
    }
    
    // Fallback logic if sessionOrders not yet loaded or empty
    if (order.paid_at) return 0;
    
    return order.totalPrice || parseFloat((order as any).total_price || 0);
  }, [sessionOrders, order.totalPrice, (order as any).total_price, order.paid_at]);

  const paidAmount = useMemo(() => attempts.filter(a => a.status === 'paid').reduce((sum, a) => sum + a.amount, 0), [attempts]);
  
  // Outstanding balance calculation
  const remainingBalance = useMemo(() => {
    return Math.max(0, (totalAmount || 0) - paidAmount);
  }, [totalAmount, paidAmount]);
  const isFullyPaid = remainingBalance <= 0.01; // Rounding tolerance

  // Service Charge & Tax Calculation (re-deriving for display)
  const scRate = restaurant.serviceCharge || 0;
  const sstRate = restaurant.sst || 0;
  const safeTotal = totalAmount || 0;
  const subtotal = safeTotal / ((1 + scRate) * (1 + sstRate));
  const scAmount = subtotal * scRate;
  const sstAmount = (subtotal + scAmount) * sstRate;

  useEffect(() => {
    fetchPaymentHistory();
  }, [order.id, sessionId, sessionOrders.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.ctrlKey || e.metaKey) return; // Don't interfere with browser shortcuts
      
      const key = e.key.toLowerCase();
      if (key === 'c') setSelectedMethod('cash');
      if (key === 't') setSelectedMethod('card');
      if (key === 'q') setSelectedMethod('qr');
      if (key === 's') setSelectedMethod('split');
      if (key === 'w') setSelectedMethod('ewallet');
      if (key === 'v') setSelectedMethod('voucher');
      if (key === 'h') setSelectedMethod('house');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const fetchPaymentHistory = async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    setIsLoadingHistory(true);
    try {
      const orderIds = sessionOrders.map(o => o.id);
      if (orderIds.length === 0) {
          setAttempts([]);
          setIsLoadingHistory(false);
          return;
      }

      const response = await fetch(getApiUrl(`/api/orders/${orderIds[0]}/payments?sessionId=${sessionId || ''}`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("Failed to fetch payment history");
      const data = await response.json();
      
      setAttempts((data || []).map((p: any) => ({
        id: p.id,
        method: p.payment_method,
        amount: parseFloat(p.amount),
        status: p.status as PaymentStatus,
        timestamp: p.created_at,
        provider: p.provider
      })));
    } catch (err) {
      console.error("Failed to fetch payment history:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const markOrdersAsPaid = async (paidAmountValue: number) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const orderIds = sessionOrders.map(o => o.id);
    if (orderIds.length > 0) {
      // API call to batch update orders and session status
      await fetch(getApiUrl(`/api/dining-sessions/${sessionId}/settle`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ orderIds, paidAmount: paidAmountValue })
      });
    }
    onPaymentSuccess();
  };

  const handlePaymentComplete = async (paymentData: { amount: number }) => {
    // Refresh history
    await fetchPaymentHistory();
    
    // Check if fully paid
    const newPaidAmount = paidAmount + paymentData.amount;
    if (newPaidAmount >= totalAmount - 0.05) {
      await markOrdersAsPaid(newPaidAmount);
    }
  };

  const handleSplitAllocation = async (splits: { amount: number; method: string }[]) => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    setIsProcessing(true);
    try {
      const totalSplit = splits.reduce((s, x) => s + x.amount, 0);
      for (const split of splits) {
        await fetch(getApiUrl(`/api/orders/${order.id}/payments`), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            restaurant_id: restaurant.id,
            amount: split.amount,
            payment_method: split.method,
            provider: 'pos_split',
            status: 'paid',
            currency: restaurant.currency || 'MYR'
          })
        });
      }
      await fetchPaymentHistory();
      if (paidAmount + totalSplit >= totalAmount - 0.05) {
        await markOrdersAsPaid(paidAmount + totalSplit);
      }
    } catch (err) {
      console.error("Split payment failed:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const [splitMethod, setSplitMethod] = useState<'equal' | 'custom'>('equal');
  const [splitCount, setSplitCount] = useState(2);

  const paymentMethods = [
    { id: 'cash', label: 'Cash', icon: Banknote, color: 'emerald' },
    { id: 'card', label: 'Terminal Card', icon: CreditCard, color: 'blue' },
    { id: 'qr', label: 'DuitNow QR', icon: QrCode, color: 'rose' },
    { id: 'ewallet', label: 'E-Wallet', icon: Wallet, color: 'indigo' },
    { id: 'split', label: 'Split Payment', icon: Split, color: 'orange' },
    { id: 'voucher', label: 'Voucher', icon: Ticket, color: 'amber' },
    { id: 'house', label: 'House Account', icon: UserCircle, color: 'zinc' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col md:flex-row overflow-hidden font-sans">
      {/* 1️⃣ Navigation Sidebar */}
      <div className={`transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'md:w-20' : 'md:w-64'} w-full bg-zinc-950 border-r border-zinc-800/50 flex flex-col shrink-0`}>
        <div className="p-4 border-b border-zinc-800/50 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <button 
              onClick={onClose}
              className="flex items-center gap-2 text-zinc-500 hover:text-white transition-colors group"
            >
              <div className="p-1.5 bg-zinc-900 rounded group-hover:bg-zinc-800">
                <ArrowLeft size={14} />
              </div>
              {!isSidebarCollapsed && <span className="text-[10px] font-black uppercase tracking-widest leading-none">Dashboard</span>}
            </button>
            <button 
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="hidden md:flex p-1.5 hover:bg-zinc-900 rounded text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              <MoreVertical size={14} />
            </button>
          </div>
          
          {!isSidebarCollapsed && (
            <div className="animate-in fade-in duration-300">
              <h1 className="text-lg font-black text-white tracking-tighter uppercase leading-none italic">{t('common.settlement')}</h1>
              <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mt-1">Terminal Active</p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {paymentMethods.map((method) => {
            const Icon = method.icon;
            const isActive = selectedMethod === method.id;
            return (
              <button
                key={method.id}
                onClick={() => setSelectedMethod(method.id as PaymentMethodType)}
                className={`w-full p-2 rounded-md flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-3'} transition-all active:scale-[0.98] ${
                  isActive 
                  ? 'bg-zinc-900 text-white shadow-xl shadow-black/50 border border-zinc-800' 
                  : 'text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-300'
                }`}
                title={isSidebarCollapsed ? method.label : undefined}
              >
                <div className={`w-8 h-8 rounded flex items-center justify-center border transition-all shrink-0 ${
                  isActive 
                  ? `bg-${method.color}-500/10 border-${method.color}-500/20 text-${method.color}-500` 
                  : 'bg-zinc-950 border-zinc-900'
                }`}>
                  <Icon size={16} />
                </div>
                {!isSidebarCollapsed && (
                  <div className="text-left flex-1 min-w-0 animate-in fade-in slide-in-from-left-1 duration-200">
                    <div className="flex items-center gap-2">
                      <span className="block text-xs font-black tracking-tight truncate">{method.label}</span>
                      <span className="text-[8px] font-black px-1 py-0.5 bg-zinc-800 text-zinc-600 rounded border border-zinc-700/50 shrink-0">
                        {method.id === 'cash' ? 'C' : method.id.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="p-3 bg-zinc-900/10 border-t border-zinc-800/50">
          <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'gap-2'} p-2 bg-zinc-900/30 rounded border border-zinc-800/50`}>
            <div className={`w-6 h-6 bg-zinc-800 rounded flex items-center justify-center ${isSidebarCollapsed ? '' : 'shrink-0'}`}>
              <ShieldCheck size={12} className="text-emerald-500" />
            </div>
            {!isSidebarCollapsed && (
              <div className="flex-1 animate-in fade-in duration-200">
                <p className="text-[9px] font-black text-white uppercase tracking-wider">Secure</p>
              </div>
            )}
            {!isSidebarCollapsed && <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shrink-0" />}
          </div>
        </div>
      </div>

      {/* 2️⃣ Main Workspace Center */}
      <div className="flex-1 bg-zinc-950 flex flex-col relative overflow-hidden">
        {/* Workspace Top Bar */}
        <div className="h-12 bg-zinc-950 border-b border-zinc-800/50 flex items-center justify-between px-4">
           <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-2 py-0.5 bg-zinc-900 rounded border border-zinc-800">
                <LayoutGrid size={10} className="text-zinc-600" />
                <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">T-{order.tableName || '-'}</span>
              </div>
              <div className="w-1 h-1 bg-zinc-800 rounded-full" />
              <div className="text-[10px] font-bold text-zinc-600 uppercase">
                Order <span className="text-zinc-400 font-black">#{order.id.slice(-6).toUpperCase()}</span>
              </div>
           </div>

           <div className="flex items-center gap-3">
             <div className="flex items-center gap-1.5 text-[10px] uppercase font-black text-zinc-600">
                <Clock size={12} />
                <span className="tabular-nums">
                  {order.createdAt || (order as any).created_at 
                    ? new Date(order.createdAt || (order as any).created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '--:--'
                  }
                </span>
             </div>
           </div>
        </div>

        {/* Dynamic Panel Content */}
        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedMethod}
              initial={{ opacity: 0, x: 5 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -5 }}
              className="h-full"
            >
              {selectedMethod === 'cash' ? (
                <div className="h-full flex items-center justify-center p-4">
                   <div className="w-full max-w-2xl scale-[0.9] origin-center">
                    <CashCalculator 
                      amountDue={remainingBalance}
                      orderId={order.id}
                      orderDetails={{
                        subtotal,
                        serviceCharge: scAmount,
                        sst: sstAmount,
                        currency: restaurant.currency
                      }}
                      onCancel={() => setSelectedMethod('card')}
                        onComplete={async (data) => {
                          const token = useAuthStore.getState().token;
                          if (!token) return;

                          setIsProcessing(true);
                          try {
                            const remainingAmount = totalAmount - paidAmount;
                            const amountPaid = data.isPartial ? data.cashReceived : (remainingAmount + data.rounding);
                            
                            const pRes = await fetch(getApiUrl(`/api/orders/${order.id}/payments`), {
                              method: 'POST',
                              headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json'
                              },
                              body: JSON.stringify({
                                restaurant_id: restaurant.id,
                                amount: amountPaid,
                                payment_method: 'cash',
                                provider: 'pos_cash',
                                status: 'paid',
                                currency: restaurant.currency || 'MYR'
                              })
                            });

                            if (!pRes.ok) throw new Error("Payment record failed");
                            const payment = await pRes.json();

                            const deviceId = localStorage.getItem('pos_device_id') || `T_ADM_${navigator.userAgent.slice(0, 5)}`;
                            
                            await fetch(getApiUrl(`/api/cash-transactions`), {
                              method: 'POST',
                              headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json'
                              },
                              body: JSON.stringify({
                                payment_id: payment.id,
                                order_id: order.id,
                                cashier_id: profile?.id,
                                restaurant_id: restaurant.id,
                                device_id: deviceId,
                                amount_due: remainingAmount,
                                cash_received: data.cashReceived,
                                change_given: data.changeGiven,
                                rounding_adjustment: data.rounding,
                                status: 'completed',
                                metadata: {
                                  is_partial: data.isPartial,
                                  remaining_balance: data.remainingBalance
                                }
                              })
                            });

                            await handlePaymentComplete(payment);
                          } finally {
                            setIsProcessing(false);
                          }
                        }}
                    />
                   </div>
                </div>
              ) : selectedMethod === 'card' ? (
                <div className="h-full flex flex-col items-center justify-center p-4 text-center bg-zinc-950">
                  <div className="w-full max-w-sm space-y-6">
                    <div className="relative">
                      <div className="absolute inset-0 bg-blue-500/5 blur-[60px] rounded-full" />
                      <div className="relative w-24 h-24 bg-zinc-900 rounded-2xl border border-zinc-800 flex items-center justify-center mx-auto shadow-2xl">
                        <Terminal size={32} className="text-zinc-600 animate-pulse" />
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                       <h3 className="text-xl font-black text-white tracking-tight uppercase italic">Card Hub</h3>
                       <p className="text-zinc-600 text-[10px] font-black uppercase tracking-widest">Insert onto terminal <span className="text-blue-500">#T500</span></p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="p-3 bg-zinc-900/50 rounded-lg border border-zinc-800 text-left">
                        <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mb-1 leading-none">Net Due</p>
                        <p className="text-sm font-black text-white leading-none">RM {remainingBalance.toFixed(2)}</p>
                      </div>
                      <div className="p-3 bg-zinc-900/50 rounded-lg border border-zinc-800 text-left">
                        <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mb-1 leading-none">Signal</p>
                        <div className="flex items-center gap-1.5 text-emerald-500 leading-none mt-1">
                          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                          <span className="text-[9px] font-black uppercase leading-none">Active</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button className="flex-1 h-10 bg-zinc-900 text-zinc-500 rounded font-black text-[9px] uppercase tracking-widest hover:bg-zinc-800 transition-all border border-zinc-800">Abort</button>
                      <button 
                        onClick={async () => {
                          const token = useAuthStore.getState().token;
                          if (!token) return;

                          const response = await fetch(getApiUrl(`/api/orders/${order.id}/payments`), {
                            method: 'POST',
                            headers: {
                              'Authorization': `Bearer ${token}`,
                              'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                              restaurant_id: restaurant.id,
                              amount: remainingBalance,
                              payment_method: 'card',
                              provider: 'pos_terminal',
                              status: 'paid',
                              currency: restaurant.currency || 'MYR'
                            })
                          });
                          
                          if (response.ok) {
                            const pData = await response.json();
                            handlePaymentComplete(pData);
                          }
                        }}
                        className="flex-[2] h-10 bg-white text-black rounded font-black text-[9px] uppercase tracking-[0.2em] hover:bg-zinc-200 transition-all shadow-xl"
                      >
                        Sync Success
                      </button>
                    </div>
                  </div>
                </div>
              ) : selectedMethod === 'split' ? (
                <div className="h-full flex flex-col items-center justify-center bg-zinc-950 p-4">
                  <div className="w-full max-w-xl bg-zinc-900 rounded-2xl border border-zinc-800 p-6 shadow-2xl">
                    <div className="mb-6 text-center">
                       <h3 className="text-xl font-black text-white tracking-tight uppercase italic leading-none mb-1">Bill Partition</h3>
                       <p className="text-zinc-600 text-[10px] font-black uppercase tracking-widest leading-none mt-2">Allocation for <span className="text-white">RM {remainingBalance.toFixed(2)}</span></p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-6">
                      <button 
                        onClick={() => setSplitMethod('equal')}
                        className={`p-4 rounded-lg border transition-all flex flex-col items-center gap-1.5 ${
                          splitMethod === 'equal' ? 'bg-orange-500/5 border-orange-500/30' : 'bg-transparent border-zinc-800 hover:border-zinc-750'
                        }`}
                      >
                        <LayoutGrid size={18} className={splitMethod === 'equal' ? 'text-orange-500' : 'text-zinc-700'} />
                        <span className={`text-[9px] font-black uppercase tracking-widest leading-none mt-1 ${splitMethod === 'equal' ? 'text-white' : 'text-zinc-600'}`}>Equal Divide</span>
                      </button>
                      <button 
                        onClick={() => setSplitMethod('custom')}
                        className={`p-4 rounded-lg border transition-all flex flex-col items-center gap-1.5 ${
                          splitMethod === 'custom' ? 'bg-orange-500/5 border-orange-500/30' : 'bg-transparent border-zinc-800 hover:border-zinc-750'
                        }`}
                      >
                        <UserCircle size={18} className={splitMethod === 'custom' ? 'text-orange-500' : 'text-zinc-700'} />
                        <span className={`text-[9px] font-black uppercase tracking-widest leading-none mt-1 ${splitMethod === 'custom' ? 'text-white' : 'text-zinc-600'}`}>Matrix Allocation</span>
                      </button>
                    </div>

                    {splitMethod === 'equal' && (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between p-4 bg-zinc-950 rounded-lg border border-zinc-800/50">
                          <div className="space-y-1">
                            <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest leading-none">Matrix Count</p>
                            <div className="flex items-center gap-4 mt-2">
                              <button onClick={() => setSplitCount(Math.max(2, splitCount - 1))} className="p-1.5 bg-zinc-900 rounded text-zinc-500">
                                <Minus size={14} />
                              </button>
                              <span className="text-xl font-black text-white w-8 text-center tabular-nums">{splitCount}</span>
                              <button onClick={() => setSplitCount(Math.min(20, splitCount + 1))} className="p-1.5 bg-zinc-900 rounded text-zinc-500">
                                <Plus size={14} />
                              </button>
                            </div>
                          </div>
                          <div className="text-right space-y-1 border-l border-zinc-800/50 pl-6">
                            <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest leading-none mb-1">Per User</p>
                            <p className="text-xl font-black text-orange-500 tracking-tighter tabular-nums leading-none">RM {(remainingBalance / splitCount).toFixed(2)}</p>
                          </div>
                        </div>

                        <button 
                          onClick={() => handleSplitAllocation(
                            Array(splitCount).fill(0).map(() => ({ amount: remainingBalance / splitCount, method: 'split_shared' }))
                          )}
                          disabled={isProcessing}
                          className="w-full h-12 bg-orange-600 hover:bg-orange-500 text-white rounded font-black text-[10px] uppercase tracking-[0.2em] transition-all"
                        >
                          {isProcessing ? 'CALCULATING...' : 'EXECUTE PARTITION'}
                        </button>
                      </div>
                    )}

                    {splitMethod === 'custom' && (
                       <div className="p-6 text-center grayscale opacity-20">
                          <Lock size={24} className="mx-auto mb-2 text-zinc-700" />
                          <p className="text-[8px] font-black uppercase tracking-widest text-zinc-600 leading-none">L4 PERMISSION REQUIRED</p>
                       </div>
                    )}
                  </div>
                </div>
              ) : selectedMethod === 'qr' ? (
                <div className="h-full flex items-center justify-center bg-zinc-950 p-4">
                  <div className="w-full max-w-[280px] bg-zinc-900 rounded-2xl border border-zinc-800 p-6 text-center shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 inset-x-0 h-0.5 bg-rose-500/10 overflow-hidden">
                      <motion.div 
                        initial={{ x: '-100%' }}
                        animate={{ x: '100%' }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                        className="h-full w-1/4 bg-rose-500"
                      />
                    </div>
                    
                    <div className="mb-4">
                       <h3 className="text-base font-black text-white uppercase tracking-tighter italic">Dynamic Pay-QR</h3>
                       <p className="text-zinc-600 text-[8px] font-black uppercase tracking-widest mt-1">Live Traffic Token</p>
                    </div>

                    <div className="aspect-square bg-white rounded-xl p-4 shadow-2xl mb-4 relative group">
                      <QrCode className="w-full h-full text-zinc-950" />
                    </div>

                    <div className="bg-zinc-950 rounded p-2.5 mb-4 border border-zinc-800/50">
                      <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest block mb-0.5 text-left leading-none">Charge</span>
                      <span className="text-xl font-black text-white tabular-nums tracking-tighter leading-none">RM {remainingBalance.toFixed(2)}</span>
                    </div>

                    <button 
                      onClick={async () => {
                        const token = useAuthStore.getState().token;
                        if (!token) return;

                        const response = await fetch(getApiUrl(`/api/orders/${order.id}/payments`), {
                          method: 'POST',
                          headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                          },
                          body: JSON.stringify({
                            restaurant_id: restaurant.id,
                            amount: remainingBalance,
                            payment_method: 'qr',
                            provider: 'duitnow_pos',
                            status: 'paid',
                            currency: restaurant.currency || 'MYR'
                          })
                        });
                        
                        if (response.ok) {
                          const pData = await response.json();
                          handlePaymentComplete(pData);
                        }
                      }}
                      className="w-full h-10 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded font-black text-[9px] uppercase tracking-widest transition-all"
                    >
                      Verify Call
                    </button>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center p-4 text-center text-zinc-600 bg-zinc-950">
                  <div className="space-y-3">
                    <div className="w-12 h-12 bg-zinc-900 rounded-full flex items-center justify-center mx-auto border border-zinc-800">
                      <ShieldCheck size={18} className="text-zinc-700" />
                    </div>
                    <div>
                      <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1">Restricted Hub</h3>
                      <p className="text-[9px] leading-[1.3] max-w-[180px] mx-auto text-zinc-600 font-bold">{t('common.l4AdminPrivilegesNeeded')}</p>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* 3️⃣ Summary & Timeline Side Panel */}
      <div className="w-full md:w-[320px] bg-zinc-950 border-l border-zinc-800/50 flex flex-col shrink-0">
        <div className="p-4 bg-zinc-950/50">
          <div className="flex items-center justify-between mb-4">
             <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-emerald-500/10 rounded flex items-center justify-center text-emerald-500 border border-emerald-500/20 shadow-inner">
                  <Receipt size={14} />
                </div>
                <h3 className="text-sm font-black text-white tracking-tight uppercase leading-none italic">Ledger</h3>
             </div>
          </div>

          {sessionOrders.length > 1 && (
            <div className="mb-4 p-2.5 bg-zinc-900/40 rounded border border-zinc-800/50 space-y-1.5">
              <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest leading-none mb-1">Session Matrix</p>
              <div className="max-h-24 overflow-y-auto pr-1 space-y-1 scrollbar-none">
                {sessionOrders.map(o => (
                  <div key={o.id} className="flex justify-between items-center text-[9px] leading-none">
                    <div className="flex items-center gap-1.5">
                       <span className={`w-1 h-1 rounded-full ${o.id === order.id ? 'bg-orange-500' : 'bg-zinc-700'}`} />
                       <span className="text-zinc-500 font-bold uppercase tracking-tighter leading-none">#O-{o.id.slice(-4).toUpperCase()}</span>
                    </div>
                    <span className="text-zinc-400 font-black leading-none">RM {parseFloat((o as any).totalPrice || (o as any).total_price || 0).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bill Metrics */}
            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded shadow-inner space-y-3">
              <div className="space-y-1.5 opacity-60">
                <div className="flex justify-between items-center text-[9px]">
                  <span className="font-black text-zinc-600 uppercase tracking-widest leading-none">Subtotal</span>
                  <span className="font-black text-zinc-400 tabular-nums leading-none">RM {subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-[9px]">
                  <span className="font-bold text-zinc-600 uppercase tracking-widest leading-none">Taxes</span>
                  <span className="font-black text-zinc-400 tabular-nums leading-none">RM {(scAmount + sstAmount).toFixed(2)}</span>
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800/50">
                 <div className="flex justify-between items-baseline mb-2">
                   <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest leading-none">Total</span>
                   <span className="text-lg font-black text-zinc-500 tracking-tighter tabular-nums leading-none">RM {totalAmount.toFixed(2)}</span>
                 </div>
                 
                 {paidAmount > 0 && (
                   <div className="flex justify-between items-center mb-3 px-2 py-1.5 bg-zinc-950 rounded border border-zinc-800/50">
                     <span className="text-[8px] font-black text-emerald-600 uppercase tracking-widest leading-none">Settled</span>
                     <span className="text-[11px] font-black text-emerald-500 tabular-nums leading-none">RM {paidAmount.toFixed(2)}</span>
                   </div>
                 )}

                 <div className="flex justify-between items-end relative mt-2">
                    <div className="flex flex-col">
                       <span className="text-[10px] font-black text-orange-500 uppercase tracking-widest leading-none mb-1">Due Net</span>
                       <span className="text-[8px] font-bold text-zinc-700 uppercase leading-none">Outstanding</span>
                    </div>
                    <span className="text-4xl font-black text-white tracking-tighter tabular-nums leading-[0.8] mb-0"> {remainingBalance.toFixed(2)}</span>
                 </div>
              </div>
            </div>
        </div>

        {/* Payment History Timeline */}
        <div className="flex-1 flex flex-col min-h-0 bg-zinc-950/20">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <h3 className="text-[8px] font-black text-zinc-600 uppercase tracking-[0.2em] flex items-center gap-1.5 leading-none">
              <History size={10} />
              Traffic Log
            </h3>
            <span className="text-[8px] font-bold text-zinc-700 uppercase tracking-widest leading-none">{attempts.length} Hits</span>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1.5 scrollbar-thin">
            {isLoadingHistory ? (
               <div className="space-y-1.5">
                {[1,2,3].map(i => (
                  <div key={i} className="h-14 bg-zinc-900/50 rounded animate-pulse" />
                ))}
               </div>
            ) : attempts.length === 0 ? (
              <div className="h-24 flex flex-col items-center justify-center text-center opacity-10 border border-dashed border-zinc-800 rounded mt-4">
                <Banknote size={20} className="mb-2" />
                <p className="text-[8px] font-bold uppercase tracking-widest">Idle Log</p>
              </div>
            ) : (
              attempts.map((attempt) => (
                <div 
                  key={attempt.id} 
                  className="bg-zinc-900 border border-zinc-800 p-2.5 rounded relative overflow-hidden group border-l-2"
                  style={{ borderLeftColor: attempt.status === 'paid' ? '#10b981' : '#ef4444' }}
                >
                  <div className="flex justify-between items-start mb-1.5 h-3">
                    <div className="flex items-center gap-2 leading-none">
                       <span className="text-[10px] font-black text-white uppercase tracking-tight leading-none italic">{attempt.method}</span>
                    </div>
                    <span className={`text-[7px] font-black uppercase tracking-widest px-1 rounded leading-none ${
                      attempt.status === 'paid' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                    }`}>
                      {attempt.status}
                    </span>
                  </div>

                  <div className="flex justify-between items-end leading-none">
                    <p className="text-sm font-black text-zinc-200 tabular-nums tracking-tight leading-none">{attempt.amount.toFixed(2)}</p>
                    <div className="flex items-center gap-1.5 text-zinc-600 text-[8px] leading-none mb-0.5">
                      <Clock size={8} />
                      <span className="leading-none">{new Date(attempt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-4 border-t border-zinc-800/50 bg-zinc-950">
            {isFullyPaid ? (
               <motion.button
                initial={{ scale: 0.98, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                onClick={onPaymentSuccess}
                className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-black text-[10px] uppercase tracking-[0.2em] shadow-lg shadow-emerald-600/10 transition-all flex items-center justify-center gap-2"
               >
                 <CheckCircle2 size={16} />
                 ACK Close
               </motion.button>
            ) : (
               <div className="p-3 bg-zinc-900 border border-zinc-800 rounded flex items-center justify-between">
                  <div className="flex items-center gap-2 text-zinc-600">
                    <Smartphone size={12} />
                    <span className="text-[8px] font-black uppercase tracking-widest leading-none">Awaiting Ops</span>
                  </div>
                  <div className="flex items-center gap-1 leading-none">
                    <span className="text-zinc-600 text-[10px] font-bold leading-none">RM</span>
                    <span className="text-lg font-black text-white tabular-nums leading-none mt-0.5">{remainingBalance.toFixed(2)}</span>
                  </div>
               </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
