import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { getApiUrl } from '../lib/api';
import { indexedDbStorage } from '../lib/indexedDbStorage';
import { 
  Building2, 
  Store, 
  ArrowRight, 
  Plus, 
  Loader2, 
  LogOut, 
  AlertTriangle,
  ShieldAlert,
  X,
  Clock,
  Check,
  Globe,
  PlusCircle,
  Hash,
  Sparkles
} from 'lucide-react';

const getEntryTimestampsAsync = async (userId: string): Promise<Record<string, number>> => {
  try {
    const data = await indexedDbStorage.getItem<any>(`workspace_entry_timestamps_${userId}`);
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch (_) {
        return {};
      }
    }
    return data || {};
  } catch (e) {
    return {};
  }
};

const recordEntryAsync = async (userId: string, workspaceId: string) => {
  try {
    const data = await getEntryTimestampsAsync(userId);
    data[workspaceId] = Date.now();
    await indexedDbStorage.setItem(`workspace_entry_timestamps_${userId}`, data);
  } catch (e) {
    console.error(e);
  }
};

const formatLastEntryTime = (lastEntryAtString?: string | null, fallbackTimestamp?: number) => {
  const dateObj = lastEntryAtString ? new Date(lastEntryAtString) : (fallbackTimestamp ? new Date(fallbackTimestamp) : null);
  if (!dateObj || isNaN(dateObj.getTime())) return null;

  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffMs < 0) return 'Just now';
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return dateObj.toLocaleDateString(undefined, { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
};

interface Organization {
  id: string;
  name: string;
  slug?: string;
  company_register_number?: string;
  created_at: string;
}

interface Workspace {
  id: string;
  name: string;
  organization_id?: string;
  role: string;
  status: string;
  permissions: Record<string, boolean>;
  last_entry_at?: string | null;
}

export function WorkspaceSelect() {
  const navigate = useNavigate();
  const { user, profile, token, signOut, switchWorkspace } = useAuthStore();
  const { language, setLanguage, t } = useLanguageStore();
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [entryTimestamps, setEntryTimestamps] = useState<Record<string, number>>({});
  
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newOrgName, setNewOrgName] = useState('');

  // Auto-restore session overlay states
  const [isFromLogin, setIsFromLogin] = useState(false);
  const [restoringSession, setRestoringSession] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [lastBranchId, setLastBranchId] = useState<string | null>(null);
  const [lastBranchName, setLastBranchName] = useState<string>('');
  const [lastModulePath, setLastModulePath] = useState<string | null>(null);

  // Edit Organization States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editOrgName, setEditOrgName] = useState('');
  const [editCompanyRegisterNumber, setEditCompanyRegisterNumber] = useState('');
  const [updatingOrg, setUpdatingOrg] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);

  const fetchWorkspaces = async (autoRedirectEnabled = false) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl('/api/my-workspaces'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!res.ok) {
        throw new Error(`Failed to load workspaces (${res.status})`);
      }
      
      const data = await res.json();
      const orgs = (data.organizations || []) as Organization[];
      const rests = (data.restaurants || []) as Workspace[];
      
      setOrganizations(orgs);
      setWorkspaces(rests);

      const params = new URLSearchParams(window.location.search);
      const isFromLoginVal = autoRedirectEnabled || params.get('fromLogin') === 'true' || params.get('fromlogin') === 'true';
      if (rests.length === 0 && isFromLoginVal) {
        navigate('/onboarding');
        return;
      }

      if (orgs.length > 0) {
        const params = new URLSearchParams(window.location.search);
        const queryOrgId = params.get('orgId');
        
        setSelectedOrgId(prev => {
          if (queryOrgId && orgs.some((o: any) => o.id === queryOrgId)) {
            return queryOrgId;
          }
          if (prev && orgs.some((o: any) => o.id === prev)) {
            return prev;
          }
          return orgs[0].id;
        });
      } else {
        setSelectedOrgId(null);
      }

      // Restore session or auto enter checks
      if (user?.id) {
        const timestamps = await getEntryTimestampsAsync(user.id);
        setEntryTimestamps(timestamps);
        const storedBranchId = await indexedDbStorage.getItem<string>(`user_last_branch_${user.id}`);
        const storedModulePath = await indexedDbStorage.getItem<string>(`user_last_module_${user.id}`);
        
        if (storedBranchId && rests.some(w => w.id === storedBranchId)) {
          const matchedBranch = rests.find(w => w.id === storedBranchId);
          setLastBranchId(storedBranchId);
          setLastBranchName(matchedBranch?.name || 'Previous Branch');
          setLastModulePath(storedModulePath || '');
          
          const params = new URLSearchParams(window.location.search);
          const forceSelector = params.get('select') === 'true';
          if (!forceSelector && !params.get('orgId') && autoRedirectEnabled) {
            setRestoringSession(true);
            return; // let countdown handle it
          }
        } else if (autoRedirectEnabled && rests.length === 1 && orgs.length === 1) {
          // If strictly 1 organization and 1 branch, enter automatically
          const singleOrg = orgs[0];
          const outlets = rests.filter((w: any) => w.organization_id === singleOrg.id);
          if (outlets.length === 1) {
            await handleSelectWorkspace(outlets[0].id, outlets[0].role);
            return;
          }
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred while loading workspaces.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLogin = params.get('fromLogin') === 'true' || params.get('fromlogin') === 'true';
    setIsFromLogin(fromLogin);
    const queryOrgId = params.get('orgId');
    if (queryOrgId) {
      setSelectedOrgId(queryOrgId);
    }
    // Only autoRedirect automatically if coming from real login page workflow
    fetchWorkspaces(fromLogin);
  }, [token, window.location.search]);

  // Session recovery countdown ticking
  useEffect(() => {
    if (!restoringSession || !lastBranchId) return;

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setRestoringSession(false);
          // Trigger entry
          const matched = workspaces.find(w => w.id === lastBranchId);
          if (matched) {
            handleSelectWorkspace(lastBranchId, matched.role, lastModulePath || '');
          }
          return 0;
        }
        return prev - 1;
      });
    }, 600);

    return () => clearInterval(timer);
  }, [restoringSession, lastBranchId, workspaces]);

  const handleSelectWorkspace = async (workspaceId: string, role: string, directPath?: string, forceDefaultLanding = !isFromLogin) => {
    setError(null);
    setSubmitting(true);
    try {
      await switchWorkspace(workspaceId);
      if (user?.id) {
        await recordEntryAsync(user.id, workspaceId);
      }
      
      const targetPath = !forceDefaultLanding && (directPath || (lastModulePath && lastModulePath.startsWith(`/restaurant/${workspaceId}`) ? lastModulePath : ''));
      if (targetPath) {
        navigate(targetPath);
        return;
      }

      // Default landing experiences
      const lowerRole = role ? role.toLowerCase() : '';
      if (lowerRole === 'kitchen' || lowerRole === 'runner') {
        navigate(`/restaurant/${workspaceId}/kitchen`);
      } else if (lowerRole === 'owner' || lowerRole === 'manager' || lowerRole === 'admin') {
        navigate(`/restaurant/${workspaceId}/admin`);
      } else {
        navigate(`/restaurant/${workspaceId}/orders`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to enter workspace.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspaceName.trim()) {
      setError("Please enter a branch/outlet name.");
      return;
    }
    if (!selectedOrgId && !newOrgName.trim()) {
      setError("Please select or enter an organization.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const payload: any = {
        workspaceName: newWorkspaceName.trim()
      };

      if (selectedOrgId) {
        payload.orgId = selectedOrgId;
      } else if (newOrgName.trim()) {
        payload.orgName = newOrgName.trim();
      }

      const res = await fetch(getApiUrl('/api/onboarding/create-org-workspace'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to create branch workspace.');
      }

      const outcome = await res.json();
      setNewWorkspaceName('');
      setNewOrgName('');
      
      await fetchWorkspaces(false);
      
      const restId = outcome.user?.restaurantId || outcome.user?.restaurant_id;
      const role = outcome.user?.role || 'owner';
      
      if (restId) {
        await handleSelectWorkspace(restId, role);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create and map branch.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEditModal = () => {
    if (currentOrg) {
      setEditOrgName(currentOrg.name);
      setEditCompanyRegisterNumber(currentOrg.company_register_number || '');
      setOrgError(null);
      setIsEditModalOpen(true);
    }
  };

  const handleUpdateOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg) return;
    if (!editOrgName.trim()) {
      setOrgError("Organization name cannot be empty.");
      return;
    }

    setUpdatingOrg(true);
    setOrgError(null);
    try {
      const res = await fetch(getApiUrl(`/api/organizations/${currentOrg.id}`), {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: editOrgName.trim(),
          company_register_number: editCompanyRegisterNumber.trim()
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update organization');
      }

      const updated = await res.json();
      
      setOrganizations(prev => 
        prev.map(o => o.id === currentOrg.id 
          ? { 
              ...o, 
              name: updated.name, 
              company_register_number: updated.company_register_number || editCompanyRegisterNumber.trim() 
            } 
          : o
        )
      );
      
      setIsEditModalOpen(false);
    } catch (err: any) {
      setOrgError(err.message || 'An error occurred while updating organization.');
    } finally {
      setUpdatingOrg(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const hasZeroOrgs = organizations.length === 0;
  const currentOrg = selectedOrgId ? organizations.find(o => o.id === selectedOrgId) : null;
  const filteredOutlets = selectedOrgId 
    ? workspaces.filter(w => !w.organization_id || w.organization_id === selectedOrgId)
    : workspaces;

  const activeWorkspaceId = profile?.restaurantId;

  const activeWorkspace = activeWorkspaceId 
    ? filteredOutlets.find(w => w.id === activeWorkspaceId) 
    : null;

  const otherWorkspaces = activeWorkspaceId 
    ? filteredOutlets.filter(w => w.id !== activeWorkspaceId) 
    : filteredOutlets;

  const sortedOtherWorkspaces = [...otherWorkspaces].sort((a, b) => {
    const timeA = a.last_entry_at ? new Date(a.last_entry_at).getTime() : (entryTimestamps[a.id] || 0);
    const timeB = b.last_entry_at ? new Date(b.last_entry_at).getTime() : (entryTimestamps[b.id] || 0);
    return timeB - timeA;
  });

  // RESTORING AUTOMATIC COUNTDOWN HUD OVERLAY (Highly polished square terminals/Toast styling)
  if (restoringSession && lastBranchId) {
    return (
      <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-8 select-none">
          <div className="relative w-28 h-28 mx-auto flex items-center justify-center">
            {/* Pulsing ring */}
            <div className="absolute inset-0 rounded-full border-4 border-zinc-800 animate-pulse"></div>
            {/* Spinning glowing sector */}
            <div className="absolute inset-0 rounded-full border-4 border-t-orange-500 border-r-orange-500/30 border-b-transparent border-l-transparent animate-spin duration-1000"></div>
            
            <span className="text-2xl font-black text-white font-mono">{countdown}s</span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 text-orange-500">
              <Sparkles size={16} className="animate-bounce" />
              <span className="text-[10px] font-black uppercase tracking-widest">Post-Login Resolution Engine</span>
            </div>
            <h2 className="text-2xl font-black text-zinc-100 tracking-tight">Restoring Last Active Context</h2>
            <p className="text-zinc-400 text-sm max-w-xs mx-auto font-semibold">
              Reconnecting to <span className="text-zinc-200 font-extrabold">{lastBranchName}</span>...
            </p>
          </div>

          <div className="pt-6 flex flex-col gap-2.5 max-w-xs mx-auto">
            <button
              onClick={() => setRestoringSession(false)}
              className="w-full py-3.5 bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-800 rounded-2xl text-xs font-black uppercase tracking-wider transition-all active:scale-95"
            >
              Change Workspace
            </button>
            <button
              onClick={handleLogout}
              className="w-full py-3 text-zinc-600 hover:text-zinc-400 text-[11px] font-extrabold transition-all"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center py-12 px-4 sm:px-6">
      <div className="max-w-3xl w-full">
        
        {/* Header toolbar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-5 px-3">
          
          {currentOrg ? (
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-orange-500/10 text-orange-500 rounded-[1.25rem] border border-orange-500/20 flex items-center justify-center shrink-0">
                <Building2 size={26} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-black text-zinc-100 tracking-tight leading-none">{currentOrg.name}</h1>
                  <button
                    onClick={handleOpenEditModal}
                    className="p-1.5 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-orange-500 border border-zinc-800 hover:border-orange-500/20 shadow-sm transition-all flex items-center gap-1 text-[10px] font-black uppercase tracking-wider active:scale-95 duration-150"
                  >
                    {t('workspace.manageCorporate')}
                  </button>
                </div>
                {currentOrg.company_register_number ? (
                  <p className="text-xs text-zinc-500 font-bold mt-1.5 tracking-wider uppercase">{t('workspace.ssmNo', { number: currentOrg.company_register_number })}</p>
                ) : (
                  <p className="text-xs text-zinc-600 font-medium mt-1.5 italic">{t('workspace.provideSSM')}</p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-3xl font-black text-zinc-100 tracking-tight">{t('workspace.title')}</h1>
              <p className="text-zinc-400 font-semibold text-sm">{t('workspace.subtitle')}</p>
            </div>
          )}

          {/* Language Switch Row */}
          <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-2xl border border-zinc-800 self-end sm:self-auto shrink-0 select-none">
            <button
              onClick={() => setLanguage('en')}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-155 active:scale-95 ${
                language === 'en'
                  ? 'bg-orange-600 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setLanguage('zh')}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-155 active:scale-95 ${
                language === 'zh'
                  ? 'bg-orange-600 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              中文
            </button>
            <button
              onClick={() => setLanguage('ms')}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-155 active:scale-95 ${
                language === 'ms'
                  ? 'bg-orange-600 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Melayu
            </button>
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="mb-6 bg-red-950/40 border border-red-900/50 text-red-400 p-4 rounded-3xl flex items-center gap-3 font-semibold text-sm">
            <ShieldAlert className="shrink-0 text-red-500" />
            <span>{error}</span>
          </div>
        )}

        {/* Core content block */}
        {loading ? (
          <div className="bg-zinc-900 px-20 py-24 rounded-[3rem] border border-zinc-800 flex flex-col items-center justify-center">
            <Loader2 className="animate-spin text-orange-500 mb-4" size={36} />
            <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px]">{t('workspace.resolvingIdentity')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            
            {/* Case A: NO ORGANIZATIONS AVAILABLE */}
            {hasZeroOrgs && (
              <div className="bg-zinc-900 p-10 rounded-[3rem] border border-zinc-800 shadow-sm space-y-6">
                <div className="w-16 h-16 bg-orange-500/10 text-orange-500 rounded-2xl flex items-center justify-center border border-orange-500/20">
                  <Building2 size={30} />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-zinc-100 tracking-tight">{t('workspace.createBrandOutlet')}</h2>
                  <p className="text-sm text-zinc-400 font-semibold mt-1">
                    {t('workspace.createBrandOutletSubtitle')}
                  </p>
                </div>
 
                <form onSubmit={handleCreateWorkspace} className="space-y-4 pt-2">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5 ml-1">{t('workspace.brandOrgName')}</label>
                    <input
                      required
                      type="text"
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      placeholder="e.g. McDonald's Malaysia"
                      className="w-full px-5 py-3.5 rounded-2xl bg-zinc-950 border-2 border-zinc-800 text-zinc-100 focus:border-orange-500 outline-none transition-all font-semibold text-sm"
                    />
                  </div>
 
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5 ml-1">{t('workspace.firstOutletName')}</label>
                    <input
                      required
                      type="text"
                      value={newWorkspaceName}
                      onChange={(e) => setNewWorkspaceName(e.target.value)}
                      placeholder="e.g. KLCC Branch"
                      className="w-full px-5 py-3.5 rounded-2xl bg-zinc-950 border-2 border-zinc-800 text-zinc-100 focus:border-orange-500 outline-none transition-all font-semibold text-sm"
                    />
                  </div>
 
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-black text-sm tracking-wide transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 pr-4"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={16} /> : t('workspace.createAndLaunch')}
                  </button>
                </form>
              </div>
            )}

            {/* Case C: ACTIVE CHOSEN ORGANIZATIONS */}
            {selectedOrgId && currentOrg && (
              <div className="space-y-6 animate-in fade-in duration-300">
                             {/* Brand Selection Tabs */}
                {organizations.length > 1 && (
                  <div className="bg-zinc-900 p-6 rounded-[2rem] border border-zinc-800/80 space-y-3">
                    <div className="flex items-center gap-2">
                      <Building2 size={16} className="text-orange-500" />
                      <h2 className="text-xs font-black uppercase tracking-widest text-zinc-500">
                        {t('workspace.selectCorporateTab')}
                      </h2>
                    </div>
                    <div className="flex flex-wrap gap-2.5">
                      {organizations.map((org) => {
                        const isSelected = org.id === selectedOrgId;
                        return (
                          <button
                            key={org.id}
                            onClick={() => {
                              setSelectedOrgId(org.id);
                              const url = new URL(window.location.href);
                              url.searchParams.set('orgId', org.id);
                              window.history.pushState({}, '', url.toString());
                            }}
                            className={`px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all border duration-150 active:scale-95 flex items-center gap-2 ${
                              isSelected
                                ? 'bg-orange-600 border-orange-600 text-white shadow-md shadow-orange-500/10'
                                : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-orange-500 hover:border-orange-500/25'
                            }`}
                          >
                            <Building2 size={13} />
                            {org.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                
                {/* Branches List Container */}
                <div className="bg-zinc-900 rounded-[3rem] border border-zinc-800 p-8 sm:p-10 space-y-6">
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-widest text-zinc-500 ml-1">
                      {t('workspace.branchOutlets')}
                    </h2>
                    <p className="text-zinc-500 text-xs mt-0.5 font-semibold">{t('workspace.selectBranchBelow')}</p>
                  </div>
 
                  {filteredOutlets.length === 0 ? (
                    <div className="p-10 bg-zinc-950 rounded-[2.25rem] border border-dashed border-zinc-800 text-center space-y-4">
                      <div className="w-12 h-12 bg-zinc-900 rounded-xl flex items-center justify-center mx-auto text-zinc-600 shadow-sm border border-zinc-800">
                        <Store size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-zinc-300 text-sm">{t('workspace.noBranchesFound')}</h4>
                        <p className="text-xs text-zinc-500 font-semibold max-w-sm mx-auto mt-1">{t('workspace.noBranchesFoundDesc', { name: currentOrg.name })}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      
                      {/* 1. Connected Active Branch Highlight */}
                      {activeWorkspace && (
                        <div className="space-y-2.5">
                          <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-orange-500 ml-1">
                            <Check size={11} className="stroke-[3]" />
                            <span>{t('workspace.connectedActiveBranch')}</span>
                          </div>
                          
                          {(() => {
                            const isSuspended = activeWorkspace.status === 'suspended';
                            const activeLastEntry = entryTimestamps[activeWorkspace.id];
                            const formattedTime = formatLastEntryTime(activeWorkspace.last_entry_at, activeLastEntry);
                            return (
                              <div
                                onClick={() => !isSuspended && !submitting && handleSelectWorkspace(activeWorkspace.id, activeWorkspace.role)}
                                className={`group p-6 rounded-[1.75rem] border transition-all duration-200 cursor-pointer flex items-center justify-between ${
                                  isSuspended 
                                    ? 'opacity-60 cursor-not-allowed border-red-950 bg-red-950/10' 
                                    : 'bg-orange-500/5 border-orange-500/30 hover:border-orange-500 shadow-sm hover:shadow-orange-500/5'
                                }`}
                              >
                                <div className="flex items-center gap-4">
                                  <div className="w-12 h-12 bg-orange-600/10 text-orange-500 border border-orange-500/25 rounded-xl flex items-center justify-center transition-colors shrink-0">
                                    <Store size={20} />
                                  </div>
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h3 className="font-extrabold text-zinc-200 group-hover:text-orange-500 transition-colors text-sm sm:text-base">{activeWorkspace.name}</h3>
                                      <span className="bg-orange-500/10 text-orange-400 text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full border border-orange-500/10">
                                        {t('common.active')}
                                      </span>
                                      {isSuspended && (
                                        <span className="bg-red-950/60 text-red-400 text-[8px] font-black uppercase px-2 py-0.5 rounded-full border border-red-900/40">
                                          {t('workspace.suspended')}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-zinc-500 font-semibold mt-1">{t('workspace.currentlyAssigned')}</p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-4">
                                  <div className="text-right hidden sm:block">
                                    <span className="inline-block bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[9px] font-black uppercase px-3 py-1 rounded-lg">
                                      {activeWorkspace.role?.toUpperCase()}
                                    </span>
                                  </div>
                                  <ArrowRight size={16} className="text-orange-400 group-hover:translate-x-1 duration-200" />
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* 2. Sorted Other Branches list */}
                      {sortedOtherWorkspaces.length > 0 && (
                        <div className="space-y-3 pt-2">
                          <div className="flex items-center gap-2.5">
                            <span className="h-px bg-zinc-800 flex-1"></span>
                            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-600 flex items-center gap-1 shrink-0">
                              <Building2 size={11} />
                              {t('workspace.availableBranches', { count: sortedOtherWorkspaces.length })}
                            </span>
                            <span className="h-px bg-zinc-800 flex-1"></span>
                          </div>

                          <div className="space-y-3">
                            {sortedOtherWorkspaces.map((workspace) => {
                              const isSuspended = workspace.status === 'suspended';
                              const lastVisitedVal = entryTimestamps[workspace.id];
                              const formattedTime = formatLastEntryTime(workspace.last_entry_at, lastVisitedVal);
                              
                              return (
                                <div
                                  key={workspace.id}
                                  onClick={() => !isSuspended && !submitting && handleSelectWorkspace(workspace.id, workspace.role)}
                                  className={`group p-5 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center justify-between ${
                                    isSuspended 
                                      ? 'opacity-60 cursor-not-allowed border-zinc-900 bg-zinc-950' 
                                      : 'bg-zinc-950/70 border-zinc-850 hover:border-orange-500/30 hover:bg-zinc-900'
                                  }`}
                                >
                                  <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-zinc-900 text-zinc-500 group-hover:bg-orange-500/5 group-hover:text-orange-500 border border-zinc-800 rounded-xl flex items-center justify-center transition-colors shrink-0">
                                      <Store size={20} />
                                    </div>
                                    <div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="font-bold text-zinc-300 group-hover:text-orange-500 transition-colors text-sm sm:text-base">{workspace.name}</h3>
                                        {isSuspended && (
                                          <span className="bg-red-950/50 text-red-400 text-[8px] font-black uppercase px-2 py-0.5 rounded-full border border-red-900/30">
                                            {t('workspace.suspended')}
                                          </span>
                                        )}
                                        {formattedTime && (
                                          <span className="bg-zinc-900 text-zinc-400 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border border-zinc-800">
                                            <Clock size={9} /> {formattedTime}
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-zinc-500 font-semibold mt-1">{t('workspace.multiTenantScoped')}</p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-4">
                                    <div className="text-right hidden sm:block">
                                      <span className="inline-block bg-zinc-900 border border-zinc-800 text-zinc-400 text-[9px] font-black uppercase px-3 py-1 rounded-lg">
                                        {workspace.role?.toUpperCase()}
                                      </span>
                                    </div>
                                    <ArrowRight size={16} className="text-zinc-500 group-hover:text-orange-500 transition-colors group-hover:translate-x-1 duration-200" />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    </div>
                  )}

                  {/* Add branch form */}
                  {!isFromLogin && (
                    <div className="pt-6 border-t border-zinc-800">
                      <h3 className="font-bold text-zinc-300 text-sm mb-3 ml-1">{t('workspace.establishExpansion')}</h3>
                      <form onSubmit={handleCreateWorkspace} className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1">
                          <input
                            required
                            type="text"
                            value={newWorkspaceName}
                            onChange={(e) => setNewWorkspaceName(e.target.value)}
                            placeholder={t('workspace.uniqueBranchName')}
                            className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-2xl focus:outline-none focus:border-orange-500 text-zinc-100 placeholder-zinc-500 text-xs font-bold"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={submitting}
                          className="bg-zinc-100 hover:bg-white text-zinc-950 px-6 py-3 text-xs font-black uppercase tracking-wider rounded-2xl transition-all flex items-center justify-center gap-2 shrink-0 active:scale-95 disabled:opacity-50"
                        >
                          {submitting ? <Loader2 className="animate-spin" size={12} /> : <><Plus size={14} /> {t('workspace.addBranchOutlet')}</>}
                        </button>
                      </form>
                    </div>
                  )}

                </div>

              </div>
            )}

            {/* Standard Safety Policy note footer */}
            <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-[2rem] text-zinc-400 text-xs leading-relaxed space-y-2 select-none">
              <p className="font-black uppercase tracking-widest text-[9px] text-orange-500">{t('workspace.securityPolicy')}</p>
              <p className="font-semibold text-zinc-500">
                {t('workspace.securityPolicyDesc')}
              </p>
            </div>

            {/* Logout/Signout toolbar */}
            <div className="flex justify-between items-center px-4">
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 p-3 text-zinc-500 hover:text-red-400 transition-all text-xs font-black uppercase tracking-wider"
              >
                <LogOut size={16} />
                {t('workspace.signOutDisconnect')}
              </button>
            </div>

          </div>
        )}

      </div>

      {/* EDIT ORGANIZATION MODAL */}
      {isEditModalOpen && currentOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsEditModalOpen(false)} />
          <div className="relative bg-zinc-900 w-full max-w-md rounded-[2.5rem] border border-zinc-800 p-8 z-10 text-zinc-100">
            
            <button 
              onClick={() => setIsEditModalOpen(false)}
              className="absolute top-6 right-6 p-2 rounded-full bg-zinc-950 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-all"
            >
              <X size={16} />
            </button>

            <div className="mb-6">
              <div className="w-12 h-12 bg-orange-500/10 text-orange-500 rounded-2xl flex items-center justify-center mb-3 border border-orange-500/15">
                <Building2 size={24} />
              </div>
              <h3 className="text-xl font-black text-zinc-100 tracking-tight text-left">{t('workspace.orgProfile')}</h3>
              <p className="text-xs text-zinc-500 font-semibold mt-0.5 text-left">{t('workspace.manageGroupDetails')}</p>
            </div>

            {orgError && (
              <div className="mb-4 bg-red-950/40 border border-red-900/50 text-red-400 p-3.5 rounded-2xl text-xs font-bold text-left">
                {orgError}
              </div>
            )}

            <form onSubmit={handleUpdateOrganization} className="space-y-4">
              <div className="text-left">
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5 ml-1">{t('workspace.brandOrgName')}</label>
                <input
                  required
                  type="text"
                  value={editOrgName}
                  onChange={(e) => setEditOrgName(e.target.value)}
                  placeholder="e.g. McDonald's Malaysia"
                  className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl focus:border-orange-500 text-zinc-100 text-xs font-semibold focus:outline-none"
                />
              </div>

              <div className="text-left">
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5 ml-1">{t('workspace.companyRegisterNumber')}</label>
                <input
                  type="text"
                  value={editCompanyRegisterNumber}
                  onChange={(e) => setEditCompanyRegisterNumber(e.target.value)}
                  placeholder="e.g. 199901004321 (483214-A)"
                  className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl focus:border-orange-500 text-zinc-100 text-xs font-semibold focus:outline-none"
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="w-1/2 py-3 bg-zinc-950 hover:bg-zinc-800 text-zinc-400 border border-zinc-850 font-black text-xs uppercase tracking-wider rounded-xl transition-all"
                >
                  {t('common.cancel')}
                </button>
                
                <button
                  type="submit"
                  disabled={updatingOrg}
                  className="w-1/2 py-3 bg-orange-600 hover:bg-orange-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5"
                >
                  {updatingOrg ? <Loader2 className="animate-spin" size={14} /> : t('workspace.saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
