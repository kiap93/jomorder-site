import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { 
  ChefHat, 
  ArrowRight, 
  Check, 
  X, 
  Smartphone, 
  Monitor, 
  Printer, 
  Wifi, 
  WifiOff, 
  Globe, 
  Building2, 
  Layers, 
  Database, 
  Clock, 
  ChevronRight, 
  DollarSign, 
  TrendingUp, 
  HelpCircle, 
  Sparkles, 
  Plus, 
  Minus, 
  ShoppingBag, 
  Info, 
  ShieldCheck, 
  Award, 
  Users, 
  Settings, 
  CheckCircle2, 
  UtensilsCrossed, 
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuthStore } from '../store/useAuthStore';

export function Landing() {
  const navigate = useNavigate();
  const { profile, init, user } = useAuthStore();
  const restId = profile?.restaurantId;

  // State Management
  const [activeTab, setActiveTab] = useState<'qr' | 'kds' | 'pos' | 'ai'>('qr');
  const [isBookDemoOpen, setIsBookDemoOpen] = useState(false);
  const [demoSubmitted, setDemoSubmitted] = useState(false);
  const [demoForm, setDemoForm] = useState({
    name: '',
    restaurantName: '',
    phone: '',
    email: '',
    outlets: '1',
    message: ''
  });

  // FAQ Expand Accordion States
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  // QR Mini-Simulator Cart
  const [qrSimulatorCart, setQrSimulatorCart] = useState<Record<string, number>>({
    'nasi-lemak': 1,
    'roti-canai': 0,
    'teh-tarik': 1
  });
  const [qrLanguage, setQrLanguage] = useState<'EN' | 'BM' | 'ZH'>('EN');
  const [simulatedKdsTickets, setSimulatedKdsTickets] = useState([
    { id: 'T-102', table: 'Table 4', items: '1x Nasi Lemak, 1x Teh Tarik', timeElapsed: 124, status: 'cooking' },
    { id: 'T-103', table: 'Table 9', items: '2x Roti Canai, 1x Teh Tarik', timeElapsed: 45, status: 'pending' },
    { id: 'T-104', table: 'Table 2', items: '1x Claypot Rice', timeElapsed: 310, status: 'cooking' }
  ]);

  // Is Outage Active Simulator
  const [isNetworkOutageActive, setIsNetworkOutageActive] = useState(false);

  // AI Translation Simulator Strings
  const [activeTranslateLang, setActiveTranslateLang] = useState<'EN' | 'BM' | 'ZH' | 'TA' | 'JA'>('EN');

  // Incremental ticker for KDS elapsed times
  useEffect(() => {
    const timer = setInterval(() => {
      setSimulatedKdsTickets(prev => 
        prev.map(t => ({ ...t, timeElapsed: t.timeElapsed + 1 }))
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Handle Demo Form Submit
  const handleDemoSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDemoSubmitted(true);
    setTimeout(() => {
      setDemoSubmitted(false);
      setIsBookDemoOpen(false);
      setDemoForm({
        name: '',
        restaurantName: '',
        phone: '',
        email: '',
        outlets: '1',
        message: ''
      });
    }, 4000);
  };

  // Helper translations for Simulator
  const translateFoodName = (id: string, lang: 'EN' | 'BM' | 'ZH') => {
    const map: Record<string, Record<'EN' | 'BM' | 'ZH', string>> = {
      'nasi-lemak': { EN: 'Spicy Nasi Lemak Sambal', BM: 'Nasi Lemak Sambal Pedas', ZH: '辣椰浆饭配叁巴酱' },
      'roti-canai': { EN: 'Crispy Roti Canai', BM: 'Roti Canai Garing', ZH: '香脆印度煎饼' },
      'teh-tarik': { EN: 'Teh Tarik (Pull Tea)', BM: 'Teh Tarik Kurang Manis', ZH: '拉茶 (少甜)' }
    };
    return map[id]?.[lang] || id;
  };

  const translatePrice = (id: string) => {
    const prices: Record<string, string> = {
      'nasi-lemak': '14.90',
      'roti-canai': '4.50',
      'teh-tarik': '3.90'
    };
    return prices[id] || '0.00';
  };

  const getCartTotal = () => {
    let sum = 0;
    Object.keys(qrSimulatorCart).forEach(key => {
      sum += qrSimulatorCart[key] * parseFloat(translatePrice(key));
    });
    return sum.toFixed(2);
  };

  const handleKdsComplete = (id: string) => {
    setSimulatedKdsTickets(prev => prev.filter(t => t.id !== id));
  };

  const getAiTranslationText = (lang: 'EN' | 'BM' | 'ZH' | 'TA' | 'JA') => {
    switch (lang) {
      case 'BM':
        return {
          title: "Ayam Goreng Berempah Madu",
          desc: "Ayam segar diperap semalaman bersama halia segar, ketumbar giling, cili kering, dan madu hutan asli, digoreng garing menghasilkan rasa rempah karamel yang memikat selera."
        };
      case 'ZH':
        return {
          title: "秘制蜂肉香料炸鸡",
          desc: "优质嫩鸡用香茅、黄姜、生姜与天然野蜂蜜腌制24小时，炸至金黄酥脆。散发浓郁烤焦香料甜香，皮脆肉嫩。"
        };
      case 'TA':
        return {
          title: "மது பாணி தேன் பொரித்த கோழி",
          desc: "பழைய பாரம்பரிய மசாலாப் பொடிகள் மற்றும் தேனுடன் ஊறவைத்து பொன்னிறமாக வறுத்தெடுக்கப்பட்ட சுவையான கோழி வறுவல்."
        };
      case 'JA':
        return {
          title: "スパイスハニー骨付きフライドチキン",
          desc: "新鮮なハーブ、蜂蜜、クラシックな地元マレーの香辛料でマリネされたカリカリに揚げられたチキン。スパイスの甘辛い香りがお口いっぱいに広がります。"
        };
      case 'EN':
      default:
        return {
          title: "Signature Honey Spiced Chicken",
          desc: "Crispy marinated bone-in chicken leg infused with fresh lemongrass, crushed coriander stalks, ginger, wild highland honey, and traditional Malay spice blends, fried golden."
        };
    }
  };

  // FAQs Array
  const faqsArr = [
    {
      q: "Do I need proprietary POS hardware machines to start using Sikmatye?",
      a: "Absolutely not. Sikmatye is architected to run on any tablet, iPad, smartphone, PC, or Android terminal. You can use hardware you already own or lease standard thermal network printers from third parties."
    },
    {
      q: "How does the Offline-First POS capability operate if local internet cuts out?",
      a: "Our SQLite + IndexedDB hybrid caching layers sync data instantaneously. When internet connections vanish, cashiers, tables, and KDS continue punching orders, adjusting bills, and queuing records locally. Everything syncs to cloud servers automatically when lines return."
    },
    {
      q: "Can food court operators or multi-outlet brands manage everything in one space?",
      a: "Yes. Our core multi-tenant directory manages complex franchise chains. You can swap between branches with a single click inside the workspace switcher, update prices company-wide, and route centralized financial audits safely."
    },
    {
      q: "Can kitchen teams access KDS tickets and print tickets simultaneously?",
      a: "Yes. Customers placing smartphone QR orders automatically print receipts via network thermal printers inside the kitchen whilst the KDS screen flashes new order timers simultaneously."
    },
    {
      q: "Can customers pay online directly from the QR menu?",
      a: "Absolutely. Sikmatye includes dynamic payment gateways supporting local banking options (FPX, credit cards, GrabPay, TouchnGo, and Apple Pay). Transactions integrate directly inside your shift registers."
    },
    {
      q: "How does the 14-day trial work, and do I have to submit credit card data?",
      a: "Our trial is completely risk-free. No credit cards are required to sign up. Once registered, your restaurant is instantly bootstrapped with a 14-day trial of our starter plan. This gets you operational instantly."
    }
  ];

  return (
    <div id="sikmatye-saas" className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans selection:bg-orange-500 selection:text-white">
      
      {/* 1. TOP SAAS NAVBAR */}
      <header className="sticky top-0 z-40 w-full bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md border-b border-zinc-200/50 dark:border-zinc-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-orange-50 dark:bg-zinc-900 rounded-xl flex items-center justify-center shadow-lg overflow-hidden border border-zinc-200/50 dark:border-zinc-800">
              <img src="/logo.png" className="w-full h-full object-cover" alt="Sikmatye Logo" referrerPolicy="no-referrer" />
            </div>
            <div>
              <span className="text-lg font-black tracking-tight text-zinc-900 dark:text-zinc-50">Sikmatye</span>
              <span className="text-[10px] block font-semibold text-orange-600 uppercase tracking-widest leading-none">Operating System</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center space-x-8 text-sm font-semibold text-zinc-650 dark:text-zinc-300">
            <a href="#problem" className="hover:text-orange-600 dark:hover:text-orange-400 transition">Frustrations</a>
            <a href="#solution" className="hover:text-orange-600 dark:hover:text-orange-400 transition">Unified Solution</a>
            <a href="#features" className="hover:text-orange-600 dark:hover:text-orange-400 transition">Features</a>
            <a href="#pricing" className="hover:text-orange-600 dark:hover:text-orange-400 transition">Pricing</a>
            <a href="#faq" className="hover:text-orange-600 dark:hover:text-orange-400 transition">Help FAQ</a>
          </nav>

          <div className="flex items-center space-x-3.5">
            <Link 
              to="/login"
              className="text-sm font-bold text-zinc-650 hover:text-orange-600 dark:text-zinc-350 dark:hover:text-orange-400 px-3 py-1.5 transition"
            >
              Sign In
            </Link>
            <Link
              to="/register"
              className="hidden sm:inline-flex px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-white text-white dark:text-zinc-950 rounded-xl text-xs font-black uppercase tracking-wider transition active:scale-95 shadow-md"
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      </header>

      {/* 2. SECTION 1: HERO CONTAINER */}
      <section className="relative overflow-hidden pt-12 pb-20 md:py-28 bg-gradient-to-b from-orange-50/20 via-transparent to-transparent">
        
        {/* Ambient Grid Line Ornaments */}
        <div className="absolute inset-0 bg-[radial-gradient(#ea580c_0.07rem,transparent_0.07rem)] [background-size:1.5rem_1.5rem] opacity-20 pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          
          {/* Main Hero Header Text */}
          <div className="text-center max-w-4xl mx-auto space-y-6">
            <div className="inline-flex items-center space-x-2 bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 px-3 py-1.5 rounded-full text-xs font-bold tracking-tight mb-2 select-none">
              <Sparkles size={13} className="animate-spin" style={{ animationDuration: '4s' }} />
              <span>Unified F&B Platform Version 2.4 Live</span>
            </div>
            
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-black text-zinc-900 dark:text-white tracking-tight leading-tighter">
              Run Your Restaurant Smarter with <span className="text-orange-600 dark:text-orange-500 underline decoration-orange-500/30">QR Ordering</span>, POS & Kitchen Display
            </h1>
            
            <p className="text-lg md:text-xl text-zinc-500 dark:text-zinc-400 max-w-2xl mx-auto font-medium leading-relaxed">
              Accept orders, manage kitchen workflows, print kitchen tickets, and grow your restaurant from one platform. Perfect for cafes, diners, mamak lines, and multi-outlet brand hubs.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <Link
                to="/register"
                className="w-full sm:w-auto px-8 py-4 bg-orange-600 hover:bg-orange-700 text-white font-black text-center text-sm rounded-2xl shadow-xl shadow-orange-500/20 hover:shadow-orange-500/30 transition-all transform active:scale-98 tracking-wide flex items-center justify-center space-x-2"
              >
                <span>Start Free 14-Day Trial</span>
                <ArrowRight size={18} />
              </Link>
              
              <button
                type="button"
                onClick={() => setIsBookDemoOpen(true)}
                className="w-full sm:w-auto px-8 py-4 bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-850 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 font-bold text-sm text-center rounded-2xl transition"
              >
                Book Demo
              </button>
            </div>

            {/* Key Value Proposition Bullets */}
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-3 pt-6 text-zinc-650 dark:text-zinc-400 text-xs font-semibold uppercase tracking-wider">
              {["✓ QR Ordering", "✓ Kitchen Display System", "✓ Kitchen Ticket Printing", "✓ Offline-First POS", "✓ Multi-Outlet Management", "✓ AI Menu Translation"].map((badge, i) => (
                <span key={i} className="flex items-center space-x-1 hover:text-orange-600 transition duration-150 cursor-pointer">
                  <span className="text-orange-600 dark:text-orange-400 mr-1">●</span> {badge.substring(2)}
                </span>
              ))}
            </div>
          </div>

          {/* SaaS Core Interactive Dashboard Mockup Showcase */}
          <div className="mt-16 bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl p-4 sm:p-6 md:p-8 relative">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-1.5 rounded-full bg-zinc-950 text-white dark:bg-white dark:text-zinc-950 font-mono text-[10px] uppercase font-bold tracking-widest flex items-center space-x-1 bg-gradient-to-r from-orange-600 to-orange-500 text-white">
              <Monitor size={11} />
              <span>Interactive Simulator Panel</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 pt-4 min-h-[500px]">
              
              {/* Simulator Tabs Panel */}
              <div className="lg:col-span-1 space-y-2 flex lg:flex-col overflow-x-auto lg:overflow-visible pb-3 lg:pb-0 scrollbar-hide border-b lg:border-b-0 lg:border-r border-zinc-200/60 dark:border-zinc-800 pr-0 lg:pr-4">
                {[
                  { id: 'qr', label: '📱 QR Menu Order', desc: 'Smartphone Scan Order flow' },
                  { id: 'kds', label: '🖥️ Kitchen Screen', desc: 'Realtime order tracking system' },
                  { id: 'pos', label: '📠 Cashier POS App', desc: 'Offline mode simulation' },
                  { id: 'ai', label: '🌐 AI Multi-Translate', desc: 'Automatic global output' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    type="button"
                    className={`w-full text-left p-3.5 rounded-2xl transition-all flex flex-col space-y-1 md:min-w-[200px] shrink-0 border uppercase tracking-wider font-sans ${
                      activeTab === tab.id 
                        ? 'bg-orange-50/70 border-orange-200 text-orange-700 dark:bg-orange-950/20 dark:border-orange-900/30 dark:text-orange-400 font-bold' 
                        : 'border-transparent text-zinc-500 hover:text-zinc-850 dark:hover:text-zinc-300'
                    }`}
                  >
                    <span className="text-xs font-black">{tab.label}</span>
                    <span className="text-[10px] lowercase normal-case tracking-normal opacity-80">{tab.desc}</span>
                  </button>
                ))}
                
                {/* Simulated Output Ribbon */}
                <div className="hidden lg:block pt-8 space-y-3">
                  <div className="rounded-xl bg-zinc-50 dark:bg-zinc-950 p-4 border border-zinc-150 dark:border-zinc-900 space-y-2">
                    <div className="flex items-center space-x-2">
                      <Printer size={15} className="text-orange-500" />
                      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">KOT Printer Status</span>
                    </div>
                    <div className="w-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 p-2 rounded text-[10px] font-semibold text-center uppercase tracking-wider font-mono">
                      ● Net Printer Ready
                    </div>
                  </div>
                </div>
              </div>

              {/* Mock Area Display */}
              <div className="lg:col-span-3 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-900 p-4 sm:p-6 overflow-hidden flex flex-col justify-between">
                
                <AnimatePresence mode="wait">
                  
                  {/* 1. SMARTPHONE QR MENU SIMULATION */}
                  {activeTab === 'qr' && (
                    <motion.div 
                      key="qr"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-4 w-full"
                    >
                      <div className="flex justify-between items-center bg-white dark:bg-zinc-900 p-3 rounded-xl border border-zinc-200/50 dark:border-zinc-800">
                        <div className="flex items-center space-x-2">
                          <Smartphone size={16} className="text-zinc-400" />
                          <span className="text-xs font-bold text-zinc-500">Scan Demo / Table 04 Menu</span>
                        </div>
                        <div className="flex space-x-1.5">
                          {(['EN', 'BM', 'ZH'] as const).map(l => (
                            <button
                              key={l}
                              onClick={() => setQrLanguage(l)}
                              type="button"
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                qrLanguage === l ? 'bg-orange-550 text-white bg-orange-600' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                              }`}
                            >
                              {l}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Menu Dishes Inside Smartphone Sim */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {[
                          { id: 'nasi-lemak', img: '🍳' },
                          { id: 'roti-canai', img: '🫓' },
                          { id: 'teh-tarik', img: '☕' }
                        ].map(food => {
                          const count = qrSimulatorCart[food.id] || 0;
                          return (
                            <div key={food.id} className="bg-white dark:bg-zinc-900 p-3.5 rounded-xl border border-zinc-150 dark:border-zinc-850 flex justify-between items-center">
                              <div className="space-y-1">
                                <span className="text-lg">{food.img}</span>
                                <h4 className="text-xs font-bold text-zinc-800 dark:text-zinc-100 mt-1 lines-clamp-1">
                                  {translateFoodName(food.id, qrLanguage)}
                                </h4>
                                <span className="text-[10px] font-mono text-zinc-500 font-bold">RM {translatePrice(food.id)}</span>
                              </div>
                              <div className="flex items-center space-x-2">
                                <button
                                  type="button"
                                  onClick={() => setQrSimulatorCart(p => ({ ...p, [food.id]: Math.max(0, count - 1) }))}
                                  className="p-1 rounded-md bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-850 text-zinc-650"
                                >
                                  <Minus size={11} />
                                </button>
                                <span className="text-xs text-zinc-850 dark:text-zinc-150 font-black font-mono w-4 text-center">{count}</span>
                                <button
                                  type="button"
                                  onClick={() => setQrSimulatorCart(p => ({ ...p, [food.id]: count + 1 }))}
                                  className="p-1 rounded-md bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-850 text-zinc-650"
                                >
                                  <Plus size={11} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Simulated Checkout Block */}
                      <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200/60 dark:border-zinc-850 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div>
                          <span className="text-[9px] block uppercase font-bold text-zinc-400">Total Simulated Cart</span>
                          <span className="text-xl font-mono font-black text-zinc-900 dark:text-zinc-50">RM {getCartTotal()}</span>
                          {parseFloat(getCartTotal()) > 0 && (
                            <span className="text-[10px] block text-emerald-500 font-semibold mt-0.5">✓ Ready to print to kitchen KOT</span>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={parseFloat(getCartTotal()) === 0}
                          onClick={() => {
                            const newTicket = {
                              id: 'T-' + Math.floor(100 + Math.random() * 900),
                              table: 'Table 4',
                              items: Object.keys(qrSimulatorCart)
                                .filter(k => qrSimulatorCart[k] > 0)
                                .map(k => `${qrSimulatorCart[k]}x ${translateFoodName(k, 'EN')}`)
                                .join(', '),
                              timeElapsed: 0,
                              status: 'pending'
                            };
                            setSimulatedKdsTickets(prev => [newTicket, ...prev]);
                            alert("Order processed inside sandbox! Swap to 'Kitchen Screen' tab to view or complete your incoming order ticket live.");
                          }}
                          className="px-5 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider text-center flex items-center justify-center space-x-1.5 bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                        >
                          <ShoppingBag size={14} />
                          <span>Simulate Submit Order</span>
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {/* 2. REALTIME KITCHEN DISPLAY KDS SIMULATION */}
                  {activeTab === 'kds' && (
                    <motion.div 
                      key="kds"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-4 w-full"
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center space-x-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                          <h4 className="text-xs font-black uppercase text-zinc-500 tracking-wider">Live Kitchen Display System (KDS) Feed</h4>
                        </div>
                        <span className="text-xs font-bold text-zinc-400 font-mono">3 active tickets tracking seconds</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {simulatedKdsTickets.map((ticket) => (
                          <div 
                            key={ticket.id} 
                            className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-850 rounded-xl p-3.5 shadow-sm space-y-3 relative overflow-hidden"
                          >
                            <div className="flex justify-between items-center border-b border-zinc-100 dark:border-zinc-800 pb-2">
                              <span className="text-xs font-mono font-black text-orange-600 dark:text-orange-500">{ticket.id}</span>
                              <span className="text-xs font-black text-zinc-800 dark:text-zinc-150">{ticket.table}</span>
                            </div>
                            
                            <p className="text-xs text-zinc-650 dark:text-zinc-350 min-h-[40px] leading-relaxed">
                              {ticket.items}
                            </p>

                            <div className="flex justify-between items-center pt-1 mt-2">
                              <div className="flex items-center space-x-1 font-mono text-[10px] font-bold text-zinc-400">
                                <Clock size={12} className="text-indigo-400" />
                                <span>{Math.floor(ticket.timeElapsed / 60)}m {ticket.timeElapsed % 60}s</span>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleKdsComplete(ticket.id)}
                                className="px-2.5 py-1 bg-emerald-500 text-white hover:bg-emerald-600 rounded text-[10px] font-bold uppercase tracking-wider transition"
                              >
                                Server Sent
                              </button>
                            </div>
                          </div>
                        ))}
                        {simulatedKdsTickets.length === 0 && (
                          <div className="col-span-3 text-center py-8 text-zinc-400 space-y-2">
                            <UtensilsCrossed className="mx-auto block text-zinc-300" size={30} />
                            <p className="text-sm font-semibold">All Kitchen orders have been cleared!</p>
                            <p className="text-xs">Go back to "QR Menu" tab to place more simulated food orders.</p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* 3. CASHIER OFFLINE-FIRST POS APP SIMULATION */}
                  {activeTab === 'pos' && (
                    <motion.div 
                      key="pos"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-4 w-full"
                    >
                      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            {isNetworkOutageActive ? (
                              <WifiOff size={16} className="text-amber-500 animate-pulse shrink-0" />
                            ) : (
                              <Wifi size={16} className="text-emerald-500 shrink-0" />
                            )}
                            <h4 className="text-sm font-bold text-zinc-850 dark:text-zinc-100">
                              {isNetworkOutageActive ? "Internet Outage Active (Offline Mode)" : "Connected to Sikmatye Clouds"}
                            </h4>
                          </div>
                          <p className="text-xs text-zinc-500 leading-normal max-w-lg">
                            {isNetworkOutageActive 
                              ? "SIMULATOR: In standard environments, loss of internet blocks normal POS models. Sikmatye caches inputs locally to IndexedDB seamlessly. Cash registers, checkout tables remain 100% active." 
                              : "Toggle the switch to cut offline and evaluate how the client applet maintains shift records smoothly without crash interruptions."}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setIsNetworkOutageActive(!isNetworkOutageActive)}
                          className={`px-4 py-2.5 rounded-xl font-bold font-mono text-[10px] uppercase tracking-wider text-center shrink-0 border transition active:scale-95 ${
                            isNetworkOutageActive 
                              ? 'bg-amber-600 border-amber-600 text-white' 
                              : 'border-zinc-300 text-zinc-700 dark:border-zinc-800 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-850'
                          }`}
                        >
                          {isNetworkOutageActive ? "Simulate Restore Internet" : "Simulate Outage"}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-850 p-4 rounded-xl space-y-2">
                          <span className="text-[10px] uppercase font-bold text-zinc-400">POS Offline Cache State</span>
                          <div className="text-xl font-bold font-mono text-zinc-800 dark:text-zinc-250">
                            {isNetworkOutageActive ? "2 Queued Updates" : "Sync Clear"}
                          </div>
                          <span className="text-[10px] text-zinc-500 block leading-tight">Registers hold local states. Zero lag spikes.</span>
                        </div>

                        <div className="bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-850 p-4 rounded-xl space-y-2">
                          <span className="text-[10px] uppercase font-bold text-zinc-400">Total Shift Income</span>
                          <div className="text-xl font-black font-mono text-zinc-900 dark:text-zinc-50">RM 1,489.20</div>
                          <span className="text-[10px] text-zinc-500 block leading-tight">Reconciliation active across tables.</span>
                        </div>

                        <div className="bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-850 p-4 rounded-xl space-y-2">
                          <span className="text-[10px] uppercase font-bold text-zinc-400">Terminal Code Link</span>
                          <div className="text-xl font-bold font-mono text-zinc-800 dark:text-zinc-250">POS-KLR-29</div>
                          <span className="text-[10px] text-orange-600 dark:text-orange-400 block font-semibold leading-tight">Operating System Active</span>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* 4. AI LANGUAGE SWAP TRANSLATOR */}
                  {activeTab === 'ai' && (
                    <motion.div 
                      key="ai"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-4 w-full"
                    >
                      <div className="space-y-2">
                        <h4 className="text-xs font-black uppercase text-zinc-500 tracking-wider">AI Instant Menu Multi-Translation Engine</h4>
                        <p className="text-xs text-zinc-550 dark:text-zinc-400">
                          Configure a single English description. Sikmatye automatically translates to Malay, Chinese, Tamil, or Japanese for foreign tourists with Gemini AI.
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2 border-b border-zinc-200/50 dark:border-zinc-800 pb-3">
                        {[
                          { key: 'EN', label: '🇬🇧 English Raw' },
                          { key: 'BM', label: '🇲🇾 Malay AI' },
                          { key: 'ZH', label: '🇨🇳 Chinese Simplified' },
                          { key: 'TA', label: '🇮🇳 Tamil translation' },
                          { key: 'JA', label: '🇯🇵 Japanese Guide' }
                        ].map((btn) => (
                          <button
                            key={btn.key}
                            onClick={() => setActiveTranslateLang(btn.key as any)}
                            type="button"
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                              activeTranslateLang === btn.key 
                                ? 'bg-orange-600 text-white' 
                                : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-650 hover:bg-zinc-100'
                            }`}
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>

                      <div className="bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-850 p-5 rounded-xl space-y-2 min-h-[140px] flex flex-col justify-center">
                        <div className="inline-flex items-center space-x-1 text-[10px] text-orange-600 dark:text-orange-400 font-bold tracking-widest uppercase">
                          <Globe size={11} />
                          <span>Gemini AI Engine Instant Output</span>
                        </div>
                        <h3 className="text-base font-black text-zinc-950 dark:text-zinc-50">
                          {getAiTranslationText(activeTranslateLang).title}
                        </h3>
                        <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed italic">
                          "{getAiTranslationText(activeTranslateLang).desc}"
                        </p>
                      </div>
                    </motion.div>
                  )}

                </AnimatePresence>

                <div className="mt-4 pt-4 border-t border-zinc-200/40 dark:border-zinc-900/65 flex flex-col sm:flex-row items-center justify-between text-zinc-500 text-[10px] gap-2">
                  <span>💡 Note: This is an active preview showing actual runtime system dynamics.</span>
                  <a href="#features" className="text-orange-600 dark:text-orange-400 font-bold hover:underline">Explore complete features list &darr;</a>
                </div>

              </div>

            </div>

          </div>

        </div>

      </section>

      {/* 3. SECTION 2: THE PROBLEM */}
      <section id="problem" className="py-20 md:py-28 bg-white dark:bg-zinc-900 border-y border-zinc-200/50 dark:border-zinc-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
            <span className="text-xs font-bold uppercase tracking-widest text-red-600 dark:text-red-500">The Hard Truth About F&B</span>
            <h2 className="text-3xl md:text-5xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
              Restaurants Are Using Too Many Systems
            </h2>
            <p className="text-sm md:text-base text-zinc-500 dark:text-zinc-400">
              Juggling legacy cash boxes, tablet aggregators, printer drivers, and Whatsapp order chains isn't operations—it's chaos. Here are the core struggles owners face daily:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                title: "Manual Order Taking",
                desc: "Waiters spend 40% of their shifts pacing tables to specify orders and clarify item availability, leading to heavy cashier queues and table delays.",
                icon: "❌"
              },
              {
                title: "Lost Kitchen Tickets",
                desc: "Legacy carbon papers and unstable printer cables misplace kitchen orders, leaving customers waiting 40+ minutes for absent culinary lines.",
                icon: "❌"
              },
              {
                title: "WhatsApp Ordering Chaos",
                desc: "Manual orders taken over WhatsApp lead to mixed addresses, lost payment receipts, manual bank slip checking, and massive customer frustration.",
                icon: "❌"
              },
              {
                title: "Expensive POS Subscriptions",
                desc: "Unfair subscription policies squeeze margins by charging separate fees for tablet users, menu updates, and cashier seats. Addons pile up fast.",
                icon: "❌"
              },
              {
                title: "No Visibility Into Kitchen Operations",
                desc: "The manager has no concept of order processing times, dish bottlenecks, or runner delivery times. Optimization is impossible.",
                icon: "❌"
              },
              {
                title: "Internet Outages Stop Operations",
                desc: "Most cloud POS networks lock or crash when local router networks blink. Waiters can't select items; kitchens can't cook. Sales drop to zero.",
                icon: "❌"
              }
            ].map((prob, i) => (
              <div 
                key={i}
                className="bg-zinc-50 dark:bg-zinc-950 p-6 rounded-2xl border border-zinc-200/60 dark:border-zinc-850 hover:border-red-500/30 transition duration-200 space-y-3 shadow-sm group"
              >
                <div className="text-xl inline-block p-2 bg-red-100/50 dark:bg-red-950/20 rounded-xl mb-1 group-hover:scale-110 transition-transform">
                  {prob.icon}
                </div>
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 font-sans tracking-tight">
                  {prob.title}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-450 leading-relaxed">
                  {prob.desc}
                </p>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* 4. SECTION 3: THE SOLUTION */}
      <section id="solution" className="py-20 md:py-28 bg-gradient-to-b from-zinc-50 via-zinc-100/30 to-zinc-50 dark:from-zinc-950 dark:via-zinc-900/30 dark:to-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
            <span className="text-xs font-bold uppercase tracking-widest text-orange-600 dark:text-orange-500">The Restaurant Operating System</span>
            <h2 className="text-3xl md:text-5xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
              Everything Your Restaurant Needs in One Platform
            </h2>
            <p className="text-sm md:text-base text-zinc-500 dark:text-zinc-400">
              By replacing fragmented tools, Sikmatye functions as a singular, robust operating core for every element of customer ordering, cashier totals, and kitchen dispatch.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                title: "QR Ordering",
                desc: "Customers scan a secure table QR code, browse a language-localized dynamic menu, submit orders, and checkout via custom online gateways in seconds.",
                icon: <Smartphone className="text-orange-500" size={24} />
              },
              {
                title: "Kitchen Display System",
                desc: "Orders flow directly to KDS screens in real time. Kitchen staff see items categorized by station with visual countdown timers to prevent ticket delays.",
                icon: <Monitor className="text-indigo-500" size={24} />
              },
              {
                title: "Kitchen Order Ticket Printing",
                desc: "Auto-route kitchen tickets across multiple network printers (bar, kitchen, grill) directly from QR scans or the POS terminal with zero manual work.",
                icon: <Printer className="text-emerald-500" size={24} />
              },
              {
                title: "Offline-First POS",
                desc: "Designed with enterprise caching. Continue operating, sending orders to kitchen printers, and accepting cash payments even when your internet drops.",
                icon: <Database className="text-rose-500" size={24} />
              },
              {
                title: "Multi-Outlet Management",
                desc: "Control multiple operational outlets, adjust menus globally, track branch revenues, and run consolidated accounting audits from a single master dashboard.",
                icon: <Building2 className="text-sky-500" size={24} />
              },
              {
                title: "AI Menu Translation",
                desc: "Instantly translate your menu coordinates and dish descriptions into Chinese, Tamil, Malay, Japanese, or English via integrated Gemini AI pipelines.",
                icon: <Globe className="text-amber-500" size={24} />
              }
            ].map((sol, i) => (
              <div 
                key={i}
                className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-4 shadow-sm hover:translate-y-[-2px] transition duration-200"
              >
                <div className="p-3 bg-zinc-50 dark:bg-zinc-950 inline-block rounded-xl border border-zinc-100 dark:border-zinc-800">
                  {sol.icon}
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 font-sans tracking-tight">
                    {sol.title}
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    {sol.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* 5. SECTION 4: HOW IT WORKS */}
      <section className="py-20 md:py-28 bg-white dark:bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-20">
            <span className="text-xs font-bold uppercase tracking-widest text-orange-650 dark:text-orange-400">Streamlined Implementation</span>
            <h2 className="text-3xl md:text-5xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
              Get Started In Minutes
            </h2>
            <p className="text-sm md:text-base text-zinc-500 dark:text-zinc-400">
              Modern SaaS shouldn't require on-site technical architects. Bootstrap your dining operations with simple, standalone steps:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative">
            
            {/* Horizontal timeline connector lines for desktop */}
            <div className="hidden md:block absolute top-7 left-14 right-14 h-0.5 bg-zinc-200 dark:bg-zinc-800 z-0" />

            {[
              {
                step: "01",
                title: "Create Account",
                desc: "Sign up via our web platform in 30 seconds. No credit card information is required to access your 14-day free trial."
              },
              {
                step: "02",
                title: "Upload Menu",
                desc: "Import your dish listings, upload item photos, define pricing schedules, and specify custom ingredient modifiers easily."
              },
              {
                step: "03",
                title: "Print QR Code",
                desc: "Generate your branded high-contrast dining table QR codes. Print them directly from the platform to place at tables."
              },
              {
                step: "04",
                title: "Start Taking Orders",
                desc: "Customers scan, order, and pay instantly. Orders route immediately to kitchen screens and your cashier POS."
              }
            ].map((item, idx) => (
              <div key={idx} className="relative z-10 flex flex-col items-center md:items-start text-center md:text-left space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-orange-600 text-white font-mono font-black text-lg flex items-center justify-center shadow-lg shadow-orange-500/20">
                  {item.step}
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 font-sans">
                    {item.title}
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed md:max-w-[240px]">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}

          </div>

        </div>
      </section>

      {/* 6. SECTION 5: WHY SIKMATYE (COMPARISON TABLE) */}
      <section className="py-20 md:py-28 bg-zinc-50 dark:bg-zinc-900 border-y border-zinc-200/50 dark:border-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
            <span className="text-xs font-bold uppercase tracking-widest text-orange-600 dark:text-orange-500">Complete Platform Verification</span>
            <h2 className="text-3xl md:text-5xl font-black text-zinc-900 dark:text-zinc-150 tracking-tight">
              More Than Just a QR Ordering System
            </h2>
            <p className="text-sm md:text-base text-zinc-500 dark:text-zinc-400">
              Why use limited standalone tools when you can run your entire business from Sikmatye? See the differences below:
            </p>
          </div>

          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xl max-w-4xl mx-auto">
            <div className="p-5 border-b border-zinc-100 dark:border-zinc-805 bg-zinc-50/50 dark:bg-zinc-950/20 text-center font-bold text-sm tracking-wide text-orange-600 uppercase font-mono">
              Features Matrix Comparison
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 text-zinc-500 text-xs font-mono uppercase">
                    <th className="p-4 pl-6">Capabilities</th>
                    <th className="p-4 text-center">QR Menu Only</th>
                    <th className="p-4 text-center">Basic Ordering</th>
                    <th className="p-4 text-center bg-orange-50/20 dark:bg-orange-950/20 font-black text-orange-600 dark:text-orange-400 text-xs">Sikmatye OS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-850 text-zinc-700 dark:text-zinc-350">
                  {[
                    { capability: "QR Ordering System", qrMenu: "✓", basic: "✓", jom: "✓" },
                    { capability: "Integrated Cashier POS Interface", qrMenu: "❌", basic: "❌", jom: "✓" },
                    { capability: "Kitchen Display Screens (KDS)", qrMenu: "❌", basic: "❌", jom: "✓" },
                    { capability: "Thermal KOT Printer Support", qrMenu: "❌", basic: "❌", jom: "✓" },
                    { capability: "SQLite / Offline-First Engine", qrMenu: "❌", basic: "❌", jom: "✓" },
                    { capability: "Multi-Outlet Switcher Dashboard", qrMenu: "❌", basic: "❌", jom: "✓" },
                    { capability: "Instant AI Word Multi-Translation", qrMenu: "❌", basic: "❌", jom: "✓" },
                    { capability: "Granular RBAC Staff Permissions", qrMenu: "❌", basic: "❌", jom: "✓" }
                  ].map((row, index) => (
                    <tr key={index} className="hover:bg-zinc-50/40">
                      <td className="p-4 pl-6 font-bold text-zinc-850 dark:text-zinc-150">{row.capability}</td>
                      <td className="p-4 text-center text-zinc-400">{row.qrMenu === "✓" ? <Check className="text-emerald-500 mx-auto" size={18} /> : <X className="text-zinc-300 mx-auto" size={16} />}</td>
                      <td className="p-4 text-center text-zinc-400">{row.basic === "✓" ? <Check className="text-emerald-500 mx-auto" size={18} /> : <X className="text-zinc-300 mx-auto" size={16} />}</td>
                      <td className="p-4 text-center bg-orange-50/10 dark:bg-orange-950/10 font-bold">{row.jom === "✓" ? <Check className="text-orange-600 mx-auto font-black" size={20} /> : <X className="text-zinc-300 mx-auto" size={16} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-6 bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-150 dark:border-zinc-800 text-center">
              <p className="text-xs text-zinc-500 leading-normal">
                🛡️ Sikmatye coordinates your entire F&B brand logistics in a single operational platform. No additional hardware required.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* 7. SECTION 6: FEATURES SHOWCASE */}
      <section id="features" className="py-20 md:py-28 bg-white dark:bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-20">
            <span className="text-xs font-bold uppercase tracking-widest text-orange-600 dark:text-orange-500">Detailed Capability Hub</span>
            <h2 className="text-3xl md:text-5xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
              Enterprise Features Designed For Scaling
            </h2>
            <p className="text-sm md:text-base text-zinc-500 dark:text-zinc-400">
              Each module of Sikmatye is built with high detail to run diners, food parks, bubble tea trucks, or regional dine franchises cleanly.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                title: "QR Ordering System",
                desc: "Direct table scan browser order interface with multi-tier item modifications, dynamic cart values, and integrated checkout methods.",
                tag: "QR Code Menu",
                icon: <Smartphone className="text-orange-500" size={22} />
              },
              {
                title: "Kitchen Display (KDS)",
                desc: "Grid of active orders categorized by preparation station (hot, cold, drinks). Multi-tablet sync keeps kitchen operations aligned.",
                tag: "Kitchen Display",
                icon: <Monitor className="text-indigo-500" size={22} />
              },
              {
                title: "Thermal Printer Network",
                desc: "Configurable direct routing for multiple thermal receipt printers. Instantly prints clean KOT receipts on customer scan checkouts.",
                tag: "Printing Support",
                icon: <Printer className="text-emerald-500" size={22} />
              },
              {
                title: "Table Map Logistics",
                desc: "Dynamic table maps, checkout status tracking, cover count indices, and live table order aggregations managed from one central grid.",
                tag: "Floor Mapping",
                icon: <Layers className="text-yellow-500" size={22} />
              },
              {
                title: "Granular Staff Roles",
                desc: "Define distinct access, cash registers tracking, payment verification, and menu edit roles for cashiers, runners, owners, and managers.",
                tag: "RBAC Controls",
                icon: <Users className="text-pink-500" size={22} />
              },
              {
                title: "Analytics Dashboard",
                desc: "Track daily sales figures, busiest dining hours, top-selling items, and wait times inside the visual reporting engine.",
                tag: "Business Intelligence",
                icon: <TrendingUp className="text-blue-500" size={22} />
              },
              {
                title: "AI Auto-Translation",
                desc: "Dynamically translate items into multiple languages. Bring food culture closer to local residents and international tourists alike.",
                tag: "Gemini AI Core",
                icon: <Globe className="text-purple-500" size={22} />
              },
              {
                title: "Offline Sync Engine",
                desc: "Local IndexedDb caches protect critical records during outage emergencies. Synced back automatically when wifi connects.",
                tag: "Outages Shield",
                icon: <Database className="text-rose-500" size={22} />
              }
            ].map((feat, i) => (
              <div 
                key={i} 
                className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-850 rounded-2xl p-5 hover:border-orange-500/30 transition duration-150 flex flex-col justify-between"
              >
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="p-2.5 bg-white dark:bg-zinc-950 rounded-xl border border-zinc-150 dark:border-zinc-800">
                      {feat.icon}
                    </div>
                    <span className="text-[10px] font-bold font-mono tracking-wider uppercase text-zinc-400">
                      {feat.tag}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 font-sans tracking-tight">
                      {feat.title}
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                      {feat.desc}
                    </p>
                  </div>
                </div>

                <div className="pt-6 border-t border-zinc-200/40 dark:border-zinc-850 mt-5">
                  <div className="w-full bg-zinc-200/50 dark:bg-zinc-950 h-28 rounded-lg flex items-center justify-center border border-dashed border-zinc-300 dark:border-zinc-800 text-[10px] uppercase font-mono tracking-widest text-zinc-400 font-bold select-none">
                    Preview Link Active
                  </div>
                </div>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* 8. SECTION 7: PRICING */}
      <section id="pricing" className="py-20 md:py-28 bg-zinc-50 dark:bg-zinc-900 border-y border-zinc-200/50 dark:border-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-20">
            <span className="text-xs font-bold uppercase tracking-widest text-orange-650 dark:text-orange-400">Simple Transparent Pricing</span>
            <h2 className="text-3xl md:text-5xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
              One Subscription. No Surprise Fees.
            </h2>
            <p className="text-sm md:text-base text-zinc-500 dark:text-zinc-400">
              Upgrade, downgrade, or cancel your active plan anytime. Secure Stripe settlements with simple recurring monthly rates.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            
            {/* Starter Plan */}
            <div className="bg-white dark:bg-zinc-950 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6 sm:p-8 flex flex-col justify-between shadow-sm relative">
              <div className="space-y-6">
                <div>
                  <span className="text-xs font-bold font-mono tracking-wider uppercase text-zinc-400">Starter</span>
                  <div className="flex items-baseline mt-2">
                    <span className="text-4xl font-extrabold text-zinc-950 dark:text-zinc-50 font-mono">RM18</span>
                    <span className="text-zinc-500 text-xs ml-1 font-semibold">/ month</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-2 min-h-[32px]">Best details for local diners bootstrapping single outlet operations.</p>
                </div>

                <ul className="space-y-3.5 text-xs text-zinc-650 dark:text-zinc-350 border-t border-zinc-100 dark:border-zinc-850 pt-5">
                  <li className="flex items-center"><Check className="text-emerald-500 mr-2 shrink-0" size={15} /> <span>1 Active Brand Outlet Limit</span></li>
                  <li className="flex items-center"><Check className="text-emerald-500 mr-2 shrink-0" size={15} /> <span>QR Web Ordering System</span></li>
                  <li className="flex items-center"><Check className="text-emerald-500 mr-2 shrink-0" size={15} /> <span>Basic Cashier POS App</span></li>
                  <li className="flex items-center text-zinc-400"><X className="mr-2 shrink-0" size={14} /> <span>Kitchen Display Screens</span></li>
                  <li className="flex items-center text-zinc-400"><X className="mr-2 shrink-0" size={14} /> <span>Network Printer support</span></li>
                </ul>
              </div>

              <div className="pt-8 mt-8 border-t border-zinc-100 dark:border-zinc-850">
                <Link
                  to="/register"
                  className="block w-full py-3 text-center rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-950 text-xs font-black uppercase tracking-wider transition active:scale-95"
                >
                  Start Starter Plan
                </Link>
              </div>
            </div>

            {/* Growth Plan (Most Popular) */}
            <div className="bg-white dark:bg-zinc-950 rounded-3xl border-2 border-orange-500 dark:border-orange-500 p-6 sm:p-8 flex flex-col justify-between shadow-xl relative scale-100 md:scale-105">
              <span className="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-600 text-white px-3 py-1 text-[10px] font-black uppercase tracking-widest font-mono">
                Most Popular
              </span>

              <div className="space-y-6">
                <div>
                  <span className="text-xs font-bold font-mono tracking-wider uppercase text-orange-600 dark:text-orange-400">Growth</span>
                  <div className="flex items-baseline mt-2">
                    <span className="text-4xl font-extrabold text-zinc-950 dark:text-zinc-50 font-mono">RM38</span>
                    <span className="text-zinc-500 text-xs ml-1 font-semibold">/ month</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-2 min-h-[32px]">Perfect for collaborative, expanding diners and cafes with multiple spots.</p>
                </div>

                <ul className="space-y-3.5 text-xs text-zinc-650 dark:text-zinc-350 border-t border-orange-100 dark:border-zinc-850 pt-5">
                  <li className="flex items-center"><Check className="text-emerald-500 mr-2 shrink-0" size={15} /> <span>Up to 3 operational outlets</span></li>
                  <li className="flex items-center"><Check className="text-emerald-500 mr-2 shrink-0" size={15} /> <span>Kitchen Display Screens (KDS)</span></li>
                  <li className="flex items-center"><Check className="text-emerald-500 mr-2 shrink-0" size={15} /> <span>Thermal Network Printer Support</span></li>
                  <li className="flex items-center"><Check className="text-emerald-500 mr-2 shrink-0" size={15} /> <span>Granular Staff Access Permissions</span></li>
                  <li className="flex items-center"><Check className="text-emerald-500 mr-2 shrink-0" size={15} /> <span>Basic POS & Analytics</span></li>
                </ul>
              </div>

              <div className="pt-8 mt-8 border-t border-zinc-100 dark:border-zinc-850">
                <Link
                  to="/register"
                  className="block w-full py-3.5 text-center rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-black uppercase tracking-wider transition active:scale-95 shadow-md shadow-orange-500/20"
                >
                  Start growth trial
                </Link>
              </div>
            </div>

            {/* Pro Plan */}
            <div className="bg-white dark:bg-zinc-950 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6 sm:p-8 flex flex-col justify-between shadow-sm relative">
              <div className="space-y-6">
                <div>
                  <span className="text-xs font-bold font-mono tracking-wider uppercase text-zinc-400">Pro Integration</span>
                  <div className="flex items-baseline mt-2">
                    <span className="text-4xl font-extrabold text-zinc-950 dark:text-zinc-50 font-mono">RM98</span>
                    <span className="text-zinc-500 text-xs ml-1 font-semibold">/ month</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-2 min-h-[32px]">Best details for franchise brand operators and high volume AI users.</p>
                </div>

                <ul className="space-y-3.5 text-xs text-zinc-650 dark:text-zinc-350 border-t border-zinc-100 dark:border-zinc-850 pt-5">
                  <li className="flex items-center"><Check className="text-emerald-500 mr-2 shrink-0" size={15} /> <span>Unlimited Outlet Generation</span></li>
                  <li className="flex items-center"><Check className="text-emerald-500 mr-2 shrink-0" size={15} /> <span>AI multi-word translation cap</span></li>
                  <li className="flex items-center"><Check className="text-emerald-500 mr-2 shrink-0" size={15} /> <span>Advanced Performance charts</span></li>
                  <li className="flex items-center"><Check className="text-emerald-500 mr-2 shrink-0" size={15} /> <span>Franchise Controls & branding</span></li>
                  <li className="flex items-center"><Check className="text-emerald-500 mr-2 shrink-0" size={15} /> <span>Priority SLA ticketing chats</span></li>
                </ul>
              </div>

              <div className="pt-8 mt-8 border-t border-zinc-100 dark:border-zinc-850">
                <Link
                  to="/register"
                  className="block w-full py-3 text-center rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-950 text-xs font-black uppercase tracking-wider transition active:scale-95"
                >
                  Start Corporate Plan
                </Link>
              </div>
            </div>

          </div>

          <div className="mt-14 max-w-lg mx-auto text-center space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-450 dark:text-zinc-400">14-Day Free Trial ● No Credit Card Required</h4>
            <p className="text-[11px] text-zinc-400">
              Sign up today and get 14 days of unrestricted access of our starter system. Upgrade, shift plans, or request custom offline integrations inside the billing console.
            </p>
          </div>

        </div>
      </section>

      {/* 9. SECTION 8: SOCIAL PROOF */}
      <section className="py-20 md:py-28 bg-white dark:bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center max-w-3xl mx-auto space-y-4 mb-20">
            <span className="text-xs font-bold uppercase tracking-widest text-orange-600 dark:text-orange-500 font-mono flex items-center justify-center gap-1.5">
              <Award size={14} /> Trust Coordinates
            </span>
            <h2 className="text-3xl md:text-5xl font-black text-zinc-900 dark:text-zinc-50 tracking-tight">
              Built for Restaurants in Malaysia & Singapore
            </h2>
            <p className="text-sm md:text-base text-zinc-500 dark:text-zinc-400">
              Hear from actual dining captains, coffee roasters, and franchise founders running Sikmatye coordinates perfectly every day:
            </p>
          </div>

          {/* Testimonial Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                quote: "Before Sikmatye, we were losing 10-15 tickets during the busy weekend dinner rush. Now, smartphone orders flow straight to kitchen printers and KDS panels. General wait times decreased by 18 minutes average.",
                author: "Chef Raymond Tan",
                role: "Operations Director, Mamak Bistro Kajang",
                outlets: "2 Outlets Active"
              },
              {
                quote: "The Offline-First capability saved us yesterday. Local commercial fiber lines split near our block, killing all store internet. Our POS system kept ringing up registers and queuing KOT tickets without missing a single order.",
                author: "Lim Siew Mei",
                role: "Founder, Lim's Dim Sum Group",
                outlets: "3 Outlets Connected"
              },
              {
                quote: "AI menu translation transformed our branch tourist revenues. In Johor near Singapore, foreign visitors scan and browse our local listings in Japanese, Chinese, or Malay instantly. Highly recommended.",
                author: "Azlan Iskandar",
                role: "Managing Partner, Jom Kopi Roasters",
                outlets: "Single Branch Pro"
              }
            ].map((test, i) => (
              <div 
                key={i} 
                className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/60 dark:border-zinc-850 rounded-2xl p-6 flex flex-col justify-between space-y-6 shadow-sm"
              >
                <div className="space-y-4 text-zinc-600 dark:text-zinc-350">
                  <div className="text-orange-500 font-serif text-3xl leading-none">“</div>
                  <p className="text-xs sm:text-sm leading-relaxed italic">
                    {test.quote}
                  </p>
                </div>

                <div className="border-t border-zinc-200/40 dark:border-zinc-800 pt-4 flex justify-between items-center text-xs">
                  <div>
                    <h4 className="font-bold text-zinc-900 dark:text-zinc-100">{test.author}</h4>
                    <span className="text-zinc-500 block text-[10px] mt-0.5">{test.role}</span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded bg-orange-100/60 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 text-[10px] uppercase font-bold tracking-tight">
                    {test.outlets}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Realistic Logo Grid */}
          <div className="mt-20 border-t border-zinc-200/50 dark:border-zinc-900 pt-10 text-center space-y-6">
            <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Powering Leading dining hotspots globally</span>
            <div className="flex flex-wrap justify-center items-center gap-12 opacity-40 hover:opacity-60 transition duration-200 select-none">
              <span className="text-base font-black tracking-tighter uppercase font-sans">Nasi Lemak HQ</span>
              <span className="text-base font-bold italic font-sans tracking-wide">Little Penang Cafe</span>
              <span className="text-base font-black font-mono tracking-widest">Kopi Kafe 21</span>
              <span className="text-base font-medium font-sans underline decoration-2 decoration-orange-550">Dim Sum Capital</span>
              <span className="text-base font-black tracking-tight font-sans">BakeHouse SG</span>
            </div>
          </div>

        </div>
      </section>

      {/* 10. SECTION 9: FAQ */}
      <section id="faq" className="py-20 md:py-28 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200/50 dark:border-zinc-950">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center space-y-4 mb-16">
            <HelpCircle className="mx-auto text-orange-500" size={30} />
            <h2 className="text-3xl md:text-5xl font-black text-zinc-900 dark:text-zinc-50 tracking-tight">
              Frequently Asked Questions
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Have questions about implementation, printer links, offline registers, or translations? Find details here:
            </p>
          </div>

          <div className="space-y-4">
            {faqsArr.map((faq, index) => {
              const isExpanded = expandedFaq === index;
              return (
                <div 
                  key={index}
                  className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden transition"
                >
                  <button
                    onClick={() => setExpandedFaq(isExpanded ? null : index)}
                    type="button"
                    className="w-full text-left p-5 flex justify-between items-center font-bold text-sm sm:text-base text-zinc-850 dark:text-zinc-150 gap-4"
                  >
                    <span>{faq.q}</span>
                    <span className={`text-orange-500 text-lg transition duration-200 ${isExpanded ? 'rotate-45' : ''}`}>
                      <Plus size={18} />
                    </span>
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-t border-zinc-100 dark:border-zinc-850/60"
                      >
                        <p className="p-5 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed bg-zinc-50/40 dark:bg-zinc-900/10">
                          {faq.a}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

        </div>
      </section>

      {/* 11. SECTION 10: FINAL CTA */}
      <section className="py-20 md:py-28 bg-white dark:bg-zinc-950 text-center relative overflow-hidden">
        
        {/* Vector Accent glow decoration */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-500/10 blur-3xl rounded-full pointer-events-none" />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative space-y-8">
          
          <div className="space-y-4">
            <span className="text-xs font-black uppercase tracking-widest text-orange-600 dark:text-orange-500">Accelerate Kitchen Workflows</span>
            <h2 className="text-3xl sm:text-5xl font-black tracking-tight text-zinc-950 dark:text-white">
              Ready to Modernize Your Restaurant?
            </h2>
            <p className="text-sm sm:text-base text-zinc-500 dark:text-zinc-400 max-w-xl mx-auto leading-relaxed">
              Join leading dining spots using Sikmatye to simplify customer ordering, process fast kitchen prints, and improve financial reporting.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto pt-4">
            <Link
              to="/register"
              className="w-full sm:w-auto px-8 py-4 bg-orange-600 hover:bg-orange-700 text-white font-black text-center text-sm rounded-2xl shadow-xl shadow-orange-500/20 hover:shadow-orange-500/30 transition-all transform active:scale-98 tracking-wide flex items-center justify-center space-x-2"
            >
              <span>Start Free Trial</span>
              <ArrowRight size={18} />
            </Link>
            
            <button
              type="button"
              onClick={() => setIsBookDemoOpen(true)}
              className="w-full sm:w-auto px-8 py-4 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 border border-zinc-250 dark:border-zinc-800 font-bold text-sm text-center rounded-2xl transition"
            >
              Book Demo Consultation
            </button>
          </div>

          <p className="text-[10px] text-zinc-400">
            No credit card setup required. Your 14-day trial runs automatically.
          </p>

        </div>
      </section>

      {/* 12. SAAS FOOTER */}
      <footer className="bg-zinc-900 text-zinc-400 py-12 border-t border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 border-b border-zinc-800 pb-10">
            
            {/* Brand descriptor */}
            <div className="space-y-4 md:col-span-2">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center overflow-hidden border border-zinc-800">
                  <img src="/logo.png" className="w-full h-full object-cover" alt="Sikmatye Logo" referrerPolicy="no-referrer" />
                </div>
                <span className="text-base font-black tracking-tight text-white">Sikmatye OS</span>
              </div>
              <p className="text-xs text-zinc-500 max-w-sm leading-relaxed">
                Sikmatye is the complete Restaurant Operating System linking QR online ordering, kitchen display feeds (KDS), thermal printing nodes, and offline-first shifting POS structures seamlessly.
              </p>
            </div>

            {/* Platform Links */}
            <div className="space-y-3.5">
              <h4 className="text-xs uppercase font-extrabold tracking-widest text-zinc-200 font-mono">Platform</h4>
              <ul className="space-y-2 text-xs">
                <li><a href="#features" className="hover:text-white transition">Product Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition">SaaS Pricing</a></li>
                <li><a href="#faq" className="hover:text-white transition">Help Knowledge</a></li>
                <li><Link to="/login" className="hover:text-white transition">Manager Sign In</Link></li>
              </ul>
            </div>

            {/* Legal Links */}
            <div className="space-y-3.5">
              <h4 className="text-xs uppercase font-extrabold tracking-widest text-zinc-200 font-mono">Company Info</h4>
              <ul className="space-y-2 text-xs">
                <li><a href="#" className="hover:text-white transition">Contact Hub</a></li>
                <li><a href="#" className="hover:text-white transition">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-white transition">Terms of Service</a></li>
                <li><a href="/internal/audit-hub" className="hover:text-white transition font-mono uppercase text-[9px] bg-zinc-800 border border-zinc-700 px-1 py-0.5 rounded text-orange-400">System Audit</a></li>
              </ul>
            </div>

          </div>

          <div className="pt-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-zinc-650">
            <span>© 2026 Sikmatye Inc. All rights reserve coordinates globally.</span>
            <div className="flex space-x-4">
              <span>RM Currency processing handled safely via Stripe API.</span>
            </div>
          </div>

        </div>
      </footer>

      {/* 13. BOOK DEMO DIALOG FLYOUT / OVERLAY */}
      <AnimatePresence>
        {isBookDemoOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            
            {/* Background Backdrop blur */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsBookDemoOpen(false)}
              className="fixed inset-0 bg-zinc-950/50 backdrop-blur-sm" 
            />

            {/* Modal Body Container */}
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="relative w-full max-w-lg bg-white dark:bg-zinc-900 border border-zinc-250 dark:border-zinc-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col p-6 sm:p-8 space-y-6"
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <h3 className="text-lg font-black text-zinc-900 dark:text-zinc-50 font-sans">
                    Book Sikmatye Expert Consultation
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Get custom suggestions regarding kitchen layouts, ticketing printers, and offline setups.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsBookDemoOpen(false)}
                  className="p-1 rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                >
                  <X size={18} />
                </button>
              </div>

              {demoSubmitted ? (
                <div className="text-center py-12 space-y-4">
                  <div className="w-16 h-16 bg-emerald-500/10 dark:bg-emerald-950/20 text-emerald-500 mx-auto rounded-full flex items-center justify-center shadow">
                    <ShieldCheck size={32} />
                  </div>
                  <h4 className="text-base font-bold text-zinc-900 dark:text-zinc-50">Demo Inbound Request Logged!</h4>
                  <p className="text-xs text-zinc-500 max-w-sm mx-auto leading-relaxed">
                    Our Southeast Asian operations team will reach out to you within 2 business hours regarding custom KDS / POS hardware integrations for <strong>{demoForm.restaurantName}</strong>. Ready to scale!
                  </p>
                </div>
              ) : (
                <form onSubmit={handleDemoSubmit} className="space-y-4">
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-450 dark:text-zinc-400 block">Your Contact Name</label>
                      <input 
                        type="text" 
                        required
                        value={demoForm.name}
                        onChange={(e) => setDemoForm(p => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Raymond Tan"
                        className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-orange-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-450 dark:text-zinc-400 block">Restaurant Brand Name</label>
                      <input 
                        type="text" 
                        required
                        value={demoForm.restaurantName}
                        onChange={(e) => setDemoForm(p => ({ ...p, restaurantName: e.target.value }))}
                        placeholder="e.g. Mamak Bistro Kajang"
                        className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-orange-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-450 dark:text-zinc-400 block">Phone Connection</label>
                      <input 
                        type="tel" 
                        required
                        value={demoForm.phone}
                        onChange={(e) => setDemoForm(p => ({ ...p, phone: e.target.value }))}
                        placeholder="e.g. +6012-345 6789"
                        className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-orange-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-450 dark:text-zinc-400 block">Business Email</label>
                      <input 
                        type="email" 
                        required
                        value={demoForm.email}
                        onChange={(e) => setDemoForm(p => ({ ...p, email: e.target.value }))}
                        placeholder="e.g. manager@bistro.com"
                        className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-orange-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-450 dark:text-zinc-400 block">Operational Outlets Count</label>
                    <select 
                      value={demoForm.outlets}
                      onChange={(e) => setDemoForm(p => ({ ...p, outlets: e.target.value }))}
                      className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-orange-500"
                    >
                      <option value="1">1 Active Outlet (Single Diner)</option>
                      <option value="2-3">2-3 Operational Areas (Growth Target)</option>
                      <option value="4+">4+ Channels (Enterprise Chain)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold tracking-wider text-zinc-450 dark:text-zinc-400 block">Specific notes / Special requests</label>
                    <textarea 
                      rows={3}
                      value={demoForm.message}
                      onChange={(e) => setDemoForm(p => ({ ...p, message: e.target.value }))}
                      placeholder="Specify your thermal printer models or current legacy POS pains..."
                      className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-orange-500"
                    />
                  </div>

                  <div className="pt-4 flex items-center justify-end space-x-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setIsBookDemoOpen(false)}
                      className="px-4 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl font-bold"
                    >
                      Dismiss
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2.5 bg-orange-650 hover:bg-orange-700 bg-orange-600 text-white rounded-xl font-black uppercase tracking-wider transition shadow"
                    >
                      Send Consult Application
                    </button>
                  </div>

                </form>
              )}

              <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 text-center flex items-center justify-center space-x-1 text-[9px] text-zinc-400 uppercase tracking-widest font-mono">
                <Lock size={10} />
                <span>Encrypted client directory. 256-Bit SSL protection.</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
