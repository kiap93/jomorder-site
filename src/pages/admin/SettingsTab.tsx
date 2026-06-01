import { Restaurant } from '../../types';
import { Save, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SettingsTabProps {
  restaurant: Restaurant;
  setRestaurant: (restaurant: Restaurant) => void;
  settingsError: string | null;
  savingSettings: boolean;
  updateRestaurantSettings: () => void;
  t: (key: string) => string;
}

export function SettingsTab({
  restaurant,
  setRestaurant,
  settingsError,
  savingSettings,
  updateRestaurantSettings,
  t
}: SettingsTabProps) {
  return (
    <section className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100 max-w-2xl">
      <h2 className="text-base sm:text-lg font-black text-gray-900 mb-4">{t('admin.branchSettings')}</h2>
      
      <AnimatePresence>
        {settingsError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
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
                placeholder="10"
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
                placeholder="6"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-gray-400">%</span>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.currency')}</label>
          <input
            value={restaurant.currency}
            onChange={e => setRestaurant({ ...restaurant, currency: e.target.value })}
            className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 border border-gray-100 focus:bg-white focus:border-orange-500 focus:ring-0 font-bold font-mono"
            placeholder="RM"
          />
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
    </section>
  );
}
