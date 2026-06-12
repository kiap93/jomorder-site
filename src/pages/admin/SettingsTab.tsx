import { useState, useEffect } from 'react';
import { Restaurant } from '../../types';
import { Save, AlertCircle, Shield, CheckCircle, CreditCard, Key, HelpCircle, Activity, Globe, Check, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuthStore } from '../../store/useAuthStore';
import { getApiUrl } from '../../lib/api';

interface SettingsTabProps {
  restaurant: Restaurant;
  setRestaurant: (restaurant: Restaurant) => void;
  settingsError: string | null;
  savingSettings: boolean;
  updateRestaurantSettings: () => void;
  t: (key: string) => string;
}

const AVAILABLE_PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash / Pay at Counter', type: 'cash' },
  { id: 'fpx', label: 'FPX Online Banking', type: 'online' },
  { id: 'duitnow', label: 'DuitNow QR', type: 'online' },
  { id: 'tng', label: 'Touch \'n Go eWallet', type: 'ewallet' },
  { id: 'grabpay', label: 'GrabPay', type: 'ewallet' },
  { id: 'boost', label: 'Boost eWallet', type: 'ewallet' },
  { id: 'visa', label: 'Visa Credit Card', type: 'card' },
  { id: 'mastercard', label: 'Mastercard Credit Card', type: 'card' },
  { id: 'atome', label: 'Atome BNPL (Buy Now Pay Later)', type: 'bnpl' },
  { id: 'grab_paylater', label: 'Grab PayLater', type: 'bnpl' },
];

export function SettingsTab({
  restaurant,
  setRestaurant,
  settingsError,
  savingSettings,
  updateRestaurantSettings,
  t
}: SettingsTabProps) {
  const [activeSubtab, setActiveSubtab] = useState<'branch' | 'payments'>('branch');
  
  // Auth and RBAC
  const { profile, token } = useAuthStore();
  const hasPaymentsAccess = profile?.role === 'owner' || profile?.role === 'manager' || profile?.platform_role === 'superadmin';

  // Multi-Tenant Payment States
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [savingPayments, setSavingPayments] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [existingSettings, setExistingSettings] = useState<any[]>([]);
  
  // Form fields
  const [selectedProvider, setSelectedProvider] = useState<'stripe' | 'billplz' | 'senangpay' | 'curlec'>('stripe');
  const [accountType, setAccountType] = useState<'owner' | 'platform'>('owner');
  const [enabledMethods, setEnabledMethods] = useState<string[]>([]);
  const [merchantConfig, setMerchantConfig] = useState<Record<string, string>>({});
  const [isActiveConfig, setIsActiveConfig] = useState(true);

  // Status indicators
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Load payment settings on mounts
  const fetchPaymentSettings = async (preserveSelectedProvider: boolean = false) => {
    if (!token || !hasPaymentsAccess) return;
    setLoadingPayments(true);
    setPaymentError(null);
    try {
      const response = await fetch(getApiUrl(`/api/restaurants/${restaurant.id}/payment-settings`), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setExistingSettings(data);
        
        if (!preserveSelectedProvider) {
          // Use active configuration as the initially selected tab, if any
          const active = data.find((s: any) => s.is_active);
          if (active) {
            setSelectedProvider(active.provider as any);
            setAccountType(active.account_type);
            setEnabledMethods(active.enabled_methods || []);
            setMerchantConfig(active.merchant_config || {});
            setIsActiveConfig(true);
          } else if (data.length > 0) {
            setSelectedProvider(data[0].provider as any);
            setAccountType(data[0].account_type);
            setEnabledMethods(data[0].enabled_methods || []);
            setMerchantConfig(data[0].merchant_config || {});
            setIsActiveConfig(data[0].is_active);
          }
        }
      } else {
        const txt = await response.text();
        setPaymentError(`Could not load payment configurations: ${txt}`);
      }
    } catch (err: any) {
      setPaymentError(`Network fault loading payments: ${err.message}`);
    } finally {
      setLoadingPayments(false);
    }
  };

  useEffect(() => {
    if (activeSubtab === 'payments') {
      fetchPaymentSettings();
    }
  }, [activeSubtab]);

  // Handle provider switching: load respective settings from state
  useEffect(() => {
    if (activeSubtab === 'payments') {
      const found = existingSettings.find(s => s.provider === selectedProvider);
      if (found) {
        setAccountType(found.account_type || 'owner');
        setEnabledMethods(found.enabled_methods || []);
        setMerchantConfig(found.merchant_config || {});
        setIsActiveConfig(found.is_active ?? true);
      } else {
        // Safe clear defaults
        setAccountType('owner');
        setEnabledMethods(selectedProvider === 'stripe' ? ['visa', 'mastercard'] : ['fpx']);
        setMerchantConfig({});
        setIsActiveConfig(false);
      }
      setTestResult(null);
    }
  }, [selectedProvider, existingSettings]);

  // Handle key value modifier
  const handleConfigChange = (key: string, val: string) => {
    setMerchantConfig(prev => ({
      ...prev,
      [key]: val
    }));
  };

  // Toggle checkout methodcheckbox
  const handleMethodToggle = (methodId: string) => {
    setEnabledMethods(prev => 
      prev.includes(methodId)
        ? prev.filter(id => id !== methodId)
        : [...prev, methodId]
    );
  };

  // Connection Test Trigger
  const handleTestConnection = async () => {
    if (!token) return;
    setTestingConnection(true);
    setTestResult(null);
    setPaymentError(null);
    try {
      const response = await fetch(getApiUrl(`/api/restaurants/${restaurant.id}/payment-settings/test-connection`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          provider: selectedProvider,
          merchant_config: merchantConfig
        })
      });

      const resBody = await response.json();
      if (response.ok) {
        setTestResult({ success: true, message: resBody.message });
      } else {
        setTestResult({ success: false, message: resBody.error || "Connection request failed" });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: `Check failed: ${err.message}` });
    } finally {
      setTestingConnection(false);
    }
  };

  // Save Settings Trigger
  const handleSavePayments = async () => {
    if (!token) return;
    setSavingPayments(true);
    setPaymentError(null);
    setPaymentSuccess(null);
    try {
      const response = await fetch(getApiUrl(`/api/restaurants/${restaurant.id}/payment-settings`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          provider: selectedProvider,
          account_type: accountType,
          enabled_methods: enabledMethods,
          merchant_config: merchantConfig,
          is_active: isActiveConfig
        })
      });

      if (response.ok) {
        setPaymentSuccess(`Successfully saved settings for ${selectedProvider.toUpperCase()}!`);
        // Refresh local cache to populate merged scrubbed credentials
        await fetchPaymentSettings(true);
      } else {
        const txt = await response.text();
        setPaymentError(`Could not save credentials: ${txt}`);
      }
    } catch (err: any) {
      setPaymentError(`Save failed: ${err.message}`);
    } finally {
      setSavingPayments(false);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Settings Navigation Subtabs */}
      <div className="flex bg-gray-100 p-0.5 rounded-xl border border-gray-200.5 w-full sm:w-fit" id="settings_subtab_nav">
        <button
          onClick={() => setActiveSubtab('branch')}
          className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-bold rounded-lg transition-all ${
            activeSubtab === 'branch'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-900'
          }`}
          id="tab_branch_settings"
        >
          {t('admin.branchSettings') || "Branch Settings"}
        </button>
        <button
          onClick={() => setActiveSubtab('payments')}
          className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
            activeSubtab === 'payments'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-900'
          }`}
          id="tab_payment_settings"
        >
          <CreditCard size={13} />
          Payment Gateway
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeSubtab === 'branch' ? (
          <motion.section 
            key="branch"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100 max-w-2xl"
            id="branch_settings_panel"
          >
            <h2 className="text-sm font-black text-gray-900 mb-4">{t('admin.branchSettings')}</h2>
            
            <AnimatePresence>
              {settingsError && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600"
                >
                  <AlertCircle size={15} />
                  <span className="text-xs font-bold">{settingsError}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.restaurantName')}</label>
                <input
                  value={restaurant.name}
                  onChange={e => setRestaurant({ ...restaurant, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 border border-gray-100 focus:bg-white focus:border-orange-500 focus:ring-0 font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.serviceCharge')}</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      value={restaurant.serviceCharge * 100}
                      onChange={e => setRestaurant({ ...restaurant, serviceCharge: parseFloat(e.target.value) / 100 })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 border border-gray-100 focus:bg-white focus:border-orange-500 focus:ring-0 font-bold font-mono"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">%</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.sst')}</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      value={restaurant.sst * 100}
                      onChange={e => setRestaurant({ ...restaurant, sst: parseFloat(e.target.value) / 100 })}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 border border-gray-100 focus:bg-white focus:border-orange-500 focus:ring-0 font-bold font-mono"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">%</span>
                  </div>
                </div>
              </div>

              {/* --- Multi-Country & Localization Section --- */}
              <div className="p-4 bg-orange-50/15 border border-orange-500/10 rounded-2xl space-y-4">
                <div className="flex items-start gap-2.5">
                  <Globe className="text-orange-500 shrink-0 mt-0.5" size={16} />
                  <div>
                    <h4 className="text-xs font-black text-gray-900">Multi-Country Global Architecture</h4>
                    <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">
                      JomOrder SaaS is configured for worldwide operations. Changing the Country Profile below automatically pre-configures currency codes, tax systems (SST/GST/VAT), date guidelines, timezones, and system languages.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Country Profile</label>
                    <select
                      value={restaurant.business_settings?.country || 'MY'}
                      onChange={e => {
                        const countryCode = e.target.value;
                        const presets: Record<string, any> = {
                          MY: { currency: 'MYR', timezone: 'Asia/Kuala_Lumpur', language: 'ms', tax_type: 'SST', tax_rate: 6.0, date_format: 'DD/MM/YYYY' },
                          SG: { currency: 'SGD', timezone: 'Asia/Singapore', language: 'en', tax_type: 'GST', tax_rate: 9.0, date_format: 'DD/MM/YYYY' },
                          TH: { currency: 'THB', timezone: 'Asia/Bangkok', language: 'en', tax_type: 'VAT', tax_rate: 7.0, date_format: 'DD/MM/YYYY' },
                          ID: { currency: 'IDR', timezone: 'Asia/Jakarta', language: 'en', tax_type: 'VAT', tax_rate: 11.0, date_format: 'DD/MM/YYYY' },
                          PH: { currency: 'PHP', timezone: 'Asia/Manila', language: 'en', tax_type: 'VAT', tax_rate: 12.0, date_format: 'DD/MM/YYYY' },
                          US: { currency: 'USD', timezone: 'America/New_York', language: 'en', tax_type: 'Sales Tax', tax_rate: 8.0, date_format: 'MM/DD/YYYY' },
                          GB: { currency: 'GBP', timezone: 'Europe/London', language: 'en', tax_type: 'VAT', tax_rate: 20.0, date_format: 'DD/MM/YYYY' },
                          AU: { currency: 'AUD', timezone: 'Australia/Sydney', language: 'en', tax_type: 'GST', tax_rate: 10.0, date_format: 'DD/MM/YYYY' }
                        };
                        const pst = presets[countryCode] || presets.MY;
                        setRestaurant({
                          ...restaurant,
                          currency: pst.currency,
                          sst: pst.tax_rate / 100,
                          business_settings: {
                            country: countryCode,
                            currency: pst.currency,
                            timezone: pst.timezone,
                            language: pst.language,
                            tax_type: pst.tax_type,
                            tax_rate: pst.tax_rate,
                            date_format: pst.date_format,
                            payment_mode: restaurant.payment_mode || 'both'
                          }
                        });
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-150 focus:border-orange-500 focus:ring-0 font-bold"
                    >
                      <option value="MY">Malaysia (MY)</option>
                      <option value="SG">Singapore (SG)</option>
                      <option value="TH">Thailand (TH)</option>
                      <option value="ID">Indonesia (ID)</option>
                      <option value="PH">Philippines (PH)</option>
                      <option value="US">United States (US)</option>
                      <option value="GB">United Kingdom (GB)</option>
                      <option value="AU">Australia (AU)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Base Currency ISO</label>
                    <input
                      value={restaurant.business_settings?.currency || restaurant.currency || 'MYR'}
                      onChange={e => {
                        const val = e.target.value.toUpperCase();
                        setRestaurant({
                          ...restaurant,
                          currency: val,
                          business_settings: {
                            ...(restaurant.business_settings || {
                              country: 'MY', timezone: 'Asia/Kuala_Lumpur', language: 'en', tax_type: 'SST', tax_rate: 6.0, date_format: 'DD/MM/YYYY', payment_mode: 'both'
                            }),
                            currency: val
                          }
                        });
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-150 focus:border-orange-500 focus:ring-0 font-bold font-mono"
                      placeholder="e.g. SGD, USD, MYR"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Local Timezone</label>
                    <input
                      value={restaurant.business_settings?.timezone || 'Asia/Kuala_Lumpur'}
                      onChange={e => {
                        setRestaurant({
                          ...restaurant,
                          business_settings: {
                            ...(restaurant.business_settings || {
                              country: 'MY', currency: 'MYR', language: 'en', tax_type: 'SST', tax_rate: 6.0, date_format: 'DD/MM/YYYY', payment_mode: 'both'
                            }),
                            timezone: e.target.value
                          }
                        });
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-150 focus:border-orange-500 focus:ring-0 font-bold"
                      placeholder="e.g. Asia/Singapore"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">System Language</label>
                    <select
                      value={restaurant.business_settings?.language || 'en'}
                      onChange={e => {
                        setRestaurant({
                          ...restaurant,
                          business_settings: {
                            ...(restaurant.business_settings || {
                              country: 'MY', currency: 'MYR', timezone: 'Asia/Kuala_Lumpur', tax_type: 'SST', tax_rate: 6.0, date_format: 'DD/MM/YYYY', payment_mode: 'both'
                            }),
                            language: e.target.value
                          }
                        });
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-150 focus:border-orange-500 focus:ring-0 font-bold"
                    >
                      <option value="en">English</option>
                      <option value="ms">Bahasa Melayu</option>
                      <option value="zh">Simplified Chinese</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Tax Type Name</label>
                    <input
                      value={restaurant.business_settings?.tax_type || 'SST'}
                      onChange={e => {
                        const val = e.target.value;
                        setRestaurant({
                          ...restaurant,
                          business_settings: {
                            ...(restaurant.business_settings || {
                              country: 'MY', currency: 'MYR', timezone: 'Asia/Kuala_Lumpur', language: 'en', tax_rate: 6.0, date_format: 'DD/MM/YYYY', payment_mode: 'both'
                            }),
                            tax_type: val
                          }
                        });
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-150 focus:border-orange-500 focus:ring-0 font-bold"
                      placeholder="e.g. GST, VAT, SST"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Tax Percentage (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={restaurant.business_settings?.tax_rate !== undefined ? restaurant.business_settings.tax_rate : (restaurant.sst * 100)}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0;
                        setRestaurant({
                          ...restaurant,
                          sst: val / 100,
                          business_settings: {
                            ...(restaurant.business_settings || {
                              country: 'MY', currency: 'MYR', timezone: 'Asia/Kuala_Lumpur', language: 'en', tax_type: 'SST', date_format: 'DD/MM/YYYY', payment_mode: 'both'
                            }),
                            tax_rate: val
                          }
                        });
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-150 focus:border-orange-500 focus:ring-0 font-bold font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Local Date Format</label>
                    <select
                      value={restaurant.business_settings?.date_format || 'DD/MM/YYYY'}
                      onChange={e => {
                        setRestaurant({
                          ...restaurant,
                          business_settings: {
                            ...(restaurant.business_settings || {
                              country: 'MY', currency: 'MYR', timezone: 'Asia/Kuala_Lumpur', language: 'en', tax_type: 'SST', tax_rate: 6.0, payment_mode: 'both'
                            }),
                            date_format: e.target.value
                          }
                        });
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-gray-150 focus:border-orange-500 focus:ring-0 font-bold"
                    >
                      <option value="DD/MM/YYYY">DD/MM/YYYY (e.g. 31/12/2026)</option>
                      <option value="MM/DD/YYYY">MM/DD/YYYY (e.g. 12/31/2026)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-2 ml-1">Order Payment Mode</label>
                <div className="grid grid-cols-1 gap-2.5">
                  <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    (restaurant.payment_mode || 'pay_first') === 'pay_first'
                      ? 'border-orange-500 bg-orange-50/20'
                      : 'border-gray-150 bg-gray-50/50 hover:bg-gray-50'
                  }`}>
                    <input
                      type="radio"
                      name="payment_code"
                      value="pay_first"
                      checked={(restaurant.payment_mode || 'pay_first') === 'pay_first'}
                      onChange={() => setRestaurant({ ...restaurant, payment_mode: 'pay_first' })}
                      className="mt-1 border-gray-300 text-orange-500 focus:ring-orange-500"
                    />
                    <div>
                      <span className="block text-xs font-black text-gray-950">Pay First (Prepaid)</span>
                      <span className="block text-[10px] text-gray-500 mt-0.5 leading-relaxed">
                        Customer must complete payment before order is submitted. Status starts as Paid → Preparing. (Ideal for Quick Service)
                      </span>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    restaurant.payment_mode === 'pay_later'
                      ? 'border-orange-500 bg-orange-50/20'
                      : 'border-gray-150 bg-gray-50/50 hover:bg-gray-50'
                  }`}>
                    <input
                      type="radio"
                      name="payment_code"
                      value="pay_later"
                      checked={restaurant.payment_mode === 'pay_later'}
                      onChange={() => setRestaurant({ ...restaurant, payment_mode: 'pay_later' })}
                      className="mt-1 border-gray-300 text-orange-500 focus:ring-orange-500"
                    />
                    <div>
                      <span className="block text-xs font-black text-gray-950">Pay Later (Postpaid)</span>
                      <span className="block text-[10px] text-gray-500 mt-0.5 leading-relaxed">
                        Customer submits order first. Staff collects payment at counter, table, or after meal. Status starts as Pending Payment. (Ideal for Table Service)
                      </span>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    restaurant.payment_mode === 'both'
                      ? 'border-orange-500 bg-orange-50/20'
                      : 'border-gray-150 bg-gray-50/50 hover:bg-gray-50'
                  }`}>
                    <input
                      type="radio"
                      name="payment_code"
                      value="both"
                      checked={restaurant.payment_mode === 'both'}
                      onChange={() => setRestaurant({ ...restaurant, payment_mode: 'both' })}
                      className="mt-1 border-gray-300 text-orange-500 focus:ring-orange-500"
                    />
                    <div>
                      <span className="block text-xs font-black text-gray-950">Allow Both (Customer Chooses)</span>
                      <span className="block text-[10px] text-gray-500 mt-0.5 leading-relaxed">
                        Allow customers to choose between instant checkout ("Pay Now") or pay later ("Pay at Counter"). (Highly Flexible)
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-2 ml-1">Receipt Printing Settings</label>
                <div className="p-3 bg-gray-50 border border-gray-150 rounded-lg flex items-center justify-between">
                  <div>
                    <span className="block text-xs font-black text-gray-950">Show voided items on receipt</span>
                    <span className="block text-[10px] text-gray-500 mt-0.5 leading-relaxed">
                      If enabled, voided items will be printed on the invoice stamped with a VOID marker.
                    </span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={restaurant.show_voided_on_receipt !== false}
                      onChange={e => setRestaurant({ ...restaurant, show_voided_on_receipt: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-250 opacity-100 rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#FF6B35]"></div>
                  </label>
                </div>
              </div>

              <button
                onClick={updateRestaurantSettings}
                disabled={savingSettings}
                className="w-full mt-2 bg-gray-900 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-black transition-all shadow-md disabled:bg-gray-400 text-xs"
              >
                {savingSettings ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <>
                    <Save size={16} />
                    {t('admin.saveSettings')}
                  </>
                )}
              </button>
            </div>
          </motion.section>
        ) : (
          <motion.section 
            key="payments"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
            id="payment_settings_panel"
          >
            {/* Left/Middle Column (Configurations Panel) */}
            <div className="md:col-span-2 space-y-6">
              
              {!hasPaymentsAccess ? (
                <div className="bg-red-50 border border-red-150 p-4 rounded-xl flex items-start gap-3 text-red-700">
                  <Shield size={18} className="shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-bold text-xs mb-1">Access Restricted</h3>
                    <p className="text-[11px] leading-relaxed">
                      Only Establishments Owners and Directors have credentials-level rights to modify merchant parameters or integrate checkout backends.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-105 space-y-5">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <div>
                      <h2 className="text-sm font-black text-gray-900">Payment Gateway Setup</h2>
                      <p className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">Multi-Tenant Routing Integration</p>
                    </div>
                    
                    {/* Active Checkbox Slider */}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <span className="text-[10px] font-black text-gray-500 uppercase">Provider Active</span>
                      <input
                        type="checkbox"
                        checked={isActiveConfig}
                        onChange={e => setIsActiveConfig(e.target.checked)}
                        className="rounded border-gray-300 text-orange-500 focus:ring-orange-500 h-4 w-4"
                      />
                    </label>
                  </div>

                  {paymentError && (
                    <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600 text-xs font-bold">
                      <AlertCircle size={15} />
                      <span>{paymentError}</span>
                    </div>
                  )}

                  {paymentSuccess && (
                    <div className="p-3 bg-green-50 border border-green-100 rounded-xl flex items-center gap-2 text-green-700 text-xs font-bold">
                      <CheckCircle size={15} />
                      <span>{paymentSuccess}</span>
                    </div>
                  )}

                  {loadingPayments ? (
                    <div className="flex flex-col items-center justify-center py-10 space-y-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-orange-500"></div>
                      <span className="text-xs text-gray-400 font-bold">Loading payment configurations...</span>
                    </div>
                  ) : (
                    <div className="space-y-4 text-xs">
                      {/* Provider Dropdown */}
                      <div>
                        <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">Payment Provider</label>
                        <select
                          value={selectedProvider}
                          onChange={e => setSelectedProvider(e.target.value as any)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 border border-gray-100 focus:bg-white focus:border-orange-500 focus:ring-0 font-bold"
                          id="select_payment_provider"
                        >
                          <option value="stripe">Stripe Checkout</option>
                          <option value="billplz">Billplz (Malaysia FPX/E-Wallet)</option>
                          <option value="senangpay">SenangPay (FPX & Cards)</option>
                          <option value="curlec">Curlec (by Razorpay)</option>
                        </select>
                      </div>

                      {/* Account Type choice */}
                      <div>
                        <label className="block text-[10px] font-black uppercase text-gray-400 mb-2 ml-1">Account & Settlement Mode</label>
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => setAccountType('owner')}
                            className={`p-3 rounded-xl border font-bold text-left transition-all ${
                              accountType === 'owner'
                                ? 'bg-orange-50 border-orange-200 text-orange-700'
                                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                            }`}
                          >
                            <div className="text-xs">Merchant Account (Direct)</div>
                            <div className="text-[10px] font-medium opacity-85 mt-0.5">Funds settle directly into your custom bank account.</div>
                          </button>
                          
                          <button
                            type="button"
                            onClick={() => setAccountType('platform')}
                            className={`p-3 rounded-xl border font-bold text-left transition-all ${
                              accountType === 'platform'
                                ? 'bg-orange-50 border-orange-200 text-orange-700'
                                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                            }`}
                          >
                            <div className="text-xs">JomOrder Account (Managed)</div>
                            <div className="text-[10px] font-medium opacity-85 mt-0.5">We handle payouts, deducting a shared transaction charge.</div>
                          </button>
                        </div>
                      </div>

                      {/* Credentials based on chosen provider */}
                      <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-3.5">
                        <div className="flex items-center gap-1.5 text-xs font-black text-gray-700 uppercase tracking-wider">
                          <Key size={13} />
                          <span>Merchant API Credentials</span>
                        </div>

                        {selectedProvider === 'stripe' && (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[9px] font-black text-gray-400 uppercase mb-1">Stripe Publishable Key</label>
                              <input
                                placeholder="pk_live_..."
                                value={merchantConfig.publishableKey || ""}
                                onChange={e => handleConfigChange('publishableKey', e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 font-mono focus:border-orange-500 focus:ring-0"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-black text-gray-400 uppercase mb-1">Stripe Secret Key</label>
                              <input
                                type="password"
                                placeholder={merchantConfig.secretKey ? "••••••••••••••••••••" : "sk_live_..."}
                                value={merchantConfig.secretKey || ""}
                                onChange={e => handleConfigChange('secretKey', e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 font-mono focus:border-orange-500 focus:ring-0"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-black text-gray-400 uppercase mb-1">Stripe Webhook Secret</label>
                              <input
                                type="password"
                                placeholder={merchantConfig.webhookSecret ? "••••••••••••••••••••" : "whsec_..."}
                                value={merchantConfig.webhookSecret || ""}
                                onChange={e => handleConfigChange('webhookSecret', e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 font-mono focus:border-orange-500 focus:ring-0"
                              />
                              <span className="text-[9px] text-gray-400 leading-normal mt-1 block">
                                Register callback hook to: <code className="bg-white px-1.5 py-0.5 rounded border font-mono text-[8px]">/api/webhooks/stripe</code>
                              </span>
                            </div>
                          </div>
                        )}

                        {selectedProvider === 'billplz' && (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[9px] font-black text-gray-400 uppercase mb-1">Billplz API Secret Key</label>
                              <input
                                type="password"
                                placeholder={merchantConfig.apiKey ? "••••••••••••••••••••" : "billplz_..."}
                                value={merchantConfig.apiKey || ""}
                                onChange={e => handleConfigChange('apiKey', e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 font-mono focus:border-orange-500 focus:ring-0"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-black text-gray-400 uppercase mb-1">Collection ID</label>
                              <input
                                placeholder="Enter Billplz Collection ID"
                                value={merchantConfig.collectionId || ""}
                                onChange={e => handleConfigChange('collectionId', e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 font-mono focus:border-orange-500 focus:ring-0"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-black text-gray-400 uppercase mb-1">Webhook Signature Secret Key</label>
                              <input
                                type="password"
                                placeholder={merchantConfig.webhookSecret ? "••••••••••••••••••••" : "Enter signature token"}
                                value={merchantConfig.webhookSecret || ""}
                                onChange={e => handleConfigChange('webhookSecret', e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 font-mono focus:border-orange-500 focus:ring-0"
                              />
                            </div>
                          </div>
                        )}

                        {selectedProvider === 'senangpay' && (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[9px] font-black text-gray-400 uppercase mb-1">Merchant ID</label>
                              <input
                                placeholder="Format: xxxxxxxxxx"
                                value={merchantConfig.merchantId || ""}
                                onChange={e => handleConfigChange('merchantId', e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 font-mono focus:border-orange-500 focus:ring-0"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-black text-gray-400 uppercase mb-1">Secret Key</label>
                              <input
                                type="password"
                                placeholder={merchantConfig.secretKey ? "••••••••••••••••••••" : "Enter senangPay secretKey"}
                                value={merchantConfig.secretKey || ""}
                                onChange={e => handleConfigChange('secretKey', e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 font-mono focus:border-orange-500 focus:ring-0"
                              />
                            </div>
                          </div>
                        )}

                        {selectedProvider === 'curlec' && (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[9px] font-black text-gray-400 uppercase mb-1">Merchant ID</label>
                              <input
                                placeholder="Enter Curlec Merchant Code"
                                value={merchantConfig.merchantId || ""}
                                onChange={e => handleConfigChange('merchantId', e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 font-mono focus:border-orange-500 focus:ring-0"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-black text-gray-400 uppercase mb-1">API Access Token</label>
                              <input
                                type="password"
                                placeholder={merchantConfig.apiKey ? "••••••••••••••••••••" : "Enter curlec API token"}
                                value={merchantConfig.apiKey || ""}
                                onChange={e => handleConfigChange('apiKey', e.target.value)}
                                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 font-mono focus:border-orange-500 focus:ring-0"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Test Connection Results */}
                      <AnimatePresence>
                        {testResult && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className={`p-3 rounded-lg flex items-center gap-2 font-bold ${
                              testResult.success 
                                ? 'bg-green-50 border border-green-100 text-green-800' 
                                : 'bg-amber-50 border border-amber-100 text-amber-800'
                            }`}
                          >
                            {testResult.success ? <Check size={14} className="shrink-0" /> : <AlertCircle size={14} className="shrink-0" />}
                            <span>{testResult.message}</span>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Action buttons */}
                      <div className="flex gap-3 pt-2">
                        <button
                          type="button"
                          onClick={handleTestConnection}
                          disabled={testingConnection}
                          className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 py-3 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all outline-none"
                          id="btn_test_payment_connection"
                        >
                          {testingConnection ? (
                            <RefreshCw className="animate-spin text-gray-500" size={13} />
                          ) : (
                            <Activity size={13} />
                          )}
                          Test Connection
                        </button>
                        
                        <button
                          type="button"
                          onClick={handleSavePayments}
                          disabled={savingPayments}
                          className="flex-1 bg-gray-900 hover:bg-black text-white py-3 rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all shadow shadow-gray-200"
                          id="btn_save_payment_settings"
                        >
                          {savingPayments ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          ) : (
                            <>
                              <Save size={14} />
                              Save Settings
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right Column (Selective Payment Modes List Checkboxes) */}
            <div className="space-y-6">
              <div className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-105 space-y-4">
                <div>
                  <h3 className="text-xs font-black text-gray-900 uppercase tracking-wide">Enabled Checkout Modes</h3>
                  <p className="text-[10px] text-gray-400 mt-0.5 leading-normal">
                    Select exactly which checkout modes are active for customers of this outlet. Unselected items are hidden from customers.
                  </p>
                </div>

                <div className="space-y-1.5 text-xs">
                  {AVAILABLE_PAYMENT_METHODS.map((method) => {
                    const isSelected = enabledMethods.includes(method.id);
                    return (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => handleMethodToggle(method.id)}
                        className={`w-full p-2.5 rounded-lg border text-left font-bold flex items-center justify-between transition-all ${
                          isSelected
                            ? 'bg-orange-50/50 border-orange-100 text-gray-900 font-extrabold'
                            : 'bg-white border-gray-100 text-gray-400 hover:border-gray-200'
                        }`}
                      >
                        <div className="flex flex-col">
                          <span>{method.label}</span>
                          <span className="text-[8px] opacity-75 uppercase font-medium">{method.type}</span>
                        </div>
                        <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                          isSelected 
                            ? 'bg-[#FF6B35] border-[#FF6B35] text-white' 
                            : 'border-gray-200 bg-gray-50'
                        }`}>
                          {isSelected && <Check size={10} strokeWidth={4} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Pipelines Ready for Future Providers */}
              <div className="bg-[#FAF9F6] rounded-xl p-4 sm:p-5 border border-dashed border-gray-200.5">
                <div className="flex items-start gap-2.5 text-xs text-gray-500">
                  <HelpCircle size={15} className="shrink-0 text-gray-400 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-gray-700 mb-0.5 uppercase tracking-wide text-[9px]">Future Expansion Pipelines</h4>
                    <p className="text-[10px] leading-relaxed">
                      JomOrder adapters for <span className="font-extrabold text-[#FF6B35]">ToyyibPay</span>, <span className="font-extrabold">iPay88</span>, and <span className="font-extrabold">Revenue Monster</span> are currently under sandbox certification. Drop us an alignment note to request early custom activation models.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
