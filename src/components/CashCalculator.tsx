import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Banknote, 
  Calculator, 
  Check, 
  X, 
  ArrowRight, 
  CornerDownRight, 
  ShieldCheck, 
  Printer, 
  Plus, 
  Minus, 
  AlertCircle,
  Clock,
  History,
  Lock,
  Unlock,
  CreditCard,
  Hash
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';

type CashCalculatorStatus = 'idle' | 'calculating' | 'awaiting_confirmation' | 'confirmed' | 'completed' | 'voided';

interface CashCalculatorProps {
  amountDue: number;
  orderId: string;
  orderDetails?: {
    subtotal: number;
    serviceCharge: number;
    sst: number;
    currency?: string;
  };
  onComplete: (data: { 
    cashReceived: number; 
    changeGiven: number; 
    rounding: number;
    isPartial: boolean;
    remainingBalance: number;
  }) => void;
  onCancel: () => void;
  inline?: boolean;
}

export function CashCalculator({ amountDue: initialAmountDue, orderId, orderDetails, onComplete, onCancel, inline = false }: CashCalculatorProps) {
  const { profile } = useAuthStore();
  const currency = orderDetails?.currency || 'RM';
  const [cashReceived, setCashReceived] = useState<string>('');
  const [status, setStatus] = useState<CashCalculatorStatus>('calculating');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  
  // Malaysian rounding logic (to nearest 0.05) if using cash
  const roundToFiveSen = (amount: number) => {
    return Math.round(amount * 20) / 20;
  };

  const finalAmountDue = useMemo(() => roundToFiveSen(initialAmountDue), [initialAmountDue]);
  const roundingAdjustment = useMemo(() => finalAmountDue - initialAmountDue, [finalAmountDue, initialAmountDue]);

  const cash = parseFloat(cashReceived || '0');
  const change = Math.max(0, cash - finalAmountDue);
  const remaining = Math.max(0, finalAmountDue - cash);
  const isSufficient = cash >= finalAmountDue;
  const isPartial = cash > 0 && cash < finalAmountDue;

  const quickCashButtons = [5, 10, 20, 50, 100];
  const incrementButtons = [1, 5, 10, 50];
  
  // Smart suggestions
  const suggestions = useMemo(() => {
    const s = new Set<number>();
    s.add(finalAmountDue); // Exact
    quickCashButtons.forEach(btn => {
      if (btn > finalAmountDue) s.add(btn);
    });
    
    // Add common next-level notes
    const nextFive = Math.ceil(finalAmountDue / 5) * 5;
    const nextTen = Math.ceil(finalAmountDue / 10) * 10;
    const nextFifty = Math.ceil(finalAmountDue / 50) * 50;
    
    if (nextFive > finalAmountDue) s.add(nextFive);
    if (nextTen > finalAmountDue) s.add(nextTen);
    if (nextFifty > finalAmountDue) s.add(nextFifty);
    
    return Array.from(s).sort((a, b) => a - b).slice(0, 5);
  }, [finalAmountDue]);

  const handleKeypad = (val: string) => {
    if (status !== 'calculating') return;
    if (val === 'CLEAR') {
      setCashReceived('');
      return;
    }
    if (val === '.' && cashReceived.includes('.')) return;
    
    const parts = cashReceived.split('.');
    if (parts.length > 1 && parts[1].length >= 2) return; // Max 2 decimal
    
    setCashReceived(prev => prev + val);
  };

  const addIncrement = (val: number) => {
    if (status !== 'calculating') return;
    const current = parseFloat(cashReceived || '0');
    setCashReceived((current + val).toFixed(2).replace(/\.00$/, ''));
  };

  const handleConfirm = () => {
    if (cash <= 0) return;
    setStatus('awaiting_confirmation');
  };

  const finalize = async () => {
    if (!profile || isProcessing) return;
    setIsProcessing(true);
    setStatus('confirmed');
    
    try {
      // Small artificial delay for "Cash Drawer Trigger" feel
      await new Promise(r => setTimeout(r, 600));
      
      onComplete({
        cashReceived: cash,
        changeGiven: change,
        rounding: roundingAdjustment,
        isPartial,
        remainingBalance: remaining
      });
      setStatus('completed');
    } catch (err) {
      console.error("Cash settlement failed:", err);
      setStatus('calculating');
    } finally {
      setIsProcessing(false);
    }
  };

  const outerClass = inline 
    ? "w-full h-full bg-zinc-950 relative flex flex-col overflow-y-auto" 
    : "fixed inset-0 z-50 flex items-start md:items-center justify-center p-0 md:p-2 bg-zinc-950/95 backdrop-blur-md overflow-y-auto";

  const innerClass = inline
    ? "w-full h-full bg-zinc-950 flex flex-col md:flex-row"
    : "w-full max-w-[850px] min-h-full md:min-h-0 h-auto md:h-[90vh] md:max-h-[600px] bg-zinc-950 border-b md:border border-zinc-800/50 md:rounded-xl shadow-2xl flex flex-col md:flex-row shadow-black";

  return (
    <div className={outerClass}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.99 }}
        animate={{ opacity: 1, scale: 1 }}
        className={innerClass}
      >
        {/* 1️⃣ Total Summary & Calculation Zone (Left) */}
        <div className="w-full md:w-[280px] bg-zinc-900/30 border-b md:border-b-0 md:border-r border-zinc-800/50 flex flex-col shrink-0">
          <div className="p-3 md:p-4 space-y-2 md:space-y-4 flex-none md:flex-1">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-emerald-500/10 rounded flex items-center justify-center border border-emerald-500/20 shadow-inner">
                  <Banknote size={16} className="text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-white tracking-tight uppercase italic leading-none">Cash Hub</h2>
                  <div className="flex items-center gap-1.5 text-zinc-600 text-[8px] font-black uppercase tracking-wider mt-1">
                    <Hash size={8} />
                    <span>#{orderId.slice(-4).toUpperCase()}</span>
                  </div>
                </div>
              </div>
              <button onClick={onCancel} className="p-1.5 hover:bg-zinc-800 rounded text-zinc-600 transition-colors">
                <X size={14} />
              </button>
            </div>

            {/* Total Summary Panel */}
            <div className="p-2.5 md:p-4 bg-zinc-900 border border-zinc-800 rounded shadow-inner">
              <div className="space-y-2">
                <div className="hidden md:block space-y-2">
                  {orderDetails ? (
                    <>
                      <div className="flex justify-between items-center text-[9px] font-bold text-zinc-600 uppercase tracking-widest leading-none">
                        <span>Subtotal</span>
                        <span className="text-zinc-500">{currency} {(orderDetails.subtotal || 0).toFixed(2)}</span>
                      </div>
                      {(orderDetails.serviceCharge || 0) > 0 && (
                        <div className="flex justify-between items-center text-[9px] font-bold text-zinc-700 uppercase tracking-widest leading-none">
                          <span>Tax/Fees</span>
                          <span>{currency} {(orderDetails.serviceCharge + orderDetails.sst).toFixed(2)}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex justify-between items-center text-[9px] font-bold text-zinc-600 uppercase tracking-widest leading-none">
                      <span>Order Total</span>
                      <span className="text-zinc-500">{currency} {(initialAmountDue || 0).toFixed(2)}</span>
                    </div>
                  )}
                  
                  {Math.abs(roundingAdjustment || 0) > 0 && (
                    <div className="flex justify-between items-center text-[8px] font-black text-orange-500/60 uppercase tracking-widest leading-none">
                      <span>Rounding</span>
                      <span>{(roundingAdjustment || 0) > 0 ? '+' : ''}{(roundingAdjustment || 0).toFixed(2)}</span>
                    </div>
                  )}
                </div>
                
                <div className="pt-1 md:pt-2 md:border-t md:border-zinc-800">
                  <p className="text-[8px] font-black uppercase tracking-widest text-zinc-600 mb-0.5 leading-none">Required Net</p>
                  <div className="flex items-baseline gap-1.5 leading-none">
                    <span className="text-zinc-600 font-black text-xs md:text-base italic leading-none">{currency}</span>
                    <span className="text-2xl md:text-3xl font-black text-white tabular-nums tracking-tighter leading-none">
                      {(finalAmountDue || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Calculation Panel */}
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {cash > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className={`p-4 rounded border transition-all ${
                      isSufficient ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-orange-500/5 border-orange-500/20'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex justify-between items-center leading-none">
                        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-600">Input</span>
                        <span className="text-base font-black text-white tabular-nums tracking-tight">{currency} {cash.toFixed(2)}</span>
                      </div>
                      <div className="h-px bg-zinc-800/50" />
                      <div className="flex justify-between items-end leading-none">
                        <div className="leading-none">
                          <span className="text-[8px] font-black uppercase tracking-widest text-zinc-600 block mb-1">
                            {isSufficient ? 'Change' : 'Remaining'}
                          </span>
                          <span className={`text-2xl font-black tabular-nums tracking-tighter ${
                            isSufficient ? 'text-emerald-500' : 'text-orange-500'
                          }`}>
                            {currency} {(isSufficient ? change : remaining).toFixed(2)}
                          </span>
                        </div>
                        {isPartial && (
                          <div className="bg-orange-500/10 px-1.5 py-0.5 rounded border border-orange-500/20 mb-0.5">
                            <span className="text-[7px] font-black text-orange-500 uppercase tracking-tighter">PARTIAL</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Bottom Security / Audit */}
          <div className="hidden md:block p-3 border-t border-zinc-800/50 bg-zinc-950/20">
            <div className="flex items-center gap-2 text-zinc-700 leading-none">
              <div className="w-7 h-7 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                <ShieldCheck size={12} />
              </div>
              <div className="flex-1 min-w-0 leading-none">
                <p className="text-[8px] font-black uppercase tracking-widest truncate leading-none">Audit Trace</p>
                <p className="text-[7px] font-bold text-zinc-800 truncate leading-none mt-1 uppercase italic">{profile?.email?.split('@')[0] || 'ADM-01'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* 2️⃣ Cash Input Panel (Right) */}
        <div className="flex-1 bg-zinc-950 flex flex-col">
          <div className="p-3 md:p-4 space-y-3 md:space-y-4 flex-none md:flex-1 overflow-y-visible md:overflow-y-auto scrollbar-none">
            
            {/* Quick Multi-Input Panel */}
            <div className="space-y-3 md:space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[9px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-1.5 italic">
                  <Calculator size={12} />
                  Matrix Entry
                </h3>
                <div className="h-px flex-1 ml-3 bg-zinc-900" />
              </div>

              {/* Incremental Buttons */}
              <div className="grid grid-cols-4 gap-1.5">
                {incrementButtons.map(val => (
                  <button
                    key={val}
                    onClick={() => addIncrement(val)}
                    className="h-8 md:h-10 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 rounded transition-all active:scale-95 flex flex-col items-center justify-center shrink-0"
                  >
                    <span className="text-[8px] font-black text-zinc-700 mb-0.5 leading-none">+{currency}</span>
                    <span className="text-xs font-black text-zinc-300 leading-none">{val}</span>
                  </button>
                ))}
              </div>

              {/* Exact & Common Denominations */}
              <div className="grid grid-cols-5 gap-1.5">
                <button
                  onClick={() => setCashReceived(finalAmountDue.toFixed(2))}
                  className="col-span-2 h-10 md:h-12 bg-emerald-600/5 hover:bg-emerald-600/10 border border-emerald-500/20 rounded-lg transition-all active:scale-95 flex flex-col items-center justify-center leading-none/95"
                >
                  <span className="text-[7px] font-black text-emerald-500 uppercase tracking-widest mb-1 leading-none italic">EXACT</span>
                  <span className="text-xs md:text-sm font-black text-white tracking-tighter leading-none">{finalAmountDue.toFixed(2)}</span>
                </button>
                {suggestions.filter(s => s !== finalAmountDue).slice(0, 3).map(amt => (
                  <button
                    key={amt}
                    onClick={() => setCashReceived(amt.toFixed(0))}
                    className="h-10 md:h-12 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-all active:scale-95 flex flex-col items-center justify-center leading-none"
                  >
                    <span className="text-[7px] font-black text-zinc-700 uppercase tracking-widest mb-1 leading-none italic">SYNC</span>
                    <span className="text-xs md:text-sm font-black text-zinc-300 tracking-tighter leading-none">{amt}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Keypad Panel */}
            <div className="space-y-3 md:space-y-4">
               <div className="flex items-center justify-between">
                <h3 className="text-[9px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-1.5 italic">
                  <Banknote size={12} />
                  Terminal Keypad
                </h3>
                <div className="h-px flex-1 ml-3 bg-zinc-900" />
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-3 md:left-4 flex items-center pointer-events-none">
                  <span className="text-xs md:text-sm font-black text-zinc-800">{currency}</span>
                </div>
                <input 
                  type="text" 
                  value={cashReceived}
                  readOnly
                  placeholder="0.00"
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-lg py-3 md:py-4 pl-10 md:pl-12 pr-10 md:pr-12 text-2xl md:text-3xl font-black text-white tabular-nums placeholder:text-zinc-900 focus:border-zinc-800 transition-colors leading-none"
                />
                {cashReceived && (
                   <button 
                    onClick={() => setCashReceived('')}
                    className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 p-1.5 bg-zinc-900 hover:bg-zinc-800 rounded text-zinc-600"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'C'].map((key) => (
                  <button
                    key={key}
                    onClick={() => key === 'C' ? handleKeypad('CLEAR') : handleKeypad(key)}
                    className={`h-11 md:h-14 rounded-lg text-base md:text-lg font-black transition-all active:scale-95 flex items-center justify-center border shadow-sm ${
                      key === 'C' 
                        ? 'bg-zinc-900/50 text-zinc-600 border-zinc-900/50 hover:bg-zinc-900 hover:text-white shadow-inner' 
                        : 'bg-zinc-900 text-white border-zinc-800 hover:bg-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    {key}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3️⃣ Action Zone (Bottom) */}
          <div className="p-4 bg-zinc-900/30 border-t border-zinc-800/50">
            <AnimatePresence mode="wait">
              {status === 'calculating' ? (
                <motion.button
                  key="confirm"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  onClick={handleConfirm}
                  disabled={cash <= 0}
                  className={`w-full h-12 rounded-lg font-black text-[10px] uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${
                    cash > 0 
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-600/10 active:scale-[0.98]' 
                    : 'bg-zinc-900 text-zinc-800 cursor-not-allowed border border-zinc-800 shadow-inner'
                  }`}
                >
                  {isPartial ? `Submit Partial ${cash.toFixed(2)}` : 'Settle Workspace'}
                  <ArrowRight size={14} />
                </motion.button>
              ) : status === 'awaiting_confirmation' ? (
                 <motion.div
                  key="awaiting"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-emerald-700 p-4 rounded-xl flex flex-col items-center gap-4 shadow-2xl border border-emerald-500/20"
                 >
                   <div className="text-center w-full">
                     <p className="text-emerald-300 text-[8px] font-black uppercase tracking-widest mb-1 italic">Verify Transaction</p>
                     <h3 className="text-xl font-black text-white tracking-tight leading-none italic">
                        {isSufficient ? `Give Change ${currency} ${change.toFixed(2)}?` : `Pay Partial ${currency} ${cash.toFixed(2)}?`}
                     </h3>
                   </div>
                   <div className="flex gap-2 w-full shrink-0">
                     <button 
                      onClick={() => setStatus('calculating')}
                      className="flex-1 h-10 bg-black/20 text-white rounded font-bold text-[9px] tracking-widest hover:bg-black/30 transition-colors uppercase"
                     >
                       Edit
                     </button>
                     <button 
                      onClick={finalize}
                      disabled={isProcessing}
                      className="flex-[2] h-10 bg-white text-emerald-800 rounded font-black text-[9px] tracking-[0.2em] uppercase hover:bg-emerald-50 shadow-xl transition-all flex items-center justify-center gap-2"
                     >
                       {isProcessing ? 'SYC...' : 'COMMIT OPS'}
                       <Check size={14} />
                     </button>
                   </div>
                 </motion.div>
              ) : status === 'confirmed' || status === 'completed' ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-zinc-900 border border-zinc-800 p-6 rounded-xl text-center flex flex-col items-center gap-4"
                >
                  <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/10 animate-pulse">
                    <Check size={24} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-emerald-500 tracking-tighter uppercase italic">Ops Success</h3>
                    <p className="text-zinc-600 text-[9px] font-black uppercase tracking-widest mt-1 italic">Voucher Synchronized</p>
                  </div>
                  <div className="flex gap-2 w-full max-w-sm">
                    <button className="flex-1 h-10 bg-zinc-800 text-zinc-400 rounded font-bold text-[9px] uppercase tracking-widest flex items-center justify-center gap-1.5 border border-zinc-700 transition-all">
                      <Printer size={12} /> Log
                    </button>
                    <button 
                      onClick={() => {
                        if (isFinishing) return;
                        setIsFinishing(true);
                        onCancel();
                      }}
                      disabled={isFinishing}
                      className="flex-[1.5] h-10 bg-white text-black rounded font-black text-[9px] uppercase tracking-[0.2em] transition-all shadow-xl disabled:opacity-50"
                    >
                      {isFinishing ? 'Closing...' : 'Finish'}
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
