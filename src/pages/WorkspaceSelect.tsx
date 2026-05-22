import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { getApiUrl } from '../lib/api';
import { 
  Building2, 
  Store, 
  ArrowRight, 
  Plus, 
  Loader2, 
  LogOut, 
  AlertTriangle,
  ShieldAlert,
  ArrowLeft,
  X,
  User,
  ChevronDown,
  Edit3,
  Check,
  Clock
} from 'lucide-react';

const getEntryTimestamps = (userId: string): Record<string, number> => {
  try {
    const data = localStorage.getItem(`workspace_entry_timestamps_${userId}`);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    return {};
  }
};

const recordEntry = (userId: string, workspaceId: string) => {
  try {
    const data = getEntryTimestamps(userId);
    data[workspaceId] = Date.now();
    localStorage.setItem(`workspace_entry_timestamps_${userId}`, JSON.stringify(data));
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

  if (diffMs < 0) return 'Just now'; // handle slight clock skew
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d  ago`;

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
  
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newOrgName, setNewOrgName] = useState('');

  // Dropdown & Modal UI States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Edit Organization States
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

      // Save or update active selectedOrgId
      const params = new URLSearchParams(window.location.search);
      const queryOrgId = params.get('orgId');
      
      if (orgs.length > 0) {
        setSelectedOrgId(prev => {
          if (queryOrgId && orgs.some((o: any) => o.id === queryOrgId)) {
            return queryOrgId;
          }
          if (prev && orgs.some((o: any) => o.id === prev)) {
            return prev;
          }
          return orgs[0].id; // Fallback to first
        });
      } else {
        setSelectedOrgId(null);
      }

      if (autoRedirectEnabled) {
        // Evaluate landing auto-redirect if exactly 1 organization and 1 branch
        if (orgs.length === 1) {
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
    const fromLogin = params.get('fromLogin') === 'true';
    const queryOrgId = params.get('orgId');
    if (queryOrgId) {
      setSelectedOrgId(queryOrgId);
    }
    fetchWorkspaces(fromLogin);
  }, [token, window.location.search]);

  useEffect(() => {
    const activeId = profile?.restaurantId;
    if (user?.id && activeId) {
      recordEntry(user.id, activeId);
    }
  }, [user?.id, profile?.restaurantId]);

  const handleSelectWorkspace = async (workspaceId: string, role: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await switchWorkspace(workspaceId);
      if (user?.id) {
        recordEntry(user.id, workspaceId);
      }
      
      // Dynamic routing based on RBAC role
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
      
      // Refresh list
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
      
      // Update local state
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

  // Process visual bounds
  const hasZeroOrgs = organizations.length === 0;
  const currentOrg = selectedOrgId ? organizations.find(o => o.id === selectedOrgId) : null;
  const filteredOutlets = selectedOrgId 
    ? workspaces.filter(w => !w.organization_id || w.organization_id === selectedOrgId)
    : workspaces;

  const activeWorkspaceId = profile?.restaurantId;

  // Find the currently active workspace if it exists in the filtered outlets
  const activeWorkspace = activeWorkspaceId 
    ? filteredOutlets.find(w => w.id === activeWorkspaceId) 
    : null;

  // Filter other workspaces
  const otherWorkspaces = activeWorkspaceId 
    ? filteredOutlets.filter(w => w.id !== activeWorkspaceId) 
    : filteredOutlets;

  // Retrieve user timestamps and sort the other workspaces with fallback to client-side
  const entryTimestamps = user?.id ? getEntryTimestamps(user.id) : {};
  const sortedOtherWorkspaces = [...otherWorkspaces].sort((a, b) => {
    const timeA = a.last_entry_at ? new Date(a.last_entry_at).getTime() : (entryTimestamps[a.id] || 0);
    const timeB = b.last_entry_at ? new Date(b.last_entry_at).getTime() : (entryTimestamps[b.id] || 0);
    return timeB - timeA; // most recent entry on top
  });

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6">
      <div className="max-w-3xl w-full">
        
        {/* Header toolbar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-10 gap-5 px-3">
          
          {/* Organization Title View + Edit button */}
          {currentOrg ? (
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-orange-500/10 text-orange-600 rounded-[1.25rem] border border-orange-500/10 flex items-center justify-center shadow-sm shrink-0">
                <Building2 size={26} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-3xl font-black text-gray-900 tracking-tight leading-none">{currentOrg.name}</h1>
                  <button
                    onClick={handleOpenEditModal}
                    className="p-1.5 px-3 rounded-xl bg-white hover:bg-orange-50 text-gray-500 hover:text-orange-600 border border-gray-100 hover:border-orange-500/20 shadow-sm transition-all flex items-center gap-1 text-[10px] font-black uppercase tracking-wider active:scale-95 duration-150"
                  >
                    <Edit3 size={11} />
                    Edit Name / SSC
                  </button>
                </div>
                {currentOrg.company_register_number ? (
                  <p className="text-xs text-gray-400 font-bold mt-1.5 tracking-wider uppercase">SSM No: {currentOrg.company_register_number}</p>
                ) : (
                  <p className="text-xs text-gray-400 font-medium mt-1.5 italic">Provide registration number via Edit</p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-4xl font-black text-gray-900 tracking-tight">{t('workspace.title')}</h1>
              <p className="text-gray-500 font-semibold text-sm">{t('workspace.subtitle')}</p>
            </div>
          )}

          {/* Language Switch Row */}
          <div className="flex items-center gap-1 bg-white p-1 rounded-2xl border border-gray-100 shadow-sm self-end sm:self-auto shrink-0 select-none">
            <button
              onClick={() => setLanguage('en')}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-155 active:scale-95 ${
                language === 'en'
                  ? 'bg-orange-600 text-white shadow-md shadow-orange-100'
                  : 'text-gray-450 hover:text-gray-600 hover:bg-gray-50'
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setLanguage('zh')}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-155 active:scale-95 ${
                language === 'zh'
                  ? 'bg-orange-600 text-white shadow-md shadow-orange-100'
                  : 'text-gray-450 hover:text-gray-600 hover:bg-gray-50'
              }`}
            >
              中文
            </button>
            <button
              onClick={() => setLanguage('ms')}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-155 active:scale-95 ${
                language === 'ms'
                  ? 'bg-orange-600 text-white shadow-md shadow-orange-100'
                  : 'text-gray-450 hover:text-gray-600 hover:bg-gray-50'
              }`}
            >
              Melayu
            </button>
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-100 text-red-600 p-4 rounded-3xl flex items-center gap-3 font-semibold text-sm">
            <ShieldAlert className="shrink-0 text-red-500" />
            <span>{error}</span>
          </div>
        )}

        {/* Core content block */}
        {loading ? (
          <div className="bg-white px-20 py-24 rounded-[3rem] shadow-sm border border-gray-100 flex flex-col items-center justify-center">
            <Loader2 className="animate-spin text-orange-500 mb-4" size={40} />
            <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Syncing active tenant structure...</p>
          </div>
        ) : (
          <div className="space-y-6">
            
            {/* STATE 1: NO ORGANIZATIONS AVAILABLE */}
            {hasZeroOrgs && (
              <div className="bg-white p-10 rounded-[3rem] border border-gray-100 shadow-sm space-y-6">
                <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center">
                  <Building2 className="text-orange-600" size={30} />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-gray-900 tracking-tight">Create your Brand & Outlet</h2>
                  <p className="text-sm text-gray-500 font-medium mt-1">
                    You are not linked to any brand organizations yet. Let's create your first corporate retail organization and initial branch outlet.
                  </p>
                </div>

                <form onSubmit={handleCreateWorkspace} className="space-y-4 pt-2">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Brand / Organization Name</label>
                    <input
                      required
                      type="text"
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      placeholder="e.g. McDonald's Malaysia"
                      className="w-full px-5 py-3.5 rounded-2xl bg-gray-50 border-2 border-transparent focus:bg-white focus:border-orange-500 outline-none transition-all font-semibold text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">First Outlet / Branch Name</label>
                    <input
                      required
                      type="text"
                      value={newWorkspaceName}
                      onChange={(e) => setNewWorkspaceName(e.target.value)}
                      placeholder="e.g. KLCC Branch"
                      className="w-full px-5 py-3.5 rounded-2xl bg-gray-50 border-2 border-transparent focus:bg-white focus:border-orange-500 outline-none transition-all font-semibold text-sm"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-black text-sm tracking-wide transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-100 disabled:opacity-50"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={16} /> : 'Create and Launch Workspace'}
                  </button>
                </form>
              </div>
            )}

            {/* STATE 2: ACTIVE ORGANIZATION (List all related outlets under it) */}
            {selectedOrgId && currentOrg && (
              <div className="space-y-6">
                
                {/* Brand Selector Tabs */}
                {organizations.length > 1 && (
                  <div className="bg-white p-6 rounded-[2rem] border border-gray-100/80 shadow-sm space-y-3">
                    <div className="flex items-center gap-2">
                      <Building2 size={16} className="text-orange-500" />
                      <h2 className="text-xs font-black uppercase tracking-widest text-gray-400">
                        Select Corporate Brand / Organization
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
                                ? 'bg-orange-600 border-orange-600 text-white shadow-md shadow-orange-100'
                                : 'bg-gray-50 border-gray-100 text-gray-600 hover:text-orange-600 hover:border-orange-200'
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
                
                {/* Branches Container */}
                <div className="bg-white rounded-[3rem] border border-gray-100/80 shadow-sm p-8 sm:p-10 space-y-6">
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 ml-1">
                      Registered Branches
                    </h2>
                    <p className="text-gray-500 text-xs mt-0.5 font-medium">Select a branch workspace below to enter operational views.</p>
                  </div>

                  {filteredOutlets.length === 0 ? (
                    <div className="p-10 bg-gray-50 rounded-[2.25rem] border border-dashed border-gray-200 text-center space-y-4">
                      <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center mx-auto text-gray-400 shadow-sm">
                        <Store size={20} />
                      </div>
                      <div>
                        <h4 className="font-bold text-gray-800 text-sm">No Branches Found</h4>
                        <p className="text-xs text-gray-400 font-medium max-w-sm mx-auto mt-1">There are no registered branches under "{currentOrg.name}". Use the tool below to generate your first branch.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      
                       {/* 1. Current Active Workspace Outlet */}
                      {activeWorkspace && (
                        <div className="space-y-2.5">
                          <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-orange-600 ml-1">
                            <Check size={11} className="stroke-[3]" />
                            <span>{t('workspace.connected')}</span>
                          </div>
                          
                          {(() => {
                            const isSuspended = activeWorkspace.status === 'suspended';
                            const activeLastEntry = entryTimestamps[activeWorkspace.id];
                            const formattedTime = formatLastEntryTime(activeWorkspace.last_entry_at, activeLastEntry);
                            return (
                              <div
                                onClick={() => !isSuspended && !submitting && handleSelectWorkspace(activeWorkspace.id, activeWorkspace.role)}
                                className={`group p-6 rounded-[1.75rem] border-2 transition-all duration-200 cursor-pointer flex items-center justify-between ${
                                  isSuspended 
                                    ? 'opacity-60 cursor-not-allowed border-red-100 bg-red-50/20' 
                                    : 'bg-orange-50/20 border-orange-500/40 hover:border-orange-500 shadow-sm shadow-orange-100/50 hover:shadow-md'
                                }`}
                              >
                                <div className="flex items-center gap-4">
                                  <div className="w-12 h-12 bg-orange-500 text-white border border-orange-500/10 rounded-xl flex items-center justify-center transition-colors shadow-[0_2px_8px_rgba(249,115,22,0.15)] shrink-0">
                                    <Store size={20} />
                                  </div>
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h3 className="font-extrabold text-gray-900 group-hover:text-orange-600 transition-colors text-sm sm:text-base">{activeWorkspace.name}</h3>
                                      <span className="bg-orange-100 text-orange-700 text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full flex items-center gap-1 border border-orange-200/50">
                                        Active
                                      </span>
                                      {isSuspended && (
                                        <span className="bg-red-50 text-red-600 text-[8px] font-black uppercase px-2 py-0.5 rounded-full flex items-center gap-1 font-extrabold">
                                          <AlertTriangle size={8} /> {t('workspace.suspended')}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-gray-400 font-semibold mt-1">{t('workspace.connected')}</p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-4">
                                  <div className="text-right hidden sm:block">
                                    <span className="inline-block bg-orange-600/10 border border-orange-500/20 text-orange-700 text-[9px] font-black uppercase px-3 py-1 rounded-lg">
                                      {activeWorkspace.role?.toUpperCase()}
                                    </span>
                                  </div>
                                  <ArrowRight size={16} className="text-orange-500 group-hover:text-orange-600 transition-colors group-hover:translate-x-1 duration-200" />
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* Divider / Header for other workspaces if any exist */}
                      {sortedOtherWorkspaces.length > 0 && (
                        <div className="space-y-3 pt-2">
                          <div className="flex items-center gap-2.5">
                            <span className="h-px bg-gray-100 flex-1"></span>
                            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 flex items-center gap-1 shrink-0">
                              <Building2 size={11} />
                              {t('workspace.title')} ({sortedOtherWorkspaces.length})
                            </span>
                            <span className="h-px bg-gray-100 flex-1"></span>
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
                                      ? 'opacity-60 cursor-not-allowed border-gray-100 bg-gray-50' 
                                      : 'bg-white border-gray-100 hover:border-orange-200 hover:shadow-md hover:bg-orange-50/[0.1]'
                                  }`}
                                >
                                  <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-gray-50 text-gray-400 group-hover:bg-orange-50 group-hover:text-orange-600 border border-gray-100/50 rounded-xl flex items-center justify-center transition-colors shadow-inner shrink-0">
                                      <Store size={20} />
                                    </div>
                                    <div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="font-bold text-gray-800 group-hover:text-orange-600 transition-colors text-sm sm:text-base">{workspace.name}</h3>
                                        {isSuspended && (
                                          <span className="bg-red-50 text-red-600 text-[8px] font-black uppercase px-2 py-0.5 rounded-full flex items-center gap-1">
                                            <AlertTriangle size={8} /> Suspended
                                          </span>
                                        )}
                                        {formattedTime && (
                                          <span className="bg-orange-50 text-orange-600 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border border-orange-100/35">
                                            <Clock size={9} /> {formattedTime}
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-gray-400 font-semibold mt-1">Full isolation workspace secure token</p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-4">
                                    <div className="text-right hidden sm:block">
                                      <span className="inline-block bg-gray-100/80 border text-gray-600 text-[9px] font-black uppercase px-3 py-1 rounded-lg">
                                        {workspace.role?.toUpperCase()}
                                      </span>
                                    </div>
                                    <ArrowRight size={16} className="text-gray-300 group-hover:text-orange-600 transition-colors group-hover:translate-x-1 duration-200" />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    </div>
                  )}

                  {/* Built-in Expandable Form to Add Branch Outlet under this Org */}
                  <div className="pt-6 border-t border-gray-100">
                    <h3 className="font-bold text-gray-900 text-sm mb-3 ml-1">Establish Brand Expansion (Add Outlet)</h3>
                    <form onSubmit={handleCreateWorkspace} className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-1">
                        <input
                          required
                          type="text"
                          value={newWorkspaceName}
                          onChange={(e) => setNewWorkspaceName(e.target.value)}
                          placeholder="Unique Branch Name (e.g. Mid Valley Branch)"
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl focus:bg-white focus:outline-none focus:border-orange-500 transition-all text-xs font-bold text-gray-800 placeholder-gray-400"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={submitting}
                        className="bg-gray-900 hover:bg-black text-white px-6 py-3 text-xs font-black uppercase tracking-wider rounded-2xl transition-all flex items-center justify-center gap-2 shadow-sm shrink-0 active:scale-95 disabled:opacity-50"
                      >
                        {submitting ? <Loader2 className="animate-spin" size={12} /> : <><Plus size={14} /> Add Branch Outlet</>}
                      </button>
                    </form>
                  </div>

                </div>

              </div>
            )}

            {/* Information Standard Policy Note Footer */}
            <div className="bg-blue-50/50 border border-blue-50/80 p-5 rounded-[2rem] text-blue-800/85 text-xs leading-relaxed space-y-2">
              <p className="font-black uppercase tracking-widest text-[9px] text-blue-500">Security Architecture Standard</p>
              <p className="font-semibold text-blue-900/70">
                Outlets represent complete database schemas partitioned safely behind multi-tenant JSON Web Tokens. Entering an outlet workspace automatically requests a dynamic, secure session token scoped ONLY to that branch.
              </p>
            </div>

          </div>
        )}

      </div>

      {/* EDIT ORGANIZATION MODAL */}
      {isEditModalOpen && currentOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setIsEditModalOpen(false)} />
          <div className="relative bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl border border-gray-100 p-8 z-10 animate-in zoom-in-95 duration-200">
            
            <button 
              onClick={() => setIsEditModalOpen(false)}
              className="absolute top-6 right-6 p-2 rounded-full bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-all"
            >
              <X size={16} />
            </button>

            <div className="mb-6">
              <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center mb-3">
                <Building2 size={24} />
              </div>
              <h3 className="text-xl font-black text-gray-900 tracking-tight">Organization Profile</h3>
              <p className="text-xs text-gray-400 font-semibold mt-0.5">Manage group details and identifiers</p>
            </div>

            {orgError && (
              <div className="mb-4 bg-red-50 border border-red-100 text-red-600 p-3.5 rounded-2xl text-xs font-bold">
                {orgError}
              </div>
            )}

            <form onSubmit={handleUpdateOrganization} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Brand / Organization Name</label>
                <input
                  required
                  type="text"
                  value={editOrgName}
                  onChange={(e) => setEditOrgName(e.target.value)}
                  placeholder="e.g. McDonald's Malaysia"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200/60 rounded-xl focus:bg-white focus:outline-none focus:border-orange-500 transition-all text-xs font-bold text-gray-800"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Company Register Number (SSM)</label>
                <input
                  type="text"
                  value={editCompanyRegisterNumber}
                  onChange={(e) => setEditCompanyRegisterNumber(e.target.value)}
                  placeholder="e.g. 199901004321 (483214-A)"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200/60 rounded-xl focus:bg-white focus:outline-none focus:border-orange-500 transition-all text-xs font-bold text-gray-800"
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="w-1/2 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-black text-xs uppercase tracking-wider rounded-xl transition-all"
                >
                  Cancel
                </button>
                
                <button
                  type="submit"
                  disabled={updatingOrg}
                  className="w-1/2 py-3 bg-orange-600 hover:bg-orange-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-orange-100"
                >
                  {updatingOrg ? <Loader2 className="animate-spin" size={14} /> : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
