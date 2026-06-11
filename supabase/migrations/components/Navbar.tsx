import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChefHat, LayoutDashboard, ShoppingBag, Settings, LogOut, Banknote, Building2, User, X, Globe, CreditCard, Bell, Check } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../store/useWorkspaceStore';
import { offlineService } from '../lib/offlineService';
import { hasPermission } from '../lib/rbac';
import { Organization, WorkspaceRestaurant } from '../types';
import { supabase } from '../lib/supabase';

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, token, signOut, switchWorkspace } = useAuthStore();
  const { language, setLanguage, t } = useLanguageStore();
  
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  
  // Real-time Assistance variables
  const [assistanceRequests, setAssistanceRequests] = useState<any[]>([]);
  const [isAssistanceOpen, setIsAssistanceOpen] = useState(false);

  const { 
    organizations, 
    restaurants, 
    loading: isWorkspaceStoreLoading, 
    hasFetched, 
    fetchWorkspaces 
  } = useWorkspaceStore();

  const isLoading = isWorkspaceStoreLoading || (!hasFetched && !!token);

  // Offline states
  const [isOnline, setIsOnline] = useState(true);
  const [queueStatus, setQueueStatus] = useState({ pendingCount: 0, failedCount: 0, processingCount: 0, isSyncing: false });

  useEffect(() => {
    const unsubConnectivity = offlineService.subscribeConnectivity(setIsOnline);
    const unsubQueue = offlineService.subscribeQueueStatus(setQueueStatus);
    return () => {
      unsubConnectivity();
      unsubQueue();
    };
  }, []);

  
  const pathParts = location.pathname.split('/');
  const restIndex = pathParts.indexOf('restaurant');
  const urlRestId = restIndex !== -1 ? pathParts[restIndex + 1] : null;
  
  const restId = urlRestId || profile?.restaurantId;

  const activeRestaurant = restaurants.find(r => r.id?.toString() === restId?.toString());
  const activeOrgId = activeRestaurant?.organization_id;
  const activeOrg = organizations.find(o => o.id === activeOrgId);

  const activeOrgBranches = restaurants.filter(
    r => r.organization_id && r.organization_id === activeOrgId
  );

  const isWorkspaceSwitcherVisible = !isLoading && (
    activeOrg ? (Number(activeOrg.max_outlets) > 1) : false
  );

  useEffect(() => {
    if (token) {
      fetchWorkspaces(token);
    }
  }, [token, fetchWorkspaces]);

  // Real-time Assistance WebSocket broadcast listener
  useEffect(() => {
    if (!user || !restId) return;

    const channel = supabase.channel(`assistance-${restId}`);

    channel
      .on('broadcast', { event: 'assistance_requested' }, (payload: any) => {
        console.log('[Navbar] Realtime assistance request received', payload);
        const data = payload.payload;
        if (data && data.restId === restId) {
          setAssistanceRequests(prev => {
            if (prev.some(r => r.id === data.id)) return prev;
            
            // Double-chime major third ring dynamically (Web Audio API)
            try {
              const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
              const osc1 = audioCtx.createOscillator();
              const osc2 = audioCtx.createOscillator();
              const gainNode = audioCtx.createGain();
              
              osc1.type = 'sine';
              osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
              osc2.type = 'sine';
              osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime); // E5
              
              gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
              gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
              
              osc1.connect(gainNode);
              osc2.connect(gainNode);
              gainNode.connect(audioCtx.destination);
              
              osc1.start();
              osc2.start();
              osc1.stop(audioCtx.currentTime + 0.6);
              osc2.stop(audioCtx.currentTime + 0.6);
            } catch (err) {
              console.warn('[Navbar] Web Audio Chime ignored:', err);
            }

            return [data, ...prev];
          });
        }
      })
      .on('broadcast', { event: 'assistance_resolved' }, (payload: any) => {
        console.log('[Navbar] Realtime assistance resolution received', payload);
        const data = payload.payload;
        if (data && data.id) {
          setAssistanceRequests(prev => prev.filter(r => r.id !== data.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, restId]);

  const handleResolveAssistance = async (id: string) => {
    // Optimistically update local active calls state
    setAssistanceRequests(prev => prev.filter(r => r.id !== id));

    try {
      // Broadcast to other staff devices that this assistance is resolved!
      const channel = supabase.channel(`assistance-${restId}`);
      await channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.send({
            type: 'broadcast',
            event: 'assistance_resolved',
            payload: { id }
          });
          setTimeout(() => {
            supabase.removeChannel(channel);
          }, 3000);
        }
      });
    } catch (err) {
      console.error('[Navbar] Failed to send resolution broadcast:', err);
    }
  };

  if (location.pathname === '/') return null;

  const isCustomerPath = location.pathname.includes('/table/') || location.pathname.includes('/order/');
  if (isCustomerPath && !user) return null;

  const handleSelectOrg = (orgId: string) => {
    setIsDropdownOpen(false);
    navigate(`/workspace-select?orgId=${orgId}`);
  };

  const handleSelectBranch = async (branchId: string, role?: string) => {
    setIsDropdownOpen(false);
    try {
      await switchWorkspace(branchId);
      const lowerRole = role ? role.toLowerCase() : '';
      if (lowerRole === 'kitchen' || lowerRole === 'runner') {
        navigate(`/restaurant/${branchId}/kitchen`);
      } else if (lowerRole === 'owner' || lowerRole === 'manager' || lowerRole === 'admin') {
        navigate(`/restaurant/${branchId}/admin`);
      } else {
        navigate(`/restaurant/${branchId}/orders`);
      }
    } catch (err) {
      console.error("Failed to switch branch inside navbar dropdown:", err);
    }
  };

  const handleSignOut = async () => {
    setIsDropdownOpen(false);
    await signOut();
    navigate('/login');
  };

  return (
    <>
      {/* Offline Banner and Syncing indicators */}
      <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[10000] flex flex-col gap-1.5 pointer-events-none items-center max-w-sm w-full font-sans">
        {!isOnline && (
          <div className="pointer-events-auto bg-amber-500 text-zinc-950 px-4 py-2.5 rounded-full text-xs font-black shadow-2xl flex items-center gap-2 border border-amber-400">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping shrink-0" />
            <span className="leading-none">{t('navbar.workingOffline')}</span>
          </div>
        )}
        {(queueStatus.isSyncing || queueStatus.pendingCount > 0) && (
          <div className="pointer-events-auto bg-zinc-950/95 backdrop-blur-md border border-zinc-800 text-zinc-100 px-4 py-2 rounded-full text-xs font-bold shadow-2xl flex items-center gap-2.5">
            <span className="animate-spin text-orange-500 font-extrabold shrink-0 text-xs">🔄</span>
            <span className="leading-none">{t('navbar.syncBacklog', { count: queueStatus.pendingCount + queueStatus.processingCount })}</span>
          </div>
        )}
        {queueStatus.failedCount > 0 && (
          <div className="pointer-events-auto bg-red-950/90 backdrop-blur-md border border-red-800/80 text-red-100 px-4 py-2 rounded-full text-xs font-bold shadow-2xl flex items-center justify-between gap-3 w-full">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm">⚠️</span>
              <span className="leading-none">{t('navbar.syncDelayed', { count: queueStatus.failedCount })}</span>
            </div>
            <button
              onClick={() => offlineService.forceSyncAll()}
              className="pointer-events-auto bg-red-800 hover:bg-red-700 text-white font-extrabold px-2.5 py-1 rounded-full text-[10px] uppercase tracking-wider active:scale-95 transition-all outline-none shrink-0"
            >
              {t('navbar.retrySync')}
            </button>
          </div>
        )}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-zinc-950 border-t border-zinc-900 px-4 py-2 flex justify-around items-center md:top-0 md:bottom-auto md:flex-col md:w-14 md:h-full md:border-t-0 md:border-r md:pt-4 md:space-y-4 z-50 shadow-2xl">
        {(!profile || !profile.role || profile.role.toLowerCase() !== 'kitchen') && (
          <Link 
            to={restId ? `/restaurant/${restId}/table/default` : '/'} 
            className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/table/') ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'text-zinc-600 hover:text-orange-500'}`}
          >
            <ShoppingBag size={20} />
          </Link>
        )}
        
        {user && restId && (
          <>
            {hasPermission(profile?.role, 'payments.view', profile?.permissions) && (
              <Link 
                to={`/restaurant/${restId}/payments`} 
                className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/payments') ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'text-zinc-600 hover:text-emerald-500'}`}
              >
                <Banknote size={20} />
              </Link>
            )}
            {hasPermission(profile?.role, 'orders.view', profile?.permissions) && (
              <Link 
                to={`/restaurant/${restId}/orders`} 
                className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/orders') ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'text-zinc-600 hover:text-blue-500'}`}
              >
                <LayoutDashboard size={20} />
              </Link>
            )}
            {hasPermission(profile?.role, 'kitchen.view', profile?.permissions) && (
              <Link 
                to={`/restaurant/${restId}/kitchen`} 
                className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/kitchen') ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'text-zinc-600 hover:text-orange-500'}`}
              >
                <ChefHat size={20} />
              </Link>
            )}
            {hasPermission(profile?.role, 'settings.manage', profile?.permissions) && (
              <Link 
                to={`/restaurant/${restId}/admin`} 
                className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/admin') ? 'bg-zinc-800 text-zinc-100 border border-zinc-700' : 'text-zinc-600 hover:text-zinc-300'}`}
              >
                <Settings size={20} />
              </Link>
            )}
            {isWorkspaceSwitcherVisible && (
              <Link 
                to="/workspace-select" 
                title={t('navbar.switchWorkspace')}
                className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/workspace-select') ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'text-zinc-600 hover:text-orange-500'}`}
              >
                <Building2 size={20} />
              </Link>
            )}
            
            <button
              onClick={() => setIsAssistanceOpen(!isAssistanceOpen)}
              className={`p-2 rounded relative transition-all active:scale-90 ${
                isAssistanceOpen 
                  ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30 font-extrabold' 
                  : 'text-zinc-400 hover:text-amber-500'
              }`}
              title="Active Table Calls"
            >
              <Bell size={20} className={assistanceRequests.length > 0 ? 'animate-bounce text-amber-500' : ''} />
              {assistanceRequests.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-amber-500 text-zinc-950 text-[9px] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center border border-zinc-950 animate-pulse">
                  {assistanceRequests.length}
                </span>
              )}
            </button>
          </>
        )}
        
        {user && (
          <div className="relative md:mt-auto md:mb-4">
            <button 
              id="navbar-profile-btn"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)} 
              className={`p-2 rounded-full transition-all active:scale-90 ${
                isDropdownOpen 
                  ? 'bg-orange-500/20 text-orange-500 border border-orange-500/40' 
                  : 'bg-zinc-900 text-zinc-400 hover:text-orange-500 border border-zinc-800'
              }`}
            >
              <User size={18} />
            </button>

            {isDropdownOpen && (
              <>
                <div 
                  className="fixed inset-0 z-40 bg-transparent" 
                  onClick={() => setIsDropdownOpen(false)} 
                />
                <div className="absolute bottom-14 right-0 md:right-auto md:left-12 md:bottom-0 w-64 bg-zinc-950 border border-zinc-850 rounded-2xl shadow-2xl py-2.5 px-2 z-50 text-left animate-in fade-in slide-in-from-bottom-2 duration-150">
                  
                  {/* Language Selector */}
                  <div className="px-3 py-2 border-b border-zinc-900 mb-2 flex flex-col gap-1.5">
                    <p className="text-[9px] font-black uppercase text-zinc-500 tracking-wider flex items-center gap-1">
                      <Globe size={11} className="text-zinc-400" /> Language / 语言 / Bahasa
                    </p>
                    <div className="grid grid-cols-3 gap-0.5 bg-zinc-900 p-0.5 rounded-lg border border-zinc-850">
                      <button
                        onClick={() => setLanguage('en')}
                        className={`py-1 text-[10px] font-bold rounded-md transition-all ${language === 'en' ? 'bg-orange-500 text-white font-extrabold shadow' : 'text-zinc-500 hover:text-zinc-200'}`}
                      >
                        English
                      </button>
                      <button
                        onClick={() => setLanguage('zh')}
                        className={`py-1 text-[10px] font-bold rounded-md transition-all ${language === 'zh' ? 'bg-orange-500 text-white font-extrabold shadow' : 'text-zinc-500 hover:text-zinc-200'}`}
                      >
                        中文
                      </button>
                      <button
                        onClick={() => setLanguage('ms')}
                        className={`py-1 text-[10px] font-bold rounded-md transition-all ${language === 'ms' ? 'bg-orange-500 text-white font-extrabold shadow' : 'text-zinc-500 hover:text-zinc-200'}`}
                      >
                        Melayu
                      </button>
                    </div>
                  </div>

                  <div className="px-3 py-2 mb-1.5 border-b border-zinc-900">
                    <p className="text-[10px] font-black uppercase text-zinc-500 tracking-wider">{t('navbar.signedInAs')}</p>
                    <p className="text-xs font-bold text-zinc-300 truncate mt-0.5">{user.email || 'Admin User'}</p>
                  </div>

                  {/* Switch Brand */}
                  {organizations.length > 1 && (
                    <div className="px-3 pb-2.5 mb-2 border-b border-zinc-900">
                      <p className="text-[10px] font-black uppercase text-zinc-500 tracking-wider mb-2">{t('navbar.switchBrand')}</p>
                      <div className="space-y-1 max-h-36 overflow-y-auto pr-1 select-none">
                        {organizations.map((org) => (
                          <button
                            key={org.id}
                            onClick={() => handleSelectOrg(org.id)}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-between text-zinc-400 hover:bg-zinc-900 hover:text-orange-500"
                          >
                            <span className="truncate pr-2">{org.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                          {/* Quick Switch Branch Outlet within organization */}
                  {activeOrgBranches.length > 1 && (
                    <div className="px-3 pb-2.5 mb-2 border-b border-zinc-900">
                      <p className="text-[10px] font-black uppercase text-zinc-500 tracking-wider mb-2">{t('navbar.switchOutlet')}</p>
                      <div className="space-y-1 max-h-36 overflow-y-auto pr-1 select-none">
                        {activeOrgBranches.map((branch) => {
                          const isCurrent = branch.id === restId;
                          return (
                            <button
                              key={branch.id}
                              disabled={isCurrent}
                              onClick={() => handleSelectBranch(branch.id, branch.role)}
                              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-between ${
                                isCurrent 
                                  ? 'text-orange-500 bg-orange-500/5' 
                                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-orange-500'
                              }`}
                            >
                              <span className="truncate pr-2">{branch.name}</span>
                              {isCurrent && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-orange-500/10 font-bold">{t('navbar.active')}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="space-y-0.5">
                    <button
                      onClick={() => {
                        setIsProfileModalOpen(true);
                        setIsDropdownOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-all text-left"
                    >
                      <User size={14} className="text-zinc-500" />
                      {t('navbar.viewProfile')}
                    </button>

                    {hasPermission(profile?.role, 'settings.manage', profile?.permissions) && restId && (
                      <Link
                        to={`/restaurant/${restId}/billing`}
                        onClick={() => setIsDropdownOpen(false)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-all text-left"
                      >
                        <CreditCard size={14} className="text-zinc-500" />
                        Billing Subscription
                      </Link>
                    )}

                    {isWorkspaceSwitcherVisible && (
                      <button
                        onClick={() => {
                          setIsDropdownOpen(false);
                          navigate('/workspace-select');
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 transition-all text-left"
                      >
                        <Building2 size={14} className="text-zinc-500" />
                        {t('navbar.manageOutlets')}
                      </button>
                    )}

                    <button
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-red-500 hover:bg-red-500/10 transition-all text-left"
                    >
                      <LogOut size={14} />
                      {t('navbar.signOut')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </nav>

      {/* PROFILE SETTINGS MODAL IN NAVBAR */}
      {isProfileModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setIsProfileModalOpen(false)} />
          <div className="relative bg-zinc-950 w-full max-w-md rounded-[2.5rem] shadow-2xl border border-zinc-850 p-8 z-10 animate-in zoom-in-95 duration-200 text-left">
            
            <button 
              onClick={() => setIsProfileModalOpen(false)}
              className="absolute top-6 right-6 p-2 rounded-full bg-zinc-900 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-all"
            >
              <X size={16} />
            </button>

            <div className="mb-6">
              <div className="w-12 h-12 bg-orange-500/10 text-orange-500 rounded-2xl flex items-center justify-center mb-3">
                <User size={24} />
              </div>
              <h3 className="text-xl font-black text-zinc-100 tracking-tight">{t('navbar.activeIdentity')}</h3>
              <p className="text-xs text-zinc-500 font-semibold mt-0.5 animate-pulse">Your enterprise operational indicators</p>
            </div>

            <div className="space-y-4 bg-zinc-900/60 p-6 rounded-2xl border border-zinc-850/60 mb-6">
              <div>
                <span className="text-[10px] font-black uppercase text-zinc-500 block mb-0.5">{t('navbar.accountEmail')}</span>
                <span className="text-sm font-bold text-zinc-200">{user?.email || 'N/A'}</span>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-zinc-500 block mb-0.5">{t('navbar.userId')}</span>
                <span className="text-xs font-mono text-zinc-300 block break-all bg-zinc-900 p-2.5 rounded-lg border border-zinc-850 mt-1 select-all">{user?.id || 'N/A'}</span>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-zinc-500 block mb-0.5">{t('navbar.tenantToken')}</span>
                <span className="text-[10px] font-mono text-zinc-400 block break-all bg-zinc-900 p-2.5 rounded-lg border border-zinc-850 mt-1 select-all select-none truncate max-w-xs text-ellipsis overflow-hidden">
                  {token ? `${token.slice(0, 35)}...` : 'None'}
                </span>
              </div>
            </div>

            <button
              onClick={() => setIsProfileModalOpen(false)}
              className="w-full py-3.5 bg-orange-600 hover:bg-orange-700 text-white font-black text-xs uppercase tracking-wider rounded-2xl transition-all shadow-lg shadow-orange-950/20 active:scale-95 duration-100"
            >
              {t('navbar.dismiss')}
            </button>
          </div>
        </div>
      )}

      {/* Real-time Waiter Assistance Overlay Panel */}
      {isAssistanceOpen && user && (
        <>
          <div 
            className="fixed inset-0 z-[45] bg-zinc-950/20 backdrop-blur-xs" 
            onClick={() => setIsAssistanceOpen(false)} 
          />
          <div className="fixed bottom-16 left-4 right-4 md:bottom-auto md:left-18 md:top-4 md:w-80 bg-zinc-950 border border-zinc-900 rounded-3xl shadow-2xl p-5 z-50 text-left animate-in fade-in slide-in-from-bottom-2 md:slide-in-from-left-2 duration-150">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                <h4 className="text-sm font-black text-zinc-100 uppercase tracking-wider">
                  Table Calls ({assistanceRequests.length})
                </h4>
              </div>
              <button 
                onClick={() => setIsAssistanceOpen(false)}
                className="text-zinc-500 hover:text-zinc-350 p-1.5 hover:bg-zinc-900 rounded-lg transition"
              >
                <X size={14} />
              </button>
            </div>

            {assistanceRequests.length === 0 ? (
              <div className="py-8 text-center text-zinc-500 flex flex-col items-center gap-2">
                <div className="w-10 h-10 bg-zinc-900 text-zinc-650 rounded-xl flex items-center justify-center">
                  <Check size={18} />
                </div>
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">All Clear</p>
                <p className="text-[10px] text-zinc-500 font-medium">No tables are currently requesting waiter assistance.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                {assistanceRequests.map((req) => {
                  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(req.timestamp).getTime()) / 1000));
                  const timeStr = elapsedSeconds < 60 
                    ? `${elapsedSeconds}s ago` 
                    : `${Math.floor(elapsedSeconds / 60)}m ago`;

                  return (
                    <div 
                      key={req.id}
                      className="bg-zinc-900 border border-zinc-850 rounded-2xl p-3.5 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1 duration-200"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-black text-zinc-200">
                          Table {req.tableName || (req.tableId ? req.tableId.slice(-3).toUpperCase() : 'Guest')}
                        </p>
                        <p className="text-[10px] font-bold text-zinc-500 mt-0.5">
                          Assistance requested • {timeStr}
                        </p>
                      </div>

                      <button
                        onClick={() => handleResolveAssistance(req.id)}
                        className="h-8 px-3 bg-amber-500 hover:bg-amber-600 active:scale-95 text-zinc-950 rounded-xl text-[10px] font-black uppercase tracking-wider transition shrink-0"
                      >
                        Help Settle
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            
            <div className="mt-3 pt-3 border-t border-zinc-900 text-center flex items-center justify-center gap-1.5 text-[9px] text-zinc-500 uppercase font-extrabold tracking-widest leading-none">
              <span>🛎 Waiter Response Terminal</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
