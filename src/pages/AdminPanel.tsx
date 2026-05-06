import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Category, MenuItem, Table, Restaurant } from '../types';
import { Plus, Trash2, Edit2, BarChart2, List, Grid, UtensilsCrossed, Monitor, X, Save, Image as ImageIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';

export function AdminPanel() {
  const { restId } = useParams();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [activeTab, setActiveTab] = useState<'menu' | 'categories' | 'tables' | 'analytics'>('menu');
  const [loading, setLoading] = useState(true);
  
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingItem, setEditingItem] = useState<Partial<MenuItem> | null>(null);

  useEffect(() => {
    if (!restId) return;
    fetchData();
  }, [restId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [restRes, catsRes, itemsRes, tablesRes] = await Promise.all([
        supabase.from('restaurants').select('*').eq('id', restId).single(),
        supabase.from('categories').select('*').eq('restaurant_id', restId).order('sort_order', { ascending: true }),
        supabase.from('menu_items').select('*').eq('restaurant_id', restId),
        supabase.from('tables').select('*').eq('restaurant_id', restId)
      ]);

      if (restRes.data) {
        setRestaurant({
          id: restRes.data.id,
          name: restRes.data.name,
          currency: restRes.data.currency,
          serviceCharge: parseFloat(restRes.data.service_charge),
          sst: parseFloat(restRes.data.sst)
        });
      }

      if (catsRes.data) {
        setCategories(catsRes.data.map(c => ({ id: c.id, name: c.name, order: c.sort_order })));
      }

      if (itemsRes.data) {
        setMenuItems(itemsRes.data.map(i => ({
          id: i.id,
          categoryId: i.category_id,
          name: i.name,
          price: parseFloat(i.price),
          imageUrl: i.image_url,
          description: i.description,
          isActive: i.is_active,
          options: i.options || []
        })));
      }

      if (tablesRes.data) {
        setTables(tablesRes.data.map(t => ({ id: t.id, name: t.name, status: t.status })));
      }
    } catch (err) {
      console.error("Fetch data failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const addCategory = async () => {
    if (!newCategoryName.trim() || !restId) return;
    const { data, error } = await supabase
      .from('categories')
      .insert({
        restaurant_id: restId,
        name: newCategoryName.trim(),
        sort_order: categories.length
      })
      .select()
      .single();

    if (data) {
      setCategories([...categories, { id: data.id, name: data.name, order: data.sort_order }]);
      setNewCategoryName('');
      setIsAddingCategory(false);
    }
  };

  const deleteCategory = async (id: string) => {
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (!error) setCategories(categories.filter(c => c.id !== id));
  };

  const saveMenuItem = async () => {
    if (!editingItem?.name?.trim()) {
      alert("Please enter a dish name.");
      return;
    }
    if (!editingItem?.categoryId) {
      alert("Please select a category first. If you don't have categories, create one in the Categories tab.");
      return;
    }
    if (!restId) return;
    
    setLoading(true);
    try {
      const itemData = {
        restaurant_id: restId,
        category_id: editingItem.categoryId,
        name: editingItem.name.trim(),
        price: editingItem.price || 0,
        image_url: editingItem.imageUrl || '',
        description: editingItem.description || '',
        is_active: editingItem.isActive !== false,
        options: editingItem.options || []
      };

      if (editingItem.id) {
        const { error } = await supabase.from('menu_items').update(itemData).eq('id', editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('menu_items').insert(itemData);
        if (error) throw error;
      }
      
      setEditingItem(null);
      await fetchData();
    } catch (err: any) {
      console.error("Save failed:", err);
      alert(err.message || "Failed to save dish. Please check your permissions.");
    } finally {
      setLoading(false);
    }
  };

  const deleteMenuItem = async (id: string) => {
    const { error } = await supabase.from('menu_items').delete().eq('id', id);
    if (!error) setMenuItems(menuItems.filter(i => i.id !== id));
  };

  const addTable = async () => {
    const name = prompt("Table Name (e.g. T1)");
    if (!name || !restId) return;
    const { data, error } = await supabase
      .from('tables')
      .insert({ restaurant_id: restId, name, status: 'available' })
      .select()
      .single();
    
    if (data) setTables([...tables, { id: data.id, name: data.name, status: data.status }]);
  };

  const deleteTable = async (id: string) => {
    const { error } = await supabase.from('tables').delete().eq('id', id);
    if (!error) setTables(tables.filter(t => t.id !== id));
  };

  if (loading) return <div className="flex justify-center p-20"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div></div>;

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Management</h1>
          <p className="text-gray-500 font-medium">Control center for {restaurant?.name || 'Branch'}</p>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
        {[
          { id: 'menu', icon: UtensilsCrossed, label: 'Menu Items' },
          { id: 'categories', icon: List, label: 'Categories' },
          { id: 'tables', icon: Monitor, label: 'Tables / QR' },
          { id: 'analytics', icon: BarChart2, label: 'Analytics' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all whitespace-nowrap ${
              activeTab === tab.id ? 'bg-gray-900 text-white shadow-xl' : 'bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            <tab.icon size={20} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'menu' && (
        <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100">
           <div className="flex justify-between items-center mb-8">
            <h2 className="text-xl font-black text-gray-900">Items List</h2>
            <button
              onClick={() => setEditingItem({ categoryId: categories[0]?.id, isActive: true, options: [] })}
              className="bg-gray-900 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-black transition-all shadow-lg"
            >
              <Plus size={20} /> Add Dish
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {menuItems.map(item => (
              <div key={item.id} className="bg-white border rounded-3xl overflow-hidden group hover:shadow-md transition-all">
                <div className="h-40 bg-gray-100 relative">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                      <ImageIcon size={40} />
                    </div>
                  )}
                  <div className="absolute top-4 right-4 flex gap-2">
                    <button onClick={() => setEditingItem(item)} className="bg-white/90 backdrop-blur p-2 rounded-xl shadow-sm text-gray-600 hover:text-orange-600"><Edit2 size={16} /></button>
                    <button onClick={() => deleteMenuItem(item.id)} className="bg-white/90 backdrop-blur p-2 rounded-xl shadow-sm text-gray-600 hover:text-red-600"><Trash2 size={16} /></button>
                  </div>
                </div>
                <div className="p-5">
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="font-black text-gray-900">{item.name}</h3>
                    <span className="font-mono font-bold text-orange-600">RM{item.price.toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">
                    {categories.find(c => c.id === item.categoryId)?.name || 'Uncategorized'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'categories' && (
        <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-xl font-black text-gray-900">Categories</h2>
            <button
              onClick={() => setIsAddingCategory(true)}
              className="bg-orange-50 text-orange-600 p-3 rounded-2xl hover:bg-orange-100 transition-colors"
            >
              <Plus size={24} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {isAddingCategory && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-orange-50 p-4 rounded-3xl border-2 border-dashed border-orange-200 flex gap-2"
                >
                  <input
                    autoFocus
                    value={newCategoryName}
                    onChange={e => setNewCategoryName(e.target.value)}
                    className="bg-white px-4 rounded-xl flex-1 font-bold text-sm"
                    placeholder="Category Name"
                  />
                  <button onClick={addCategory} className="bg-orange-600 text-white p-2 rounded-xl"><Plus size={18} /></button>
                  <button onClick={() => setIsAddingCategory(false)} className="text-gray-400 p-2"><X size={18} /></button>
                </motion.div>
              )}
            </AnimatePresence>
            {categories.map(cat => (
              <div key={cat.id} className="bg-gray-50 p-4 rounded-3xl flex justify-between items-center group border border-transparent hover:border-orange-100 transition-all">
                <span className="font-bold text-gray-700">{cat.name}</span>
                <button
                  onClick={() => deleteCategory(cat.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'tables' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {tables.map(table => (
            <div key={table.id} className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
              <div className="mb-6 p-4 bg-white border border-gray-100 rounded-2xl shadow-inner">
                <QRCodeSVG 
                  value={`${window.location.origin}/restaurant/${restId}/table/${table.id}`} 
                  size={150}
                  level="H"
                  includeMargin={true}
                />
              </div>
              <h3 className="font-black text-xl text-gray-900 mb-1">Table {table.name}</h3>
              <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-6">Scan to order</p>
              <div className="flex gap-2 w-full">
                <button onClick={() => deleteTable(table.id)} className="flex-1 p-2 bg-gray-50 text-gray-400 rounded-xl hover:text-red-500 transition-colors"><Trash2 size={16} className="mx-auto" /></button>
              </div>
            </div>
          ))}
          <button 
            onClick={addTable}
            className="border-2 border-dashed border-gray-200 p-8 rounded-3xl flex flex-col items-center justify-center gap-3 text-gray-400 font-bold hover:border-orange-200 hover:text-orange-500 transition-all hover:bg-orange-50/20"
          >
            <Plus size={32} />
            Add Table
          </button>
        </div>
      )}

      {activeTab === 'analytics' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
            <div className="bg-white p-12 rounded-[2.5rem] shadow-sm border border-gray-100">
                <div className="text-gray-400 text-xs font-black uppercase tracking-widest mb-4">Total Revenue Today</div>
                <div className="text-5xl font-black text-gray-900">RM 0</div>
            </div>
            <div className="bg-white p-12 rounded-[2.5rem] shadow-sm border border-gray-100">
                <div className="text-gray-400 text-xs font-black uppercase tracking-widest mb-4">Total Orders</div>
                <div className="text-5xl font-black text-gray-900">0</div>
            </div>
            <div className="bg-white p-12 rounded-[2.5rem] shadow-sm border border-gray-100">
                <div className="text-gray-400 text-xs font-black uppercase tracking-widest mb-4">Average Ticket</div>
                <div className="text-5xl font-black text-gray-900">RM 0</div>
            </div>
        </div>
      )}

      {/* Edit Modal */}
      <AnimatePresence>
        {editingItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[3rem] w-full max-w-xl overflow-hidden shadow-2xl"
            >
              <div className="p-8 border-b flex justify-between items-center">
                <h3 className="text-xl font-black text-gray-900">{editingItem.id ? 'Edit Dish' : 'New Dish'}</h3>
                <button onClick={() => setEditingItem(null)} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
              </div>
              <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto scrollbar-thin">
                <div>
                  <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">Dish Name</label>
                  <input
                    value={editingItem.name || ''}
                    onChange={e => setEditingItem({ ...editingItem, name: e.target.value })}
                    className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-0 font-bold"
                    placeholder="e.g. Nasi Lemak Ayam Goreng"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">Price (MYR)</label>
                    <input
                      type="number"
                      value={editingItem.price || ''}
                      onChange={e => setEditingItem({ ...editingItem, price: parseFloat(e.target.value) })}
                      className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-0 font-bold"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">Category</label>
                    <select
                      value={editingItem.categoryId || ''}
                      onChange={e => setEditingItem({ ...editingItem, categoryId: e.target.value })}
                      className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-0 font-bold"
                    >
                      <option value="">Select Category</option>
                      {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">Image URL</label>
                  <input
                    value={editingItem.imageUrl || ''}
                    onChange={e => setEditingItem({ ...editingItem, imageUrl: e.target.value })}
                    className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-0 font-bold"
                    placeholder="https://images.unsplash.com/..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">Description</label>
                  <textarea
                    value={editingItem.description || ''}
                    onChange={e => setEditingItem({ ...editingItem, description: e.target.value })}
                    className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-0 font-bold h-24"
                    placeholder="Freshly prepared coconut rice with crispy chicken..."
                  />
                </div>
              </div>
              <div className="p-8 bg-gray-50 flex gap-3">
                <button
                  onClick={() => setEditingItem(null)}
                  className="flex-1 px-6 py-4 rounded-2xl font-bold bg-white text-gray-500 hover:bg-gray-100 transition-all border border-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={saveMenuItem}
                  className="flex-1 px-6 py-4 rounded-2xl font-bold bg-gray-900 text-white hover:bg-black transition-all shadow-xl flex items-center justify-center gap-2"
                >
                  <Save size={20} /> Save Product
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
