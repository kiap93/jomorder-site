import { MenuItem, Category } from '../../types';
import { Plus, Edit2, Trash2, Image as ImageIcon } from 'lucide-react';

interface MenuTabProps {
  menuItems: MenuItem[];
  categories: Category[];
  setEditingItem: (item: Partial<MenuItem> | null) => void;
  deleteMenuItem: (id: string) => void;
  t: (key: string) => string;
}

export function MenuTab({
  menuItems,
  categories,
  setEditingItem,
  deleteMenuItem,
  t
}: MenuTabProps) {
  return (
    <section className="bg-white rounded-xl p-4 sm:p-5 shadow-sm border border-gray-100">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-black text-gray-900">{t('admin.itemsList')}</h2>
        <button
          onClick={() => setEditingItem({ categoryId: categories[0]?.id, isActive: true, status: 'Available', comboGroups: [], modifierGroups: [], productType: 'single' })}
          className="bg-gray-900 text-white px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-1.5 hover:bg-black transition-all shadow-md"
        >
          <Plus size={16} /> {t('admin.addDish')}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {menuItems.map(item => (
          <div key={item.id} className="bg-white border rounded-xl overflow-hidden group hover:shadow-sm transition-all border-gray-150">
            <div className="h-32 bg-gray-100 relative">
              {item.imageUrl ? (
                <img src={item.imageUrl} className="w-full h-full object-cover" alt="" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-300">
                  <ImageIcon size={30} />
                </div>
              )}
              <div className="absolute top-2 right-2 flex gap-1.5">
                <button onClick={() => setEditingItem(item)} className="bg-white/90 backdrop-blur p-1.5 rounded-lg shadow-sm text-gray-600 hover:text-orange-600 border border-gray-200/50">
                  <Edit2 size={13} />
                </button>
                <button onClick={() => deleteMenuItem(item.id)} className="bg-white/90 backdrop-blur p-1.5 rounded-lg shadow-sm text-gray-600 hover:text-red-600 border border-gray-200/50">
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="absolute bottom-2 left-2">
                <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider shadow-sm border ${
                  item.status === 'Available' ? 'bg-green-500 text-white border-green-400' :
                  item.status === 'Low Stock' ? 'bg-yellow-500 text-white border-yellow-400' :
                  item.status === 'Out of Stock' ? 'bg-red-500 text-white border-red-400' :
                  item.status === 'Paused' ? 'bg-gray-500 text-white border-gray-400' :
                  item.status === 'Hidden' ? 'bg-black text-white border-gray-700' :
                  item.status === 'Scheduled' ? 'bg-blue-500 text-white border-blue-400' :
                  'bg-purple-500 text-white border-purple-400'
                }`}>
                  {item.status}
                </span>
              </div>
            </div>
            <div className="p-3">
              <div className="flex justify-between items-start mb-0.5">
                <h3 className="font-black text-gray-900 line-clamp-1 text-sm">{item.name}</h3>
                <span className="font-mono font-bold text-orange-600 text-xs">RM{item.price.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-end">
                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">
                  {categories.find(c => c.id === item.categoryId)?.name || 'Uncategorized'}
                </p>
                {item.description && (
                  <p className="text-[9px] text-gray-400 italic line-clamp-1 max-w-[60%]">{item.description}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
