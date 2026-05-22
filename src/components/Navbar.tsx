import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChefHat, LayoutDashboard, ShoppingBag, Settings, LogOut, Banknote, Building2, User, X, Globe } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { useState, useEffect } from 'react';
import { getApiUrl } from '../lib/api';

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, token, signOut } = useAuthStore();
  const { language, setLanguage, t } = useLanguageStore();
  
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [restaurants, setRestaurants] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Extract restId from path: /restaurant/:restId/...
  const pathParts = location.pathname.split('/');
  const restIndex = pathParts.indexOf('restaurant');
  const urlRestId = restIndex !== -1 ? pathParts[restIndex + 1] : null;
  
  const restId = urlRestId || profile?.restaurantId;

  // Find organization of the active restaurant to check max_outlets ceiling
  const activeRestaurant = restaurants.find(r => r.id === restId);
  const activeOrgId = activeRestaurant?.organization_id;
  const activeOrg = organizations.find(o => o.id === activeOrgId);

  // If Max Outlet Ceiling = 1, then the user should not see the switch workspace navbar capabilities.
  // Default to hide (false) during loading so there is no 1-second visual flash.
  const isWorkspaceSwitcherVisible = !isLoading && (
    profile?.role?.toLowerCase() === 'admin' || 
    (activeOrg ? activeOrg.max_outlets !== 1 : true)
  );

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    const fetchOrgs = async () => {
      try {
        const res = await fetch(getApiUrl('/api/my-workspaces'), {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (res.ok) {
          const data = await res.json();
          setOrganizations(data.organizations || []);
          setRestaurants(data.restaurants || []);
        }
      } catch (err) {
        console.error("Failed to load organizations in Navbar:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchOrgs();
  }, [token]);

  // Don't show Navbar on landing page (Conditional returns must be placed below all hook calls)
  if (location.pathname === '/') return null;

  // Don't show Navbar for customers on mobile (they have their own navigation in CustomerMenu)
  const isCustomerPath = location.pathname.includes('/table/') || location.pathname.includes('/order/');
  if (isCustomerPath && !user) return null;

  const handleSelectOrg = (orgId: string) => {
    setIsDropdownOpen(false);
    navigate(`/workspace-select?orgId=${orgId}`);
  };

  const handleSignOut = async () => {
    setIsDropdownOpen(false);
    await signOut();
    navigate('/login');
  };

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 bg-zinc-950 border-t border-zinc-900 px-4 py-2 flex justify-around items-center md:top-0 md:bottom-auto md:flex-col md:w-14 md:h-full md:border-t-0 md:border-r md:pt-4 md:space-y-4 z-50 shadow-2xl">
        <Link 
          to={restId ? `/restaurant/${restId}/table/default` : '/'} 
          className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/table/') ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'text-zinc-600 hover:text-orange-500'}`}
        >
          <ShoppingBag size={20} />
        </Link>
        
        {user && restId && (
          <>
            <Link 
              to={`/restaurant/${restId}/payments`} 
              className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/payments') ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'text-zinc-600 hover:text-emerald-500'}`}
            >
              <Banknote size={20} />
            </Link>
            <Link 
              to={`/restaurant/${restId}/orders`} 
              className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/orders') ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'text-zinc-600 hover:text-blue-500'}`}
            >
              <LayoutDashboard size={20} />
            </Link>
            <Link 
              to={`/restaurant/${restId}/kitchen`} 
              className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/kitchen') ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'text-zinc-600 hover:text-orange-500'}`}
            >
              <ChefHat size={20} />
            </Link>
            <Link 
              to={`/restaurant/${restId}/admin`} 
              className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/admin') ? 'bg-zinc-800 text-zinc-100 border border-zinc-700' : 'text-zinc-600 hover:text-zinc-300'}`}
            >
              <Settings size={20} />
            </Link>
            {isWorkspaceSwitcherVisible && (
              <Link 
                to="/workspace-select" 
                title="Switch Workspace"
                className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/workspace-select') ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'text-zinc-600 hover:text-orange-500'}`}
              >
                <Building2 size={20} />
              </Link>
            )}
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
                  
                  {/* Language Switch Section */}
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
                <span className="text-[10px] font-mono text-zinc-400 block break-all bg-zinc-900 p-2.5 rounded-lg border border-zinc-850 mt-1 select-all select-none truncate max-w-xs">
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
    </>
  );
}
