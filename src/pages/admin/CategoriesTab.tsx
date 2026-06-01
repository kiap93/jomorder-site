import { Category } from '../../types';
import { Plus, X, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CategoriesTabProps {
  categories: Category[];
  isAddingCategory: boolean;
  setIsAddingCategory: (val: boolean) => void;
  newCategoryName: string;
  setNewCategoryName: (val: string) => void;
  addCategory: () => void;
  deleteCategory: (id: string) => void;
  t: (key: string) => string;
}

export function CategoriesTab({
  categories,
  isAddingCategory,
  setIsAddingCategory,
  newCategoryName,
  setNewCategoryName,
  addCategory,
  deleteCategory,
  t
}: CategoriesTabProps) {
  return (
    <section className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-black text-gray-900">{t('admin.categories')}</h2>
        <button
          onClick={() => setIsAddingCategory(true)}
          className="bg-orange-50 text-orange-600 p-2 rounded-xl hover:bg-orange-100 transition-colors"
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <AnimatePresence>
          {isAddingCategory && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-orange-50 p-2.5 rounded-xl border-2 border-dashed border-orange-200 flex gap-2"
            >
              <input
                autoFocus
                value={newCategoryName}
                onChange={e => setNewCategoryName(e.target.value)}
                className="bg-white px-3 rounded-lg flex-1 font-bold text-xs"
                placeholder={t('admin.categoryName')}
              />
              <button onClick={addCategory} className="bg-orange-600 text-white p-1.5 rounded-lg"><Plus size={16} /></button>
              <button onClick={() => setIsAddingCategory(false)} className="text-gray-400 p-1.5"><X size={16} /></button>
            </motion.div>
          )}
        </AnimatePresence>
        {categories.map(cat => (
          <div key={cat.id} className="bg-gray-55 p-2.5 rounded-xl flex justify-between items-center group border border-gray-100 hover:border-orange-100 transition-all text-sm">
            <span className="font-bold text-gray-705">{cat.name}</span>
            <button
              onClick={() => deleteCategory(cat.id)}
              className="text-gray-300 hover:text-red-500 transition-colors"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
