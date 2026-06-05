import React from 'react';
import { RefreshCw, Users, Edit2, Trash2, Shield, X, Plus } from 'lucide-react';

export interface StaffMember {
  id: string;
  email: string;
  role: string;
  status: 'active' | 'suspended';
  permissions?: Record<string, boolean>;
  custom_permissions?: {
    can_refund?: boolean;
    can_edit_menu?: boolean;
    can_cancel_order?: boolean;
    can_manage_staff?: boolean;
    can_view_analytics?: boolean;
  };
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user_email: string;
  user_id: string;
  role: string;
  action: string;
}

interface StaffTabProps {
  staffList: StaffMember[];
  auditLogs: AuditLogEntry[];
  isStaffLoading: boolean;
  fetchStaffData: () => void;
  canManageStaff: boolean;
  editingStaff: StaffMember | null;
  setEditingStaff: (staff: StaffMember | null) => void;
  handleSaveStaffEdit: () => void;
  handleDeleteStaff: (id: string) => void;
  handleCreateStaff: (e: React.FormEvent) => void;
  newStaffEmail: string;
  setNewStaffEmail: (val: string) => void;
  newStaffPassword: string;
  setNewStaffPassword: (val: string) => void;
  newStaffRole: 'owner' | 'manager' | 'cashier' | 'kitchen' | 'waiter' | 'runner';
  handleRoleChangeForNewStaff: (role: 'owner' | 'manager' | 'cashier' | 'kitchen' | 'waiter' | 'runner') => void;
  newStaffPermissions: Record<string, boolean>;
  setNewStaffPermissions: (perms: Record<string, boolean>) => void;
  t: (key: string) => string;
}

export function StaffTab({
  staffList,
  auditLogs,
  isStaffLoading,
  fetchStaffData,
  canManageStaff,
  editingStaff,
  setEditingStaff,
  handleSaveStaffEdit,
  handleDeleteStaff,
  handleCreateStaff,
  newStaffEmail,
  setNewStaffEmail,
  newStaffPassword,
  setNewStaffPassword,
  newStaffRole,
  handleRoleChangeForNewStaff,
  newStaffPermissions,
  setNewStaffPermissions,
  t
}: StaffTabProps) {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left side: Staff List */}
        <div className="md:col-span-2 bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-base sm:text-lg font-black text-gray-900">{t('admin.staffDirectory')}</h2>
              <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">{t('admin.rbacProfiles')}</p>
            </div>
            <button
              onClick={fetchStaffData}
              className="p-2 bg-gray-55 text-gray-700 hover:bg-gray-100 rounded-lg transition"
              title="Refresh List"
            >
              <RefreshCw size={14} className={isStaffLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {isStaffLoading && staffList.length === 0 ? (
            <div className="flex h-36 items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
            </div>
          ) : staffList.length === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center border-2 border-dashed border-gray-100 rounded-xl p-4 text-center text-gray-400">
              <Users size={28} className="mb-1 text-gray-200" />
              <p className="font-bold text-sm text-gray-700">{t('admin.noStaffProfiles')}</p>
              <p className="text-[10px] mt-0.5">{t('admin.createUniqueLogins')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {staffList.map((st) => (
                <div 
                  key={st.id} 
                  className={`p-3.5 rounded-xl border transition-all ${
                    st.status === 'suspended' ? 'bg-red-50/40 border-red-100' : 'bg-gray-50/50 border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-xs text-gray-900">{st.email}</span>
                        <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider ${
                          st.status === 'suspended' ? 'bg-red-200 text-red-800' : 'bg-green-100 text-green-800'
                        }`}>
                          {st.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="bg-gray-900 text-white font-black px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider">
                          {st.role}
                        </span>
                        <span className="text-[9px] text-gray-400 font-medium font-mono">
                          ID: {st.id ? `${st.id.slice(0, 8)}...` : 'N/A'}
                        </span>
                      </div>
                    </div>

                    {canManageStaff && (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setEditingStaff(st)}
                          className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDeleteStaff(st.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Display active permissions chips */}
                  {st.permissions && (
                    <div className="mt-2.5 pt-2.5 border-t border-gray-200/50 flex flex-wrap gap-1">
                      {Object.entries(st.permissions).map(([perm, val]) => (
                        <span 
                          key={perm}
                          className={`text-[8px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider ${
                            val ? 'bg-orange-50 text-orange-700 border border-orange-100/50' : 'bg-gray-100/50 text-gray-400'
                          }`}
                        >
                          {perm.replace('can_', '')}: {val ? 'YES' : 'NO'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right side: Add/Edit Account view */}
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm space-y-4 self-start">
          {!canManageStaff ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-gray-400 w-full">
              <Shield size={40} className="mb-4 text-orange-600/30" />
              <p className="font-extrabold text-gray-800 text-sm">Access Restricted</p>
              <p className="text-xs mt-2 text-gray-400 leading-relaxed max-w-[200px] mx-auto">
                You do not have administrative permissions to register or modify staff accounts.
              </p>
            </div>
          ) : editingStaff ? (
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-black text-gray-900">{t('admin.editSettings')}</h3>
                  <button 
                    onClick={() => setEditingStaff(null)}
                    className="text-gray-400 hover:text-black"
                  >
                    <X size={15} />
                  </button>
                </div>
                <p className="text-[10px] text-brand-dark/60 font-medium font-mono truncate mt-0.5">{editingStaff.email}</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[9px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.staffRole')}</label>
                  <select
                    value={editingStaff.role}
                    onChange={e => {
                      const updatedRole = e.target.value;
                      const isO = updatedRole === 'owner';
                      const isM = updatedRole === 'manager';
                      const isC = updatedRole === 'cashier';
                      setEditingStaff({
                        ...editingStaff,
                        role: updatedRole,
                        permissions: {
                          can_refund: isO || isM,
                          can_edit_menu: isO || isM,
                          can_cancel_order: isO || isM || isC,
                          can_view_analytics: isO || isM,
                          can_manage_staff: isO
                        }
                      });
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-150 font-bold capitalize text-xs focus:bg-white focus:border-brand"
                  >
                    {['owner', 'manager', 'cashier', 'kitchen', 'waiter', 'runner'].map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-black uppercase text-gray-400 mb-1 ml-1 font-mono">{t('admin.accountStatus')}</label>
                  <select
                    value={editingStaff.status}
                    onChange={e => setEditingStaff({ ...editingStaff, status: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-150 font-bold capitalize text-xs focus:bg-white focus:border-brand"
                  >
                    <option value="active">Active (Access Allowed)</option>
                    <option value="suspended">Suspended (Access Revoked)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.customOverrules')}</label>
                  <div className="space-y-1.5 bg-gray-50 p-3 rounded-xl border border-gray-100">
                    {Object.entries(editingStaff.permissions || {}).map(([perm, val]) => (
                      <label key={perm} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!val}
                          onChange={e => {
                            setEditingStaff({
                              ...editingStaff,
                              permissions: {
                                ...(editingStaff.permissions || {}),
                                [perm]: e.target.checked
                              }
                            });
                          }}
                          className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 h-3.5 w-3.5"
                        />
                        <span className="text-xs font-bold text-gray-700 capitalize">{perm.replace(/_/g, ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="pt-1 flex gap-2">
                  <button
                    onClick={() => setEditingStaff(null)}
                    className="flex-1 px-3 py-2 bg-gray-100 text-gray-700 font-bold rounded-lg text-xs hover:bg-gray-200 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveStaffEdit}
                    className="flex-1 px-3 py-2 bg-gray-900 text-white font-bold rounded-lg text-xs hover:bg-black transition shadow-md"
                  >
                    {t('admin.saveSettings')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateStaff} className="space-y-3">
              <div>
                <h3 className="text-sm font-black text-gray-900">{t('admin.registerStaff')}</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">{t('admin.temporalPassword')}</p>
              </div>

              <div>
                <label className="block text-[9px] font-black uppercase text-gray-400 mb-1 ml-1 text-xs">{t('admin.emailAddress')}</label>
                <input
                  type="email"
                  required
                  placeholder="name@restaurant.com"
                  value={newStaffEmail}
                  onChange={e => setNewStaffEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-55 border border-gray-150 focus:bg-white focus:border-orange-500 font-bold text-xs"
                />
              </div>

              <div>
                <label className="block text-[9px] font-black uppercase text-gray-400 mb-1 ml-1 text-xs">{t('admin.temporalPassword')}</label>
                <input
                  type="password"
                  required
                  placeholder="Minimum 6 characters"
                  value={newStaffPassword}
                  onChange={e => setNewStaffPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-55 border border-gray-155 focus:bg-white focus:border-orange-500 font-bold text-xs"
                />
              </div>

              <div>
                <label className="block text-[9px] font-black uppercase text-gray-400 mb-1 ml-1 text-xs">{t('admin.staffRole')}</label>
                <select
                  value={newStaffRole}
                  onChange={e => handleRoleChangeForNewStaff(e.target.value as 'owner' | 'manager' | 'cashier' | 'kitchen' | 'waiter' | 'runner')}
                  className="w-full px-3 py-2 rounded-lg bg-gray-55 border border-gray-150 font-bold capitalize text-xs focus:bg-white focus:border-brand"
                >
                  {['owner', 'manager', 'cashier', 'kitchen', 'waiter', 'runner'].map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[9px] font-black uppercase text-gray-400 mb-1.5 ml-1 text-xs">{t('admin.systemPermissions')}</label>
                <div className="space-y-1.5 bg-gray-55 p-3 rounded-lg border border-gray-100">
                  {Object.entries(newStaffPermissions).map(([perm, val]) => (
                    <label key={perm} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={val}
                        onChange={e => {
                          setNewStaffPermissions({
                            ...newStaffPermissions,
                            [perm]: e.target.checked
                          });
                        }}
                        className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 h-3.5 w-3.5"
                      />
                      <span className="text-xs font-bold text-gray-700 capitalize">{perm.replace(/_/g, ' ')}</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-orange-600 hover:bg-orange-700 text-white py-2.5 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition"
              >
                <Plus size={14} />
                {t('admin.deployStaffAccount')}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Bottom Section: Audit Trail Hub */}
      <div className="bg-white rounded-xl p-4 sm:p-5 border border-gray-100 shadow-sm space-y-4">
        <div>
          <h2 className="text-base sm:text-lg font-black text-gray-900 flex items-center gap-2">
            <Shield className="text-orange-600" size={20} />
            {t('admin.orgAuditTrail')}
          </h2>
          <p className="text-[10px] text-gray-400 mt-0.5">{t('admin.immutableSessionHistory')}</p>
        </div>

        {auditLogs.length === 0 ? (
          <div className="h-24 flex flex-col items-center justify-center border-2 border-dashed border-gray-100 rounded-xl p-4 text-center text-gray-400">
            <Shield size={24} className="mb-1 text-gray-200" />
            <p className="text-xs font-bold">No Audit Log Data Registered</p>
          </div>
        ) : (
          <div className="border border-gray-105 rounded-lg overflow-hidden shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-55 border-b border-gray-100 text-[9px] font-black uppercase text-gray-400 tracking-wider">
                  <th className="px-4 py-2 text-left">Timestamp</th>
                  <th className="px-3 py-2 text-left">Staff Member</th>
                  <th className="px-3 py-2 text-left">Role</th>
                  <th className="px-4 py-2 text-left">Action / Secure Log Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-55/50 text-[11px] transition-colors">
                    <td className="px-4 py-2 text-gray-400 font-mono">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-bold text-gray-800">
                      {log.user_email}
                      <div className="text-[9px] text-gray-400 font-mono">ID: {log.user_id ? `${log.user_id.slice(0, 8)}...` : 'N/A'}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-[8px] bg-gray-55 border border-gray-150 text-gray-800 px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                        {log.role}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-bold text-gray-700">
                      {log.action}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
