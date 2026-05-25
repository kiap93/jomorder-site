import { useState, useEffect } from 'react';
import { printerService } from '../services/printerService';
import { ThermalPrinter, PrinterRoute, PrintJob, Category, Order } from '../types';
import { guestSupabase as supabase } from '../lib/supabase';
import { 
  Printer, 
  Plus, 
  Trash2, 
  Edit2, 
  Check, 
  AlertCircle, 
  RefreshCw, 
  Wifi, 
  WifiOff, 
  Settings, 
  FileText, 
  ChevronRight, 
  Play,
  CheckCircle2,
  HelpCircle,
  Clock,
  X
} from 'lucide-react';
import { useLanguageStore } from '../store/useLanguageStore';

interface PrinterManagerProps {
  restaurantId: string;
  categories: Category[];
}

export function PrinterManager({ restaurantId, categories }: PrinterManagerProps) {
  const { t } = useLanguageStore();
  const [printers, setPrinters] = useState<ThermalPrinter[]>([]);
  const [routes, setRoutes] = useState<PrinterRoute[]>([]);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form State
  const [editingPrinter, setEditingPrinter] = useState<Partial<ThermalPrinter> | null>(null);
  const [assignedCategories, setAssignedCategories] = useState<string[]>([]);

  // Simulation / Viewer modal
  const [activeSimulationHtml, setActiveSimulationHtml] = useState<string | null>(null);

  const loadData = async () => {
    if (!restaurantId) return;
    setLoading(true);
    try {
      const [printersList, routesList, localJobs] = await Promise.all([
        printerService.getPrinters(restaurantId),
        printerService.getPrinterRoutes(restaurantId),
        printerService.getLocalPrintJobs(restaurantId)
      ]);

      setPrinters(printersList);
      setRoutes(routesList);

      // Fetch online jobs from Supabase or merge with local IndexDB
      try {
        const { data: onlineJobs, error } = await supabase
          .from('print_jobs')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('created_at', { ascending: false })
          .limit(30);

        if (error) throw error;
        
        const parsedOnline: PrintJob[] = (onlineJobs || []).map(j => ({
          id: j.id,
          restaurantId: j.restaurant_id,
          orderId: j.order_id,
          printerId: j.printer_id,
          idempotencyKey: j.idempotency_key,
          type: j.type as 'kot' | 'receipt',
          status: j.status as 'pending' | 'printed' | 'failed',
          retries: j.retries,
          payload: j.payload,
          reprintCount: j.reprint_count || 0,
          reprintedBy: j.reprinted_by,
          reprintedAt: j.reprinted_at,
          createdAt: j.created_at,
          updatedAt: j.updated_at
        }));

        // Merge keeping pending local jobs if offline/failed on server
        const mergedJobs = [...parsedOnline];
        localJobs.forEach(lj => {
          if (!mergedJobs.some(x => x.id === lj.id)) {
            mergedJobs.push(lj);
          }
        });
        
        // Sort newest first
        mergedJobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setJobs(mergedJobs);
      } catch (jobErr) {
        console.warn('Supabase print jobs load failing, fallback to local', jobErr);
        const sortedLocal = [...localJobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setJobs(sortedLocal);
      }

    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load printer configurations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Subscribe to real-time additions of jobs for live printing action notifications
    const channelName = `print-jobs-${restaurantId}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'print_jobs',
        filter: `restaurant_id=eq.${restaurantId}`
      }, () => {
        // Reload history of printer jobs
        loadData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  const handleEditClick = (printer: ThermalPrinter) => {
    setEditingPrinter(printer);
    // Find category ids routed to this printer
    const modelRoutes = routes.filter(r => r.printerId === printer.id).map(r => r.categoryId);
    setAssignedCategories(modelRoutes);
  };

  const handleCreateClick = () => {
    setEditingPrinter({
      name: '',
      type: 'browser',
      interfaceType: 'browser',
      connectionAddress: 'Main Counter Desk',
      isActive: true,
      status: 'online'
    });
    setAssignedCategories([]);
  };

  const handleSavePrinter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPrinter || !editingPrinter.name) return;
    setFormLoading(true);
    setErrorMessage(null);

    try {
      const saved = await printerService.savePrinter(restaurantId, editingPrinter);
      
      // Update routes: Delete unselected and Insert new ones
      const existingPrinterRoutes = routes.filter(r => r.printerId === saved.id);
      
      // Routes to delete
      const toDelete = existingPrinterRoutes.filter(r => !assignedCategories.includes(r.categoryId));
      for (const td of toDelete) {
        await printerService.deletePrinterRoute(restaurantId, td.id);
      }

      // Routes to insert
      const existingCatIds = existingPrinterRoutes.map(r => r.categoryId);
      const toInsert = assignedCategories.filter(cid => !existingCatIds.includes(cid));
      for (const cid of toInsert) {
        await printerService.savePrinterRoute(restaurantId, saved.id, cid);
      }

      setEditingPrinter(null);
      await loadData();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error occurred while saving printer configuration');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeletePrinter = async (printerId: string) => {
    if (!window.confirm("Are you sure you want to delete this printer? This will delete all item-category routing associated with it.")) return;
    try {
      await printerService.deletePrinter(restaurantId, printerId);
      await loadData();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to delete printer');
    }
  };

  const toggleCategorySelection = (categoryId: string) => {
    setAssignedCategories(prev => 
      prev.includes(categoryId) 
        ? prev.filter(id => id !== categoryId) 
        : [...prev, categoryId]
    );
  };

  const handleTestPrint = async (printer: ThermalPrinter) => {
    // Generate dummy items with actual or sample layout
    const testKOTPayload = {
      orderId: 'TEST-88',
      tableName: 'TEST A12',
      orderType: 'dine_in' as const,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }),
      items: [
        {
          name: 'Classic Chicken Chop (TEST PRINT)',
          quantity: 2,
          modifiers: [
            '+ Extra Pepper Gravy',
            '- No Raw Cucumber Salad'
          ],
          specialInstructions: 'Warm the sauce separately.'
        },
        {
          name: 'Fresh Iced Lemon Tea (TEST PRINT)',
          quantity: 1,
          modifiers: ['+ Double Ice', '+ No Syrup Syrup']
        }
      ],
      notes: 'This is a kitchen printer channel verification test. If you can read this, your routing works!'
    };

    const htmlRecipe = printerService.renderKOTHtml(testKOTPayload);
    
    // Switch to local print bridge fallback
    if (printer.type === 'browser') {
      await printerService.printHtml(htmlRecipe);
    } else {
      // For thermal ethernet printer star / epson: simulate or fallback
      setActiveSimulationHtml(htmlRecipe);
    }
  };

  const handleReprintJob = async (job: PrintJob) => {
    const userRole = 'Staff (Kitchen Admin)';
    const updated = await printerService.reprintKOT(restaurantId, job.id, userRole);
    if (updated) {
      await loadData();
    }
  };

  const handleSimulateLocalView = (job: PrintJob) => {
    const html = printerService.renderKOTHtml(job.payload);
    setActiveSimulationHtml(html);
  };

  return (
    <div className="space-y-8">
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-2xl flex items-center gap-2">
          <AlertCircle size={20} />
          <p className="font-bold text-sm">{errorMessage}</p>
        </div>
      )}

      {/* Hero configuration header */}
      <div className="flex justify-between items-center bg-gray-50 p-6 rounded-[2rem] border border-gray-100">
        <div>
          <h3 className="text-lg font-black text-gray-900 tracking-tight">Assigned Kitchen Stations & Hardware Printers</h3>
          <p className="text-xs text-gray-500 font-medium">Configure network/USB and local fallback KOT printer devices. Assign food classes for immediate ticket split.</p>
        </div>
        <button
          onClick={handleCreateClick}
          className="bg-gray-900 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-black transition-all shadow-md"
        >
          <Plus size={20} /> Add Printer Station
        </button>
      </div>

      {/* Grid view of active channels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {printers.map(printer => {
          const printerRoutes = routes.filter(r => r.printerId === printer.id);
          const printerCategoryNames = printerRoutes.map(pr => {
            const cat = categories.find(c => c.id === pr.categoryId);
            return cat ? cat.name : 'Unknown Food Class';
          });

          return (
            <div 
              key={printer.id} 
              className={`bg-white border p-6 rounded-[2rem] shadow-sm transition-all flex flex-col justify-between ${
                printer.isActive ? 'border-gray-100 hover:shadow-md' : 'border-gray-100 opacity-60'
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gray-100 border border-gray-100 rounded-2xl flex items-center justify-center">
                      <Printer className="text-gray-700" size={24} />
                    </div>
                    <div>
                      <h4 className="font-black text-gray-900 text-base">{printer.name}</h4>
                      <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider font-mono">
                        {printer.type.toUpperCase()} / {printer.interfaceType.toUpperCase()}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${printer.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-[10px] font-bold text-gray-500 font-mono uppercase">
                      {printer.status}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 mb-6">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400 font-bold">Address / Endpoint:</span>
                    <span className="font-mono font-bold text-gray-700">{printer.connectionAddress || 'None'}</span>
                  </div>

                  <div className="space-y-1">
                    <span className="text-[10px] text-gray-400 font-extrabold uppercase tracking-wide">Routed Food Classes:</span>
                    <div className="flex flex-wrap gap-1">
                      {printerCategoryNames.length === 0 ? (
                        <span className="text-xs text-orange-600 font-bold italic bg-orange-50 px-2 py-0.5 rounded-lg border border-orange-100">
                          Receiving all unassigned items (Default KOT)
                        </span>
                      ) : (
                        printerCategoryNames.map((name, i) => (
                          <span key={i} className="text-xs bg-gray-100 text-gray-600 font-semibold px-2 py-0.5 rounded-lg border border-gray-100">
                            {name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-4 border-t border-gray-50">
                <button
                  type="button"
                  onClick={() => handleTestPrint(printer)}
                  className="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold py-2 rounded-xl text-xs border border-gray-200 transition-all flex items-center justify-center gap-1"
                >
                  <Play size={14} /> Test Print
                </button>
                <button
                  type="button"
                  onClick={() => handleEditClick(printer)}
                  className="bg-gray-50 hover:bg-gray-100 text-gray-700 p-2.5 rounded-xl border border-gray-200 transition-all"
                  title="Config routing"
                >
                  <Edit2 size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeletePrinter(printer.id)}
                  className="bg-red-50 hover:bg-red-100 text-red-600 p-2.5 rounded-xl border border-red-100 transition-all"
                  title="Delete station"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit/Create Form Popup overlay Modal */}
      {editingPrinter && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-[2.5rem] w-full max-w-xl overflow-hidden shadow-2xl border border-gray-100 animate-[scaleUp_0.3s_ease-out]">
            <header className="bg-gray-900 text-white p-6 flex justify-between items-center">
              <div>
                <h4 className="text-lg font-black tracking-tight">{editingPrinter.id ? 'Edit Printer Station' : 'Add Kitchen Printer Station'}</h4>
                <p className="text-[10px] text-gray-300 font-bold uppercase tracking-wider">Configure routing parameters & categories</p>
              </div>
              <button 
                onClick={() => setEditingPrinter(null)}
                className="text-gray-400 hover:text-white p-2 transition-colors"
                type="button"
              >
                <X size={20} />
              </button>
            </header>

            <form onSubmit={handleSavePrinter} className="p-8 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1">
                  <label className="text-xs text-gray-500 font-black uppercase">Station/Printer Name *</label>
                  <input
                    type="text"
                    required
                    value={editingPrinter.name || ''}
                    onChange={e => setEditingPrinter({ ...editingPrinter, name: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-100 bg-gray-50 rounded-2xl font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900"
                    placeholder="e.g. Hot Kitchen Station"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-gray-500 font-black uppercase">Hardware Format</label>
                  <select
                    value={editingPrinter.type || 'browser'}
                    onChange={e => setEditingPrinter({ ...editingPrinter, type: e.target.value as any })}
                    className="w-full px-4 py-3 border border-gray-100 bg-gray-50 rounded-2xl font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900"
                  >
                    <option value="browser">Browser fallback (`window.print`)</option>
                    <option value="thermal">Epson compatible (ESC/POS)</option>
                    <option value="star">Star Micronics</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-gray-500 font-black uppercase">Interface</label>
                  <select
                    value={editingPrinter.interfaceType || 'browser'}
                    onChange={e => setEditingPrinter({ ...editingPrinter, interfaceType: e.target.value as any })}
                    className="w-full px-4 py-3 border border-gray-100 bg-gray-50 rounded-2xl font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900"
                  >
                    <option value="browser">Virtual Browser Feed</option>
                    <option value="network">Network IP Ethernet</option>
                    <option value="usb">USB Driver Hook</option>
                    <option value="bluetooth">Bluetooth Interface</option>
                  </select>
                </div>

                <div className="col-span-2 space-y-1">
                  <label className="text-xs text-gray-500 font-black uppercase">IP Address / USB Port Descriptor</label>
                  <input
                    type="text"
                    value={editingPrinter.connectionAddress || ''}
                    onChange={e => setEditingPrinter({ ...editingPrinter, connectionAddress: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-100 bg-gray-50 rounded-2xl font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900"
                    placeholder="e.g. 192.168.1.150:9100 or Bluetooth MAC Address"
                  />
                </div>

                <div className="col-span-2 flex items-center gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={editingPrinter.isActive !== false}
                    onChange={e => setEditingPrinter({ ...editingPrinter, isActive: e.target.checked })}
                    className="w-5 h-5 accent-zinc-900"
                  />
                  <label htmlFor="isActive" className="text-xs text-gray-700 font-black uppercase cursor-pointer select-none">
                    Status Active (Printer ready to process incoming jobs)
                  </label>
                </div>
              </div>

              {/* Category Routing assignments check list */}
              <div className="space-y-2">
                <label className="text-xs text-gray-500 font-black uppercase block border-b pb-1">
                  Route Food Categories To This Station:
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-2 scrollbar-thin">
                  {categories.map(cat => {
                    const selected = assignedCategories.includes(cat.id);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => toggleCategorySelection(cat.id)}
                        className={`flex items-center gap-2 p-3 text-left border rounded-xl font-bold text-xs transition-colors ${
                          selected 
                            ? 'bg-zinc-900 text-white border-zinc-900' 
                            : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded-md border flex items-center justify-center text-[10px] ${selected ? 'bg-white text-zinc-900 border-white' : 'bg-white border-gray-300'}`}>
                          {selected && '✓'}
                        </span>
                        {cat.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setEditingPrinter(null)}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-3 rounded-xl text-xs font-bold font-mono uppercase tracking-wider"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="bg-gray-900 hover:bg-black text-white px-8 py-3 rounded-xl text-xs font-bold font-mono uppercase tracking-wider flex items-center gap-2 disabled:opacity-50"
                >
                  {formLoading && <RefreshCw className="animate-spin" size={14} />}
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Simulated printer modal to satisfy visual testing / verify output */}
      {activeSimulationHtml && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-[2.5rem] w-full max-w-sm overflow-hidden shadow-2xl border border-gray-200 flex flex-col items-center">
            <header className="w-full bg-zinc-900 text-white p-4 flex justify-between items-center">
              <span className="text-xs font-mono font-bold tracking-widest uppercase">Thermal Output Simulator (80mm)</span>
              <button 
                onClick={() => setActiveSimulationHtml(null)}
                className="text-gray-400 hover:text-white p-1"
              >
                <X size={16} />
              </button>
            </header>

            <div className="w-full h-80 overflow-y-auto p-6 bg-white border-b flex justify-center">
              {/* Load html content safely inside a responsive div */}
              <div 
                className="text-black font-mono"
                style={{ width: '80mm', maxWidth: '80mm', transform: 'scale(1)', transformOrigin: 'top center' }}
                dangerouslySetInnerHTML={{ __html: activeSimulationHtml }}
              />
            </div>

            <footer className="w-full p-4 bg-gray-50 flex gap-2 justify-end">
              <button
                onClick={() => {
                  const win = window.open();
                  if (win) {
                    win.document.open();
                    win.document.write(activeSimulationHtml);
                    win.document.close();
                    win.print();
                  }
                }}
                className="bg-gray-900 hover:bg-black text-white px-6 py-2.5 rounded-xl font-bold text-xs font-mono uppercase tracking-widest"
              >
                Print Fallback
              </button>
              <button
                onClick={() => setActiveSimulationHtml(null)}
                className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-2.5 rounded-xl font-bold text-xs font-mono uppercase tracking-widest"
              >
                Dismiss
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* PRINT JOBS HISTORY LOG */}
      <section className="bg-white rounded-[2rem] border border-gray-100 p-6 overflow-hidden shadow-sm">
        <header className="flex justify-between items-center mb-6 border-b pb-4">
          <div>
            <h3 className="text-base font-black text-gray-900 tracking-tight">Print Queue Logs & Station Performance</h3>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider font-mono">Real-time tracking for active sessions & error recovery</p>
          </div>
          <button
            onClick={loadData}
            className="text-gray-500 hover:text-gray-900 p-2 border rounded-xl hover:bg-gray-50 transition-colors flex items-center gap-1 text-xs font-bold"
          >
            <RefreshCw size={14} /> Refresh Logs
          </button>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-gray-400 font-extrabold uppercase font-mono tracking-widest py-3">
                <th className="pb-3 text-center">STATUS</th>
                <th className="pb-3">TIME</th>
                <th className="pb-3">CHIT INFO</th>
                <th className="pb-3">ITEMS PRINTED</th>
                <th className="pb-3 text-center">PRINTER STN</th>
                <th className="pb-3 text-center">REPRINTS</th>
                <th className="pb-3 text-right">CONTROLS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 font-medium">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-gray-400 font-bold">
                    No active chits queued in this session yet.
                  </td>
                </tr>
              ) : (
                jobs.map(job => {
                  const targetPrinter = printers.find(p => p.id === job.printerId);
                  const statusColors = {
                    pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
                    printed: 'bg-green-50 text-green-700 border-green-250',
                    failed: 'bg-red-50 text-red-700 border-red-200'
                  };

                  return (
                    <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-4 text-center">
                        <span className={`inline-flex px-3 py-1 rounded-full border font-black uppercase text-[10px] tracking-wide ${statusColors[job.status]}`}>
                          {job.status}
                        </span>
                      </td>
                      <td className="py-4 text-gray-400 font-mono">
                        {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-4 font-bold">
                        <div>
                          <span className="text-gray-900 font-extrabold uppercase">ORDER #{job.payload.orderId}</span>
                          <span className="text-[10px] text-gray-400 ml-2 font-mono">TABLE {job.payload.tableName}</span>
                        </div>
                        <div className="text-[10px] text-zinc-500 uppercase tracking-widest mt-0.5">
                          {job.payload.orderType === 'dine_in' ? 'Dine In' : 'Takeaway'} @ {new Date(job.createdAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="py-4 text-gray-600 font-bold">
                        <div className="max-w-xs truncate" title={job.payload.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}>
                          {job.payload.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                        </div>
                      </td>
                      <td className="py-4 text-center font-bold text-gray-800">
                        {targetPrinter?.name || 'Main Kitchen Fallback'}
                      </td>
                      <td className="py-4 text-center font-bold">
                        {job.reprintCount > 0 ? (
                          <span className="bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded border text-[10px]">
                            {job.reprintCount} rep (by {job.reprintedBy || 'Staff'})
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                      <td className="py-4 text-right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => handleSimulateLocalView(job)}
                            className="bg-gray-50 hover:bg-zinc-100 text-gray-700 font-black tracking-wider px-3 py-1.5 rounded-lg border text-[10px] font-mono uppercase"
                          >
                            View HTML
                          </button>
                          <button
                            onClick={() => handleReprintJob(job)}
                            className="bg-zinc-900 hover:bg-black text-white font-black tracking-wider px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase"
                          >
                            Reprint Chit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
