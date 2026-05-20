import { useState, useEffect } from 'react';
import { 
  Building, Server, TrendingUp, Activity, Terminal, ShieldAlert,
  Search, Plus, CheckCircle, AlertTriangle, X, ChevronRight,
  Database, RefreshCw, Key, Power, Play, CreditCard, Ban, Trash2, Sliders
} from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { getApiUrl } from '../lib/api';

interface TenantFeature {
  duitnow_payment: boolean;
  partial_payment: boolean;
  kitchen_display: boolean;
  multi_language_menu: boolean;
  socket_realtime: boolean;
}

interface TenantUsage {
  numOrders: number;
  activeSessions: number;
  apiCalls: number;
}

interface BillingItem {
  date: string;
  description: string;
  amount: number;
  status: 'paid' | 'pending';
}

interface Tenant {
  id: string;
  name: string;
  currency: string;
  serviceCharge: number;
  sst: number;
  createdAt: string;
  subscriptionPlan: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'suspended' | 'deleted';
  features: TenantFeature;
  billingHistory: BillingItem[];
  usage: TenantUsage;
}

interface ActiveOrder {
  id: string;
  tableId: string;
  sessionId: string;
  restaurantId: string;
  restaurantName: string;
  status: string;
  paymentStatus: 'PAID' | 'PENDING';
  totalAmount: number;
  createdAt: string;
  isStuck: boolean;
  isInvestigating: boolean;
}

interface DebugData {
  orderId: string;
  timeline: { event: string; timestamp: string; author: string }[];
  gatewayPayload: any;
  webhookLogs: { timestamp: string; direction: string; path: string; status: number; message: string }[];
  socketEvents: { event: string; timestamp: string; recipients: string[]; value?: string }[];
  isInvestigating: boolean;
}

export function SuperAdmin() {
  const { token, profile } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'overview' | 'tenants' | 'orders' | 'logs'>('overview');
  
  // Dashboard Metrics
  const [metrics, setMetrics] = useState({
    totalTenants: 0,
    activeTenants: 0,
    activeOrdersCount: 0,
    totalRevenue: 0,
    systemHealth: 'Healthy',
    paymentSuccessRate: 94.6,
    webhookFailureRate: 0.8,
    socketConnections: 0,
    redisQueueStatus: 'Online',
    apiLatency: '22ms'
  });

  // Data collections
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  const [systemLogs, setSystemLogs] = useState<{ level: string; timestamp: string; message: string }[]>([]);
  
  // Searching & Filtering
  const [tenantSearch, setTenantSearch] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderTenantFilter, setOrderTenantFilter] = useState('all');
  const [showStuckOnly, setShowStuckOnly] = useState(false);

  // Modal / Drawer Selection states
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<ActiveOrder | null>(null);
  const [orderDebug, setOrderDebug] = useState<DebugData | null>(null);
  const [isRefreshingDebug, setIsRefreshingDebug] = useState(false);
  const [isRetryingWebhook, setIsRetryingWebhook] = useState(false);

  // Forms
  const [showCreateTenantModal, setShowCreateTenantModal] = useState(false);
  const [newTenantName, setNewTenantName] = useState('');
  const [newTenantPlan, setNewTenantPlan] = useState<'free' | 'pro' | 'enterprise'>('free');
  const [newTenantCurrency, setNewTenantCurrency] = useState('MYR');
  const [newTenantServiceCharge, setNewTenantServiceCharge] = useState(6.0);
  const [newTenantSst, setNewTenantSst] = useState(10.0);
  const [isCreatingTenant, setIsCreatingTenant] = useState(false);

  // General Status triggers
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Auth Guard check: Reject non-superadmins immediately
  const isSuper = profile?.role === 'admin' || profile?.email === 'admin@jomorder.com';

  const triggerToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchDashboardData = async () => {
    if (!token) return;
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      
      const [resDash, resTenants, resOrders, resMetrics] = await Promise.all([
        fetch(getApiUrl('/api/superadmin/dashboard'), { headers }),
        fetch(getApiUrl('/api/superadmin/tenants'), { headers }),
        fetch(getApiUrl('/api/superadmin/orders'), { headers }),
        fetch(getApiUrl('/api/superadmin/system/metrics'), { headers })
      ]);

      if (resDash.ok) {
        const data = await resDash.json();
        setMetrics(data);
      }
      if (resTenants.ok) {
        setTenants(await resTenants.json());
      }
      if (resOrders.ok) {
        setActiveOrders(await resOrders.json());
      }
      if (resMetrics.ok) {
        const data = await resMetrics.json();
        setSystemLogs(data.logs || []);
      }
    } catch (e: any) {
      console.error("Failed to load superadmin statistics", e);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    if (isSuper) {
      fetchDashboardData();
      
      // Auto pulse system data every 4 seconds for real-time telemetry updates!
      const interval = setInterval(() => {
        fetchDashboardData();
      }, 4000);

      return () => clearInterval(interval);
    }
  }, [token, isSuper]);

  // Fetch Order debugging details
  const fetchOrderDebug = async (orderId: string) => {
    if (!token) return;
    setIsRefreshingDebug(true);
    try {
      const response = await fetch(getApiUrl(`/api/superadmin/orders/${orderId}/debug`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const debug = await response.json();
        setOrderDebug(debug);
      } else {
        triggerToast("Failed to retrieve system debug trace", "error");
      }
    } catch (err) {
      triggerToast("Network interruption tracing webhook path", "error");
    } finally {
      setIsRefreshingDebug(false);
    }
  };

  // Create Tenant (Restaurant)
  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newTenantName.trim()) return;
    setIsCreatingTenant(true);

    try {
      const response = await fetch(getApiUrl('/api/superadmin/tenants'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newTenantName,
          currency: newTenantCurrency,
          serviceCharge: newTenantServiceCharge,
          sst: newTenantSst,
          subscriptionPlan: newTenantPlan
        })
      });

      if (response.ok) {
        triggerToast(`Successfully registered "${newTenantName}" as system tenant`);
        setShowCreateTenantModal(false);
        setNewTenantName('');
        fetchDashboardData();
      } else {
        const err = await response.json();
        triggerToast(err.error || "Failed to register tenant", "error");
      }
    } catch (err) {
      triggerToast("Network connection error", "error");
    } finally {
      setIsCreatingTenant(false);
    }
  };

  // Update Tenant flags, plans, status
  const updateTenantConfig = async (tenantId: string, payload: Partial<Tenant>) => {
    if (!token) return;
    try {
      // Find current state
      const current = tenants.find(t => t.id === tenantId);
      if (!current) return;

      const response = await fetch(getApiUrl(`/api/superadmin/tenants/${tenantId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          ...current,
          ...payload
        })
      });

      if (response.ok) {
        triggerToast("Tenant configuration updated instantly (Real-time Sync)");
        // Update local state instantly and sync from background
        setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, ...payload } : t));
        if (selectedTenant && selectedTenant.id === tenantId) {
          setSelectedTenant(prev => prev ? { ...prev, ...payload } : null);
        }
        fetchDashboardData();
      } else {
        triggerToast("Failed to write configurations to database registry", "error");
      }
    } catch (err) {
      triggerToast("Interruption connecting to management route", "error");
    }
  };

  // Retry Webhook Execution
  const handleRetryWebhook = async (orderId: string) => {
    if (!token) return;
    setIsRetryingWebhook(true);
    try {
      const response = await fetch(getApiUrl(`/api/superadmin/orders/${orderId}/retry-webhook`), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        triggerToast("Webhook payload re-queued successfully - Order marked PAID!");
        // Refresh Order details
        fetchOrderDebug(orderId);
        fetchDashboardData();
      } else {
        triggerToast("Gateway failed to retry webhook", "error");
      }
    } catch (err) {
      triggerToast("Webhook processing failed to assert database callback", "error");
    } finally {
      setIsRetryingWebhook(false);
    }
  };

  // Toggle order investigation flags
  const handleToggleInvestigate = async (orderId: string) => {
    if (!token) return;
    try {
      const response = await fetch(getApiUrl(`/api/superadmin/orders/${orderId}/investigate`), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const res = await response.json();
        const msg = res.isInvestigating 
          ? "Incident log raised: Order tagged as INVESTIGATING" 
          : "Incident log resolved: Investigation mark retired";
        triggerToast(msg);
        fetchOrderDebug(orderId);
        fetchDashboardData();
      }
    } catch (err) {
      triggerToast("Failed to toggle investigation log", "error");
    }
  };

  // Soft Delete Restaurant (soft mark)
  const handleSoftDelete = (tenantId: string) => {
    if (confirm("Are you sure you want to soft delete this tenant? They will be locked out and invisible in routing directories.")) {
      updateTenantConfig(tenantId, { status: 'deleted' });
    }
  };

  if (!isSuper) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 bg-zinc-950 text-white font-sans">
        <ShieldAlert size={64} className="text-red-500 animate-pulse mb-4" />
        <h1 className="text-2xl font-bold tracking-tight mb-2 uppercase">Access Authorization Denied</h1>
        <p className="text-zinc-500 text-sm max-w-md text-center">
          The requested system terminal is reserve-restricted to SaaS Platform Owners. Please login with a Super Admin credential.
        </p>
      </div>
    );
  }

  // Filter collections
  const filteredTenants = tenants.filter(t => 
    t.status !== 'deleted' &&
    t.name.toLowerCase().includes(tenantSearch.toLowerCase())
  );

  const filteredOrders = activeOrders.filter(o => {
    const matchesSearch = o.id.toLowerCase().includes(orderSearch.toLowerCase()) || 
                          o.restaurantName.toLowerCase().includes(orderSearch.toLowerCase());
    const matchesTenant = orderTenantFilter === 'all' || o.restaurantId === orderTenantFilter;
    const matchesStuck = !showStuckOnly || o.isStuck;

    return matchesSearch && matchesTenant && matchesStuck;
  });

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans p-2 sm:p-6 pb-24 md:pl-24">
      {/* Toast notifications */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border transition-all duration-300 animate-bounce ${
          toast.type === 'success' 
            ? 'bg-emerald-950/95 border-emerald-500/30 text-emerald-400' 
            : 'bg-red-950/95 border-red-500/30 text-red-400'
        }`}>
          <CheckCircle size={18} />
          <span className="text-xs font-semibold tracking-wide">{toast.message}</span>
        </div>
      )}

      {/* Top Deck Banner */}
      <div className="relative mb-8 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 overflow-hidden">
        <div className="absolute top-0 right-0 h-full w-1/3 bg-radial from-orange-500/5 to-transparent blur-2xl pointer-events-none" />
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2 w-2 rounded-full bg-orange-500 animate-ping" />
              <span className="text-[10px] font-black tracking-[0.3em] uppercase text-orange-500">SYSTEM COGNIZANT PORTAL</span>
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight">Super Admin Dashboard</h1>
            <p className="text-zinc-400 text-xs mt-1">Multi-Tenant SLA Monitoring & Real-time Webhook Operations Logs.</p>
          </div>
          <button 
            onClick={() => setShowCreateTenantModal(true)}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold tracking-wider uppercase px-4 py-3 rounded-lg transition-transform active:scale-95 shadow-lg shadow-orange-500/10"
          >
            <Plus size={16} /> Register Tenant
          </button>
        </div>
      </div>

      {/* SLA Telemetry Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4">
          <div className="p-3 bg-zinc-800 rounded-xl text-blue-500">
            <Building size={22} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-extrabold text-zinc-500">RESTAURANT TENANTS</p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight">{metrics.totalTenants}</span>
              <span className="text-[9px] text-zinc-400 font-bold">({metrics.activeTenants} Active)</span>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4">
          <div className="p-3 bg-zinc-800 rounded-xl text-orange-500">
            <TrendingUp size={22} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-extrabold text-zinc-500">ALL ACTIVE ORDERS</p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight">{metrics.activeOrdersCount}</span>
              <span className="text-[9px] text-zinc-400 font-bold">In Pipelines</span>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4">
          <div className="p-3 bg-zinc-800 rounded-xl text-emerald-500">
            <CreditCard size={22} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-extrabold text-zinc-500">SLA REVENUE (TODAY)</p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight">RM {metrics.totalRevenue.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4">
          <div className="p-3 bg-zinc-800 rounded-xl text-orange-500">
            <Activity size={22} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-extrabold text-zinc-500">SERVER APY RESPONSE</p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold tracking-tight text-emerald-400">{metrics.apiLatency}</span>
              <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block mb-1" />
            </div>
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-2 border-b border-zinc-800 pb-2 mb-6">
        {[
          { id: 'overview', label: 'Dashboard Live Map', icon: Activity },
          { id: 'tenants', label: 'SaaS Tenant Registry', icon: Building },
          { id: 'orders', label: 'Cross-Tenant Active Orders', icon: TrendingUp },
          { id: 'logs', label: 'Platform Console Logs', icon: Terminal }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 border ${
                activeTab === tab.id 
                  ? 'bg-zinc-800 border-zinc-700 text-white' 
                  : 'bg-transparent border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* PANEL CONTENTS */}

      {/* 1. OVERVIEW LIVE TELEMETRY MAP */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Monitor Metrics */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <h3 className="text-sm font-black tracking-wider uppercase text-zinc-400 mb-4 flex items-center gap-2">
                <Server size={16} /> SLA HEALTH DECK
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl text-center">
                  <span className="text-xs text-zinc-500 font-bold block uppercase mb-1">DuitNow Gateway Rate</span>
                  <p className="text-2xl font-black text-emerald-400">{metrics.paymentSuccessRate}%</p>
                  <span className="text-[9px] text-zinc-600 block mt-1">Target SLA: 92.5%</span>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl text-center">
                  <span className="text-xs text-zinc-500 font-bold block uppercase mb-1">WebHook Retry Fails</span>
                  <p className="text-2xl font-black text-red-400">{metrics.webhookFailureRate}%</p>
                  <span className="text-[9px] text-zinc-600 block mt-1">Target SLA: {"< 1.5%"}</span>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl text-center">
                  <span className="text-xs text-zinc-500 font-bold block uppercase mb-1">Active Sockets Count</span>
                  <p className="text-2xl font-black text-blue-400">{metrics.socketConnections}</p>
                  <span className="text-[9px] text-zinc-600 block mt-1">Realtime Connection Thread</span>
                </div>
              </div>
            </div>

            {/* Quick Diagnostic Instructions Card */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <h3 className="text-sm font-black tracking-wider uppercase text-zinc-400 mb-2">
                OPS ASSISTANCE PROTOCOLS
              </h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                As a platform administrator, you monitor all order statuses in real-time. If an incoming web checkout callback fails or times out (indicated by a "stuck" alert tag on active orders), drill down into the order payload parameters. You can retry processing using the mock gateway listener loop or mark the entry for further investigation in the ops journal in one touch. User order items remain unmodifiable by core SLA specification constraints.
              </p>
            </div>
          </div>

          {/* Quick Stats sidebar logs */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <h3 className="text-sm font-black tracking-wider uppercase text-zinc-400 mb-4 flex items-center gap-2">
              <Database size={16} /> SYSTEM TELEMETRY
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-zinc-800 text-xs">
                <span className="text-zinc-500">PostgreSQL Cloud Database</span>
                <span className="font-bold text-emerald-400">Connected</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-zinc-800 text-xs">
                <span className="text-zinc-500">Redis Cache Bus</span>
                <span className="font-bold text-emerald-400">{metrics.redisQueueStatus}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-zinc-800 text-xs">
                <span className="text-zinc-500">Live Socket.IO Stream</span>
                <span className="font-bold text-emerald-400">Active</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-zinc-800 text-xs">
                <span className="text-zinc-500">SLA Webhook Logs</span>
                <span className="font-bold text-emerald-400">Streaming</span>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* 2. TENANTS MODULE WORKSPACE */}
      {activeTab === 'tenants' && (
        <div>
          {/* Action Row */}
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-center mb-6">
            <div className="relative w-full sm:w-80">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search SaaS Tenant Registry..."
                value={tenantSearch}
                onChange={e => setTenantSearch(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-xs rounded-lg pl-10 pr-4 py-2.5 focus:outline-none focus:border-zinc-700 font-semibold tracking-wider"
              />
            </div>
            <div className="text-xs font-bold text-zinc-400">
              Showing <span className="text-orange-500 font-black">{filteredTenants.length}</span> active restaurant tenants
            </div>
          </div>

          {/* Tenants Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTenants.map(tenant => {
              const activeSessions = tenant.usage?.activeSessions || 0;
              const totalOrders = tenant.usage?.numOrders || 0;
              const totalApi = tenant.usage?.apiCalls || 0;

              return (
                <div 
                  key={tenant.id}
                  className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl p-6 transition-all shadow-xl"
                >
                  <div className="flex justify-between items-start gap-2 mb-4">
                    <div>
                      <h3 className="text-base font-black tracking-tight text-white mb-1 leading-tight">{tenant.name}</h3>
                      <span className="text-[10px] font-mono text-zinc-500">{tenant.id}</span>
                    </div>
                    {/* Status badge */}
                    <div className="flex flex-col items-end gap-1.5">
                      <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${
                        tenant.status === 'active' 
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/20' 
                          : 'bg-zinc-800 text-zinc-400 border border-zinc-700/20'
                      }`}>
                        {tenant.status}
                      </span>
                      <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${
                        tenant.subscriptionPlan === 'enterprise' 
                          ? 'bg-purple-950 text-purple-400 border border-purple-500/20' 
                          : tenant.subscriptionPlan === 'pro'
                          ? 'bg-blue-950 text-blue-400 border border-blue-500/20'
                          : 'bg-neutral-800 text-zinc-400'
                      }`}>
                        {tenant.subscriptionPlan} Plan
                      </span>
                    </div>
                  </div>

                  {/* Usage telemetry inline */}
                  <div className="grid grid-cols-3 gap-2 bg-zinc-950 p-2.5 border border-zinc-800/60 rounded-xl text-center mb-4 text-[11px]">
                    <div>
                      <span className="text-[8px] uppercase tracking-wider text-zinc-500 block mb-0.5">Orders Count</span>
                      <span className="font-bold text-white">{totalOrders}</span>
                    </div>
                    <div>
                      <span className="text-[8px] uppercase tracking-wider text-zinc-500 block mb-0.5">Live Sessions</span>
                      <span className="font-bold text-emerald-400">{activeSessions}</span>
                    </div>
                    <div>
                      <span className="text-[8px] uppercase tracking-wider text-zinc-500 block mb-0.5">Monthly APIs</span>
                      <span className="font-bold text-blue-400">{totalApi}</span>
                    </div>
                  </div>

                  {/* Config settings panel */}
                  <div className="space-y-4 pt-2 border-t border-zinc-800">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-zinc-500">Service Charge / SST</span>
                      <span className="font-bold">{tenant.serviceCharge}% / {tenant.sst}%</span>
                    </div>
                    
                    {/* Feature Flag quick review badges */}
                    <div className="flex flex-wrap gap-1">
                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold ${tenant.features?.duitnow_payment ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-950 text-zinc-600'}`}>DuitNow</span>
                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold ${tenant.features?.partial_payment ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-950 text-zinc-600'}`}>Partial-Pay</span>
                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold ${tenant.features?.kitchen_display ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-950 text-zinc-600'}`}>KDS Screen</span>
                      <span className={`px-2 py-0.5 rounded text-[8px] font-bold ${tenant.features?.multi_language_menu ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-950 text-zinc-600'}`}>MultilingMenu</span>
                    </div>

                    {/* Manage buttons */}
                    <div className="flex gap-2 pt-2">
                      <button 
                        onClick={() => setSelectedTenant(tenant)}
                        className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-[10px] font-bold tracking-wider uppercase py-2 px-3 rounded-lg border border-zinc-700"
                      >
                        Adjust Config & Flags
                      </button>
                      <button 
                        onClick={() => handleSoftDelete(tenant.id)}
                        className="p-2 bg-zinc-950 hover:bg-red-950 text-zinc-600 hover:text-red-400 border border-zinc-800 rounded-lg transition-colors"
                        title="Delete Tenant"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}


      {/* 3. ACTIVE ORDERS READONLY TERMINAL */}
      {activeTab === 'orders' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
          {/* Header Workspace Options */}
          <div className="p-6 border-b border-zinc-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex block md:flex gap-4 w-full md:w-auto">
              {/* Search Order Input */}
              <div className="relative flex-1 md:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Order ID / restaurant search..."
                  value={orderSearch}
                  onChange={e => setOrderSearch(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 text-xs rounded-lg pl-9 pr-4 py-2 focus:outline-none focus:border-zinc-700 font-semibold tracking-wider text-white"
                />
              </div>

              {/* Tenant choose */}
              <select
                value={orderTenantFilter}
                onChange={e => setOrderTenantFilter(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 text-xs rounded-lg px-3 py-2 text-zinc-300 font-semibold active:outline-none focus:outline-none"
              >
                <option value="all">All Restaurants</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* Stuck filters */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showStuckOnly}
                onChange={e => setShowStuckOnly(e.target.checked)}
                className="rounded bg-zinc-950 border-zinc-800 text-orange-600 focus:ring-0 focus:ring-offset-0"
              />
              <span className="text-xs font-bold text-zinc-400 tracking-wider flex items-center gap-1.5 uppercase">
                <AlertTriangle size={14} className="text-orange-500" /> Highlight Stuck Orders Only
              </span>
            </label>
          </div>

          {/* Orders Table UI */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="bg-zinc-950/50 text-[10px] font-black uppercase tracking-wider border-b border-zinc-800 text-zinc-500">
                <tr>
                  <th className="p-4">Order Details</th>
                  <th className="p-4">Tenant / Restaurant</th>
                  <th className="p-4 text-center">Table / Session</th>
                  <th className="p-4 text-center">Payment System</th>
                  <th className="p-4 text-right">Total RM</th>
                  <th className="p-4 text-center">Pipeline Status</th>
                  <th className="p-4 text-right">Actions Dashboard</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-zinc-500 font-semibold">
                      No active orders matched search criteria.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map(order => (
                    <tr 
                      key={order.id}
                      className={`hover:bg-zinc-800/40 transition-colors ${
                        order.isStuck ? 'bg-orange-500/5' : ''
                      }`}
                    >
                      <td className="p-4">
                        <div className="font-bold flex items-center gap-1.5">
                          <span className="text-white">#{order.id.slice(0, 8)}</span>
                          {order.isStuck && (
                            <span className="bg-orange-950/80 text-orange-400 border border-orange-500/20 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider animate-pulse flex items-center gap-1">
                              <AlertTriangle size={10} /> Stuck
                            </span>
                          )}
                          {order.isInvestigating && (
                            <span className="bg-red-950/80 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider">
                              Investigating
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-zinc-500 font-medium">
                          {new Date(order.createdAt).toLocaleTimeString()} · {new Date(order.createdAt).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="p-4 font-semibold text-zinc-200">
                        {order.restaurantName}
                      </td>
                      <td className="p-4 text-center font-mono">
                        <span className="bg-zinc-950 px-2 py-1 rounded border border-zinc-800 text-zinc-400 font-bold">
                          Table {order.tableId || "POS/Kiosk"}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          order.paymentStatus === 'PAID' 
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/20' 
                            : 'bg-zinc-800 text-zinc-500'
                        }`}>
                          {order.paymentStatus}
                        </span>
                      </td>
                      <td className="p-4 text-right font-bold text-white">
                        RM {order.totalAmount.toFixed(2)}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${
                          order.status === 'confirmed' || order.status === 'completed'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/20'
                            : order.status === 'pending'
                            ? 'bg-yellow-950 text-yellow-400 border border-yellow-500/20'
                            : 'bg-blue-950 text-blue-400 border border-blue-500/20'
                        }`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <button 
                          onClick={() => {
                            setSelectedOrder(order);
                            fetchOrderDebug(order.id);
                          }}
                          className="bg-zinc-800 hover:bg-orange-600 text-white text-[10px] font-black tracking-wider uppercase px-3 py-1.5 rounded transition-colors"
                        >
                          Trace & Debug
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}


      {/* 4. PLATFORM LIVE LOGS CONSOLE */}
      {activeTab === 'logs' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-black tracking-wider uppercase text-zinc-400 flex items-center gap-2">
              <Terminal size={16} /> API GATEWAY LOGGER CONSOLE
            </h3>
            <span className="text-[10px] bg-zinc-950 text-zinc-500 border border-zinc-800 px-2 py-1 rounded font-bold uppercase tracking-wider">
              AUTO REFRESH ACTIVE (4s)
            </span>
          </div>
          
          {/* Mock Console */}
          <div className="bg-zinc-950 p-4 border border-zinc-800 rounded-xl font-mono text-[11px] leading-relaxed select-text shadow-inner">
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {systemLogs.map((log, idx) => (
                <div key={idx} className="flex gap-4">
                  <span className="text-zinc-600">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                  <span className={log.level === 'warn' ? 'text-amber-500' : 'text-zinc-500'}>
                    [{log.level.toUpperCase()}]
                  </span>
                  <span className="text-zinc-200">{log.message}</span>
                </div>
              ))}
              <div className="text-orange-500 flex items-center gap-2 animate-pulse mt-3 font-semibold pb-1">
                <span>● STREAM LISTENING... Ready for active webhook events</span>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* SYSTEM MODALS & REGISTRY CONFIG DRAWER */}

      {/* ADJUST TENANT CONFIGURATION AND FLAGS DRAWER */}
      {selectedTenant && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-lg rounded-2xl p-6 overflow-hidden relative animate-in fade-in zoom-in-95 duration-200 shadow-2xl">
            <button 
              onClick={() => setSelectedTenant(null)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-200"
            >
              <X size={20} />
            </button>
            
            <h2 className="text-lg font-black tracking-tight mb-1 text-white uppercase flex items-center gap-2">
              <Sliders size={18} className="text-orange-500" /> Adjust Portal Configs
            </h2>
            <p className="text-xs text-zinc-500 mb-6">Real-time parameters for {selectedTenant.name}</p>

            <div className="space-y-5">
              {/* Plan Choice Dropdown */}
              <div>
                <label className="text-[10px] font-black tracking-wider text-zinc-500 uppercase block mb-1.5">SaaS Subscription Plan</label>
                <select
                  value={selectedTenant.subscriptionPlan}
                  onChange={e => updateTenantConfig(selectedTenant.id, { subscriptionPlan: e.target.value as any })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs font-bold text-zinc-300"
                >
                  <option value="free">Standard (Free SLA)</option>
                  <option value="pro">Pro Merchant Plan</option>
                  <option value="enterprise">Enterprise VIP Service</option>
                </select>
              </div>

              {/* Status Change Dropdown */}
              <div>
                <label className="text-[10px] font-black tracking-wider text-zinc-500 uppercase block mb-1.5">Tenant Service Status</label>
                <select
                  value={selectedTenant.status}
                  onChange={e => updateTenantConfig(selectedTenant.id, { status: e.target.value as any })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs font-bold text-zinc-300"
                >
                  <option value="active">Active System Node</option>
                  <option value="suspended">Suspended SLA Restriction</option>
                </select>
              </div>

              {/* Toggle Feature Flags */}
              <div className="pt-4 border-t border-zinc-800">
                <span className="text-[10px] font-black tracking-wider text-zinc-500 uppercase block mb-3">Modular Feature Flags Permissions</span>
                <div className="space-y-3">
                  {[
                    { key: 'duitnow_payment', label: 'DuitNow QR Checkout Gateways', desc: 'Allows instant customer checkout via PayNet e-Wallets' },
                    { key: 'partial_payment', label: 'Partial & Family Split Checks', desc: 'Allows customer tables to split billing increments' },
                    { key: 'kitchen_display', label: 'Kitchen Display (KDS) Screen Access', desc: 'Enables real-time kitchen monitors inside kitchens' },
                    { key: 'multi_language_menu', label: 'AI Multi-Language Deep Translation', desc: 'Allows instant auto-translation using automated models' },
                    { key: 'socket_realtime', label: 'Real-time WebSockets Sync', desc: 'Forces client live stream updates via server sockets' }
                  ].map(flag => (
                    <div key={flag.key} className="flex justify-between items-start gap-4 p-2 rounded bg-zinc-950/50 border border-zinc-800/40">
                      <div>
                        <span className="text-xs font-bold text-zinc-200 block leading-tight">{flag.label}</span>
                        <span className="text-[9px] text-zinc-500 block mt-0.5 leading-snug">{flag.desc}</span>
                      </div>
                      <button
                        onClick={() => {
                          const updated = { ...selectedTenant.features, [flag.key]: !selectedTenant.features[flag.key as keyof TenantFeature] };
                          updateTenantConfig(selectedTenant.id, { features: updated });
                        }}
                        className={`p-1.5 rounded-lg border transition-all ${
                          selectedTenant.features[flag.key as keyof TenantFeature]
                            ? 'bg-emerald-950/80 border-emerald-500/20 text-emerald-400'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-650'
                        }`}
                      >
                        <Power size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="mt-8 pt-4 border-t border-zinc-800 flex gap-2">
              <button
                onClick={() => setSelectedTenant(null)}
                className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-3 rounded-lg text-xs font-bold uppercase tracking-wider"
              >
                Close Portal Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE NEW TENANT MODAL */}
      {showCreateTenantModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form 
            onSubmit={handleCreateTenant}
            className="bg-zinc-900 border border-zinc-800 w-full max-w-md rounded-2xl p-6 overflow-hidden relative animate-in fade-in zoom-in-95 duration-200 shadow-2xl"
          >
            <button 
              type="button" 
              onClick={() => setShowCreateTenantModal(false)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-200"
            >
              <X size={20} />
            </button>
            
            <h2 className="text-lg font-black tracking-tight mb-1 text-white uppercase flex items-center gap-2">
              <Building size={18} className="text-orange-500" /> New Tenant Registry
            </h2>
            <p className="text-xs text-zinc-500 mb-6">Deploy a brand-new restaurant tenant instantly</p>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black tracking-wider text-zinc-500 uppercase block mb-1">Restaurant Tenant Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Jom Dim Sum Subang"
                  value={newTenantName}
                  onChange={e => setNewTenantName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-700 font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black tracking-wider text-zinc-500 uppercase block mb-1">Currency Code</label>
                  <input
                    type="text"
                    required
                    maxLength={3}
                    value={newTenantCurrency}
                    onChange={e => setNewTenantCurrency(e.target.value.toUpperCase())}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-white font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black tracking-wider text-zinc-500 uppercase block mb-1">SaaS Launch Plan</label>
                  <select
                    value={newTenantPlan}
                    onChange={e => setNewTenantPlan(e.target.value as any)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-300 font-bold"
                  >
                    <option value="free">Standard (Free)</option>
                    <option value="pro">Pro Merchant</option>
                    <option value="enterprise">Enterprise Partner</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-black tracking-wider text-zinc-500 uppercase block mb-1">Service Charge (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={newTenantServiceCharge}
                    onChange={e => setNewTenantServiceCharge(parseFloat(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-white font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black tracking-wider text-zinc-500 uppercase block mb-1">Government SST (%)</label>
                  <input
                    type="number"
                    step="1"
                    required
                    value={newTenantSst}
                    onChange={e => setNewTenantSst(parseFloat(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-xs text-white font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-zinc-800 flex gap-2">
              <button
                type="button"
                onClick={() => setShowCreateTenantModal(false)}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-350 text-xs font-bold uppercase tracking-wider py-3 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreatingTenant}
                className="flex-[1.5] bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold uppercase tracking-wider py-3 rounded-lg shadow-lg disabled:opacity-50"
              >
                {isCreatingTenant ? 'Provisioning...' : 'Provision Now'}
              </button>
            </div>
          </form>
        </div>
      )}


      {/* ORDER TRACING & DIAGNOSTIC DRAWER */}
      {selectedOrder && (
        <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-zinc-900 border-l border-zinc-800 z-50 p-6 shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-200">
          <div className="flex justify-between items-start mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-ping" />
                <span className="text-[10px] font-black tracking-widest text-orange-500 uppercase">OPS TELEMETRY LOG</span>
              </div>
              <h2 className="text-xl font-black text-white leading-tight">Order #{selectedOrder.id.slice(0, 8)}</h2>
              <span className="text-[10px] font-mono text-zinc-500 block mt-0.5">{selectedOrder.restaurantName}</span>
            </div>
            <button 
              onClick={() => {
                setSelectedOrder(null);
                setOrderDebug(null);
              }}
              className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg"
            >
              <X size={20} />
            </button>
          </div>

          {!orderDebug && isRefreshingDebug && (
            <div className="h-64 flex flex-col justify-center items-center gap-2 text-zinc-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
              <span className="text-xs font-semibold tracking-wider uppercase">Acquiring diagnostic parameters...</span>
            </div>
          )}

          {orderDebug && (
            <div className="space-y-6">
              {/* Critical Operations controls */}
              <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800/80">
                <span className="text-[10px] font-black tracking-wide text-zinc-500 uppercase block mb-3">Ops Intervention Actions</span>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleRetryWebhook(selectedOrder.id)}
                    disabled={isRetryingWebhook || selectedOrder.paymentStatus === 'PAID'}
                    className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black uppercase tracking-wider py-2.5 rounded disabled:opacity-40 transition-colors"
                  >
                    <Play size={12} /> Retry Webhook Callback
                  </button>
                  <button
                    onClick={() => handleToggleInvestigate(selectedOrder.id)}
                    className={`flex items-center justify-center gap-2 text-[11px] font-black uppercase tracking-wider py-2.5 rounded border transition-colors ${
                      orderDebug.isInvestigating
                        ? 'bg-red-950/80 border-red-500/20 text-red-400 hover:bg-red-900/40'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700'
                    }`}
                  >
                    <ShieldAlert size={12} /> {orderDebug.isInvestigating ? 'Resolve Investigation' : 'Mark Investigating'}
                  </button>
                </div>
              </div>

              {/* Order State timeline */}
              <div>
                <span className="text-[10px] font-black tracking-wide text-zinc-500 uppercase block mb-3">Order Trace Timeline</span>
                <div className="space-y-3 font-mono text-[10px]">
                  {orderDebug.timeline.map((line, idx) => (
                    <div key={idx} className="flex gap-4 p-2 bg-zinc-950 rounded border border-zinc-800/40">
                      <span className="text-zinc-600">[{new Date(line.timestamp).toLocaleTimeString()}]</span>
                      <div className="flex-1">
                        <span className="text-white font-semibold block">{line.event}</span>
                        <span className="text-zinc-500 block text-[9px] mt-0.5">Executor: {line.author}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Gateway parameters inspecting box */}
              <div>
                <span className="text-[10px] font-black tracking-wide text-zinc-500 uppercase block mb-3">Payment Gateway Payload</span>
                <div className="bg-zinc-950 p-3 rounded border border-zinc-800 font-mono text-[9px] text-zinc-400 overflow-x-auto select-all max-h-48 overflow-y-auto">
                  <pre>{JSON.stringify(orderDebug.gatewayPayload, null, 2)}</pre>
                </div>
              </div>

              {/* Webhook events and incoming responses */}
              <div>
                <span className="text-[10px] font-black tracking-wide text-zinc-500 uppercase block mb-3">Incoming SLA Webhook Logs</span>
                <div className="space-y-2 font-mono text-[10px]">
                  {orderDebug.webhookLogs.map((log, idx) => (
                    <div key={idx} className="p-3 bg-zinc-950/80 rounded border border-zinc-800/50">
                      <div className="flex justify-between text-zinc-500 mb-1">
                        <span>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                        <span className={log.status === 200 ? 'text-emerald-500' : 'text-red-500'}>
                          HTTP {log.status}
                        </span>
                      </div>
                      <p className="text-zinc-300 font-bold">{log.direction} {"→"} {log.path}</p>
                      <p className="text-zinc-550 mt-1 text-[9px] leading-tight">{log.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
