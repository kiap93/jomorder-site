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
import { getApiUrl, getOrderDisplayNo } from '../lib/api';
import { supabase } from '../lib/supabase';
import { indexedDbStorage } from '../lib/indexedDbStorage';
import { useLanguageStore } from '../store/useLanguageStore';
import { Order, OrderItem, Restaurant, Payment, PaymentStatus } from '../types';
import { OrderStatus } from '../enums';
import { useAuthStore } from '../store/useAuthStore';
import { CashCalculator } from './CashCalculator';
import { QRCodeSVG } from 'qrcode.react';

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
  const [paymentSettings, setPaymentSettings] = useState<{ provider?: string; enabled_methods?: string[] } | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settingsRes = await fetch(getApiUrl(`/api/restaurants/${restaurant.id}/public-payment-settings`));
        if (settingsRes.ok) {
          const settingsData = await settingsRes.json();
          setPaymentSettings(settingsData);
        }
      } catch (err) {
        console.error('[PaymentWorkspace] Failed to fetch public payment settings:', err);
      }
    };
    if (restaurant?.id) {
      fetchSettings();
    }
  }, [restaurant?.id]);
  
  // Dynamic DuitNow QR States
  const [activeQrData, setActiveQrData] = useState<string | null>(null);
  const [activeQrPayment, setActiveQrPayment] = useState<any | null>(null);
  const [isQrLoading, setIsQrLoading] = useState(false);
  const [qrGenerationError, setQrGenerationError] = useState<string | null>(null);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  
  const sessionId = order.sessionId || order.session_id;

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
        setSessionOrders((data as Array<Order & { payments?: Array<{ amount: string | number }> }>).map((o) => ({
          ...o,
          totalPrice: parseFloat(String(o.total_price || o.totalPrice || 0)),
          paidAmount: (o.payments || []).reduce((sum: number, p) => sum + parseFloat(String(p.amount)), 0)
        } as Order)));
      }
    } catch (err) {
      console.error("Failed to fetch session orders:", err);
    } finally {
      setIsLoadingSession(false);
    }
  };

  // --- Operational States for Voids & Discounts ---
  const [centerTab, setCenterTab] = useState<'payment' | 'financial_ops'>('payment');
  const [pinInput, setPinInput] = useState<string>('');
  const [unlockedRole, setUnlockedRole] = useState<'cashier' | 'manager' | 'owner' | null>(null);

  const [selectedItemForAction, setSelectedItemForAction] = useState<{ item: OrderItem; idx: number } | null>(null);
  const [selectedActionType, setSelectedActionType] = useState<'discount' | 'void' | null>(null);

  const [reasonText, setReasonText] = useState<string>('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountValue, setDiscountValue] = useState<number>(0);

  const [showVoidReasonModal, setShowVoidReasonModal] = useState<boolean>(false);
  const [voidTarget, setVoidTarget] = useState<'item' | 'order' | null>(null);
  const [voidItemId, setVoidItemId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState<string>('Operator Input Entry Mistake');

  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAudits, setLoadingAudits] = useState<boolean>(false);

  // Service Charge & Tax Rates
  const scRate = restaurant.serviceCharge || 0;
  const sstRate = restaurant.sst || 0;

  // Real-time financial calculations involving soft-voids and multi-tiered discounts
  const dynamicFinancials = useMemo(() => {
    let rawSubtotal = 0;
    let itemDiscountsTotal = 0;
    let orderDiscountsTotal = 0;
    let voidedItemsTotal = 0;
    
    sessionOrders.forEach(o => {
      // Entire order cancelled/voided count as zero
      if (o.status === 'cancelled' || o.voided) {
        return;
      }

      const orderDisc = o.discount;
      const orderItems = o.items || [];
      let orderRawSubtotal = 0;

      orderItems.forEach(item => {
        const itemPrice = item.price || 0;
        const itemQty = item.quantity || 1;
        const itemTotal = itemPrice * itemQty;

        if (item.voided) {
          voidedItemsTotal += itemTotal;
          return; // Skip soft-voided item
        }

        let itemDiscountAmt = 0;
        if (item.discount) {
          if (item.discount.type === 'percentage') {
            itemDiscountAmt = itemTotal * (item.discount.value / 100);
          } else {
            itemDiscountAmt = Math.min(itemTotal, item.discount.value * itemQty);
          }
        }

        itemDiscountsTotal += itemDiscountAmt;
        orderRawSubtotal += (itemTotal - itemDiscountAmt);
      });

      rawSubtotal += orderRawSubtotal;

      if (orderDisc) {
        let orderDiscAmt = 0;
        if (orderDisc.type === 'percentage') {
          orderDiscAmt = orderRawSubtotal * (orderDisc.value / 100);
        } else {
          orderDiscAmt = Math.min(orderRawSubtotal, orderDisc.value);
        }
        orderDiscountsTotal += orderDiscAmt;
      }
    });

    const netSubtotal = Math.max(0, rawSubtotal - orderDiscountsTotal);
    const serviceChargeAmount = netSubtotal * scRate;
    const taxAmount = (netSubtotal + serviceChargeAmount) * sstRate;
    const grandTotal = netSubtotal + serviceChargeAmount + taxAmount;

    return {
      subtotal: rawSubtotal,
      itemDiscounts: itemDiscountsTotal,
      orderDiscounts: orderDiscountsTotal,
      netSubtotal,
      serviceCharge: serviceChargeAmount,
      tax: taxAmount,
      total: grandTotal,
      voidedTotal: voidedItemsTotal
    };
  }, [sessionOrders, scRate, sstRate]);

  // Bind calculation outputs back to original variable handles so we don't break payments
  const totalAmount = dynamicFinancials.total;
  const subtotal = dynamicFinancials.netSubtotal;
  const scAmount = dynamicFinancials.serviceCharge;
  const sstAmount = dynamicFinancials.tax;

  const paidAmount = useMemo(() => attempts.filter(a => a.status === 'paid').reduce((sum, a) => sum + a.amount, 0), [attempts]);
  
  const remainingBalance = useMemo(() => {
    return Math.max(0, (totalAmount || 0) - paidAmount);
  }, [totalAmount, paidAmount]);
  const isFullyPaid = remainingBalance <= 0.01;

  // --- End of financial calculations block ---

  useEffect(() => {
    let active = true;
    let pollInterval: NodeJS.Timeout | null = null;

    if (selectedMethod === 'qr' && order?.id && remainingBalance > 0) {
      const initQrSetup = async () => {
        setIsQrLoading(true);
        setQrGenerationError(null);
        try {
          const token = useAuthStore.getState().token;
          if (!token) {
            throw new Error('Authentication token required');
          }

          // 1. Create a pending payment on the backend with method: 'duitnow'
          const createRes = await fetch(getApiUrl(`/api/orders/${order.id}/payments`), {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              restaurant_id: restaurant.id,
              amount: remainingBalance,
              payment_method: 'duitnow', // must be 'duitnow' to hit the DuitNow switch in initialize!
              provider: 'duitnow_pos',
              status: 'pending',
              currency: restaurant.currency || 'MYR'
            })
          });

          if (!createRes.ok) {
            throw new Error(`Failed to create ledger row (${createRes.status})`);
          }

          const paymentObj = await createRes.json();
          if (!active) return;
          setActiveQrPayment(paymentObj);

          // 2. Initialize the dynamic payment to retrieve the EMVCo DuitNow QR payload!
          const initRes = await fetch(getApiUrl(`/api/public/payments/${paymentObj.id}/initialize`), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          });

          if (!initRes.ok) {
            throw new Error(`Failed to fetch QR payload from provider (${initRes.status})`);
          }

          const initData = await initRes.json();
          if (!active) return;
          
          if (initData && initData.qrData) {
            setActiveQrData(initData.qrData);
          } else {
            throw new Error('No QR payload returned from server');
          }

          // 3. Start Polling the status of this specific payment!
          pollInterval = setInterval(async () => {
            try {
              const statusRes = await fetch(getApiUrl(`/api/public/payments/${paymentObj.id}/status`));
              if (statusRes.ok) {
                const statusObj = await statusRes.json();
                if (statusObj && (statusObj.status === 'completed' || statusObj.status === 'paid')) {
                  if (pollInterval) clearInterval(pollInterval);
                  // Dynamic transaction is complete, let's complete the UI flow!
                  handlePaymentComplete(paymentObj);
                }
              }
            } catch (pollErr) {
              console.warn('[PaymentWorkspace] Status polling failure ignored:', pollErr);
            }
          }, 4000);

        } catch (err: any) {
          console.error('[PaymentWorkspace] QR Gen Error:', err);
          if (active) {
            setQrGenerationError(err.message || 'Error occurred generating payment code');
          }
        } finally {
          if (active) {
            setIsQrLoading(false);
          }
        }
      };

      initQrSetup();
    } else {
      // Clear QR states when deselecting qr method
      setActiveQrData(null);
      setActiveQrPayment(null);
      setQrGenerationError(null);
    }

    return () => {
      active = false;
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [selectedMethod, order?.id, remainingBalance]);

  useEffect(() => {
    fetchPaymentHistory();
  }, [order.id, sessionId, sessionOrders.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.ctrlKey || e.metaKey) return; // Don't interfere with browser shortcuts
      
      const key = e.key.toLowerCase();
      if (key === 'c') setSelectedMethod('cash');
      if (key === 'q') {
        const hasDuitNow = paymentSettings && 
                           paymentSettings.provider && 
                           paymentSettings.provider !== 'none' && 
                           Array.isArray(paymentSettings.enabled_methods) && 
                           paymentSettings.enabled_methods.includes('duitnow');
        if (hasDuitNow) setSelectedMethod('qr');
      }
      if (key === 's') setSelectedMethod('split');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, paymentSettings]);

  // --- Operational Mutation Handlers & Override Helpers ---
  const fetchAuditLogs = async () => {
    const token = useAuthStore.getState().token;
    if (!token || !restaurant?.id) return;
    setLoadingAudits(true);
    try {
      const res = await fetch(getApiUrl(`/api/restaurants/${restaurant.id}/audit-logs`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const logs = await res.json();
        setAuditLogs(logs);
      }
    } catch (err) {
      console.error("Failed to fetch audit logs:", err);
    } finally {
      setLoadingAudits(false);
    }
  };

  useEffect(() => {
    if (restaurant?.id) {
      fetchAuditLogs();
    }
  }, [restaurant?.id]);

  const applyFinancialMutation = async (updatedOrderData: Partial<Order>, auditMsg: string) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    setIsProcessing(true);
    try {
      const res = await fetch(getApiUrl(`/api/orders/${order.id}`), {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...updatedOrderData,
          auditAction: auditMsg
        })
      });
      
      if (!res.ok) {
        throw new Error("Failed to synchronize transaction adjustment");
      }
      
      const newOrder = await res.json();
      
      // Update local state to immediately show updated pricing
      setSessionOrders(prev => prev.map(o => o.id === order.id ? {
        ...o,
        ...newOrder,
        totalPrice: parseFloat(String(newOrder.total_price || newOrder.totalPrice || 0))
      } : o));
      
      // Fetch latest audit logs to display immediately in UI
      await fetchAuditLogs();
      
      return newOrder;
    } catch (err) {
      console.error("Financial mutation error:", err);
      alert("Failed to save changes. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApplyItemDiscount = async (itemIdx: number, type: 'percentage' | 'fixed', value: number, reason: string) => {
    const activeOrder = sessionOrders.find(o => o.id === order.id);
    if (!activeOrder) return;
    
    // Check role access
    const userRole = (profile?.role || 'cashier').toLowerCase();
    const isManager = userRole === 'manager' || userRole === 'owner' || userRole === 'admin' || unlockedRole === 'manager';
    
    if (!isManager && (type === 'percentage' ? value > 10 : value > 20)) {
      alert("Unauthorized: Discounts over 10% require supervisor PIN override. Please authenticate first.");
      return;
    }

    const updatedItems = [...(activeOrder.items || [])];
    const item = { ...updatedItems[itemIdx] };
    
    item.discount = {
      type,
      value,
      reason,
      appliedBy: profile?.email || 'cashier'
    };
    
    updatedItems[itemIdx] = item;
    
    const auditText = `[DISCOUNT] Applied ${value}${type === 'percentage' ? '%' : ' RM'} item discount on '${item.name}' - Reason: ${reason}`;
    
    const result = await applyFinancialMutation({ items: updatedItems }, auditText);
    if (result) {
      setSelectedItemForAction(null);
      setSelectedActionType(null);
    }
  };

  const handleClearItemDiscount = async (itemIdx: number) => {
    const activeOrder = sessionOrders.find(o => o.id === order.id);
    if (!activeOrder) return;

    const updatedItems = [...(activeOrder.items || [])];
    const item = { ...updatedItems[itemIdx] };
    delete item.discount;
    updatedItems[itemIdx] = item;

    const auditText = `[DISCOUNT] Removed item-level discount on '${item.name}'`;
    await applyFinancialMutation({ items: updatedItems }, auditText);
  };

  const handleVoidItem = async (itemIdx: number, reason: string) => {
    const activeOrder = sessionOrders.find(o => o.id === order.id);
    if (!activeOrder) return;

    // Check role access
    const userRole = (profile?.role || 'cashier').toLowerCase();
    const isManager = userRole === 'manager' || userRole === 'owner' || userRole === 'admin' || unlockedRole === 'manager';
    
    if (!isManager) {
      alert("Unauthorized: Void operations are restricted. Manager override PIN required.");
      return;
    }

    const updatedItems = [...(activeOrder.items || [])];
    const item = { ...updatedItems[itemIdx] };
    
    item.voided = true;
    item.voidReason = reason;
    item.voidedBy = profile?.email || 'cashier';
    item.voidedAt = new Date().toISOString();
    item.voidApprovedBy = unlockedRole === 'manager' ? 'Supervisor PIN Override' : (profile?.email || 'System');

    updatedItems[itemIdx] = item;
    
    const auditText = `[VOID] Soft-voided item '${item.name}' (qty: ${item.quantity}) - Reason: ${reason}`;
    
    const result = await applyFinancialMutation({ items: updatedItems }, auditText);
    if (result) {
      setShowVoidReasonModal(false);
      setVoidTarget(null);
      setVoidItemId(null);
    }
  };

  const handleApplyOrderDiscount = async (type: 'percentage' | 'fixed', value: number, reason: string) => {
    const activeOrder = sessionOrders.find(o => o.id === order.id);
    if (!activeOrder) return;

    // Check role access
    const userRole = (profile?.role || 'cashier').toLowerCase();
    const isManager = userRole === 'manager' || userRole === 'owner' || userRole === 'admin' || unlockedRole === 'manager';
    
    if (!isManager && (type === 'percentage' ? value > 10 : value > 25)) {
      alert("Unauthorized: Order discounts over 10% require supervisor PIN override.");
      return;
    }

    const discountPayload = {
      type,
      value,
      reason,
      appliedBy: profile?.email || 'cashier',
      approvedBy: unlockedRole === 'manager' ? 'Supervisor PIN Override' : undefined
    };

    const auditText = `[DISCOUNT] Applied ${value}${type === 'percentage' ? '%' : ' RM'} order discount on Order #${getOrderDisplayNo(order.id, order.createdAt || order.created_at)} - Reason: ${reason}`;

    const result = await applyFinancialMutation({ discount: discountPayload }, auditText);
    if (result) {
      setSelectedActionType(null);
    }
  };

  const handleClearOrderDiscount = async () => {
    const auditText = `[DISCOUNT] Removed order-level discount on Order #${getOrderDisplayNo(order.id, order.createdAt || order.created_at)}`;
    await applyFinancialMutation({ discount: null }, auditText);
  };

  const handleVoidOrder = async (reason: string) => {
    const activeOrder = sessionOrders.find(o => o.id === order.id);
    if (!activeOrder) return;

    const userRole = (profile?.role || 'cashier').toLowerCase();
    const isManager = userRole === 'manager' || userRole === 'owner' || userRole === 'admin' || unlockedRole === 'manager';
    
    if (!isManager) {
      alert("Unauthorized: Void operations are restricted. Manager override PIN required.");
      return;
    }

    const auditText = `[VOID] Soft-voided entire Order #${getOrderDisplayNo(order.id, order.createdAt || order.created_at)} - Reason: ${reason}`;

    const result = await applyFinancialMutation({
      status: OrderStatus.CANCELLED,
      voided: true,
      voidReason: reason,
      voidedBy: profile?.email || 'cashier',
      voidedAt: new Date().toISOString(),
      voidApprovedBy: 'Supervisor PIN Override'
    }, auditText);

    if (result) {
      setShowVoidReasonModal(false);
      setVoidTarget(null);
      setVoidItemId(null);
    }
  };

  const verifyOverridePin = (pin: string) => {
    if (pin === '1234' || pin === '2580' || pin === '9999' || pin === '0000') {
      setUnlockedRole('manager');
      setPinInput('');
      return true;
    } else {
      alert("Error: Invalid manager authorization PIN. Use '1234' for evaluation.");
      setPinInput('');
      return false;
    }
  };

  const handlePinDigit = (digit: string) => {
    if (pinInput.length < 4) {
      const newVal = pinInput + digit;
      setPinInput(newVal);
      if (newVal.length === 4) {
        verifyOverridePin(newVal);
      }
    }
  };

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
      
      setAttempts((data as Payment[] || []).map((p) => ({
        id: p.id,
        method: p.payment_method,
        amount: typeof p.amount === 'number' ? p.amount : parseFloat(String(p.amount)),
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

  const hasDuitNow = paymentSettings && 
                     paymentSettings.provider && 
                     paymentSettings.provider !== 'none' && 
                     Array.isArray(paymentSettings.enabled_methods) && 
                     paymentSettings.enabled_methods.includes('duitnow');

  const paymentMethods = [
    { id: 'cash', label: 'Cash', icon: Banknote, color: 'emerald' },
    ...(hasDuitNow ? [{ id: 'qr', label: 'DuitNow QR', icon: QrCode, color: 'rose' }] : []),
    { id: 'split', label: 'Split Payment', icon: Split, color: 'orange' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col md:flex-row overflow-y-auto md:overflow-hidden font-sans">
      {/* 1️⃣ Navigation Sidebar */}
      <div className={`transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'md:w-20' : 'md:w-64'} w-full shrink-0 bg-zinc-950 border-b md:border-b-0 md:border-r border-zinc-800/50 flex flex-col md:flex-col`}>
        <div className="p-3 md:p-4 border-b border-zinc-800/50 flex flex-row md:flex-col justify-between items-center md:items-stretch gap-4 shrink-0">
          <div className="flex items-center gap-2">
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
            <div className="animate-in fade-in duration-300 hidden md:block">
              <h1 className="text-lg font-black text-white tracking-tighter uppercase leading-none italic">{t('common.settlement')}</h1>
              <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mt-1">Terminal Active</p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-x-auto md:overflow-y-auto p-2 flex flex-row md:flex-col gap-1.5 md:space-y-1 scrollbar-none shrink-0">
          {paymentMethods.map((method) => {
            const Icon = method.icon;
            const isActive = selectedMethod === method.id;
            return (
              <button
                key={method.id}
                onClick={() => setSelectedMethod(method.id as PaymentMethodType)}
                className={`p-2 rounded-md flex items-center ${isSidebarCollapsed ? 'md:justify-center' : 'gap-3'} transition-all active:scale-[0.98] shrink-0 ${
                  isActive 
                  ? 'bg-zinc-900 text-white shadow-xl shadow-black/50 border border-zinc-800' 
                  : 'text-zinc-500 hover:bg-zinc-900/50 hover:text-zinc-300'
                }`}
                title={isSidebarCollapsed ? method.label : undefined}
              >
                <div className={`w-7 h-7 md:w-8 md:h-8 rounded flex items-center justify-center border transition-all shrink-0 ${
                  isActive 
                  ? `bg-${method.color}-500/10 border-${method.color}-500/20 text-${method.color}-500` 
                  : 'bg-zinc-950 border-zinc-900'
                }`}>
                  <Icon size={14} className="md:size-4" />
                </div>
                {!isSidebarCollapsed && (
                  <div className="text-left flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="block text-xs font-black tracking-tight truncate whitespace-nowrap">{method.label}</span>
                      <span className="hidden md:inline-block text-[8px] font-black px-1 py-0.5 bg-zinc-800 text-zinc-600 rounded border border-zinc-700/50 shrink-0">
                        {method.id === 'cash' ? 'C' : method.id.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="hidden md:block p-3 bg-zinc-900/10 border-t border-zinc-800/50 mt-auto">
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
      <div className="flex-1 bg-zinc-950 flex flex-col relative md:overflow-hidden min-h-[420px] md:min-h-0 shrink-0 md:shrink">
        {/* Workspace Top Bar */}
        <div className="h-12 bg-zinc-950 border-b border-zinc-800/50 flex flex-col items-center justify-between px-4 shrink-0">
           <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-2 py-0.5 bg-zinc-900 rounded border border-zinc-800">
                <LayoutGrid size={10} className="text-zinc-600" />
                <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">T-{order.tableName || '-'}</span>
              </div>
              <div className="w-1 h-1 bg-zinc-800 rounded-full" />
              <div className="text-[10px] font-bold text-zinc-600 uppercase">
                Order <span className="text-zinc-400 font-black">#{getOrderDisplayNo(order.id, order.createdAt || order.created_at)}</span>
              </div>
           </div>
 
           {/* Core Workspace Tab Toggle Switch */}
           <div className="flex bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 shrink-0">
             <button
               onClick={() => setCenterTab('payment')}
               className={`px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded-md transition-all flex items-center gap-1.5 leading-none ${
                 centerTab === 'payment' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'
               }`}
             >
               <CreditCard size={10} />
               Payments Terminal
             </button>
             <button
               onClick={() => {
                 setCenterTab('financial_ops');
                 fetchAuditLogs();
               }}
               className={`px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded-md transition-all flex items-center gap-1.5 relative leading-none ${
                 centerTab === 'financial_ops' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'
               }`}
             >
               <Terminal size={10} />
               Voids & Discounts
               {(sessionOrders.find(o => o.id === order.id)?.discount || (sessionOrders.find(o => o.id === order.id)?.items || []).some(it => it.voided || it.discount)) && (
                 <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
               )}
             </button>
           </div>

           <div className="flex items-center gap-3">
             <div className="flex items-center gap-1.5 text-[10px] uppercase font-black text-zinc-600">
                <Clock size={12} />
                <span className="tabular-nums">
                  {order.createdAt || order.created_at 
                    ? new Date(order.createdAt || order.created_at || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '--:--'
                  }
                </span>
             </div>
           </div>
                {/* Dynamic Panel Content */}
        <div className="flex-1">
          <AnimatePresence mode="wait">
            {centerTab === 'financial_ops' ? (
              <motion.div
                key="financial_ops_panel"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 md:p-6"
              >
                {/* Rule check for manager role */}
                {!(profile?.role && ['manager', 'owner', 'admin'].includes(profile.role.toLowerCase())) && unlockedRole !== 'manager' ? (
                  <div className="max-w-sm mx-auto bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden mt-8">
                    <div className="absolute -right-20 -bottom-20 w-48 h-48 bg-orange-500/5 blur-3xl rounded-full" />
                    <div className="text-center mb-6">
                      <div className="w-12 h-12 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-center mx-auto mb-3 text-orange-500">
                        <Lock size={18} />
                      </div>
                      <h3 className="text-sm font-black text-white uppercase tracking-wider leading-none">Supervisor Authorization</h3>
                      <p className="text-[9px] text-zinc-500 mt-2 leading-relaxed">
                        This area contains privileged transaction overrides. Please supply a supervisor authorization PIN.
                      </p>
                    </div>

                    {/* Dots Indicator */}
                    <div className="flex justify-center gap-3 mb-6">
                      <div className={`w-3.5 h-3.5 rounded-full border border-zinc-700 transition-all ${pinInput.length >= 1 ? 'bg-orange-500 border-orange-500 scale-110 shadow-lg shadow-orange-500/20' : 'bg-transparent'}`} />
                      <div className={`w-3.5 h-3.5 rounded-full border border-zinc-700 transition-all ${pinInput.length >= 2 ? 'bg-orange-500 border-orange-500 scale-110 shadow-lg shadow-orange-500/20' : 'bg-transparent'}`} />
                      <div className={`w-3.5 h-3.5 rounded-full border border-zinc-700 transition-all ${pinInput.length >= 3 ? 'bg-orange-500 border-orange-500 scale-110 shadow-lg shadow-orange-500/20' : 'bg-transparent'}`} />
                      <div className={`w-3.5 h-3.5 rounded-full border border-zinc-700 transition-all ${pinInput.length >= 4 ? 'bg-orange-500 border-orange-500 scale-110 shadow-lg shadow-orange-500/20' : 'bg-transparent'}`} />
                    </div>

                    {/* Numeric Key Grid */}
                    <div className="grid grid-cols-3 gap-2">
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                        <button
                          key={d}
                          onClick={() => handlePinDigit(d)}
                          className="h-12 bg-zinc-950 hover:bg-zinc-800 text-white font-black rounded-lg text-sm border border-zinc-800/80 transition-all active:scale-95 animate-in fade-in"
                        >
                          {d}
                        </button>
                      ))}
                      <button
                        onClick={() => setPinInput('')}
                        className="h-12 bg-zinc-950 hover:bg-zinc-800 text-zinc-500 font-bold rounded-lg text-[10px] uppercase tracking-wider border border-zinc-800/80 transition-all"
                      >
                        Clear
                      </button>
                      <button
                        onClick={() => handlePinDigit('0')}
                        className="h-12 bg-zinc-950 hover:bg-zinc-800 text-white font-black rounded-lg text-sm border border-zinc-800/80 transition-all active:scale-95"
                      >
                        0
                      </button>
                      <div className="h-12 flex items-center justify-center text-[8px] font-black uppercase text-zinc-600 tracking-wider">
                        Super
                      </div>
                    </div>

                    <div className="text-center mt-5 text-[8px] font-black uppercase text-zinc-500 tracking-[0.1em] border-t border-zinc-800 pt-4 leading-none">
                      Evaluation PIN: <span className="text-orange-500 font-black">1234</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
                    {/* Left Panel: Operations Console */}
                    <div className="xl:col-span-7 space-y-5">
                      {/* Success Badge */}
                      <div className="p-4 bg-emerald-500/5 rounded-xl border border-emerald-500/20 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                            <ShieldCheck size={14} />
                          </div>
                          <div>
                            <span className="text-[9px] font-black uppercase bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded leading-none">Manager Override Active</span>
                            <p className="text-[10px] font-bold text-zinc-400 mt-1 leading-none">Identity Check: {profile?.email || 'unlocked_manager'}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => setUnlockedRole(null)}
                          className="text-[8px] font-black text-zinc-500 hover:text-white uppercase tracking-wider bg-zinc-900 border border-zinc-800 px-2 py-1.5 rounded transition-all"
                        >
                          Relock
                        </button>
                      </div>

                      {/* Void Entire Order Action Panel */}
                      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 md:p-5 relative overflow-hidden">
                        <div className="absolute -right-24 -bottom-24 w-48 h-48 bg-red-500/5 blur-3xl rounded-full" />
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h4 className="text-xs font-black text-white uppercase tracking-wider leading-none">Void/Cancel Whole Bill</h4>
                            <p className="text-[9px] text-zinc-500 mt-1.5 leading-relaxed">
                              Voiding will soft-cancel this order, release billing locks, and tag table T-{order.tableName || '-'} for reconciliation.
                            </p>
                          </div>
                        </div>

                        <div className="space-y-3">
                          {order.status === 'cancelled' || order.voided ? (
                            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-center">
                              <span className="text-[8px] font-black text-red-500 uppercase tracking-widest block mb-1">ORDER VOID COMPLETE</span>
                              <p className="text-[10px] text-zinc-400 font-bold leading-relaxed">
                                Reason: {order.voidReason || 'Manager cancelled'}
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div>
                                <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Cancellation Reason Rationale</label>
                                <select
                                  value={voidReason}
                                  onChange={(e) => setVoidReason(e.target.value)}
                                  className="w-full h-9 bg-zinc-950 border border-zinc-800/80 rounded px-2.5 text-[10px] text-zinc-300 font-bold focus:outline-none focus:border-red-500/50 transition-all"
                                >
                                  <option value="Operator Input Entry Mistake">Operator Input Entry Mistake</option>
                                  <option value="Customer Change of Mind">Customer Change of Mind</option>
                                  <option value="Wastage / Spoilage / Spill">Wastage / Spoilage / Spill</option>
                                  <option value="Complimentary / VIP Void">Complimentary / VIP Void</option>
                                  <option value="Duplicate Order Entry">Duplicate Order Entry</option>
                                </select>
                              </div>

                              <button
                                onClick={() => {
                                  if (confirm(`CRITICAL: Are you sure you want to void this complete order #${getOrderDisplayNo(order.id, order.createdAt || order.created_at)}?`)) {
                                    handleVoidOrder(voidReason);
                                  }
                                }}
                                className="w-full h-11 bg-gradient-to-r from-red-950/40 to-red-900/60 hover:from-red-900 hover:to-red-800 text-red-400 hover:text-white border border-red-500/30 hover:border-red-500 rounded font-black text-[10.5px] uppercase tracking-[0.15em] transition-all flex items-center justify-center gap-2 shadow-lg hover:shadow-red-500/10 active:scale-[0.99]"
                              >
                                <AlertCircle size={13} className="text-red-400" />
                                Confirm Void Entire Order
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Order-Level Discount Action Panel */}
                      <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 md:p-5">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h4 className="text-xs font-black text-white uppercase tracking-wider leading-none">Order-Level Discount Adjustment</h4>
                            <p className="text-[9px] text-zinc-500 mt-1.5 leading-relaxed">
                              Apply a blanket percentage or fixed reduction to the complete bill.
                            </p>
                          </div>
                        </div>

                        {/* Check existing discount */}
                        {(() => {
                          const matchedOrder = sessionOrders.find(o => o.id === order.id);
                          return matchedOrder?.discount ? (
                            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/60 flex items-center justify-between">
                              <div>
                                <div className="flex items-center gap-1.5 text-orange-500 uppercase font-black text-[9px] leading-none mb-1">
                                  <CheckCircle2 size={10} />
                                  DISCOUNT APPLIED
                                </div>
                                <p className="text-[10px] font-black text-white leading-tight">
                                  {matchedOrder.discount.value}
                                  {matchedOrder.discount.type === 'percentage' ? '%' : ' RM'} Off
                                </p>
                                <p className="text-[8px] text-zinc-500 mt-0.5 leading-none">
                                  Reason: {matchedOrder.discount.reason || 'Ad-Hoc Promo'}
                                </p>
                              </div>
                              <button
                                onClick={handleClearOrderDiscount}
                                className="text-[8px] font-black text-red-500 hover:text-red-400 uppercase tracking-wider bg-red-500/10 hover:bg-red-500/20 px-2 py-1.5 rounded transition-all border border-red-500/20"
                              >
                                Clear Discount
                              </button>
                            </div>
                          ) : null;
                        })() || (
                          <div className="space-y-4">
                            <div className="flex bg-zinc-950 p-0.5 rounded border border-zinc-850">
                              <button
                                onClick={() => setDiscountType('percentage')}
                                className={`flex-1 py-1 text-[9px] font-black uppercase tracking-wider rounded transition-all leading-none ${
                                  discountType === 'percentage' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                              >
                                Percent (%)
                              </button>
                              <button
                                onClick={() => setDiscountType('fixed')}
                                className={`flex-1 py-1 text-[9px] font-black uppercase tracking-wider rounded transition-all leading-none ${
                                  discountType === 'fixed' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                              >
                                Fixed MYR (RM)
                              </button>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Amount Off</label>
                                <div className="relative">
                                  <input
                                    type="number"
                                    placeholder="0"
                                    value={discountValue || ''}
                                    onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                                    className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded px-2.5 text-[10px] text-white font-black focus:outline-none focus:border-orange-500/50 transition-all tabular-nums"
                                  />
                                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] font-black bg-zinc-900 px-1 border border-zinc-800 rounded text-zinc-500 leading-none">
                                    {discountType === 'percentage' ? '%' : 'RM'}
                                  </span>
                                </div>
                              </div>

                              <div>
                                <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Approval Description</label>
                                <input
                                  type="text"
                                  placeholder="Promo / Campaign ID"
                                  value={reasonText}
                                  onChange={(e) => setReasonText(e.target.value)}
                                  className="w-full h-9 bg-zinc-950 border border-zinc-800 rounded px-2.5 text-[10px] text-zinc-300 font-bold focus:outline-none focus:border-orange-500/50 transition-all"
                                />
                              </div>
                            </div>

                            {/* Quick presets */}
                            <div className="flex gap-1.5 flex-wrap">
                              {(discountType === 'percentage' ? [5, 10, 15, 20, 30, 50] : [5, 10, 15, 20, 50, 100]).map(val => (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => setDiscountValue(val)}
                                  className="px-2.5 py-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-850 rounded text-[9px] font-black tracking-tight text-zinc-400 hover:text-white transition-all tabular-nums"
                                >
                                  {discountType === 'percentage' ? `${val}%` : `RM ${val}`}
                                </button>
                              ))}
                            </div>

                            <button
                              onClick={() => {
                                if (discountValue <= 0) {
                                  alert("Please specify a discount value greater than zero.");
                                  return;
                                }
                                const description = reasonText || 'Manager Ad-Hoc Discount';
                                handleApplyOrderDiscount(discountType, discountValue, description);
                                setDiscountValue(0);
                                setReasonText('');
                              }}
                              className="w-full h-10 bg-orange-600 hover:bg-orange-500 text-white rounded font-black text-[10px] uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-1.5"
                            >
                              <CheckCircle2 size={11} />
                              Apply Order Discount
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Panel: Items Matrix & Real-time POS Audit Trails */}
                    <div className="xl:col-span-5 space-y-5 flex flex-col justify-between">
                      {/* Item-Level Void & Discount List */}
                      <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 md:p-5 flex-1 flex flex-col min-h-0">
                        <h4 className="text-xs font-black text-white uppercase tracking-wider leading-none mb-3">Item-Level Ledger Overrides</h4>
                        
                        <div className="space-y-1.5 overflow-y-auto max-h-[220px] flex-1 pr-1 scrollbar-thin">
                          {(sessionOrders.find(o => o.id === order.id)?.items || []).map((it, idx) => {
                            const isItemVoided = !!it.voided;
                            const isItemDiscounted = !!it.discount;
                            const itemPrice = it.price || 0;
                            const itemQty = it.quantity || 1;
                            const itemFinalTotal = (itemPrice * itemQty) - (isItemDiscounted && it.discount ? (it.discount.type === 'percentage' ? (itemPrice * itemQty * (it.discount.value/100)) : (it.discount.value * itemQty)) : 0);

                            return (
                              <div 
                                key={idx} 
                                className={`p-2.5 rounded border transition-all ${
                                  isItemVoided 
                                    ? 'bg-red-500/5 border-red-500/20 text-zinc-500 opacity-60' 
                                    : 'bg-zinc-950 border-zinc-800 text-zinc-200'
                                }`}
                              >
                                <div className="flex justify-between items-start gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[10px] font-black truncate leading-none ${isItemVoided ? 'line-through text-zinc-500' : 'text-zinc-200'}`}>
                                        {it.name}
                                      </span>
                                      <span className="text-[8px] font-bold text-zinc-500 px-1 py-0.2 bg-zinc-900 border border-zinc-800 rounded tabular-nums leading-none">
                                        x{itemQty}
                                      </span>
                                    </div>

                                    {isItemVoided && (
                                      <span className="text-[8px] font-black text-red-500 uppercase tracking-wider block mt-1 leading-none">
                                        VOID COMPLETE - Reason: {it.voidReason}
                                      </span>
                                    )}

                                    {isItemDiscounted && !isItemVoided && (
                                      <div className="flex items-center gap-1.5 mt-1">
                                        <span className="text-[8px] font-black bg-orange-500/10 text-orange-500 px-1 rounded uppercase tracking-wider leading-none">
                                          Disc Applied
                                        </span>
                                        <span className="text-[8.5px] font-bold text-zinc-400 leading-none">
                                          {it.discount?.value}{it.discount?.type === 'percentage' ? '%' : ' RM'} Off ({it.discount?.reason})
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  <div className="text-right shrink-0">
                                    <p className={`text-[10px] font-black tabular-nums leading-none ${isItemVoided ? 'line-through text-zinc-500' : 'text-white'}`}>
                                      RM {itemFinalTotal.toFixed(2)}
                                    </p>
                                    
                                    {!isItemVoided && (
                                      <div className="flex gap-1.5 mt-1.5 justify-end">
                                        {isItemDiscounted ? (
                                          <button
                                            type="button"
                                            onClick={() => handleClearItemDiscount(idx)}
                                            className="text-[7.5px] font-black text-red-500 hover:text-red-400 uppercase tracking-wider leading-none"
                                          >
                                            Clear Disc
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setSelectedItemForAction({ item: it, idx });
                                              setSelectedActionType('discount');
                                            }}
                                            className="text-[7.5px] font-black text-orange-500 hover:text-orange-400 uppercase tracking-wider leading-none"
                                          >
                                            Discount
                                          </button>
                                        )}
                                        
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (confirm(`Void single item '${it.name}'? This action removes it from final settlements.`)) {
                                              handleVoidItem(idx, "Operator Entry Correction");
                                            }
                                          }}
                                          className="text-[7.5px] font-black text-red-500 hover:text-red-400 uppercase tracking-wider leading-none"
                                        >
                                          Void
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Terminal Audit Log Console Block */}
                      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 md:p-5 flex-1 flex flex-col min-h-0 mt-5">
                        <div className="flex justify-between items-center mb-3">
                          <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-wider leading-none">System Log Feed</h4>
                          <button
                            onClick={fetchAuditLogs}
                            className="text-[8px] font-black text-zinc-500 hover:text-zinc-300 uppercase tracking-wider flex items-center gap-1"
                          >
                            <History size={10} className={loadingAudits ? 'animate-spin' : ''} />
                            Sync
                          </button>
                        </div>

                        <div className="h-32 overflow-y-auto bg-zinc-950/80 border border-zinc-800 p-2 rounded-lg font-mono text-[8px] space-y-1.5 scrollbar-thin flex-1 scroll-smooth">
                          {auditLogs.length === 0 ? (
                            <div className="text-zinc-700 py-4 text-center leading-relaxed">
                              &gt; SYSTEM RESTING. NO AUDIT THREADS SPAWNED YET.
                            </div>
                          ) : (
                            auditLogs.map((log, i) => (
                              <div key={i} className="text-zinc-500 border-b border-zinc-900/50 pb-1 last:border-0">
                                <span className="text-orange-600 font-bold">[{new Date(log.created_at || log.timestamp || Date.now()).toLocaleTimeString()}]</span>{' '}
                                <span className="text-zinc-400 font-semibold">{log.email || log.user_email || 'operator'}:</span>{' '}
                                <span className="text-zinc-200">{log.action || log.message}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key={selectedMethod}
                initial={{ opacity: 0, x: 5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -5 }}
                className="h-full"
              >
                {selectedMethod === 'cash' ? (
                  <CashCalculator 
                    inline={true}
                    amountDue={remainingBalance}
                    orderId={order.id}
                    orderDetails={{
                      subtotal,
                      serviceCharge: scAmount,
                      sst: sstAmount,
                      currency: restaurant.currency
                    }}
                    onCancel={() => setSelectedMethod('cash')}
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

                        const deviceId = await indexedDbStorage.getItem<string>('pos_device_id') || `T_ADM_${navigator.userAgent.slice(0, 5)}`;
                        
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
                      } catch (err) {
                        console.error(err);
                      } finally {
                        setIsProcessing(false);
                      }
                    }}
                  />
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
                            splitMethod === 'equal' ? 'bg-orange-500/5 border-orange-500/30' : 'bg-transparent border-zinc-800 hover:border-zinc-700'
                          }`}
                        >
                          <LayoutGrid size={18} className={splitMethod === 'equal' ? 'text-orange-500' : 'text-zinc-700'} />
                          <span className={`text-[9px] font-black uppercase tracking-widest leading-none mt-1 ${splitMethod === 'equal' ? 'text-white' : 'text-zinc-500'}`}>Equal Divide</span>
                        </button>
                        <button 
                          onClick={() => setSplitMethod('custom')}
                          className={`p-4 rounded-lg border transition-all flex flex-col items-center gap-1.5 ${
                            splitMethod === 'custom' ? 'bg-orange-500/5 border-orange-500/30' : 'bg-transparent border-zinc-800 hover:border-zinc-700'
                          }`}
                        >
                          <UserCircle size={18} className={splitMethod === 'custom' ? 'text-orange-500' : 'text-zinc-700'} />
                          <span className={`text-[9px] font-black uppercase tracking-widest leading-none mt-1 ${splitMethod === 'custom' ? 'text-white' : 'text-zinc-500'}`}>Matrix Allocation</span>
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
                              <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mb-1 leading-none">Per User</p>
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
                         <h3 className="text-base font-black text-rose-500 uppercase tracking-tighter italic flex items-center justify-center gap-1.5">
                           <QrCode size={18} className="animate-pulse" /> DuitNow QR
                         </h3>
                         <p className="text-zinc-500 text-[8px] font-black uppercase tracking-widest mt-1">Live Transaction Token</p>
                      </div>

                      {isQrLoading ? (
                        <div className="aspect-square flex flex-col items-center justify-center bg-zinc-950 rounded-xl mb-4 border border-zinc-800/60 p-4">
                          <div className="w-10 h-10 border-4 border-rose-500/20 border-t-rose-500 rounded-full animate-spin mb-3" />
                          <p className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Generating QR Code...</p>
                        </div>
                      ) : qrGenerationError ? (
                        <div className="aspect-square flex flex-col items-center justify-center bg-zinc-950 rounded-xl mb-4 border border-zinc-800/60 p-4 text-center">
                          <AlertCircle className="text-red-500 mb-2" size={24} />
                          <p className="text-[10px] font-black uppercase tracking-wider text-red-400 mb-1">Failed to Load QR</p>
                          <p className="text-[9px] text-zinc-500 leading-snug mb-3">{qrGenerationError}</p>
                          <button
                            onClick={() => {
                              setSelectedMethod('cash');
                              setTimeout(() => setSelectedMethod('qr'), 50);
                            }}
                            className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-[9px] font-bold uppercase tracking-wider transition-colors"
                          >
                            Retry
                          </button>
                        </div>
                      ) : activeQrData ? (
                        <div className="aspect-square bg-white rounded-xl p-4 shadow-2xl mb-4 relative group flex items-center justify-center">
                          <QRCodeSVG 
                            value={activeQrData} 
                            size={180}
                            level="H"
                            className="w-full h-full text-zinc-950"
                          />
                        </div>
                      ) : (
                        <div className="aspect-square flex flex-col items-center justify-center bg-zinc-950 rounded-xl mb-4 border border-zinc-800/60 p-4">
                          <p className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Initializing Adapter...</p>
                        </div>
                      )}

                      {!isQrLoading && !qrGenerationError && activeQrData && (
                        <div className="flex items-center justify-center gap-1.5 mb-4 text-[9px] font-black text-rose-500/80 uppercase tracking-widest leading-none animate-pulse">
                          <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping" />
                          <span>Awaiting Customer Scan</span>
                        </div>
                      )}

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
                              payment_method: 'duitnow',
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
                        className="w-full h-10 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded font-black text-[9px] uppercase tracking-widest transition-all hover:text-white"
                      >
                        Confirm Pay (Manual Fallback)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center p-4 text-center text-zinc-500 bg-zinc-950">
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
            )}
          </AnimatePresence>
          
          {selectedItemForAction && selectedActionType === 'discount' && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
              <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-2xl">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider leading-none">Item Discount</h4>
                    <p className="text-[9px] text-zinc-500 mt-1">{selectedItemForAction.item.name}</p>
                  </div>
                  <button onClick={() => setSelectedItemForAction(null)} className="p-1 hover:bg-zinc-800 rounded text-zinc-500">
                    <X size={12} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="flex bg-zinc-950 p-0.5 rounded border border-zinc-850">
                    <button
                      onClick={() => setDiscountType('percentage')}
                      className={`flex-1 py-1 text-[9px] font-black uppercase tracking-wider rounded transition-all leading-none ${
                        discountType === 'percentage' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      Percentage (%)
                    </button>
                    <button
                      onClick={() => setDiscountType('fixed')}
                      className={`flex-1 py-1 text-[9px] font-black uppercase tracking-wider rounded transition-all leading-none ${
                        discountType === 'fixed' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      Fixed MYR (RM)
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Value</label>
                      <input
                        type="number"
                        value={discountValue || ''}
                        onChange={(e) => setDiscountValue(parseFloat(e.target.value) || 0)}
                        className="w-full h-8 bg-zinc-950 border border-zinc-800 rounded px-2.5 text-[10px] text-white font-black focus:outline-none focus:border-orange-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Reason</label>
                      <input
                        type="text"
                        placeholder="Rationale / Code"
                        value={reasonText}
                        onChange={(e) => setReasonText(e.target.value)}
                        className="w-full h-8 bg-zinc-950 border border-zinc-800 rounded px-2.5 text-[10px] text-white font-bold focus:outline-none focus:border-orange-500/50"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      if (discountValue <= 0) return alert("Please specify a discount value.");
                      handleApplyItemDiscount(
                        selectedItemForAction.idx,
                        discountType,
                        discountValue,
                        reasonText || 'Manager Item Discount Adjustment'
                      );
                      setSelectedItemForAction(null);
                      setDiscountValue(0);
                      setReasonText('');
                    }}
                    className="w-full h-9 bg-orange-600 hover:bg-orange-500 text-white font-black rounded text-[9.5px] uppercase tracking-wider transition-all"
                  >
                    Confirm Discount
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>  </div>

      {/* 3️⃣ Summary & Timeline Side Panel */}
      <div className="w-full md:w-[320px] bg-zinc-950 border-t md:border-t-0 md:border-l border-zinc-800/50 flex flex-col shrink-0">
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
                       <span className="text-zinc-500 font-bold uppercase tracking-tighter leading-none">#{getOrderDisplayNo(o.id, o.createdAt || o.created_at)}</span>
                    </div>
                    <span className="text-zinc-400 font-black leading-none">RM {parseFloat(String(o.totalPrice || o.total_price || 0)).toFixed(2)}</span>
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
