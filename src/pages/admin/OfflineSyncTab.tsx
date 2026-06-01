import { RefreshCw, Trash2 } from 'lucide-react';
import { offlineService } from '../../lib/offlineService';

interface OfflineSyncTabProps {
  activeConflictPolicy: string;
  setActiveConflictPolicy: (policy: any) => void;
  conflictLogs: any[];
  setConflictLogs: (logs: any[]) => void;
  t: (key: string) => string;
}

export function OfflineSyncTab({
  activeConflictPolicy,
  setActiveConflictPolicy,
  conflictLogs,
  setConflictLogs,
  t
}: OfflineSyncTabProps) {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Header Description */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm space-y-2">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-orange-500/10 text-orange-600 rounded-lg">
            <RefreshCw size={18} className="animate-spin duration-3000" />
          </div>
          <div>
            <h2 className="text-base font-black text-gray-900">Offline Sync & Conflict Engine</h2>
            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">Distributed State Integrity & Edge Case Safeguards</p>
          </div>
        </div>
        <p className="text-xs font-semibold text-gray-500 max-w-3xl leading-relaxed">
          When working offline or in poor network conditions, different staff members may modify the same order or table concurrently. This engine enforces strict, deterministic policy hierarchies to prevent <strong>phantom orders, uncoordinated double updates, or disappearing items</strong>.
        </p>
      </div>

      {/* 1. Policy Settings Grid */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-black text-gray-900">1. Conflict Resolution Settings</h3>
          <p className="text-[9px] text-gray-400 mt-0.5">Choose which policy is automatically triggered when concurrent modifications clash</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            {
              id: 'smart',
              title: 'Smart Precedence Merge',
              badge: 'Recommended',
              desc: 'Deterministic status priority system (Cancelled/Completed takes precedence over cook/pending), union of items to prevent food waste & disappearing orders.',
              color: 'border-orange-500/30'
            },
            {
              id: 'server-wins',
              title: 'Server Wins (Strict)',
              badge: 'Conservative',
              desc: 'All conflicts are solved in favor of the central server database. Offline modifications made concurrently on client devices are safely dropped.',
              color: 'border-zinc-300'
            },
            {
              id: 'client-wins',
              title: 'Client Wins (Offline First)',
              badge: 'Optimistic',
              desc: 'Always trust the local client. The modifications made offline override the server state completely regardless of physical modification times.',
              color: 'border-zinc-300'
            },
            {
              id: 'timestamp-wins',
              title: 'Latest Timestamp',
              badge: 'Chronological',
              desc: 'Standard Last-Write-Wins (LWW) mechanism. The computer compares precise local and physical server trigger timestamps to select the newest record.',
              color: 'border-zinc-300'
            }
          ].map(policy => {
            const isActive = activeConflictPolicy === policy.id;
            return (
              <button
                key={policy.id}
                onClick={() => {
                  offlineService.setConflictPolicy(policy.id as any);
                  setActiveConflictPolicy(policy.id as any);
                }}
                className={`text-left p-4 rounded-xl border-2 transition-all flex flex-col justify-between h-full hover:scale-[1.002] active:scale-[0.99] group cursor-pointer ${
                  isActive 
                    ? 'border-orange-500 bg-orange-500/5 shadow-sm shadow-orange-500/5' 
                    : 'border-gray-100 bg-gray-55 hover:bg-gray-100/70 hover:border-gray-200'
                }`}
              >
                <div className="space-y-1.5 bg-transparent">
                  <div className="flex justify-between items-start gap-1.5">
                    <h4 className="font-black text-xs text-gray-800 leading-tight">{policy.title}</h4>
                    <span className={`text-[8px] font-black uppercase px-1 py-0.5 rounded leading-none ${
                      isActive 
                        ? 'bg-orange-500 text-white' 
                        : 'bg-zinc-200 text-zinc-600'
                    }`}>
                      {policy.badge}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 font-semibold leading-normal group-hover:text-gray-500 transition-colors">
                    {policy.desc}
                  </p>
                </div>
                {isActive && (
                  <div className="mt-2 text-[9px] flex items-center gap-1 text-orange-600 font-extrabold font-mono font-black animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-ping" />
                    ACTIVE STRATEGY
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Interactive Conflict Simulator */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-black text-gray-900">2. Conflict Sandbox & Simulation Controls</h3>
          <p className="text-[9px] text-gray-400 mt-0.5">Safely test concurrent offline race conditions to understand how the active policy resolves them</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Card A: Status Precedence */}
          <div className="p-4 bg-gray-55 rounded-xl border border-gray-100 flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <span className="text-[8px] bg-red-100 text-red-800 font-black uppercase tracking-wider px-1.5 py-0.5 rounded">Waiters vs Kitchen</span>
              <h4 className="font-extrabold text-xs text-gray-900 pt-0.5">Status Mismatch Battle</h4>
              <p className="text-[10px] text-gray-400 leading-relaxed font-semibold">
                Simulates non-coordinated actions: Waiter marks order <strong>Completed</strong> while offline, but Kitchen marks it <strong>Cancelled</strong> online due to stock exhaustion.
              </p>
            </div>
            <button
              onClick={() => {
                const id = `order-${Math.floor(Math.random() * 9000 + 1000)}`;
                const localOrder = {
                  id,
                  status: 'Completed',
                  items: [
                    { menuItemId: 'm-rice', name: 'Golden Fried Rice', price: 12, quantity: 2 }
                  ],
                  updated_at: new Date(Date.now() - 300000).toISOString(), // 5m ago
                  version: 2
                };
                const remoteOrder = {
                  id,
                  status: 'Cancelled',
                  items: [
                    { menuItemId: 'm-rice', name: 'Golden Fried Rice', price: 12, quantity: 2 }
                  ],
                  updated_at: new Date().toISOString(), // Now
                  version: 3
                };
                offlineService.resolveOrderConflict(localOrder as any, remoteOrder as any);
                setConflictLogs(offlineService.getConflictLogs());
              }}
              className="w-full bg-gray-900 hover:bg-black text-white font-bold py-2.5 px-3 rounded-lg text-xs transition-all shadow-sm cursor-pointer"
            >
              Trigger Status Battle
            </button>
          </div>

          {/* Card B: Disappearing Items */}
          <div className="p-4 bg-gray-55 rounded-xl border border-gray-100 flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <span className="text-[8px] bg-blue-100 text-blue-800 font-black uppercase tracking-wider px-1.5 py-0.5 rounded">Waiter A vs Waiter B</span>
              <h4 className="font-extrabold text-xs text-gray-900 pt-0.5">No-Disappearing Item Union</h4>
              <p className="text-[10px] text-gray-400 leading-relaxed font-semibold">
                Simulates item edits: Client A modifies Rice quantity to 2 while offline, while Client B appends a Laksa Soup online concurrently. Prevents items from vanishing.
              </p>
            </div>
            <button
              onClick={() => {
                const id = `order-${Math.floor(Math.random() * 9000 + 1000)}`;
                const localOrder = {
                  id,
                  status: 'Cooking',
                  items: [
                    { menuItemId: 'm-rice', name: 'Golden Fried Rice', price: 12, quantity: 2 }
                  ],
                  updated_at: new Date(Date.now() - 100000).toISOString(),
                  version: 3
                };
                const remoteOrder = {
                  id,
                  status: 'Cooking',
                  items: [
                    { menuItemId: 'm-rice', name: 'Golden Fried Rice', price: 12, quantity: 1 },
                    { menuItemId: 'm-soup', name: 'Hot Laksa Soup', price: 15, quantity: 1 }
                  ],
                  updated_at: new Date().toISOString(),
                  version: 2
                };
                offlineService.resolveOrderConflict(localOrder as any, remoteOrder as any);
                setConflictLogs(offlineService.getConflictLogs());
              }}
              className="w-full bg-gray-900 hover:bg-black text-white font-bold py-2.5 px-3 rounded-lg text-xs transition-all shadow-sm cursor-pointer"
            >
              Trigger Item Edit Battle
            </button>
          </div>

          {/* Card C: Seating Overlap */}
          <div className="p-4 bg-gray-55 rounded-xl border border-gray-100 flex flex-col justify-between space-y-3">
            <div className="space-y-1">
              <span className="text-[8px] bg-emerald-100 text-emerald-800 font-black uppercase tracking-wider px-1.5 py-0.5 rounded">Concurrent Check-Ins</span>
              <h4 className="font-extrabold text-xs text-gray-900 pt-0.5">Safe Double Seating Avoidance</h4>
              <p className="text-[10px] text-gray-400 leading-relaxed font-semibold">
                Simulates Table statuses: Local device clears a table state to vacant while another device registers a new active guest session concurrently.
              </p>
            </div>
            <button
              onClick={() => {
                const localTable = {
                  id: `tbl-${Math.floor(Math.random() * 20 + 1)}`,
                  name: 'Table 6 (Simulated)',
                  status: 'vacant' as const,
                  updated_at: new Date(Date.now() - 400000).toISOString(),
                  version: 2
                };
                const remoteTable = {
                  id: localTable.id,
                  name: 'Table 6 (Simulated)',
                  status: 'active' as const,
                  current_session_id: 'sess-new-guest',
                  updated_at: new Date().toISOString(),
                  version: 3
                };
                offlineService.resolveTableConflict(localTable as any, remoteTable as any);
                setConflictLogs(offlineService.getConflictLogs());
              }}
              className="w-full bg-gray-900 hover:bg-black text-white font-bold py-2.5 px-3 rounded-lg text-xs transition-all shadow-sm cursor-pointer"
            >
              Trigger Seating Battle
            </button>
          </div>
        </div>
      </div>

      {/* 3. Conflict Resolution Log Audit Trail */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm space-y-3">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-sm font-black text-gray-900">3. Automated Conflict Resolution Audit Logs</h3>
            <p className="text-[9px] text-gray-400 mt-0.5">Immutable record of client-server auto merges executed on other devices or simulated sandbox runs</p>
          </div>
          {conflictLogs.length > 0 && (
            <button
              onClick={() => {
                offlineService.clearConflictLogs();
                setConflictLogs([]);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer"
            >
              <Trash2 size={12} /> Clear Logs
            </button>
          )}
        </div>

        {conflictLogs.length === 0 ? (
          <div className="h-28 border border-dashed border-gray-100 rounded-xl p-4 flex flex-col items-center justify-center text-center">
            <RefreshCw size={24} className="text-gray-200 mb-2 animate-pulse" />
            <h4 className="font-extrabold text-xs text-gray-600">No Conflict Resolutions Logged</h4>
            <p className="text-[10px] text-gray-400 font-medium max-w-xs mt-0.5">
              Use the quick sandbox simulator above to test conflicts and confirm policies in real time!
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-2">
            {conflictLogs.map(log => {
              const dateStr = new Date(log.timestamp).toLocaleTimeString();
              return (
                <div key={log.id} className="p-3.5 rounded-xl border border-gray-100 bg-gray-50/50 hover:bg-gray-50 transition-all space-y-3 text-left">
                  <div className="flex justify-between items-start gap-4">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-mono font-black uppercase text-gray-400 bg-gray-200/60 px-1.5 py-0.5 rounded leading-none">
                          {log.entityType} ID: {log.entityId}
                        </span>
                        <span className="text-[9.5px] text-gray-400 font-mono font-bold leading-none">
                          Triggered at {dateStr}
                        </span>
                      </div>
                      <h4 className="font-extrabold text-xs text-gray-800">{log.issue}</h4>
                    </div>
                    <span className="text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-orange-500 text-white leading-none">
                      POLICY: {log.policyApplied.replace('-', ' ')}
                    </span>
                  </div>

                  {/* Side-by-side data indicators */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="bg-white p-2 text-[10px] rounded-lg border border-gray-100">
                      <span className="block text-[8px] font-black uppercase text-gray-400 mb-1 font-mono leading-none">Waiter Local Cache (IDB)</span>
                      <pre className="font-mono text-[9px] bg-gray-55 p-1.5 rounded text-zinc-600 block max-h-16 overflow-y-auto select-all leading-tight">
                        {JSON.stringify(log.localValue, null, 2)}
                      </pre>
                    </div>
                    <div className="bg-white p-2 text-[10px] rounded-lg border border-gray-100">
                      <span className="block text-[8px] font-black uppercase text-gray-400 mb-1 font-mono leading-none">Central Server DB state</span>
                      <pre className="font-mono text-[9px] bg-gray-55 p-1.5 rounded text-zinc-600 block max-h-16 overflow-y-auto select-all leading-tight">
                        {JSON.stringify(log.remoteValue, null, 2)}
                      </pre>
                    </div>
                    <div className="bg-white p-2 text-[10px] rounded-lg border border-orange-200 bg-orange-500/[0.01]">
                      <span className="block text-[8px] font-black uppercase text-orange-600 mb-1 font-mono leading-none">Automerge Result</span>
                      <pre className="font-mono text-[9px] bg-orange-500/5 border border-orange-100 p-1.5 rounded text-orange-900 block max-h-16 overflow-y-auto font-bold select-all leading-tight">
                        {JSON.stringify(log.resolvedValue, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
