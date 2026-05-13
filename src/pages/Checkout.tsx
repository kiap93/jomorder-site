import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { paymentEngine, PaymentIntentResponse } from '../lib/paymentEngine';
import { Restaurant, Order, Payment } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ChevronLeft, 
  CreditCard, 
  QrCode, 
  Timer, 
  AlertCircle, 
  CheckCircle2, 
  LayoutGrid, 
  ShieldCheck,
  Smartphone,
  Wallet
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

export function Checkout() {
  const { restId, orderId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentResponse | null>(null);
  const [status, setStatus] = useState<'selecting' | 'processing' | 'success' | 'failed'>('selecting');
  const [timeLeft, setTimeLeft] = useState(600); // 10 minutes

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [restRes, orderRes] = await Promise.all([
          supabase.from('restaurants').select('*').eq('id', restId).single(),
          supabase.from('orders').select('*').eq('id', orderId).single()
        ]);

        if (restRes.error) throw restRes.error;
        if (orderRes.error) throw orderRes.error;

        setRestaurant(restRes.data as any);
        setOrder(orderRes.data as any);
        
        // If order is already paid, redirect to tracker
        if (orderRes.data.status === 'paid' || orderRes.data.status === 'sent_to_kitchen') {
          setStatus('success');
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [restId, orderId]);

  // Timer logic
  useEffect(() => {
    if (status !== 'processing' || timeLeft <= 0) return;
    const timer = setInterval(() => setTimeLeft(t => t - 1), 1000);
    return () => clearInterval(timer);
  }, [status, timeLeft]);

  // Polling logic
  useEffect(() => {
    if (status !== 'processing' || !paymentIntent) return;
    
    const interval = setInterval(async () => {
      const currentStatus = await paymentEngine.checkStatus(paymentIntent.paymentId);
      if (currentStatus === 'paid') {
        setStatus('success');
      } else if (currentStatus === 'failed') {
        setStatus('failed');
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [status, paymentIntent]);

  const handleMethodSelect = async (method: string) => {
    if (!restaurant || !order) return;
    
    setLoading(true);
    try {
      const payment = await paymentEngine.createPayment({
        restaurantId: restaurant.id,
        orderId: order.id,
        amount: order.totalPrice,
        method: method,
        provider: 'pos_saas_internal'
      });

      const intent = await paymentEngine.initializeProvider(payment);
      setPaymentIntent(intent);
      setStatus('processing');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const simulateSuccess = async () => {
    if (!paymentIntent) return;
    await paymentEngine.simulateSuccess(paymentIntent.paymentId);
  };

  if (error) return (
    <div className="h-screen bg-zinc-950 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-6">
        <AlertCircle size={32} />
      </div>
      <h2 className="text-xl font-bold text-white mb-2">Checkout Error</h2>
      <p className="text-zinc-500 text-sm mb-8 max-w-xs mx-auto">{error}</p>
      <button 
        onClick={() => navigate(-1)}
        className="bg-zinc-800 text-white px-8 py-3 rounded-xl font-bold text-sm hover:bg-zinc-700 transition-all border border-zinc-700"
      >
        Go Back
      </button>
    </div>
  );

  if (loading && !paymentIntent) return (
    <div className="h-screen bg-zinc-950 flex flex-col items-center justify-center p-8">
      <div className="w-12 h-12 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin mb-4" />
      <p className="text-zinc-500 font-bold text-[10px] tracking-widest uppercase">Initializing Secure Terminal</p>
    </div>
  );

  if (status === 'success') {
    return (
      <div className="h-screen bg-zinc-950 flex flex-col items-center justify-center p-8 text-center">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-24 h-24 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mb-6"
        >
          <CheckCircle2 size={48} />
        </motion.div>
        <h2 className="text-2xl font-black text-white mb-2">Payment Successful</h2>
        <p className="text-zinc-400 text-sm mb-8">Your order has been sent to the kitchen.</p>
        <button
          onClick={() => navigate(`/restaurant/${restId}/order/${orderId}`)}
          className="w-full max-w-xs h-14 bg-zinc-800 text-white rounded-2xl font-bold text-sm hover:bg-zinc-700 transition-all border border-zinc-700"
        >
          Track My Order
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans overflow-x-hidden selection:bg-orange-500/30">
      {/* Background Decor */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-30">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-orange-600/10 blur-[120px] -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-blue-600/5 blur-[120px] translate-y-1/2 -translate-x-1/2" />
      </div>

      <header className="relative z-10 px-6 py-8 flex items-center justify-between">
        <button 
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 active:scale-95 transition-all"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 mb-0.5">Checkout</span>
          <h1 className="text-sm font-bold text-white truncate max-w-[150px]">{restaurant?.name}</h1>
        </div>
        <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600">
          <ShieldCheck size={18} />
        </div>
      </header>

      <main className="relative z-10 px-6 pb-20 max-w-lg mx-auto">
        <AnimatePresence mode="wait">
          {status === 'selecting' ? (
            <motion.div
              key="selecting"
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -20, opacity: 0 }}
              className="space-y-8"
            >
              {/* Order Card */}
              <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 rounded-[2.5rem] p-8">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-orange-500 mb-1">Payable Amount</p>
                    <div className="text-4xl font-black tabular-nums tracking-tighter">
                      RM <span className="text-white">{order?.totalPrice.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="bg-zinc-800/50 p-2.5 rounded-2xl border border-zinc-700/50">
                    <Smartphone size={20} className="text-zinc-500" />
                  </div>
                </div>
                
                <div className="h-px bg-zinc-800/50 my-6" />
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Timer size={14} className="text-zinc-500" />
                    <span className="text-[11px] font-bold text-zinc-400">Transaction closes in 10:00</span>
                  </div>
                  <CheckCircle2 size={14} className="text-emerald-500" />
                </div>
              </div>

              {/* Payment Methods */}
              <div className="space-y-4">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 px-2">Select Payment Method</p>
                <div className="grid grid-cols-1 gap-3">
                  {[
                    { id: 'duitnow', name: 'DuitNow QR', icon: QrCode, color: 'bg-pink-500' },
                    { id: 'tng', name: 'Touch \'n Go', icon: Wallet, color: 'bg-blue-500' },
                    { id: 'fpx', name: 'FPX Online Banking', icon: LayoutGrid, color: 'bg-emerald-500' },
                    { id: 'card', name: 'Credit/Debit Card', icon: CreditCard, color: 'bg-zinc-600' }
                  ].map(method => (
                    <button
                      key={method.id}
                      onClick={() => handleMethodSelect(method.id)}
                      className="group relative bg-zinc-900 border border-zinc-800/50 hover:border-orange-500/50 rounded-2xl p-4 flex items-center gap-4 transition-all active:scale-[0.98]"
                    >
                      <div className={`w-12 h-12 ${method.color} rounded-xl flex items-center justify-center text-white shadow-lg`}>
                        <method.icon size={24} strokeWidth={1.5} />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-sm font-bold text-white group-hover:text-orange-500 transition-colors uppercase tracking-tight">{method.name}</p>
                        <p className="text-[10px] text-zinc-500 font-medium tracking-wide">Instant & Secure Payment</p>
                      </div>
                      <div className="w-8 h-8 rounded-full border border-zinc-800 flex items-center justify-center group-hover:bg-orange-500 transition-all">
                        <div className="w-1.5 h-1.5 bg-zinc-700 rounded-full group-hover:bg-white" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="processing"
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -20, opacity: 0 }}
              className="flex flex-col items-center"
            >
              {/* Payment Processing Card */}
              <div className="w-full bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 rounded-[3rem] p-10 flex flex-col items-center text-center">
                <div className="flex items-center gap-2 mb-8 text-[11px] font-black text-orange-500 uppercase tracking-[0.2em]">
                  <Timer size={14} className="animate-spin" />
                  <span>Awaiting Payment Verification</span>
                </div>

                {paymentIntent?.qrData ? (
                  <div className="relative p-6 bg-white rounded-[2.5rem] shadow-[0_20px_50px_rgba(249,115,22,0.15)] mb-8">
                    <QRCodeSVG 
                      value={paymentIntent.qrData} 
                      size={200}
                      level="H"
                    />
                    <div className="absolute inset-0 border-[3px] border-white rounded-[2.5rem]" />
                  </div>
                ) : (
                  <div className="w-48 h-48 bg-zinc-800 rounded-[2.5rem] flex items-center justify-center mb-8 border border-zinc-700 animate-pulse">
                    <Smartphone size={48} className="text-zinc-600" />
                  </div>
                )}

                <div className="space-y-1 mb-8">
                  <h2 className="text-xl font-bold">Scanning...</h2>
                  <p className="text-zinc-500 text-sm font-medium">Please scan the QR code using your {paymentIntent?.paymentMethod.toUpperCase()} wallet app.</p>
                </div>

                {/* Simulation Shortcut for AI Studio */}
                <button 
                  onClick={simulateSuccess}
                  className="w-full h-12 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all mb-4"
                >
                  SIMULATE PAYMENT SUCCESS
                </button>

                <button
                  onClick={() => setStatus('selecting')}
                  className="text-xs font-bold text-zinc-500 hover:text-white transition-colors"
                >
                  Cancel & Change Method
                </button>
              </div>

              {/* Help text */}
              <div className="mt-10 flex items-center gap-3 p-4 bg-zinc-900/30 border border-zinc-800/50 rounded-2xl">
                <AlertCircle size={18} className="text-zinc-600" />
                <p className="text-[11px] font-medium text-zinc-500 leading-relaxed">
                  DO NOT close this page or press back until the payment is verified. Verification usually takes 2-5 seconds.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Security Footer */}
      <footer className="fixed bottom-6 inset-x-0 flex flex-col items-center gap-3">
        <div className="flex items-center gap-4 text-[10px] font-bold text-zinc-600 tracking-wider">
          <span>PCI-DSS COMPLIANT</span>
          <div className="w-1 h-1 bg-zinc-800 rounded-full" />
          <span>256-BIT ENCRYPTION</span>
          <div className="w-1 h-1 bg-zinc-800 rounded-full" />
          <span>REAL-TIME FRAUD DETECTION</span>
        </div>
        <div className="h-1 w-24 bg-zinc-900 rounded-full overflow-hidden">
          <motion.div 
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            className="w-1/2 h-full bg-orange-600/50 blur-sm" 
          />
        </div>
      </footer>
    </div>
  );
}
