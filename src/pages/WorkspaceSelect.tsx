import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { getApiUrl } from '../lib/api';
import { 
  Building2, 
  Store, 
  ArrowRight, 
  Plus, 
  Loader2, 
  LogOut, 
  CheckCircle,
  AlertTriangle,
  User,
  ShieldAlert
} from 'lucide-react';

interface Organization {
  id: string;
  name: string;
  slug?: string;
  created_at: string;
}

interface Workspace {
  id: string;
  name: string;
  organization_id?: string;
  role: string;
  status: string;
  permissions: Record<string, boolean>;
}

export function WorkspaceSelect() {
  const navigate = useNavigate();
  const { user, profile, token, signOut, switchWorkspace } = useAuthStore();
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  
  // Create state
  const [showCreate, setShowCreate] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  
  const fetchWorkspaces = async () => {
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
      setOrganizations(data.organizations || []);
      setWorkspaces(data.restaurants || []);
      
      // Auto-select if there is only 1 workspace and no active selection already
      if (data.restaurants && data.restaurants.length === 1 && !profile?.restaurantId) {
        handleSelectWorkspace(data.restaurants[0].id, data.restaurants[0].role);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred while loading workspaces.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkspaces();
  }, [token]);

  const handleSelectWorkspace = async (workspaceId: string, role: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await switchWorkspace(workspaceId);
      
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
    if (!newWorkspaceName.trim()) return;

    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(getApiUrl('/api/onboarding/create-org-workspace'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          orgName: newOrgName.trim() || undefined,
          workspaceName: newWorkspaceName.trim()
        })
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to create workspace.');
      }

      const outcome = await res.json();
      // Reload on success or auto select
      await fetchWorkspaces();
      setShowCreate(false);
      setNewOrgName('');
      setNewWorkspaceName('');
      
      if (outcome.user?.restaurantId) {
        handleSelectWorkspace(outcome.user.restaurantId, outcome.user.role);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create brand workspace.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-10 px-4">
      <div className="max-w-4xl w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 px-2">
          <div>
            <h1 className="text-4xl font-black text-gray-900 tracking-tight">Select Workspace</h1>
            <p className="text-gray-500 font-medium">Choose a workspace restaurant or start a new brand</p>
          </div>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm font-bold text-gray-400 hover:text-gray-900 bg-white hover:bg-gray-100 py-3 px-5 rounded-2xl border border-gray-100 transition-all shadow-sm"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-100 text-red-600 p-4 rounded-3xl flex items-center gap-3 font-bold text-sm">
            <ShieldAlert className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="bg-white p-20 rounded-[3.5rem] shadow-xl border border-gray-100 flex flex-col items-center justify-center">
            <Loader2 className="animate-spin text-orange-600 mb-4" size={40} />
            <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">Fetching active workspaces...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Workspaces List Grid */}
            <div className="md:col-span-2 space-y-6">
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 ml-1">Your Restaurants ({workspaces.length})</h2>
              
              {workspaces.length === 0 ? (
                <div className="bg-white p-12 rounded-[2.5rem] border border-gray-100 text-center flex flex-col items-center">
                  <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center mb-4">
                    <Store className="text-orange-600" size={28} />
                  </div>
                  <h3 className="text-lg font-black text-gray-900 mb-1">No Workspaces Found</h3>
                  <p className="text-gray-500 font-medium text-sm mb-6">You aren't associated with any brand workspaces yet.</p>
                  <button
                    onClick={() => setShowCreate(true)}
                    className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-6 rounded-2xl shadow-md transition-all flex items-center gap-2 text-sm"
                  >
                    <Plus size={16} /> Create Now
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {workspaces.map((workspace) => {
                    const org = organizations.find(o => o.id === workspace.organization_id);
                    const isCurrent = profile?.restaurantId === workspace.id;
                    const isSuspended = workspace.status === 'suspended';
                    
                    return (
                      <div 
                        key={workspace.id}
                        onClick={() => !isSuspended && !submitting && handleSelectWorkspace(workspace.id, workspace.role)}
                        className={`group bg-white p-6 rounded-3xl border transition-all cursor-pointer flex items-center justify-between ${
                          isSuspended 
                            ? 'opacity-60 cursor-not-allowed border-gray-100 bg-gray-50' 
                            : isCurrent
                              ? 'border-orange-500 ring-2 ring-orange-100'
                              : 'border-gray-100 hover:border-gray-300 hover:shadow-lg'
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                            isCurrent ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-500'
                          }`}>
                            <Store size={22} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-gray-900 group-hover:text-orange-600 transition-colors">{workspace.name}</h3>
                              {isCurrent && (
                                <span className="bg-orange-50 text-orange-600 text-[9px] font-black uppercase px-2 py-0.5 rounded-full">
                                  Active
                                </span>
                              )}
                              {isSuspended && (
                                <span className="bg-red-50 text-red-600 text-[9px] font-black uppercase px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <AlertTriangle size={8} /> Suspended
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 font-medium mt-0.5">
                              {org ? `Brand: ${org.name}` : 'Independent Workspace'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <span className="inline-block bg-gray-100 text-gray-700 text-[10px] font-black uppercase px-3 py-1 rounded-lg">
                              {workspace.role?.toUpperCase()}
                            </span>
                          </div>
                          <ArrowRight size={18} className="text-gray-300 group-hover:text-orange-600 transition-colors group-hover:translate-x-1 duration-200" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Organizations Directory & Context Helper Section */}
            <div className="space-y-6">
              <h2 className="text-xs font-black uppercase tracking-widest text-gray-400 ml-1">Workspace Directory</h2>
              
              <div className="bg-white p-6 rounded-[2rem] border border-gray-100 space-y-6">
                <div>
                  <h3 className="font-black text-gray-900 mb-1 flex items-center gap-2 text-sm uppercase tracking-wider text-gray-500">
                    <Building2 size={16} /> Brands ({organizations.length})
                  </h3>
                  <div className="mt-3 space-y-2">
                    {organizations.length === 0 ? (
                      <p className="text-xs text-gray-400 font-medium italic">No multi-tenant brand structures.</p>
                    ) : (
                      organizations.map(o => (
                        <div key={o.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-2xl border border-transparent">
                          <span className="font-bold text-gray-700 text-xs">{o.name}</span>
                          <span className="text-[9px] bg-white border text-gray-400 font-black px-2 py-0.5 rounded-md">ID WALLET</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <h4 className="font-bold text-gray-900 text-xs uppercase tracking-wider text-gray-500 mb-2">Workspace Controls</h4>
                  {!showCreate ? (
                    <button
                      onClick={() => setShowCreate(true)}
                      className="w-full py-3 bg-gray-900 hover:bg-black text-white rounded-2xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Plus size={14} /> Link Brand Workspace
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowCreate(false)}
                      className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl font-bold text-xs transition-all flex items-center justify-center gap-2"
                    >
                      View List
                    </button>
                  )}
                </div>
              </div>

              {/* Information Alert */}
              <div className="bg-blue-50 border border-blue-100 p-5 rounded-[2rem] text-blue-700 text-xs leading-relaxed space-y-2">
                <p className="font-black uppercase tracking-widest text-[9px] text-blue-500">Architect Guide</p>
                <p className="font-medium">
                  Workspace isolation restricts backend interactions. Entering a restaurant session swaps the active database tenant context automatically.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Create Brand Workspace Modal Display */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
            <div className="bg-white rounded-[3.5rem] p-8 max-w-md w-full shadow-2xl border border-gray-100">
              <div className="w-14 h-14 bg-orange-50 rounded-2xl flex items-center justify-center mb-6">
                <Building2 className="text-orange-600" size={26} />
              </div>
              <h2 className="text-2xl font-black text-gray-950 tracking-tight mb-1">Create Brand Workspace</h2>
              <p className="text-gray-400 font-medium text-sm mb-6">Add a brand organization layer and restaurant workspace.</p>

              <form onSubmit={handleCreateWorkspace} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Brand Name (Optional)</label>
                  <input
                    type="text"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    placeholder="e.g. McDonald's Malaysia"
                    className="w-full px-5 py-3.5 rounded-2xl bg-gray-50 border-2 border-transparent focus:bg-white focus:border-orange-500 outline-none transition-all font-semibold text-sm"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5 ml-1">Restaurant Branch (Required)</label>
                  <input
                    required
                    type="text"
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    placeholder="e.g. McDonald's KLCC"
                    className="w-full px-5 py-3.5 rounded-2xl bg-gray-50 border-2 border-transparent focus:bg-white focus:border-orange-500 outline-none transition-all font-semibold text-sm"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="flex-1 py-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-2xl text-sm transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 py-4 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-100"
                  >
                    {submitting ? <Loader2 className="animate-spin" size={16} /> : 'Create & Join'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
