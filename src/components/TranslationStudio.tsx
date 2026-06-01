import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { LanguageCode, MenuItem, Category } from '../types';
import { Globe, Search, Save, History, Sparkles, Filter, ChevronRight, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface TranslationVersion {
  id: string;
  translation_id: string;
  language_code: string;
  field_name: string;
  new_text: string;
  created_at: string;
  entityName: string;
}

interface TranslationStudioProps {
  restaurantId: string;
  menuItems: MenuItem[];
  categories: Category[];
}

import { translateFoodTerm } from '../services/aiTranslationService';

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  let styles = 'bg-zinc-50 text-zinc-500 border border-zinc-200';
  let label = '↺ fallback';
  
  if (status === 'translated' || status === 'approved') {
    styles = 'bg-green-50 text-green-600 border border-green-200';
    label = '✓ translated';
  } else if (status === 'failed' || status === 'rejected') {
    styles = 'bg-red-50 text-red-500 border border-red-200';
    label = '⚠ failed';
  } else if (status === 'pending' || status === 'draft' || status === 'reviewed') {
    styles = 'bg-amber-50 text-amber-500 border border-amber-200 animate-pulse';
    label = '↺ pending';
  }

  return (
    <span className={`text-[8px] font-black uppercase tracking-[0.1em] px-2.5 py-0.5 rounded-full ${styles}`}>
      {label}
    </span>
  );
};

export const TranslationStudio: React.FC<TranslationStudioProps> = ({ restaurantId, menuItems, categories }) => {
  const [selectedEntity, setSelectedEntity] = useState<MenuItem | Category | null>(null);
  const [entityType, setEntityType] = useState<'menu_item' | 'category'>('menu_item');
  const [targetLang, setTargetLang] = useState<LanguageCode>('zh');
  const [searchQuery, setSearchQuery] = useState('');
  const [translations, setTranslations] = useState<{name: string, description: string}>({ name: '', description: '' });
  const [originalTranslations, setOriginalTranslations] = useState<{name: string, description: string}>({ name: '', description: '' });
  const [statuses, setStatuses] = useState<{name: string, description: string}>({ name: 'draft', description: 'draft' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [predictingField, setPredictingField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versions, setVersions] = useState<TranslationVersion[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showGlobalHistory, setShowGlobalHistory] = useState(false);
  const [fallbackToOriginal, setFallbackToOriginal] = useState(true);
  const [saveStatus, setSaveStatus] = useState(false);

  const [allTranslations, setAllTranslations] = useState<any[]>([]);
  const [allTranslationJobs, setAllTranslationJobs] = useState<any[]>([]);

  const fetchAllStatusData = async () => {
    try {
      const { data: transData } = await supabase
        .from('tenant_translations')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('language_code', targetLang);
      setAllTranslations(transData || []);

      const { data: jobData } = await supabase
        .from('translation_jobs')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('target_language', targetLang);
      setAllTranslationJobs(jobData || []);
    } catch (err) {
      console.error('Failed to fetch translation status data:', err);
    }
  };

  useEffect(() => {
    fetchAllStatusData();
  }, [restaurantId, targetLang]);

  const getEntityStatus = (entityId: string, hasDesc: boolean) => {
    const nameTrans = allTranslations.find(t => t.entity_id === entityId && t.field_name === 'name');
    const descTrans = hasDesc ? allTranslations.find(t => t.entity_id === entityId && t.field_name === 'description') : null;

    const nameJob = allTranslationJobs.find(j => j.entity_id === entityId && j.field_name === 'name');
    const descJob = hasDesc ? allTranslationJobs.find(j => j.entity_id === entityId && j.field_name === 'description') : null;

    if (
      (nameJob && nameJob.status === 'failed') ||
      (descJob && descJob.status === 'failed') ||
      (nameTrans && nameTrans.translation_status === 'failed') ||
      (descTrans && descTrans.translation_status === 'failed')
    ) {
      return 'failed';
    }

    if (
      (nameJob && (nameJob.status === 'pending' || nameJob.status === 'processing')) ||
      (descJob && (descJob.status === 'pending' || descJob.status === 'processing'))
    ) {
      return 'pending';
    }

    const nameTranslated = nameTrans && nameTrans.translated_text && nameTrans.translated_text.trim().length > 0;
    const descTranslated = !hasDesc || (descTrans && descTrans.translated_text && descTrans.translated_text.trim().length > 0);

    if (nameTranslated && descTranslated) {
      return 'translated';
    }

    return 'fallback';
  };

  useEffect(() => {
    const fetchFallbackSetting = async () => {
      try {
        const { data, error } = await supabase
          .from('restaurants')
          .select('fallback_to_original')
          .eq('id', restaurantId)
          .maybeSingle();
        if (error) throw error;
        if (data && data.fallback_to_original !== undefined) {
          setFallbackToOriginal(data.fallback_to_original);
        }
      } catch (err) {
        console.error("Failed to load fallback_to_original setting:", err);
      }
    };
    fetchFallbackSetting();
  }, [restaurantId]);

  const handleToggleFallback = async (checked: boolean) => {
    setFallbackToOriginal(checked);
    setSaveStatus(false);
    try {
      const { error } = await supabase
        .from('restaurants')
        .update({ fallback_to_original: checked })
        .eq('id', restaurantId);
      if (error) throw error;
      setSaveStatus(true);
      setTimeout(() => setSaveStatus(false), 2000);
    } catch (err: any) {
      console.error("Failed to update fallbackToOriginal setting:", err);
      setError("Failed to save setting to database.");
    }
  };

  const handleAiPredict = async (field: 'name' | 'description') => {
    if (!selectedEntity) return;
    const sourceText = field === 'name' ? selectedEntity.name : (selectedEntity as MenuItem).description;
    if (!sourceText) return;

    setPredictingField(field);
    setError(null);
    try {
      const prediction = await translateFoodTerm(sourceText, targetLang);
      if (prediction) {
        setTranslations(prev => ({ ...prev, [field]: prediction }));
      } else {
        setError('Machine translation returned no result.');
      }
    } catch (err: any) {
      console.error('Prediction failed:', err);
      setError('AI service unavailable. Please try again.');
    } finally {
      setPredictingField(null);
    }
  };

  const languages: { code: LanguageCode, label: string }[] = [
    { code: 'zh', label: 'Mandarin (Simplified)' },
    { code: 'ms', label: 'Bahasa Melayu' },
    { code: 'ja', label: 'Japanese' },
    { code: 'ko', label: 'Korean' },
    { code: 'th', label: 'Thai' }
  ];

  useEffect(() => {
    if (selectedEntity || showGlobalHistory) {
      fetchCurrentTranslation();
      fetchHistory();
    }
  }, [selectedEntity, targetLang, showGlobalHistory]);

  const fetchCurrentTranslation = async () => {
    if (!selectedEntity) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('tenant_translations')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('entity_id', selectedEntity.id)
        .eq('language_code', targetLang);

      const newTranslations = { name: '', description: '' };
      const newStatuses = { name: 'fallback', description: 'fallback' };
      if (data) {
        data.forEach(row => {
          if (row.field_name === 'name') {
            newTranslations.name = row.translated_text;
            newStatuses.name = row.translation_status || 'translated';
          }
          if (row.field_name === 'description') {
            newTranslations.description = row.translated_text;
            newStatuses.description = row.translation_status || 'translated';
          }
        });
      }

      const nameJob = allTranslationJobs.find(j => j.entity_id === selectedEntity.id && j.field_name === 'name');
      const descJob = allTranslationJobs.find(j => j.entity_id === selectedEntity.id && j.field_name === 'description');

      if (!newTranslations.name) {
        if (nameJob) {
          newStatuses.name = nameJob.status === 'failed' ? 'failed' : (nameJob.status === 'pending' || nameJob.status === 'processing' ? 'pending' : 'fallback');
        } else {
          newStatuses.name = 'fallback';
        }
      }
      if (!newTranslations.description) {
        if (descJob) {
          newStatuses.description = descJob.status === 'failed' ? 'failed' : (descJob.status === 'pending' || descJob.status === 'processing' ? 'pending' : 'fallback');
        } else {
          newStatuses.description = 'fallback';
        }
      }

      setTranslations(newTranslations);
      setOriginalTranslations(newTranslations);
      setStatuses(newStatuses);
    } catch (err) {
      console.error('Fetch translation failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      let query = supabase
        .from('translation_versions')
        .select('*')
        .eq('language_code', targetLang)
        .order('created_at', { ascending: false })
        .limit(showGlobalHistory ? 20 : 10);

      if (!showGlobalHistory && selectedEntity) {
        query = query.eq('translation_id', selectedEntity.id);
      }

      const { data } = await query;
      
      if (data && data.length > 0) {
        // Resolve names for global history
        const resolvedVersions = data.map(v => {
          let entityName = 'Unknown Entity';
          const menuItem = menuItems.find(m => m.id === v.translation_id);
          const category = categories.find(c => c.id === v.translation_id);
          
          if (menuItem) entityName = menuItem.name;
          else if (category) entityName = category.name;
          
          return { ...v, entityName };
        });
        setVersions(resolvedVersions);
      } else {
        setVersions([]);
      }
    } catch (err) {
      console.error('Fetch history failed:', err);
    }
  };

  const saveTranslation = async () => {
    if (!selectedEntity) return;
    setSaving(true);
    setError(null);
    try {
      const fieldsToSave: ('name' | 'description')[] = ['name', 'description'];
      
      for (const field of fieldsToSave) {
        const text = translations[field].trim();
        const originalText = originalTranslations[field];
        
        // Only proceed if the text has changed
        if (text === originalText) continue;

        // Apply fallback logic and database protection snippet:
        // Never overwrite existing translations with: null, undefined, or empty string/whitespace.
        const finalTranslation = text?.trim() ? text.trim() : originalText;
        if (!finalTranslation) {
          continue;
        }

        // 1. Create version record
        await supabase.from('translation_versions').insert({
          translation_type: 'tenant',
          translation_id: selectedEntity.id,
          field_name: field,
          language_code: targetLang,
          previous_text: originalText,
          new_text: finalTranslation,
          change_reason: 'Dashboard Edit'
        });

        // 2. Upsert translation
        const { error: upsertError } = await supabase
          .from('tenant_translations')
          .upsert({
            restaurant_id: restaurantId,
            entity_type: entityType,
            entity_id: selectedEntity.id,
            field_name: field,
            language_code: targetLang,
            translated_text: finalTranslation,
            translation_status: 'translated',
            override_global: true
          }, { onConflict: 'restaurant_id,entity_id,language_code,field_name' });

        if (upsertError) throw upsertError;

        // 3. Create/Update translation job for review flow
        await supabase.from('translation_jobs').upsert({
          restaurant_id: restaurantId,
          entity_type: entityType,
          entity_id: selectedEntity.id,
          field_name: field,
          source_language: 'en',
          target_language: targetLang,
          status: 'completed',
          reviewed_text: finalTranslation,
          review_status: 'draft'
        }, { onConflict: 'restaurant_id,entity_id,target_language,field_name' });
      }
      
      // Update original translations to current state after successful save
      setOriginalTranslations({ ...translations });
      fetchCurrentTranslation();
      fetchHistory();
      fetchAllStatusData();
    } catch (err: any) {
      console.error('Save failed:', err);
      setError(err.message || 'Failed to save translation. Verify your permissions.');
    } finally {
      setSaving(false);
    }
  };

  const filterEntities = () => {
    const list = entityType === 'menu_item' ? menuItems : categories;
    return list.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()));
  };

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Fallback to original text setting toggle */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-xs font-black uppercase tracking-wider text-gray-900">
            Fallback to original text when translation is unavailable
          </span>
          <span className="text-[11px] font-semibold text-gray-400 mt-0.5">
            If translation fails, customers will see the original text instead of empty content.
          </span>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus && (
            <span className="text-[10px] font-bold text-green-500 uppercase flex items-center gap-1 mr-2 animate-fade-in">
              <CheckCircle2 size={12} />
              Saved
            </span>
          )}
          <button
            onClick={() => handleToggleFallback(!fallbackToOriginal)}
            className={`w-11 h-6 rounded-full transition-all relative ${
              fallbackToOriginal ? 'bg-green-500' : 'bg-gray-200'
            }`}
          >
            <div
              className={`w-5 h-5 bg-white rounded-full absolute top-[0.125rem] transition-all shadow-sm ${
                fallbackToOriginal ? 'left-[1.375rem]' : 'left-[0.125rem]'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8 h-[calc(100vh-200px)]">
      {/* Entity Sidebar */}
      <div className="col-span-4 bg-white rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col overflow-hidden">
        <div className="p-6 border-b border-gray-50 flex flex-col gap-4">
          <div className="flex bg-gray-50 p-1 rounded-2xl">
            <button
              onClick={() => setEntityType('menu_item')}
              className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${entityType === 'menu_item' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400'}`}
            >
              Menu Items
            </button>
            <button
              onClick={() => setEntityType('category')}
              className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${entityType === 'category' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400'}`}
            >
              Categories
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-gray-50 border-none rounded-xl py-2.5 pl-9 pr-4 text-xs font-bold"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          {filterEntities().map(entity => {
            const hasDesc = entityType === 'menu_item' && !!(entity as MenuItem).description;
            const status = getEntityStatus(entity.id, hasDesc);
            return (
              <button
                key={entity.id}
                onClick={() => setSelectedEntity(entity)}
                className={`w-full text-left p-4 rounded-2xl transition-all flex items-center justify-between group ${selectedEntity?.id === entity.id ? 'bg-gray-900 text-white' : 'hover:bg-gray-50 text-gray-600'}`}
              >
                <div className="flex flex-col items-start gap-1">
                  <span className="text-xs font-black uppercase tracking-wide">{entity.name}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[9px] font-medium opacity-50`}>{ (entity as MenuItem).basePrice ? `$${(entity as MenuItem).basePrice}` : 'Category' }</span>
                    <span className="opacity-30 text-[9px]">•</span>
                    <StatusBadge status={status} />
                  </div>
                </div>
                <ChevronRight size={14} className={`opacity-0 group-hover:opacity-100 transition-all ${selectedEntity?.id === entity.id ? 'opacity-100' : ''}`} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Editor Main */}
      <div className="col-span-8 flex flex-col gap-8">
        {selectedEntity ? (
          <>
            <div className="bg-white rounded-[3rem] border border-gray-100 shadow-sm p-10 flex flex-col gap-10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-orange-100 rounded-2xl flex items-center justify-center text-orange-600">
                    <Globe size={24} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-gray-900 leading-none mb-1">Translation Studio</h2>
                    <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">{selectedEntity.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        className="bg-red-50 text-red-600 px-4 py-2 rounded-xl text-[9px] font-black uppercase flex items-center gap-2 border border-red-100"
                      >
                        <AlertCircle size={12} />
                        {error}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <select
                    value={targetLang}
                    onChange={e => setTargetLang(e.target.value as LanguageCode)}
                    className="bg-gray-50 border-none rounded-xl py-2 px-4 text-[10px] font-black uppercase tracking-widest h-10"
                  >
                    {languages.map(lang => (
                      <option key={lang.code} value={lang.code}>{lang.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={saveTranslation}
                    disabled={saving}
                    className="bg-gray-900 text-white rounded-xl px-6 h-10 flex items-center justify-center gap-2 group hover:bg-black transition-all"
                  >
                    {saving ? (
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                    ) : (
                      <>
                        <Save size={16} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Publish</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-10">
                {/* Name Translation Section */}
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Original Name (English)</label>
                    <div className="p-6 bg-gray-50 rounded-3xl border border-gray-100 text-sm font-bold text-gray-900 min-h-[60px]">
                      {selectedEntity.name}
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Name Translation ({targetLang})</label>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={statuses.name} />
                        <button 
                          onClick={() => handleAiPredict('name')}
                          disabled={!!predictingField}
                          className="text-[9px] font-black text-orange-600 uppercase flex items-center gap-1 hover:opacity-70 transition-all disabled:opacity-50"
                        >
                          <Sparkles size={12} className={predictingField === 'name' ? 'animate-spin' : ''} />
                          {predictingField === 'name' ? 'Predicting...' : 'AI PREDICT'}
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={translations.name}
                      onChange={e => setTranslations({ ...translations, name: e.target.value })}
                      placeholder={`Enter ${targetLang} name...`}
                      className="w-full p-6 bg-white rounded-3xl border-2 border-gray-100 focus:border-orange-500 transition-all text-sm font-bold text-gray-900 min-h-[60px]"
                    />
                  </div>
                </div>

                {/* Description Translation Section (Only for Menu Items) */}
                {entityType === 'menu_item' && (selectedEntity as MenuItem).description && (
                  <div className="grid grid-cols-2 gap-8 pt-6 border-t border-gray-50">
                    <div className="space-y-4">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Original Description</label>
                      <div className="p-6 bg-gray-50 rounded-3xl border border-gray-100 text-xs font-bold text-gray-500 min-h-[100px] whitespace-pre-wrap">
                        {(selectedEntity as MenuItem).description}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Description Translation</label>
                        <div className="flex items-center gap-3">
                          <StatusBadge status={statuses.description} />
                          <button 
                            onClick={() => handleAiPredict('description')}
                            disabled={!!predictingField}
                            className="text-[9px] font-black text-orange-600 uppercase flex items-center gap-1 hover:opacity-70 transition-all disabled:opacity-50"
                          >
                            <Sparkles size={12} className={predictingField === 'description' ? 'animate-spin' : ''} />
                            {predictingField === 'description' ? 'Predicting...' : 'AI PREDICT'}
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={translations.description}
                        onChange={e => setTranslations({ ...translations, description: e.target.value })}
                        placeholder={`Enter ${targetLang} description...`}
                        className="w-full p-6 bg-white rounded-3xl border-2 border-gray-100 focus:border-orange-500 transition-all text-xs font-bold text-gray-900 min-h-[100px]"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Status & Versioning Toggle */}
              <div className="pt-6 border-t border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">System Online • Multi-layer Conflict Check Passed</span>
                </div>
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${showHistory ? 'bg-gray-100 text-gray-900 font-black' : 'text-gray-400 font-bold hover:text-gray-600'}`}
                >
                  <History size={14} />
                  <span className="text-[9px] uppercase tracking-widest">Version History</span>
                </button>
              </div>
            </div>

            <AnimatePresence>
              {showHistory && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="bg-white rounded-[3rem] border border-gray-100 shadow-sm p-8"
                >
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-900 flex items-center gap-2">
                      <History size={12} className="text-orange-500" />
                      {showGlobalHistory ? 'Restaurant-wide Feed' : 'Audit Trail'}
                    </h3>
                    <button
                      onClick={() => setShowGlobalHistory(!showGlobalHistory)}
                      className={`text-[9px] font-black px-3 py-1.5 rounded-full transition-all border ${
                        showGlobalHistory ? 'bg-orange-600 text-white border-orange-500' : 'bg-white text-gray-400 border-gray-100 hover:border-gray-200'
                      }`}
                    >
                      {showGlobalHistory ? 'Showing Global' : 'Show All Items'}
                    </button>
                  </div>
                  <div className="space-y-4">
                    {versions.length > 0 ? versions.map((v, idx) => (
                      <div key={v.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 group transition-all hover:bg-white hover:shadow-sm">
                        <div className="flex items-center gap-4">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black ${
                            v.new_text === '[Translation Removed]' ? 'bg-red-50 text-red-400' : 'bg-white text-gray-400 shadow-sm'
                          }`}>
                            {versions.length - idx}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-gray-900 group-hover:text-orange-600 transition-colors">
                              {v.entityName} • {v.new_text}
                            </p>
                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">
                              Edit: {v.field_name} • Edited by Administrator • {new Date(v.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    )) : (
                      <p className="text-center py-8 text-xs font-bold text-gray-300">No version history found for this entity.</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 rounded-[3rem] border-2 border-dashed border-gray-200 p-12 text-center">
            <div className="w-20 h-20 bg-white rounded-full shadow-sm flex items-center justify-center text-gray-200 mb-6">
              <Globe size={40} strokeWidth={1} />
            </div>
            <h3 className="text-xl font-black text-gray-900 mb-2">Translation Workspace</h3>
            <p className="text-gray-400 text-xs font-medium max-w-[15rem] leading-relaxed">Select an item or category from the left to manage multilingual content layers.</p>
          </div>
        )}
      </div>
    </div>
  </div>
  );
};
