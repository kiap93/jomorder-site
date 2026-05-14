import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Banknote, Calculator, Check, X, ArrowRight, CornerDownRight, ShieldCheck, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';

interface CashCalculatorProps {
  amountDue: number;
  orderId: string;
  onComplete: (data: { cashReceived: number; changeGiven: number; rounding: number }) => void;
  onCancel: () => void;
}

export function CashCalculator({ amountDue, orderId, onComplete, onCancel }: CashCalculatorProps) {
  const { profile } = useAuthStore();
  const [cashReceived, setCashReceived] = useState<string>('');
  const [status, setStatus] = useState<'calculating' | 'awaiting_confirmation' | 'completed'>('calculating');
  
  // Malaysian rounding logic (to nearest 0.05) if using cash
  const roundToFiveSen = (amount: number) => {
    return Math.round(amount * 20) / 20;
  };

  const finalAmountDue = useMemo(() => roundToFiveSen(amountDue), [amountDue]);
  const roundingAdjustment = useMemo(() => finalAmountDue - amountDue, [finalAmountDue, amountDue]);

  const cash = parseFloat(cashReceived || '0');
  const change = cash - finalAmountDue;
  const isSufficient = cash >= finalAmountDue;

  const quickCashButtons = [5, 10, 20, 50, 100];
  
  // Smart suggestions
  const suggestions = useMemo(() => {
    const s = new Set<number>();
    s.add(finalAmountDue); // Exact
    quickCashButtons.forEach(btn => {
      if (btn > finalAmountDue) s.add(btn);
    });
    // Add specific common higher amounts if not exact
    if (finalAmountDue > 10 && finalAmountDue < 20) s.add(20);
    if (finalAmountDue > 20 && finalAmountDue < 50) s.add(50);
    if (finalAmountDue > 50 && finalAmountDue < 100) s.add(100);
    
    return Array.from(s).sort((a, b) => a - b).slice(0, 4);
  }, [finalAmountDue]);

  const handleKeypad = (val: string) => {
    if (status !== 'calculating') return;
    if (val === 'CLEAR') {
      setCashReceived('');
      return;
    }
    if (val === '.' && cashReceived.includes('.')) return;
    if (cashReceived.split('.')[1]?.length >= 2) return; // Max 2 decimal
    setCashReceived(prev => prev + val);
  };

  const handleConfirm = async () => {
    if (!isSufficient) return;
    setStatus('awaiting_confirmation');
  };

  const finalize = async () => {
    if (!profile) return;
    
    try {
      // 1. Create Payment record (this usually happens in parent, but we handle the transaction here)
      // Actually, createPayment should be called by parent to get a payment_id
      // But for speed, let's assume parent gives us an orderId and we complete it.
      
      onComplete({
        cashReceived: cash,
        changeGiven: change,
        rounding: roundingAdjustment
      });
      setStatus('completed');
    } catch (err) {
      console.error("Cash settlement failed:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-4xl bg-zinc-950 border border-zinc-800 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col md:flex-row h-[90vh] md:h-auto max-h-[800px]"
      >
        {/* Left Panel: Summary & Status */}
        <div className="flex-1 p-8 border-r border-zinc-900 flex flex-col justify-between bg-zinc-900/20">
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center border border-orange-500/20">
                <Banknote className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h2 className="text-xl font-black text-white tracking-tight">Cash Settlement</h2>
                <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest leading-none mt-1">POS Malaysia Terminal 01</p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="p-6 bg-zinc-900/50 rounded-3xl border border-zinc-800/50">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Total Bill</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-zinc-500 font-bold text-xl">RM</span>
                  <span className="text-4xl font-black text-white tabular-nums tracking-tighter">
                    {amountDue.toFixed(2)}
                  </span>
                </div>
                {Math.abs(roundingAdjustment) > 0 && (
                  <div className="mt-3 pt-3 border-t border-zinc-800/50 flex justify-between items-center text-[10px]">
                    <span className="text-zinc-500 font-bold uppercase tracking-wider">Cash Rounding</span>
                    <span className={`font-mono ${roundingAdjustment >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {roundingAdjustment > 0 ? '+' : ''}{roundingAdjustment.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="mt-4 flex justify-between items-center">
                  <span className="text-[10px] font-black uppercase tracking-widest text-orange-500">Amount Due</span>
                  <span className="text-2xl font-black text-white tabular-nums tracking-tight">RM {finalAmountDue.toFixed(2)}</span>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {cash > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="p-6 bg-zinc-900/50 rounded-3xl border border-zinc-800/50"
                  >
                    <div className="space-y-4">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-zinc-500 font-medium">Cash Received</span>
                        <span className="text-white font-black tabular-nums tracking-tight">RM {cash.toFixed(2)}</span>
                      </div>
                      <div className="h-px bg-zinc-800/50" />
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Change Due</span>
                        <div className="text-right">
                          <span className={`text-3xl font-black tabular-nums tracking-tighter ${isSufficient ? 'text-green-500' : 'text-red-500/50'}`}>
                            RM {Math.max(0, change).toFixed(2)}
                          </span>
                          {!isSufficient && cash > 0 && (
                            <p className="text-[10px] font-bold text-red-500 uppercase mt-1">Insufficient Balance</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="mt-8 flex gap-3">
             <button 
              onClick={onCancel}
              className="px-6 py-4 rounded-2xl bg-zinc-900 text-zinc-500 font-bold text-sm hover:bg-zinc-800 transition-all border border-zinc-800 flex items-center justify-center gap-2"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
            <div className="flex-1 flex items-center gap-2 px-4 py-2 bg-zinc-900/30 rounded-2xl border border-zinc-800/30">
               <ShieldCheck className="w-4 h-4 text-zinc-600" />
               <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-wider">Audit Security Active</span>
            </div>
          </div>
        </div>

        {/* Right Panel: Input Zone */}
        <div className="flex-[1.2] p-8 flex flex-col justify-between bg-zinc-950">
          <div className="space-y-8">
            {/* Suggested Amounts */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {suggestions.map((amt) => (
                <button
                  key={amt}
                  onClick={() => setCashReceived(amt.toFixed(2))}
                  className="p-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-2xl transition-all group flex flex-col items-center justify-center relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <CornerDownRight className="w-3 h-3 text-orange-500" />
                  </div>
                  <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1 group-hover:text-orange-500/50">RM</span>
                  <span className="text-xl font-black text-white tabular-nums">{amt.toFixed(finalAmountDue.toString().includes('.') ? 2 : 0)}</span>
                </button>
              ))}
            </div>

            {/* Keypad */}
            <div className="grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'CLEAR'].map((key) => (
                <button
                  key={key}
                  onClick={() => handleKeypad(key)}
                  className={`h-20 rounded-3xl text-2xl font-black transition-all active:scale-95 flex items-center justify-center border ${
                    key === 'CLEAR' 
                      ? 'bg-zinc-900/50 text-zinc-500 border-zinc-800/50 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20' 
                      : 'bg-zinc-900 text-white border-zinc-800 hover:bg-zinc-800 hover:border-zinc-700 shadow-xl shadow-black/20'
                  }`}
                >
                  {key === 'CLEAR' ? <X className="w-6 h-6" /> : key}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-8">
            <AnimatePresence mode="wait">
              {status === 'calculating' ? (
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  onClick={handleConfirm}
                  disabled={!isSufficient}
                  className={`w-full py-6 rounded-[2rem] font-black text-base uppercase tracking-widest transition-all flex items-center justify-center gap-3 ${
                    isSufficient 
                    ? 'bg-orange-600 text-white hover:bg-orange-500 shadow-2xl shadow-orange-600/20' 
                    : 'bg-zinc-900 text-zinc-700 cursor-not-allowed grayscale'
                  }`}
                >
                  Confirm Settlement
                  <ArrowRight className="w-5 h-5" />
                </motion.button>
              ) : status === 'awaiting_confirmation' ? (
                 <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-orange-600/10 border border-orange-500/20 p-6 rounded-[2rem] flex flex-col items-center gap-6"
                 >
                   <div className="text-center">
                     <p className="text-orange-500 text-[10px] font-black uppercase tracking-[0.2em] mb-2">Security Confirmation</p>
                     <h3 className="text-xl font-bold text-white">Give Change RM {change.toFixed(2)}?</h3>
                     <p className="text-zinc-500 text-xs mt-1">This action will be logged under your ID.</p>
                   </div>
                   <div className="flex gap-4 w-full">
                     <button 
                      onClick={() => setStatus('calculating')}
                      className="flex-1 py-4 bg-zinc-900 text-white rounded-2xl font-bold text-sm tracking-widest hover:bg-zinc-800 border border-zinc-800"
                     >
                       Edit
                     </button>
                     <button 
                      onClick={finalize}
                      className="flex-[2] py-4 bg-orange-600 text-white rounded-2xl font-black text-sm tracking-[0.2em] uppercase hover:bg-orange-500 shadow-xl shadow-orange-600/20 flex items-center justify-center gap-3"
                     >
                       Finalize & Pay
                       <Check className="w-5 h-5" />
                     </button>
                   </div>
                 </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-green-500/10 border border-green-500/20 p-8 rounded-[2rem] text-center space-y-4"
                >
                  <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-green-500/20">
                    <Check className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white">Success</h3>
                    <p className="text-zinc-500 text-sm">Payment of RM {cash.toFixed(2)} processed.</p>
                  </div>
                  <div className="flex gap-3 mt-4">
                    <button className="flex-1 py-4 bg-zinc-900 text-zinc-300 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 border border-zinc-800">
                      <Printer className="w-4 h-4" /> Receipt
                    </button>
                    <button 
                      onClick={() => onComplete({ cashReceived: cash, changeGiven: change, rounding: roundingAdjustment })}
                      className="flex-[2] py-4 bg-green-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest"
                    >
                      Done
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
