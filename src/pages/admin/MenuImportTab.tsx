import React, { useState, useEffect, useRef } from 'react';
import { 
  Download, 
  UploadCloud, 
  AlertCircle, 
  CheckCircle2, 
  RefreshCw, 
  FileSpreadsheet, 
  ChevronRight, 
  X, 
  HelpCircle,
  FileCheck,
  History,
  Timer
} from 'lucide-react';
import { getApiUrl } from '../../lib/api';
import { useAuthStore } from '../../store/useAuthStore';

interface MenuImportTabProps {
  t: (key: string) => string;
}

export function MenuImportTab({ t }: MenuImportTabProps) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<any | null>(null);
  const [historyJobs, setHistoryJobs] = useState<any[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'upload' | 'history'>('upload');
  
  // Progress polling interval reference
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const getAuthToken = () => {
    return useAuthStore.getState().token || localStorage.getItem('token') || '';
  };

  useEffect(() => {
    fetchHistory();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const fetchHistory = async () => {
    try {
      const response = await fetch(getApiUrl('/api/menu-import/history'), {
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setHistoryJobs(data);
      }
    } catch (err) {
      console.error('Failed fetching import logs:', err);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await processFile(e.target.files[0]);
    }
  };

  const processFile = async (file: File) => {
    if (!file.name.endsWith('.zip')) {
      setErrorMsg('Invalid file format. Please upload a standard compressed .zip archive.');
      return;
    }

    setUploading(true);
    setErrorMsg(null);
    setWarnings([]);
    setValidationErrors([]);
    setJobId(null);
    setJobStatus(null);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64String = (reader.result as string).split(',')[1];
        
        const response = await fetch(getApiUrl('/api/menu-import/upload'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getAuthToken()}`
          },
          body: JSON.stringify({ zipBase64: base64String })
        });

        const resData = await response.json();
        setUploading(false);

        if (!response.ok) {
          setErrorMsg(resData.error || 'Parsing/Validation crashed.');
          return;
        }

        setJobId(resData.jobId);
        setWarnings(resData.warnings || []);
        setValidationErrors(resData.errors || []);
        
        // Setup mock-initial status corresponding to validation completion
        setJobStatus({
          id: resData.jobId,
          status: 'validation_complete',
          progress: 100,
          message: resData.message,
          preview: resData.preview
        });
      };
    } catch (err: any) {
      setUploading(false);
      setErrorMsg('Error reading file data: ' + err.message);
    }
  };

  const confirmImportCommit = async () => {
    if (!jobId) return;

    try {
      const response = await fetch(getApiUrl(`/api/menu-import/jobs/${jobId}/confirm`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        }
      });

      if (!response.ok) {
        const resData = await response.json();
        setErrorMsg(resData.error || 'Confirming setup failed.');
        return;
      }

      // Start Polling for Live background job updates immediately!
      startProgressPolling(jobId);
    } catch (err: any) {
      setErrorMsg('Network error confirming import execution: ' + err.message);
    }
  };

  const startProgressPolling = (id: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    
    setJobStatus((prev: any) => ({
      ...prev,
      status: 'importing',
      progress: 5,
      message: 'Running transactional database processes...'
    }));

    pollingRef.current = setInterval(async () => {
      try {
        const response = await fetch(getApiUrl(`/api/menu-import/jobs/${id}/status`), {
          headers: {
            'Authorization': `Bearer ${getAuthToken()}`
          }
        });

        if (response.ok) {
          const job = await response.json();
          setJobStatus(job);

          if (job.status === 'completed' || job.status === 'failed') {
            if (pollingRef.current) clearInterval(pollingRef.current);
            fetchHistory(); // Sync logs view
          }
        }
      } catch (err) {
        console.warn('Failed querying background progress step:', err);
      }
    }, 800);
  };

  const downloadSampleTemplate = () => {
    window.location.href = getApiUrl('/api/menu-import/templates');
  };

  const exportCurrentMenuZip = () => {
    const token = getAuthToken();
    window.location.href = getApiUrl(`/api/menu-import/export?authorization=Bearer ${token}`);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
      {/* Title / Tab Selector Grid */}
      <div className="border-b border-gray-100 bg-gray-50/50 p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-lg font-black text-gray-900 tracking-tight flex items-center gap-1.5">
            <FileSpreadsheet className="text-gray-950" size={20} />
            Enterprise Menu Import/Export Wizard
          </h2>
          <p className="text-xs text-gray-500 font-medium">Batch manage complex simple, configurable, and combo menus seamlessly.</p>
        </div>

        <div className="flex bg-gray-100 p-1 rounded-lg self-stretch sm:self-auto">
          <button
            onClick={() => setActiveSubTab('upload')}
            className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeSubTab === 'upload' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-950'
            }`}
          >
            <UploadCloud size={14} />
            Import Wizard
          </button>
          <button
            onClick={() => setActiveSubTab('history')}
            className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              activeSubTab === 'history' ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-950'
            }`}
          >
            <History size={14} />
            Import History
          </button>
        </div>
      </div>

      {activeSubTab === 'upload' && (
        <div className="p-6 space-y-6">
          {/* Quick Actions Guide */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#FFFCEB] border border-amber-200/60 p-4 rounded-xl flex items-start gap-3">
              <Download className="text-amber-600 mt-0.5 shrink-0" size={18} />
              <div className="space-y-1">
                <h4 className="text-xs font-black text-amber-900 uppercase tracking-wider">Need the Template?</h4>
                <p className="text-[11px] text-amber-700 font-medium leading-relaxed">
                  Download a structured spreadsheet template with perfect headers, references, and circular DFS checks presets.
                </p>
                <button
                  onClick={downloadSampleTemplate}
                  className="mt-2 text-xs font-black text-amber-900 hover:underline flex items-center gap-0.5"
                >
                  Download Sample ZIP Template <ChevronRight size={14} />
                </button>
              </div>
            </div>

            <div className="bg-emerald-50/50 border border-emerald-200/60 p-4 rounded-xl flex items-start gap-3">
              <CheckCircle2 className="text-emerald-600 mt-0.5 shrink-0" size={18} />
              <div className="space-y-1">
                <h4 className="text-xs font-black text-emerald-900 uppercase tracking-wider">Round-Trip Export</h4>
                <p className="text-[11px] text-emerald-700 font-medium leading-relaxed">
                  Export your active menu elements as a formatted database ZIP. Edit it in Excel, and import it back securely!
                </p>
                <button
                  onClick={exportCurrentMenuZip}
                  className="mt-2 text-xs font-black text-emerald-900 hover:underline flex items-center gap-0.5"
                >
                  Export Active Menu ZIP <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Drag & Drop File Zone */}
          {!jobStatus && (
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center transition-all cursor-pointer ${
                dragActive ? 'border-gray-950 bg-gray-50' : 'border-gray-200 hover:border-gray-400'
              } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
            >
              <input
                id="file-upload"
                type="file"
                className="hidden"
                accept=".zip"
                onChange={handleFileChange}
                disabled={uploading}
              />
              <label htmlFor="file-upload" className="w-full flex flex-col items-center cursor-pointer">
                <div className="p-3 bg-gray-100 rounded-full mb-3 text-gray-700">
                  <UploadCloud size={28} className={uploading ? 'animate-bounce' : ''} />
                </div>
                {uploading ? (
                  <div className="space-y-1">
                    <p className="text-xs font-black text-gray-950">Validating Database Dependencies...</p>
                    <p className="text-[11px] text-gray-500">Inspecting CSVs for duplicates, references, & circles.</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs font-black text-gray-900">Drag & Drop Menu .zip or Click to browse</p>
                    <p className="text-[11px] text-gray-500">Supporting items, config-groups, mapping, & combos CSV templates</p>
                  </div>
                )}
              </label>
            </div>
          )}

          {/* Diagnostic Display Area */}
          {errorMsg && (
            <div className="p-4 bg-red-50 border border-red-200/60 rounded-xl flex items-start gap-3">
              <AlertCircle className="text-red-500 mt-0.5 shrink-0" size={18} />
              <div className="space-y-1">
                <p className="text-xs font-black text-red-900">Import Blocked</p>
                <p className="text-[11px] text-red-700 font-medium leading-relaxed">{errorMsg}</p>
                <button 
                  onClick={() => setErrorMsg(null)}
                  className="text-[10px] font-bold text-red-900 hover:underline mt-1 block"
                >
                  Dismiss Blockage
                </button>
              </div>
            </div>
          )}

          {/* Validation Report Summary card */}
          {jobStatus && (
            <div className="space-y-5 border border-gray-100 p-5 rounded-xl bg-gray-50/30">
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider bg-gray-900 text-white rounded">
                    Job ID: #{jobStatus.id}
                  </span>
                  <p className="text-xs text-gray-500">Diagnostics phase status corresponding to transaction locks.</p>
                </div>
                {jobStatus.status !== 'importing' && (
                  <button 
                    onClick={() => {
                      setJobId(null);
                      setJobStatus(null);
                      setValidationErrors([]);
                      setWarnings([]);
                    }}
                    className="p-1 text-gray-400 hover:text-gray-950 border border-gray-200 bg-white rounded-lg shadow-sm"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Status Banner */}
              <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-100 shadow-sm">
                {jobStatus.status === 'validating' || jobStatus.status === 'importing' ? (
                  <RefreshCw className="text-gray-950 animate-spin shrink-0" size={18} />
                ) : jobStatus.status === 'failed' ? (
                  <AlertCircle className="text-red-500 shrink-0" size={18} />
                ) : (
                  <FileCheck className="text-emerald-500 shrink-0" size={18} />
                )}
                <div className="flex-1">
                  <p className="text-xs font-black text-gray-950 uppercase tracking-tighter/3">{jobStatus.status}</p>
                  <p className="text-[11px] text-gray-500 leading-normal">{jobStatus.message}</p>
                </div>
              </div>

              {/* Real-time Loading progress bar */}
              {(jobStatus.status === 'importing' || jobStatus.status === 'validating') && (
                <div className="space-y-1.5 p-3 bg-white border border-gray-100 rounded-lg shadow-sm">
                  <div className="flex justify-between items-center text-[11px] font-bold">
                    <span className="text-gray-950">Active Batch Progress</span>
                    <span className="text-gray-900 font-black">{jobStatus.progress}%</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gray-950 transition-all duration-300"
                      style={{ width: `${jobStatus.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Validation errors panel (fatal blockages) */}
              {validationErrors.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto p-4 bg-red-50/55 border border-red-200/50 rounded-xl custom-scrollbar">
                  <div className="flex items-center gap-1.5 text-xs font-black text-red-900 uppercase tracking-wider">
                    <AlertCircle size={15} />
                    Fatal Validation Failures ({validationErrors.length})
                  </div>
                  <ul className="list-disc pl-5 text-[11px] text-red-700 space-y-1 leading-relaxed font-medium">
                    {validationErrors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                </div>
              )}

              {/* Warnings Panel */}
              {warnings.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto p-4 bg-[#FFFCEB] border border-amber-200/50 rounded-xl custom-scrollbar">
                  <div className="flex items-center gap-1.5 text-xs font-black text-amber-900 uppercase tracking-wider">
                    <AlertCircle size={15} />
                    Formatting Warnings ({warnings.length})
                  </div>
                  <ul className="list-disc pl-5 text-[11px] text-amber-700 space-y-1 leading-relaxed font-medium">
                    {warnings.map((warn, i) => <li key={i}>{warn}</li>)}
                  </ul>
                </div>
              )}

              {/* Records preview block */}
              {jobStatus.preview && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-white rounded-lg border border-gray-100 shadow-sm text-center">
                    <p className="text-[10px] uppercase font-black tracking-wider text-gray-500">New Items</p>
                    <p className="text-xl font-black text-emerald-500 mt-1">{jobStatus.preview.newRecords?.length || 0}</p>
                  </div>
                  <div className="p-3 bg-white rounded-lg border border-gray-100 shadow-sm text-center">
                    <p className="text-[10px] uppercase font-black tracking-wider text-gray-500">Updated Items</p>
                    <p className="text-xl font-black text-blue-500 mt-1">{jobStatus.preview.updatedRecords?.length || 0}</p>
                  </div>
                  <div className="p-3 bg-white rounded-lg border border-gray-100 shadow-sm text-center">
                    <p className="text-[10px] uppercase font-black tracking-wider text-gray-500">Unchanged</p>
                    <p className="text-xl font-black text-gray-500 mt-1">{jobStatus.preview.unchangedRecords?.length || 0}</p>
                  </div>
                </div>
              )}

              {/* Import final report logs info cards */}
              {jobStatus.status === 'completed' && jobStatus.report && (
                <div className="p-4 bg-emerald-50/50 border border-emerald-200/60 rounded-xl space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-black text-emerald-900 uppercase tracking-wider">
                    <CheckCircle2 size={16} />
                    Execution Complete Summary
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1 text-center">
                    <div>
                      <span className="text-[9px] uppercase font-black text-emerald-700">Cats Created</span>
                      <p className="text-lg font-black text-emerald-950">{jobStatus.report.summary?.categoriesCreated || 0}</p>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase font-black text-emerald-700">Created Items</span>
                      <p className="text-lg font-black text-emerald-950">{jobStatus.report.summary?.itemsCreated || 0}</p>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase font-black text-emerald-700">Configs Synced</span>
                      <p className="text-lg font-black text-emerald-950">{jobStatus.report.summary?.configsImported || 0}</p>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase font-black text-emerald-700">Warnings</span>
                      <p className="text-lg font-black text-emerald-950">{jobStatus.report.warnings?.length || 0}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Trigger Action Buttons */}
              {jobStatus.status === 'validation_complete' && (
                <div className="pt-2">
                  {validationErrors.length > 0 ? (
                    <button
                      disabled
                      className="w-full bg-gray-100 text-gray-400 font-black text-xs uppercase tracking-widest py-3 rounded-lg flex items-center justify-center gap-1.5 cursor-not-allowed"
                    >
                      Import Disabled due to Fatal Errors
                    </button>
                  ) : (
                    <button
                      onClick={confirmImportCommit}
                      className="w-full bg-gray-950 hover:bg-gray-900 text-white font-black text-xs uppercase tracking-widest py-3 rounded-lg shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 size={14} />
                      Confirm & Import Database
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'history' && (
        <div className="p-6">
          <div className="flex items-center gap-1.5 text-xs font-black text-gray-900 uppercase tracking-wider mb-4">
            <History size={16} />
            Historical Runs & Reports ({historyJobs.length})
          </div>

          <div className="space-y-4 max-h-[30rem] overflow-y-auto pr-2 custom-scrollbar">
            {historyJobs.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-gray-100 rounded-xl space-y-2">
                <Timer className="text-gray-300 mx-auto" size={32} />
                <p className="text-xs text-gray-500 font-bold">No historical menu imports found for this workspace.</p>
              </div>
            ) : (
              historyJobs.map((job: any) => (
                <div key={job.id} className="border border-gray-100 bg-gray-50/30 p-4 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:bg-gray-50/50 transition-colors">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-gray-900 text-white rounded">
                        Job: #{job.id}
                      </span>
                      <span className="text-[10px] text-gray-400 font-bold">
                        {new Date(job.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-900 font-bold leading-normal">{job.message}</p>
                    
                    {/* Tiny summary badges */}
                    {job.report && (
                      <div className="flex items-center gap-3 pt-1.5 flex-wrap">
                        <span className="text-[9px] font-black uppercase text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                          Created: {job.report.summary?.itemsCreated || 0}
                        </span>
                        <span className="text-[9px] font-black uppercase text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                          Updated: {job.report.summary?.itemsUpdated || 0}
                        </span>
                        <span className="text-[9px] font-black uppercase text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                          Configs: {job.report.summary?.configsImported || 0}
                        </span>
                        {job.report.warnings?.length > 0 && (
                          <span className="text-[9px] font-black uppercase text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                            Warnings: {job.report.warnings.length}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-right">
                    <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg ${
                      job.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                      job.status === 'failed' ? 'bg-red-50 text-red-700 border border-red-100' :
                      'bg-gray-100 text-gray-700 border border-gray-200'
                    }`}>
                      {job.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
