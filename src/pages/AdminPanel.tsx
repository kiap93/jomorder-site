import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Category, MenuItem, Table, Restaurant } from '../types';
import { Plus, Trash2, Edit2, BarChart2, List, Grid, UtensilsCrossed, Monitor, X, Save, Image as ImageIcon, CheckCircle2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';

export function AdminPanel() {
  const { restId } = useParams();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [activeTab, setActiveTab] = useState<'menu' | 'categories' | 'tables' | 'analytics' | 'settings'>('menu');
  const [loading, setLoading] = useState(true);
  
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingItem, setEditingItem] = useState<Partial<MenuItem> | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

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
          serviceCharge: parseFloat(restRes.data.service_charge || 0),
          sst: parseFloat(restRes.data.sst || 0)
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
          status: i.status || 'Available',
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

  const updateRestaurantSettings = async () => {
    if (!restaurant || !restId) return;
    setSavingSettings(true);
    try {
      const { error } = await supabase
        .from('restaurants')
        .update({
          name: restaurant.name,
          service_charge: restaurant.serviceCharge,
          sst: restaurant.sst,
          currency: restaurant.currency
        })
        .eq('id', restId);

      if (error) throw error;
      setShowSuccessToast(true);
      setTimeout(() => setShowSuccessToast(false), 3000);
    } catch (err: any) {
      console.error("Save settings failed:", err);
      alert(err.message || "Failed to save settings");
    } finally {
      setSavingSettings(false);
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
      alert("Please select a category first.");
      return;
    }
    if (editingItem.price === undefined || editingItem.price < 0) {
      alert("Price must be 0 or a positive number.");
      return;
    }
    if (!restId) return;
    
    setLoading(true);
    try {
      let finalCategoryId = editingItem.categoryId;

      // Handle direct category creation
      if (finalCategoryId === 'CREATE_NEW' && editingItem.newCategoryName?.trim()) {
        const { data: newCat, error: catError } = await supabase
          .from('categories')
          .insert({
            restaurant_id: restId,
            name: editingItem.newCategoryName.trim(),
            sort_order: categories.length
          })
          .select()
          .single();
        
        if (catError) throw catError;
        finalCategoryId = newCat.id;
      }

      if (!finalCategoryId || finalCategoryId === 'CREATE_NEW') {
        alert("Please select or create a category.");
        setLoading(false);
        return;
      }

      const itemData = {
        restaurant_id: restId,
        category_id: finalCategoryId,
        name: editingItem.name.trim(),
        price: editingItem.price || 0,
        image_url: editingItem.imageUrl || '',
        description: editingItem.description || '',
        is_active: editingItem.isActive !== false,
        status: editingItem.status || 'Available',
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

  const updateTableStatus = async (id: string, status: 'available' | 'occupied') => {
    const { error } = await supabase
      .from('tables')
      .update({ status })
      .eq('id', id);
    
    if (!error) {
      setTables(tables.map(t => t.id === id ? { ...t, status } : t));
    }
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
          { id: 'analytics', icon: BarChart2, label: 'Analytics' },
          { id: 'settings', icon: Save, label: 'Settings' }
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
              onClick={() => setEditingItem({ categoryId: categories[0]?.id, isActive: true, status: 'Available', options: [] })}
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
                  <div className="absolute bottom-4 left-4">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm border ${
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
                <div className="p-5">
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="font-black text-gray-900 line-clamp-1">{item.name}</h3>
                    <span className="font-mono font-bold text-orange-600">RM{item.price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-end">
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      {categories.find(c => c.id === item.categoryId)?.name || 'Uncategorized'}
                    </p>
                    {item.description && (
                      <p className="text-[10px] text-gray-400 italic line-clamp-1 max-w-[60%]">{item.description}</p>
                    )}
                  </div>
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
              
              <div className="flex flex-col gap-3 w-full">
                <div className="grid grid-cols-2 gap-2 bg-gray-100 p-1 rounded-2xl">
                  <button
                    onClick={() => updateTableStatus(table.id, 'available')}
                    className={`py-2 rounded-xl text-[10px] font-black uppercase transition-all ${
                      table.status === 'available' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-400'
                    }`}
                  >
                    Available
                  </button>
                  <button
                    onClick={() => updateTableStatus(table.id, 'occupied')}
                    className={`py-2 rounded-xl text-[10px] font-black uppercase transition-all ${
                      table.status === 'occupied' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-400'
                    }`}
                  >
                    Occupied
                  </button>
                </div>
                <button onClick={() => deleteTable(table.id)} className="w-full p-2 bg-gray-50 text-gray-400 rounded-xl hover:text-red-500 transition-colors flex items-center justify-center gap-2">
                  <Trash2 size={14} />
                  <span className="text-[10px] font-bold uppercase">Delete</span>
                </button>
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

      {activeTab === 'settings' && restaurant && (
        <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100 max-w-2xl">
          <h2 className="text-xl font-black text-gray-900 mb-8">Branch Settings</h2>
          <div className="space-y-6">
            <div>
              <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">Restaurant Name</label>
              <input
                value={restaurant.name}
                onChange={e => setRestaurant({ ...restaurant, name: e.target.value })}
                className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-0 font-bold"
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">Service Charge (%)</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    value={restaurant.serviceCharge * 100}
                    onChange={e => setRestaurant({ ...restaurant, serviceCharge: parseFloat(e.target.value) / 100 })}
                    className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-0 font-bold"
                    placeholder="10"
                  />
                  <span className="absolute right-5 top-1/2 -translate-y-1/2 font-bold text-gray-400">%</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">SST (%)</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    value={restaurant.sst * 100}
                    onChange={e => setRestaurant({ ...restaurant, sst: parseFloat(e.target.value) / 100 })}
                    className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-0 font-bold"
                    placeholder="6"
                  />
                  <span className="absolute right-5 top-1/2 -translate-y-1/2 font-bold text-gray-400">%</span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">Currency</label>
              <input
                value={restaurant.currency}
                onChange={e => setRestaurant({ ...restaurant, currency: e.target.value })}
                className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-0 font-bold"
                placeholder="RM"
              />
            </div>

            <button
              onClick={updateRestaurantSettings}
              disabled={savingSettings}
              className="w-full mt-4 bg-gray-900 text-white py-5 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-black transition-all shadow-xl disabled:bg-gray-400"
            >
              {savingSettings ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              ) : (
                <>
                  <Save size={20} />
                  Save Settings
                </>
              )}
            </button>
          </div>
        </section>
      )}

      {/* Edit Modal */}
      <AnimatePresence>
        {showSuccessToast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-8 py-4 rounded-3xl shadow-2xl z-50 flex items-center gap-3 border border-white/10"
          >
            <div className="bg-green-500 rounded-full p-1">
              <CheckCircle2 size={16} className="text-white" />
            </div>
            <span className="font-bold text-sm">Settings saved successfully</span>
          </motion.div>
        )}

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
                      <option value="CREATE_NEW" className="text-orange-600 font-bold">+ Create New Category</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">Status</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {['Available', 'Low Stock', 'Out of Stock', 'Paused', 'Hidden', 'Scheduled', 'Seasonal'].map(status => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setEditingItem({ ...editingItem, status: status as any })}
                        className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border-2 ${
                          editingItem.status === status 
                            ? 'bg-gray-900 text-white border-gray-900 shadow-md' 
                            : 'bg-white text-gray-400 border-gray-100 hover:border-gray-200'
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>

                {editingItem.categoryId === 'CREATE_NEW' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="overflow-hidden"
                  >
                    <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">New Category Name</label>
                    <input
                      autoFocus
                      value={(editingItem as any).newCategoryName || ''}
                      onChange={e => setEditingItem({ ...editingItem, newCategoryName: e.target.value } as any)}
                      className="w-full px-5 py-4 rounded-2xl bg-orange-50 border-2 border-orange-100 focus:bg-white focus:border-orange-500 focus:ring-0 font-bold"
                      placeholder="e.g. Signature Mains"
                    />
                  </motion.div>
                )}
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

                <div className="pt-4 border-t border-gray-100">
                  <div className="flex justify-between items-center mb-4">
                    <label className="block text-sm font-black uppercase text-gray-900 ml-1">Customization Options</label>
                    <button 
                      type="button"
                      onClick={() => {
                        const currentOptions = editingItem.options || [];
                        setEditingItem({ 
                          ...editingItem, 
                          options: [...currentOptions, { name: 'New Option', values: [] }] 
                        });
                      }}
                      className="text-xs font-bold bg-orange-50 text-orange-600 px-3 py-2 rounded-xl hover:bg-orange-100 transition-colors flex items-center gap-1"
                    >
                      <Plus size={14} /> Add Option Group
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    {editingItem.options?.map((opt, optIndex) => (
                      <div key={optIndex} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-3">
                        <div className="flex gap-2">
                          <input 
                            value={opt.name}
                            onChange={e => {
                              const newOptions = [...(editingItem.options || [])];
                              newOptions[optIndex].name = e.target.value;
                              setEditingItem({ ...editingItem, options: newOptions });
                            }}
                            className="flex-1 bg-white px-4 py-2 rounded-xl border-transparent focus:border-orange-500 focus:ring-0 font-bold text-sm"
                            placeholder="Option Name (e.g. Size)"
                          />
                          <button 
                            type="button"
                            onClick={() => {
                              const newOptions = (editingItem.options || []).filter((_, i) => i !== optIndex);
                              setEditingItem({ ...editingItem, options: newOptions });
                            }}
                            className="p-2 text-gray-400 hover:text-red-500"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        
                        <div className="space-y-2">
                          {opt.values.map((val, valIndex) => (
                            <div key={valIndex} className="flex gap-2 items-center">
                              <input 
                                value={val.name}
                                onChange={e => {
                                  const newOptions = [...(editingItem.options || [])];
                                  newOptions[optIndex].values[valIndex].name = e.target.value;
                                  setEditingItem({ ...editingItem, options: newOptions });
                                }}
                                className="flex-1 bg-white px-4 py-2 rounded-xl border-transparent focus:border-orange-500 focus:ring-0 font-bold text-xs"
                                placeholder="Choice name"
                              />
                              <div className="relative w-24">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400">+</span>
                                <input 
                                  type="number"
                                  value={val.priceDelta || 0}
                                  onChange={e => {
                                    const newOptions = [...(editingItem.options || [])];
                                    newOptions[optIndex].values[valIndex].priceDelta = parseFloat(e.target.value) || 0;
                                    setEditingItem({ ...editingItem, options: newOptions });
                                  }}
                                  className="w-full bg-white pl-5 pr-2 py-2 rounded-xl border-transparent focus:border-orange-500 focus:ring-0 font-mono font-bold text-xs text-orange-600"
                                  placeholder="0.00"
                                />
                              </div>
                              <button 
                                type="button"
                                onClick={() => {
                                  const newOptions = [...(editingItem.options || [])];
                                  newOptions[optIndex].values = newOptions[optIndex].values.filter((_, i) => i !== valIndex);
                                  setEditingItem({ ...editingItem, options: newOptions });
                                }}
                                className="p-1 text-gray-300 hover:text-red-400"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                          <button 
                            type="button"
                            onClick={() => {
                              const newOptions = [...(editingItem.options || [])];
                              newOptions[optIndex].values.push({ name: '', priceDelta: 0 });
                              setEditingItem({ ...editingItem, options: newOptions });
                            }}
                            className="w-full py-2 rounded-xl border border-dashed border-gray-200 text-[10px] font-black uppercase text-gray-400 hover:border-orange-200 hover:text-orange-500 transition-all"
                          >
                            + Add Choice
                          </button>
                        </div>
                      </div>
                    ))}
                    
                    {(!editingItem.options || editingItem.options.length === 0) && (
                      <div className="text-center py-6 border-2 border-dashed border-gray-100 rounded-3xl">
                        <p className="text-xs font-bold text-gray-400 italic">No customizations added yet</p>
                      </div>
                    )}
                  </div>
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
