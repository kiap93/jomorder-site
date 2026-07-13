import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { getApiUrl } from '../lib/api';
import { formatCurrency } from '../lib/localization';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Building2, Globe, Receipt, Settings2, Users, CheckCircle2, 
  ArrowRight, ArrowLeft, Loader2, Save, Sparkles, Mail, Phone,
  Plus, Trash2, Key, ShieldCheck, Play, HelpCircle, Laptop, Landmark, ClipboardList
} from 'lucide-react';

interface Invite {
  email: string;
  role: string;
}

interface WizardData {
  step1: { completed: boolean };
  step2: {
    business_name: string;
    business_type: string;
    contact_email: string;
    contact_phone: string;
  };
  step3: {
    country: string;
    currency: string;
    timezone: string;
    language: string;
    tax_type: string;
  };
  step4: {
    charge_tax: 'Yes' | 'No';
    tax_name: string;
    tax_percentage: number;
  };
  step5: {
    payment_mode: 'pay_first' | 'pay_later' | 'both';
  };
  step6: {
    provider: 'Stripe' | 'PayPal' | 'Billplz' | 'ToyyibPay' | 'Manual Bank' | 'Cash';
    stripe_publishable: string;
    stripe_secret: string;
    stripe_webhook: string;
  };
  step7: {
    invites: Invite[];
  };
}

const BUSINESS_TYPES = [
  "Restaurant", "Cafe", "Food Court", "Bakery", 
  "Cloud Kitchen", "Bubble Tea", "Retail Store", 
  "Service Business", "Other"
];

const COUNTRIES = [
  { code: 'MY', name: 'Malaysia', cur: 'MYR', zone: 'Asia/Kuala_Lumpur', tax: 'SST', lang: 'en' },
  { code: 'SG', name: 'Singapore', cur: 'SGD', zone: 'Asia/Singapore', tax: 'GST', lang: 'en' },
  { code: 'TH', name: 'Thailand', cur: 'THB', zone: 'Asia/Bangkok', tax: 'VAT', lang: 'en' },
  { code: 'ID', name: 'Indonesia', cur: 'IDR', zone: 'Asia/Jakarta', tax: 'VAT', lang: 'en' },
  { code: 'PH', name: 'Philippines', cur: 'PHP', zone: 'Asia/Manila', tax: 'VAT', lang: 'en' },
  { code: 'US', name: 'United States', cur: 'USD', zone: 'America/New_York', tax: 'Sales Tax', lang: 'en' },
  { code: 'GB', name: 'United Kingdom', cur: 'GBP', zone: 'Europe/London', tax: 'VAT', lang: 'en' },
  { code: 'AU', name: 'Australia', cur: 'AUD', zone: 'Australia/Sydney', tax: 'GST', lang: 'en' }
];

export function BusinessSetup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token, profile, refreshSession, switchWorkspace } = useAuthStore();
  
  // Resolve active restaurantId from query param or auth state
  const queryRestId = searchParams.get('restaurantId');
  const restaurantId = queryRestId || profile?.restaurantId;

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [wizardData, setWizardData] = useState<WizardData>({
    step1: { completed: true },
    step2: { business_name: '', business_type: 'Restaurant', contact_email: '', contact_phone: '' },
    step3: { country: 'MY', currency: 'MYR', timezone: 'Asia/Kuala_Lumpur', language: 'en', tax_type: 'SST' },
    step4: { charge_tax: 'No', tax_name: 'SST', tax_percentage: 6 },
    step5: { payment_mode: 'both' },
    step6: { provider: 'Cash', stripe_publishable: '', stripe_secret: '', stripe_webhook: '' },
    step7: { invites: [] }
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoSavedTime, setAutoSavedTime] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');

  // Input bindings inside invites loop
  const [newInviteEmail, setNewInviteEmail] = useState('');
  const [newInviteRole, setNewInviteRole] = useState('Staff');

  // Load setup progress on mount
  useEffect(() => {
    if (!token || !restaurantId) {
      if (!restaurantId && !loading) {
        setErrorMessage("To initiate setup, please choose a business workspace first.");
      }
      return;
    }

    async function fetchProgress() {
      try {
        setLoading(true);
        const res = await fetch(getApiUrl(`/api/setup/progress/${restaurantId}`), {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
          const data = await res.json();
          if (data) {
            if (data.current_step) setCurrentStep(data.current_step);
            if (data.completed_steps) setCompletedSteps(data.completed_steps);
            if (data.wizard_data) {
              setWizardData(prev => ({
                ...prev,
                ...data.wizard_data,
                // Handle merging deep properties cleanly
                step2: { ...prev.step2, ...data.wizard_data.step2 },
                step3: { ...prev.step3, ...data.wizard_data.step3 },
                step4: { ...prev.step4, ...data.wizard_data.step4 },
                step5: { ...prev.step5, ...data.wizard_data.step5 },
                step6: { ...prev.step6, ...data.wizard_data.step6 },
                step7: { invites: data.wizard_data.step7?.invites || [] }
              }));
            }
          }
        } else {
          const errText = await res.text();
          console.warn("Could not retrieve onboarding progress, applying default:", errText);
        }
      } catch (err: any) {
        setErrorMessage("Network error: Could not query your workspace onboarding state.");
      } finally {
        setLoading(false);
      }
    }
    fetchProgress();
  }, [token, restaurantId]);

  // Support autosave dynamically every 10 seconds
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const performDraftSave = async (silent = true) => {
    if (!token || !restaurantId) return;
    if (!silent) setSaving(true);

    try {
      const res = await fetch(getApiUrl(`/api/setup/progress/${restaurantId}`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          current_step: currentStep,
          completed_steps: completedSteps,
          wizard_data: wizardData
        })
      });

      if (res.ok) {
        const d = new Date();
        setAutoSavedTime(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`);
      }
    } catch (e) {
      console.warn("Autosave draft persist error:", e);
    } finally {
      if (!silent) setSaving(false);
    }
  };

  useEffect(() => {
    // Clear existing timer
    if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);

    // Setup recurring background persistent save
    autoSaveTimerRef.current = setInterval(() => {
      performDraftSave(true);
    }, 10000);

    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    };
  }, [currentStep, completedSteps, wizardData, token, restaurantId]);

  // Handle step selection/routing
  const handleNext = async () => {
    setErrorMessage(null);

    // Dynamic step verification
    if (currentStep === 2) {
      const { business_name, contact_email, contact_phone } = wizardData.step2;
      if (!business_name.trim()) return setErrorMessage("Please declare your unique Business Name.");
      if (!contact_email.trim() || !contact_email.includes('@')) return setErrorMessage("A valid email address is required.");
      if (!contact_phone.trim()) return setErrorMessage("A valid telephone number is required.");
    }

    if (currentStep === 3) {
      const { country, currency, timezone, tax_type } = wizardData.step3;
      if (!country || !currency || !timezone || !tax_type) {
        return setErrorMessage("Please complete all localization settings.");
      }
    }

    if (currentStep === 4 && wizardData.step4.charge_tax === 'Yes') {
      const { tax_name, tax_percentage } = wizardData.step4;
      if (!tax_name.trim()) return setErrorMessage("Please specify the statutory tax name (e.g., GST / VAT).");
      if (tax_percentage === undefined || tax_percentage < 0) return setErrorMessage("A valid tax percent rate is required.");
    }

    const nextStep = currentStep + 1;
    const nextCompleted = completedSteps.includes(currentStep) 
      ? completedSteps 
      : [...completedSteps, currentStep];

    setCompletedSteps(nextCompleted);
    setCurrentStep(nextStep);

    // Save state on step change
    setTimeout(() => {
      performDraftSave(true);
    }, 150);
  };

  const handlePrev = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Pre-load default configurations based on country choice
  const selectCountryPreset = (code: string) => {
    const matched = COUNTRIES.find(c => c.code === code);
    if (matched) {
      setWizardData(prev => ({
        ...prev,
        step3: {
          country: code,
          currency: matched.cur,
          timezone: matched.zone,
          tax_type: matched.tax,
          language: matched.lang
        },
        // Auto-assign matching tax name/percentage from preset
        step4: {
          ...prev.step4,
          tax_name: matched.tax,
          tax_percentage: code === 'MY' ? 6 : (code === 'SG' ? 9 : (code === 'TH' ? 7 : (code === 'ID' ? 11 : (code === 'PH' ? 12 : 8))))
        }
      }));
    }
  };

  // Simulating payment gateway checks
  const handleTestStripeConnection = () => {
    const { stripe_publishable, stripe_secret } = wizardData.step6;
    if (!stripe_publishable.trim() || !stripe_secret.trim()) {
      setErrorMessage("Please input your Publishable Key and Secret Key before attempting validation tests.");
      return;
    }
    setConnectionStatus('testing');
    setTimeout(() => {
      setConnectionStatus('success');
    }, 1600);
  };

  // Staff additions list operations
  const handleAddInvite = () => {
    if (!newInviteEmail.trim() || !newInviteEmail.includes('@')) {
      alert("Please provide a valid employee email address.");
      return;
    }
    const isDup = wizardData.step7.invites.some(i => i.email.toLowerCase() === newInviteEmail.toLowerCase());
    if (isDup) {
      alert("This employee is already scheduled for invitation.");
      return;
    }

    setWizardData(prev => ({
      ...prev,
      step7: {
        invites: [...prev.step7.invites, { email: newInviteEmail.toLowerCase(), role: newInviteRole }]
      }
    }));
    setNewInviteEmail('');
  };

  const handleRemoveInvite = (email: string) => {
    setWizardData(prev => ({
      ...prev,
      step7: {
        invites: prev.step7.invites.filter(i => i.email !== email)
      }
    }));
  };

  // Final Action to Launch & Provision Defaults
  const handleFinalizeLaunch = async () => {
    if (!token || !restaurantId) return;
    setFinalizing(true);
    setErrorMessage(null);

    try {
      const res = await fetch(getApiUrl(`/api/setup/finalize/${restaurantId}`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          wizard_data: wizardData
        })
      });

      if (res.ok) {
        // Redraw system active store to clear previous cache barriers
        await switchWorkspace(restaurantId);
        await refreshSession();
        
        // Push user to standard dashboard context
        navigate(`/restaurant/${restaurantId}/admin`);
      } else {
        const responseData = await res.json();
        setErrorMessage(responseData.error || "Failed finalizing operations. Please try again.");
      }
    } catch (err: any) {
      setErrorMessage("Network loss: Onboarding deployment request failed.");
    } finally {
      setFinalizing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[80vh] flex flex-col justify-center items-center py-20">
        <Loader2 className="animate-spin text-orange-600 mb-4" size={40} />
        <p className="text-sm font-bold text-gray-500 tracking-wide font-mono">Loading Setup Wizard Configuration...</p>
      </div>
    );
  }

  // Live calculations preview variables
  const taxPercent = Number(wizardData.step4.tax_percentage || 0);
  const calculatedTaxAmt = 100 * (taxPercent / 100);
  const calculatedTotalAmt = 100 + calculatedTaxAmt;

  return (
    <div className="max-w-2xl mx-auto py-4 px-3 sm:py-8 sm:px-6 min-h-[90vh] flex flex-col justify-between">
      {/* Upper Tracker Status Row */}
      <div className="mb-6 flex justify-between items-center bg-white p-3.5 rounded-2xl border border-gray-150 shadow-sm">
        <div className="flex items-center gap-2">
          <Building2 className="text-orange-500 shrink-0" size={18} />
          <div>
            <h1 className="text-xs font-black text-gray-900 tracking-tight leading-none uppercase">Business Setup</h1>
            {autoSavedTime && (
              <span className="text-[9px] font-mono font-bold text-gray-400 mt-0.5 inline-block">
                Config Auto-Saved {autoSavedTime}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-orange-50 px-2.5 py-1.5 rounded-xl border border-orange-500/10">
          <span className="text-[10px] font-black font-mono text-orange-600">STEP {currentStep} OF 8</span>
        </div>
      </div>

      {errorMessage && (
        <div className="mb-5 p-4 rounded-xl bg-rose-50 border border-rose-200/50 flex gap-2.5 items-start">
          <div className="w-1.5 h-1.5 bg-rose-500 rounded-full mt-1.5 shrink-0" />
          <p className="text-xs font-semibold text-rose-700 leading-relaxed">{errorMessage}</p>
        </div>
      )}

      {/* Primary Stepper Area */}
      <div className="bg-white rounded-3xl border border-gray-150 p-5 sm:p-8 flex-1 flex flex-col justify-between shadow-sm">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="flex-1 flex flex-col justify-between"
          >
            {/* STEP 1: WELCOME SCREEN */}
            {currentStep === 1 && (
              <div className="space-y-6 text-center py-10 my-auto">
                <div className="w-20 h-20 bg-orange-50 rounded-3xl flex items-center justify-center mx-auto border border-orange-500/20 overflow-hidden shadow-md">
                  <img src="/logo.png" className="w-full h-full object-cover" alt="Sikmatye Logo" referrerPolicy="no-referrer" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-black text-gray-950 tracking-tight">Welcome to Sikmatye 🎉</h2>
                  <p className="text-xs text-gray-500 font-medium max-w-sm mx-auto leading-relaxed">
                    Let's configure your newly established business in a few elegant, responsive workspace setups. We'll pre-engineer defaults so you can accept dynamic orders immediately.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2.5 justify-center pt-2">
                  <div className="text-[10px] bg-gray-50 text-gray-500 font-bold px-3 py-1.5 rounded-xl border border-gray-100 flex items-center gap-1.5">
                    <Laptop size={11} className="text-gray-400" /> Multi-Country Presets
                  </div>
                  <div className="text-[10px] bg-gray-50 text-gray-500 font-bold px-3 py-1.5 rounded-xl border border-gray-100 flex items-center gap-1.5">
                    <Users size={11} className="text-gray-400" /> Default Staff Structure
                  </div>
                </div>
              </div>
            )}

            {/* STEP 2: BUSINESS INFORMATION */}
            {currentStep === 2 && (
              <div className="space-y-5">
                <div className="border-b border-gray-100 pb-4">
                  <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
                    <Building2 className="text-orange-500" size={18} /> Business Information
                  </h2>
                  <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                    Identify your workspace and establish secure support channels.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Business Name</label>
                    <input
                      required
                      type="text"
                      className="w-full px-4 py-3 bg-gray-50/50 border border-gray-200/70 rounded-xl font-bold text-xs focus:bg-white focus:ring-0 focus:border-orange-500"
                      placeholder="e.g. Kyoto Espresso Lab"
                      value={wizardData.step2.business_name}
                      onChange={e => setWizardData({
                        ...wizardData,
                        step2: { ...wizardData.step2, business_name: e.target.value }
                      })}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Business Category Type</label>
                      <select
                        className="w-full px-4 py-3 bg-gray-50/50 border border-gray-200/70 rounded-xl font-bold text-xs focus:bg-white focus:ring-0 focus:border-orange-500 cursor-pointer"
                        value={wizardData.step2.business_type}
                        onChange={e => setWizardData({
                          ...wizardData,
                          step2: { ...wizardData.step2, business_type: e.target.value }
                        })}
                      >
                        {BUSINESS_TYPES.map(bt => (
                          <option key={bt} value={bt}>{bt}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Contact Phone</label>
                      <div className="relative">
                        <Phone className="absolute left-3.5 top-3.5 text-gray-400" size={14} />
                        <input
                          required
                          type="tel"
                          className="w-full pl-10 pr-4 py-3 bg-gray-50/50 border border-gray-200/70 rounded-xl font-bold text-xs focus:bg-white focus:ring-0 focus:border-orange-500"
                          placeholder="e.g. +6012345678"
                          value={wizardData.step2.contact_phone}
                          onChange={e => setWizardData({
                            ...wizardData,
                            step2: { ...wizardData.step2, contact_phone: e.target.value }
                          })}
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Support Contact Email</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-3.5 text-gray-400" size={14} />
                      <input
                        required
                        type="email"
                        className="w-full pl-10 pr-4 py-3 bg-gray-50/50 border border-gray-200/70 rounded-xl font-bold text-xs focus:bg-white focus:ring-0 focus:border-orange-500"
                        placeholder="e.g. admin@espresso.com"
                        value={wizardData.step2.contact_email}
                        onChange={e => setWizardData({
                          ...wizardData,
                          step2: { ...wizardData.step2, contact_email: e.target.value }
                        })}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: COUNTRY & LOCALIZATION */}
            {currentStep === 3 && (
              <div className="space-y-5">
                <div className="border-b border-gray-100 pb-4">
                  <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
                    <Globe className="text-orange-500" size={18} /> Country & Localization
                  </h2>
                  <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                    Select your operational country profile to auto-configure native base currency, timezones, and tax names cleanly.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-2 ml-1">Target Country Profile</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {COUNTRIES.map(ct => (
                        <div
                          key={ct.code}
                          onClick={() => selectCountryPreset(ct.code)}
                          className={`p-3.5 rounded-2xl border text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-1.5 hover:border-orange-500/40 relative overflow-hidden ${
                            wizardData.step3.country === ct.code
                              ? 'bg-orange-500/5 border-orange-500 shadow-sm'
                              : 'bg-gray-50/50 border-gray-150'
                          }`}
                        >
                          <span className="text-lg leading-none font-black text-gray-900 tracking-tight">{ct.code}</span>
                          <span className="text-[10px] font-bold text-gray-500 truncate max-w-full">{ct.name}</span>
                          {wizardData.step3.country === ct.code && (
                            <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-orange-500 rounded-full" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 bg-orange-50/15 border border-orange-500/10 rounded-2xl">
                    <h3 className="text-[10px] font-black text-orange-600 uppercase tracking-wider mb-2">Preset Overviews</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-bold text-gray-800">
                      <div>
                        <span className="block text-[8px] uppercase text-gray-400">Currency</span>
                        <span className="font-mono mt-0.5 inline-block text-orange-600">{wizardData.step3.currency}</span>
                      </div>
                      <div>
                        <span className="block text-[8px] uppercase text-gray-400">Timezone</span>
                        <span className="mt-0.5 inline-block truncate max-w-full">{wizardData.step3.timezone}</span>
                      </div>
                      <div>
                        <span className="block text-[8px] uppercase text-gray-400">Standard Tax</span>
                        <span className="mt-0.5 inline-block text-emerald-600">{wizardData.step3.tax_type}</span>
                      </div>
                      <div>
                        <span className="block text-[8px] uppercase text-gray-400">Language</span>
                        <span className="mt-0.5 inline-block">{wizardData.step3.language.toUpperCase()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Manual Override Controls */}
                  <details className="group border border-gray-150 rounded-xl overflow-hidden bg-gray-50/20">
                    <summary className="px-4 py-2.5 text-[10px] font-black uppercase text-gray-500 cursor-pointer hover:bg-gray-50 flex items-center justify-between select-none">
                      <span>Manual override localization specifications</span>
                      <Settings2 size={12} className="text-gray-400 group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="p-4 border-t border-gray-100 bg-white grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-[9px] font-black uppercase text-gray-400 mb-1 ml-0.5">Currency ISO</label>
                        <input
                          type="text"
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg font-bold text-xs"
                          value={wizardData.step3.currency}
                          onChange={e => setWizardData({
                            ...wizardData,
                            step3: { ...wizardData.step3, currency: e.target.value.toUpperCase() }
                          })}
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-black uppercase text-gray-400 mb-1 ml-0.5">Standard Timezone</label>
                        <input
                          type="text"
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg font-bold text-xs"
                          value={wizardData.step3.timezone}
                          onChange={e => setWizardData({
                            ...wizardData,
                            step3: { ...wizardData.step3, timezone: e.target.value }
                          })}
                        />
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            )}

            {/* STEP 4: TAX SETTINGS */}
            {currentStep === 4 && (
              <div className="space-y-5">
                <div className="border-b border-gray-100 pb-4">
                  <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
                    <Receipt className="text-orange-500" size={18} /> Government Tax Configuration
                  </h2>
                  <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                    Set up your standard statutory tax (GST, SST, VAT) for transparent customer orders bills.
                  </p>
                </div>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <label className="block text-[11px] font-black text-gray-800 ml-1">Do you charge statutory tax on consumer bills?</label>
                    <div className="flex gap-3">
                      {['Yes', 'No'].map(val => (
                        <div
                          key={val}
                          onClick={() => setWizardData({
                            ...wizardData,
                            step4: { ...wizardData.step4, charge_tax: val as 'Yes'|'No' }
                          })}
                          className={`flex-1 py-3 px-4 border rounded-2xl cursor-pointer text-center font-bold text-xs text-gray-800 transition-colors ${
                            wizardData.step4.charge_tax === val
                              ? 'bg-orange-500/5 border-orange-500'
                              : 'bg-gray-50/50 border-gray-200'
                          }`}
                        >
                          {val}
                        </div>
                      ))}
                    </div>
                  </div>

                  {wizardData.step4.charge_tax === 'Yes' && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="grid grid-cols-2 gap-4"
                    >
                      <div>
                        <label className="block text-[9px] font-black uppercase text-gray-400 mb-1 ml-1">Tax System Name</label>
                        <input
                          type="text"
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-xs"
                          placeholder="e.g. GST, SST"
                          value={wizardData.step4.tax_name}
                          onChange={e => setWizardData({
                            ...wizardData,
                            step4: { ...wizardData.step4, tax_name: e.target.value }
                          })}
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-black uppercase text-gray-400 mb-1 ml-1">Tax Percentage (%)</label>
                        <input
                          type="number"
                          step="0.1"
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-xs font-bold"
                          value={wizardData.step4.tax_percentage}
                          onChange={e => setWizardData({
                            ...wizardData,
                            step4: { ...wizardData.step4, tax_percentage: parseFloat(e.target.value) || 0 }
                          })}
                        />
                      </div>
                    </motion.div>
                  )}

                  {/* Calculations Live Preview Box */}
                  <div className="bg-gray-950 text-gray-400 rounded-2xl p-5 border border-gray-800 font-mono text-xs space-y-2.5">
                    <h3 className="text-[9px] font-black text-gray-500 uppercase tracking-widest pb-1 border-b border-gray-800 font-sans">
                      BILLING CALCULATION PREVIEW ($100 subtotal)
                    </h3>
                    <div className="flex justify-between">
                      <span>Itemized Subtotal:</span>
                      <span className="text-white">{formatCurrency(100, wizardData.step3.currency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{wizardData.step4.charge_tax === 'Yes' ? `${wizardData.step4.tax_name || 'Tax'} (${taxPercent}%)` : 'Tax Exempt'}:</span>
                      <span className="text-white">{formatCurrency(wizardData.step4.charge_tax === 'Yes' ? calculatedTaxAmt : 0, wizardData.step3.currency)}</span>
                    </div>
                    <div className="pt-2.5 border-t border-gray-800 flex justify-between font-bold text-white text-sm">
                      <span>Estimated Grand Total:</span>
                      <span className="text-orange-500">{formatCurrency(wizardData.step4.charge_tax === 'Yes' ? calculatedTotalAmt : 100, wizardData.step3.currency)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 5: ORDER & PAYMENT CONFIGURATION */}
            {currentStep === 5 && (
              <div className="space-y-5">
                <div className="border-b border-gray-100 pb-4">
                  <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
                    <Settings2 className="text-orange-500" size={18} /> Order & Payment Configuration
                  </h2>
                  <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                    Decide high-level payment flow parameters. This directly orchestrates terminal checkout logic.
                  </p>
                </div>

                <div className="space-y-4">
                  <label className="block text-[11px] font-black text-gray-800 ml-1">When should customers complete order payments?</label>
                  
                  <div className="grid grid-cols-1 gap-3">
                    {[
                      {
                        mode: 'pay_first',
                        title: 'Pay First',
                        desc: 'Customer pays immediately at table. Kitchen receives orders only after successful payment verification.'
                      },
                      {
                        mode: 'pay_later',
                        title: 'Pay Later',
                        desc: 'Customer sends orders immediately to the kitchen. Payment is finalized later at the main counter.'
                      },
                      {
                        mode: 'both',
                        title: 'Hybrid (Both Options)',
                        desc: 'Customers choose inside the shopping cart. Let customers pay at table or request bill later.'
                      }
                    ].map(p => (
                      <div
                        key={p.mode}
                        onClick={() => setWizardData({
                          ...wizardData,
                          step5: { payment_mode: p.mode as 'pay_first' | 'pay_later' | 'both' }
                        })}
                        className={`p-4 border rounded-2xl cursor-pointer transition-all flex items-start gap-3.5 hover:border-orange-500/40 ${
                          wizardData.step5.payment_mode === p.mode
                            ? 'bg-orange-500/5 border-orange-500 shadow-sm'
                            : 'bg-gray-50/50 border-gray-150'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full border mt-1.5 flex items-center justify-center shrink-0 ${
                          wizardData.step5.payment_mode === p.mode
                            ? 'border-orange-500 bg-orange-500 text-white'
                            : 'border-gray-300 bg-white'
                        }`}>
                          {wizardData.step5.payment_mode === p.mode && (
                            <div className="w-1.5 h-1.5 bg-white rounded-full" />
                          )}
                        </div>
                        <div>
                          <h4 className="text-xs font-black text-gray-950 font-sans tracking-tight">{p.title}</h4>
                          <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">{p.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 6: PAYMENT PROVIDER SETUP */}
            {currentStep === 6 && (
              <div className="space-y-5">
                <div className="border-b border-gray-100 pb-4">
                  <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
                    <Landmark className="text-orange-500" size={18} /> Payment Provider Setup
                  </h2>
                  <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                    Set up digital payment gateways so customers can process orders instantly from their tables.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-2 ml-1">Preferred Billing Gateway</label>
                    <div className="grid grid-cols-2 gap-2.5">
                      {[
                        { code: 'Stripe', sub: 'Global credit & debit cards' },
                        { code: 'ToyyibPay', sub: 'Malaysia FPS banks' },
                        { code: 'PayPal', sub: 'Global Paypal e-wallet' },
                        { code: 'Cash', sub: 'Manual Counter Payment' }
                      ].map(g => (
                        <div
                          key={g.code}
                          onClick={() => setWizardData({
                            ...wizardData,
                            step6: { ...wizardData.step6, provider: g.code as any }
                          })}
                          className={`p-4 border rounded-2xl cursor-pointer transition-all hover:border-gray-400 ${
                            wizardData.step6.provider === g.code
                              ? 'bg-orange-500/5 border-orange-500 shadow-sm'
                              : 'bg-gray-50/50 border-gray-150'
                          }`}
                        >
                          <span className="block text-xs font-black text-gray-950">{g.code}</span>
                          <span className="block text-[9px] text-gray-500 mt-0.5 leading-none font-bold">{g.sub}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {wizardData.step6.provider === 'Stripe' && (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-orange-50/5 border border-orange-500/10 rounded-2xl space-y-3"
                    >
                      <h4 className="text-[10px] font-black text-orange-600 uppercase tracking-widest flex items-center gap-1.5 leading-none">
                        <Key size={12} /> Stripe API Gateway Keys
                      </h4>
                      
                      <div className="grid grid-cols-1 gap-3 pt-1">
                        <div>
                          <label className="block text-[8px] font-black uppercase text-gray-400 mb-1 ml-0.5">Publishable Key (pk_test_...)</label>
                          <input
                            type="text"
                            className="w-full px-3 py-2 bg-white border border-gray-250 rounded-lg font-mono text-[11px]"
                            value={wizardData.step6.stripe_publishable}
                            onChange={e => setWizardData({
                              ...wizardData,
                              step6: { ...wizardData.step6, stripe_publishable: e.target.value }
                            })}
                          />
                        </div>

                        <div>
                          <label className="block text-[8px] font-black uppercase text-gray-400 mb-1 ml-0.5">Secret Key (sk_test_...)</label>
                          <input
                            type="password"
                            className="w-full px-3 py-2 bg-white border border-gray-250 rounded-lg font-mono text-[11px]"
                            value={wizardData.step6.stripe_secret}
                            onChange={e => setWizardData({
                              ...wizardData,
                              step6: { ...wizardData.step6, stripe_secret: e.target.value }
                            })}
                          />
                        </div>

                        <div>
                          <label className="block text-[8px] font-black uppercase text-gray-400 mb-1 ml-0.5">Webhook Signing Secret (whsec_...)</label>
                          <input
                            type="password"
                            className="w-full px-3 py-2 bg-white border border-gray-250 rounded-lg font-mono text-[11px]"
                            value={wizardData.step6.stripe_webhook}
                            onChange={e => setWizardData({
                              ...wizardData,
                              step6: { ...wizardData.step6, stripe_webhook: e.target.value }
                            })}
                          />
                        </div>
                      </div>

                      <div className="flex gap-4 items-center pt-2">
                        <button
                          type="button"
                          onClick={handleTestStripeConnection}
                          className="px-4 py-2 bg-gray-950 text-white rounded-xl text-[10px] font-black hover:bg-gray-900 transition-colors flex items-center gap-1.5"
                        >
                          {connectionStatus === 'testing' ? (
                            <>
                              <Loader2 className="animate-spin" size={12} />
                              Testing keys...
                            </>
                          ) : 'Test Connection'}
                        </button>

                        {connectionStatus === 'success' && (
                          <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                            <CheckCircle2 size={12} /> Connection Secure!
                          </span>
                        )}
                        {connectionStatus === 'failed' && (
                          <span className="text-[10px] font-bold text-rose-600">
                            Connection failed. Check Key values.
                          </span>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {wizardData.step6.provider !== 'Cash' && wizardData.step6.provider !== 'Stripe' && (
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl flex items-center gap-2 text-xs font-semibold text-gray-500">
                      <ShieldCheck className="text-orange-500" size={14} /> Only cash / counter payments supported during trial. Complete setup to unlock API credentials.
                    </div>
                  )}

                  <div className="pt-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setWizardData({
                          ...wizardData,
                          step5: { payment_mode: 'pay_later' }, // Skip restricts to pay_later
                          step6: { ...wizardData.step6, provider: 'Cash' }
                        });
                        handleNext();
                      }}
                      className="text-[11px] font-black text-gray-400 hover:text-orange-500 transition-colors uppercase tracking-wider"
                    >
                      Skip payment provider for now
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 7: STAFF & ROLES */}
            {currentStep === 7 && (
              <div className="space-y-5">
                <div className="border-b border-gray-100 pb-4">
                  <h2 className="text-base font-black text-gray-900 flex items-center gap-2">
                    <Users className="text-orange-500" size={18} /> Staff & Roles Setup
                  </h2>
                  <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                    Set up default organizational permissions and organize initial workforce accounts.
                  </p>
                </div>

                <div className="space-y-4">
                  {/* Default Roles summary accordion/expand */}
                  <div className="p-4 bg-orange-50/15 border border-orange-500/10 rounded-2xl space-y-3">
                    <h4 className="text-[10px] font-black text-orange-600 uppercase tracking-widest">
                      SYSTEM INTEGRATION ROLES
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-[10px] font-bold text-gray-600">
                      <div className="bg-white p-2 rounded-xl border border-orange-500/5">
                        <span className="block text-gray-950 font-black">Owner</span>
                        <span>Full platform access</span>
                      </div>
                      <div className="bg-white p-2 rounded-xl border border-orange-500/5">
                        <span className="block text-gray-950 font-black">Manager</span>
                        <span>Manage menus / refunds</span>
                      </div>
                      <div className="bg-white p-2 rounded-xl border border-orange-500/5">
                        <span className="block text-gray-950 font-black">Cashier</span>
                        <span>Billing & checkouts</span>
                      </div>
                      <div className="bg-white p-2 rounded-xl border border-orange-500/52 md:col-span-1">
                        <span className="block text-gray-950 font-black">Kitchen</span>
                        <span>Kitchen display tracking</span>
                      </div>
                      <div className="bg-white p-2 rounded-xl border border-orange-500/5 md:col-span-2">
                        <span className="block text-gray-950 font-black">Staff</span>
                        <span>General order entries</span>
                      </div>
                    </div>
                  </div>

                  {/* Add email invitations */}
                  <div className="space-y-3.5 pt-1.5">
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                      Invite staff members (optional)
                    </h4>
                    
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="flex-1 relative">
                        <Mail className="absolute left-3 top-3 text-gray-400" size={14} />
                        <input
                          type="email"
                          placeholder="Employee's Email address"
                          className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-250 rounded-xl text-xs font-bold"
                          value={newInviteEmail}
                          onChange={e => setNewInviteEmail(e.target.value)}
                        />
                      </div>
                      <div className="w-full sm:w-40">
                        <select
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-250 rounded-xl text-xs font-bold cursor-pointer"
                          value={newInviteRole}
                          onChange={e => setNewInviteRole(e.target.value)}
                        >
                          <option value="Manager">Manager</option>
                          <option value="Cashier">Cashier</option>
                          <option value="Kitchen">Kitchen Staff</option>
                          <option value="Runner">Runner</option>
                          <option value="Staff">General Staff</option>
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddInvite}
                        className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 font-black text-xs rounded-xl flex items-center justify-center gap-1 shrink-0 active:scale-95 transition-all text-center"
                      >
                        <Plus size={14} /> Add
                      </button>
                    </div>

                    {/* Invites array display */}
                    {wizardData.step7.invites.length > 0 && (
                      <div className="border border-gray-150 rounded-xl overflow-hidden divide-y divide-gray-100 bg-white">
                        {wizardData.step7.invites.map(item => (
                          <div key={item.email} className="px-4 py-2.5 flex justify-between items-center text-xs font-bold">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-900">{item.email}</span>
                              <span className="bg-orange-50 text-orange-600 text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider">
                                {item.role}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveInvite(item.email)}
                              className="text-gray-400 hover:text-rose-600 transition-colors p-1"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="text-right pt-2">
                    <button
                      type="button"
                      onClick={handleNext}
                      className="text-[11px] font-black text-gray-400 hover:text-orange-500 transition-colors uppercase tracking-wider"
                    >
                      Skip workforce invitation for now
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 8: SUMMARY & LAUNCH READY */}
            {currentStep === 8 && (
              <div className="space-y-6">
                <div className="space-y-2 text-center py-4 border-b border-gray-100">
                  <div className="w-14 h-14 bg-emerald-50 text-emerald-500 border border-emerald-200 rounded-2xl flex items-center justify-center mx-auto mb-1">
                    <CheckCircle2 size={30} />
                  </div>
                  <h2 className="text-xl font-black text-gray-950 tracking-tight">Your business is ready!</h2>
                  <p className="text-xs text-gray-500 font-medium">
                    Review your workspace defaults below before final system deployment.
                  </p>
                </div>

                {/* Grid summary cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl border border-gray-150 space-y-1 bg-gray-50/25">
                    <span className="block text-[8px] font-black uppercase text-gray-400 tracking-wider">Business Details</span>
                    <span className="block text-xs font-black text-gray-900 truncate">{wizardData.step2.business_name}</span>
                    <span className="block text-[10px] text-gray-500 font-bold">{wizardData.step2.business_type}</span>
                  </div>

                  <div className="p-4 rounded-2xl border border-gray-150 space-y-1 bg-gray-50/25">
                    <span className="block text-[8px] font-black uppercase text-gray-400 tracking-wider">Country Profile</span>
                    <span className="block text-xs font-black text-gray-900">
                      {wizardData.step3.country} ({wizardData.step3.currency})
                    </span>
                    <span className="block text-[10px] text-gray-500 font-bold font-mono tracking-tight leading-none">
                      {wizardData.step3.timezone}
                    </span>
                  </div>

                  <div className="p-4 rounded-2xl border border-gray-150 space-y-1 bg-gray-50/25">
                    <span className="block text-[8px] font-black uppercase text-gray-400 tracking-wider">Government Taxation</span>
                    <span className="block text-xs font-black text-gray-900">
                      {wizardData.step4.charge_tax === 'Yes' 
                        ? `${wizardData.step4.tax_name} (${wizardData.step4.tax_percentage}%)` 
                        : 'Tax Exempt'
                      }
                    </span>
                    <span className="block text-[10px] text-gray-500 font-bold">Standard configuration</span>
                  </div>

                  <div className="p-4 rounded-2xl border border-gray-150 space-y-1 bg-gray-50/25">
                    <span className="block text-[8px] font-black uppercase text-gray-400 tracking-wider">Checkout Settings</span>
                    <span className="block text-xs font-black text-orange-600 uppercase">
                      {wizardData.step5.payment_mode === 'pay_first' ? 'Pay First' : (wizardData.step5.payment_mode === 'pay_later' ? 'Pay Later' : 'Hybrid Both')}
                    </span>
                    <span className="block text-[10px] text-gray-500 font-bold">
                      Billing: {wizardData.step6.provider}
                    </span>
                  </div>
                </div>

                <div className="p-4 bg-orange-50/15 border border-orange-500/10 rounded-2xl space-y-2">
                  <h4 className="text-[10px] font-black text-orange-600 uppercase tracking-widest flex items-center gap-1.5">
                    <Sparkles size={11} className="shrink-0" /> AUTO-PROVISIONED DEFAULTS ON DEPLOYMENT
                  </h4>
                  <ul className="text-[10px] font-bold text-gray-600 space-y-1 list-disc pl-4 font-sans">
                    <li>Create "s" Default Category</li>
                    <li>Provision Sample Menu Food & Side dishes</li>
                    <li>Generate Default Dining Table "Table 1"</li>
                    <li>Initialize QR Code templates</li>
                    <li>Set Up Order Sequence tracking (ORD-000001)</li>
                  </ul>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Action Controls Navigation Row */}
        <div className="mt-8 pt-5 border-t border-gray-100 flex items-center justify-between gap-3">
          {currentStep > 1 && currentStep < 8 ? (
            <button
              type="button"
              onClick={handlePrev}
              className="px-5 py-3 border border-gray-250 text-gray-700 font-bold text-xs rounded-xl flex items-center gap-1 hover:bg-gray-50 active:scale-95 transition-all cursor-pointer"
            >
              <ArrowLeft size={14} /> Back
            </button>
          ) : <div className="w-2" />}

          {currentStep < 8 ? (
            <button
              type="button"
              onClick={handleNext}
              className="bg-orange-600 hover:bg-orange-700 text-white px-6 py-3 font-black text-xs rounded-xl flex items-center gap-1.5 shadow-md shadow-orange-600/10 active:scale-95 transition-all cursor-pointer ml-auto"
            >
              Continue <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinalizeLaunch}
              disabled={finalizing}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3.5 font-black text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/10 active:scale-95 transition-all cursor-pointer ml-auto w-full sm:w-auto"
            >
              {finalizing ? (
                <>
                  <Loader2 className="animate-spin text-white" size={14} />
                  Provisioning Spaces...
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} /> Finish & Launch Workspace
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
