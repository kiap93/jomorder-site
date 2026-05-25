import React, { useState, useEffect } from 'react';

import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, XCircle, AlertCircle, Edit3, Search, Filter, Globe, ChevronRight, Activity } from 'lucide-react';
import { getApiUrl } from '../lib/api';
import { indexedDbStorage } from '../lib/indexedDbStorage';

interface TranslationJob {
  id: string;
  restaurant_id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  source_language: string;
  target_language: string;
  status: string;
  reviewed_text: string;
  review_status: 'draft' | 'reviewed' | 'approved' | 'rejected';
  created_at: string;
}

export const InternalReview: React.FC = () => {
  const [jobs, setJobs] = useState<TranslationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'draft' | 'reviewed' | 'rejected' | 'all'>('all');
  const [search, setSearch] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  useEffect(() => {
    fetchJobs();
  }, [filter]);

  const saveEdit = async (job: TranslationJob) => {
    try {
      const token = await indexedDbStorage.getItem<string>('staff_token');
      const response = await fetch(getApiUrl(`/api/translation-jobs/${job.id}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ reviewed_text: editText })
      });
      
      if (!response.ok) throw new Error('Save edit failed');
      
      // Also sync to tenant_translations if it exists
      await fetch(getApiUrl(`/api/tenant-translations`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          restaurantId: job.restaurant_id,
          entityId: job.entity_id,
          fieldName: job.field_name,
          languageCode: job.target_language,
          translatedText: editText
        })
      });

      setEditingId(null);
      fetchJobs();
    } catch (err) {
      console.error('Save edit failed:', err);
    }
  };

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const token = await indexedDbStorage.getItem<string>('staff_token');
      const response = await fetch(getApiUrl(`/api/translation-jobs?filter=${filter}`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Fetch jobs failed');
      const data = await response.json();
      setJobs(data || []);
    } catch (err) {
      console.error('Fetch jobs failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (job: TranslationJob, nextStatus: 'reviewed' | 'approved' | 'rejected') => {
    setProcessingId(job.id);
    try {
      const token = await indexedDbStorage.getItem<string>('staff_token');
      // 1. Update job status
      const response = await fetch(getApiUrl(`/api/translation-jobs/${job.id}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ review_status: nextStatus })
      });

      if (!response.ok) throw new Error('Status update failed');

      // 2. If approved, update tenant_translations
      if (nextStatus === 'approved') {
        await fetch(getApiUrl(`/api/tenant-translations`), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            restaurantId: job.restaurant_id,
            entityId: job.entity_id,
            fieldName: job.field_name,
            languageCode: job.target_language,
            translatedText: job.reviewed_text
          })
        });
      }

      // Refresh
      fetchJobs();
    } catch (err) {
      console.error('Status update failed:', err);
    } finally {
      setProcessingId(null);
    }
  };

  const filteredJobs = jobs.filter(j => 
    j.reviewed_text.toLowerCase().includes(search.toLowerCase()) ||
    j.entity_id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto py-12 px-6">
      <div className="flex items-center justify-between mb-12">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 bg-black rounded-xl flex items-center justify-center text-white">
              <Activity size={18} />
            </div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tighter">Audit Hub</h1>
          </div>
          <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">Internal Translation Review Pipeline</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input 
              type="text"
              placeholder="Search content..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-white border border-gray-100 rounded-xl py-2 pl-9 pr-4 text-xs font-bold w-64 shadow-sm"
            />
          </div>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as any)}
            className="bg-white border border-gray-100 rounded-xl py-2 px-4 text-[10px] font-black uppercase tracking-widest shadow-sm"
          >
            <option value="all">Unapproved (All)</option>
            <option value="draft">Drafts Only</option>
            <option value="reviewed">Reviewed</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-[3rem] border border-gray-100">
           <div className="w-12 h-12 border-4 border-gray-100 border-t-orange-600 rounded-full animate-spin mb-4"></div>
           <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Scanning Pipeline...</p>
        </div>
      ) : (
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {filteredJobs.map((job) => (
              <motion.div
                key={job.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 flex items-center justify-between group hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-6">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                    job.review_status === 'draft' ? 'bg-gray-100 text-gray-400' :
                    job.review_status === 'reviewed' ? 'bg-blue-50 text-blue-500' :
                    'bg-red-50 text-red-500'
                  }`}>
                    <Globe size={24} />
                  </div>
                  
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 bg-gray-900 text-white rounded-full">
                        {job.target_language}
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">
                        {job.entity_type} • {job.field_name}
                      </span>
                    </div>
                    {editingId === job.id ? (
                      <div className="flex items-center gap-2">
                        <input 
                          type="text"
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-lg font-black text-gray-900 w-96 focus:ring-2 focus:ring-orange-500 outline-none"
                        />
                        <button 
                          onClick={() => saveEdit(job)}
                          className="p-2 bg-gray-900 text-white rounded-xl hover:bg-black transition-all"
                        >
                          <CheckCircle2 size={20} />
                        </button>
                        <button 
                          onClick={() => setEditingId(null)}
                          className="p-2 bg-gray-100 text-gray-400 rounded-xl hover:bg-gray-200 transition-all font-bold text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <p className="text-lg font-black text-gray-900">{job.reviewed_text}</p>
                        <button 
                          onClick={() => {
                            setEditingId(job.id);
                            setEditText(job.reviewed_text);
                          }}
                          className="text-gray-300 hover:text-gray-600 transition-colors"
                        >
                          <Edit3 size={16} />
                        </button>
                      </div>
                    )}
                    <p className="text-[10px] font-bold text-gray-400 mt-1">
                      Restaurant ID: {job.restaurant_id.slice(-8).toUpperCase()} • Created: {new Date(job.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {processingId === job.id ? (
                    <div className="px-6 py-2">
                       <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin"></div>
                    </div>
                  ) : (
                    <>
                      {job.review_status === 'draft' && (
                        <button
                          onClick={() => updateStatus(job, 'reviewed')}
                          className="px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-100 transition-all border border-blue-100"
                        >
                          Mark Reviewed
                        </button>
                      )}
                      
                      <button
                        onClick={() => updateStatus(job, 'approved')}
                        className="px-6 py-2 bg-green-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-green-700 transition-all flex items-center gap-2"
                      >
                        <CheckCircle2 size={14} />
                        Approve
                      </button>

                      <button
                        onClick={() => updateStatus(job, 'rejected')}
                        className="px-4 py-2 bg-white text-red-500 border border-red-50 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-50 transition-all"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {filteredJobs.length === 0 && (
            <div className="text-center py-24 bg-gray-50 rounded-[3rem] border-2 border-dashed border-gray-200">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-gray-200 mx-auto mb-4">
                <CheckCircle2 size={32} />
              </div>
              <h3 className="text-xl font-black text-gray-900 mb-1">Queue Clear</h3>
              <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">No pending translations require review</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
