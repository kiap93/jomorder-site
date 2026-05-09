import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Category, MenuItem, Table, Restaurant, ProductType, LanguageCode, ProductGroup } from '../types';
import { Plus, Trash2, Edit2, BarChart2, List, Grid, UtensilsCrossed, Monitor, X, Save, Image as ImageIcon, CheckCircle2, Globe, AlertCircle, ShoppingBag, Settings2, RefreshCw, Zap } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import { TranslationStudio } from '../components/TranslationStudio';

export function AdminPanel() {
  const { restId } = useParams();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [activeTab, setActiveTab] = useState<'menu' | 'categories' | 'tables' | 'analytics' | 'localization' | 'settings'>('menu');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingItem, setEditingItem] = useState<Partial<MenuItem> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  // Analytics states
  const [analyticsData, setAnalyticsData] = useState({
    revenue: 0,
    orders: 0,
    avgTicket: 0,
    topItems: [] as { name: string, count: number, revenue: number }[]
  });
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);

  useEffect(() => {
    if (!restId) return;
    fetchData();
  }, [restId]);

  useEffect(() => {
    setSaveError(null);
    setSettingsError(null);
  }, [activeTab, editingItem]);

  useEffect(() => {
    if (activeTab === 'analytics' && restId) {
      fetchAnalytics();
    }
  }, [activeTab, dateRange, restId]);

  const fetchAnalytics = async () => {
    setIsAnalyticsLoading(true);
    try {
      // Fetch orders in range
      const { data: orders, error } = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', restId)
        .gte('created_at', `${dateRange.start}T00:00:00`)
        .lte('created_at', `${dateRange.end}T23:59:59`);

      if (error) throw error;

      if (orders) {
        const stats = {
          revenue: 0,
          orders: orders.length,
          avgTicket: 0,
          topItems: [] as { name: string, count: number, revenue: number }[]
        };

        const itemMap = new Map<string, { count: number, revenue: number }>();

        orders.forEach(order => {
          stats.revenue += parseFloat(order.total_price);
          
          order.items?.forEach((item: any) => {
            const current = itemMap.get(item.name) || { count: 0, revenue: 0 };
            itemMap.set(item.name, {
              count: current.count + item.quantity,
              revenue: current.revenue + (item.price * item.quantity)
            });
          });
        });

        stats.avgTicket = stats.orders > 0 ? stats.revenue / stats.orders : 0;
        stats.topItems = Array.from(itemMap.entries())
          .map(([name, data]) => ({ name, ...data }))
          .sort((a, b) => b.count - a.count);

        setAnalyticsData(stats);
      }
    } catch (err) {
      console.error("Analytics fetch failed:", err);
    } finally {
      setIsAnalyticsLoading(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [restRes, catsRes, itemsRes, tablesRes] = await Promise.all([
        supabase.from('restaurants').select('*').eq('id', restId).single(),
        supabase.from('categories').select('*').eq('restaurant_id', restId).order('sort_order', { ascending: true }),
        supabase.from('menu_items')
          .select(`
            *,
            groups:product_groups (
              *,
              items:product_group_items (
                *,
                child_product:menu_items (*)
              )
            )
          `)
          .eq('restaurant_id', restId),
        supabase.from('tables').select('*').eq('restaurant_id', restId)
      ]);

      if (restRes.error) throw restRes.error;
      if (itemsRes.error) {
        console.warn("Complex items fetch failed in admin, falling back:", itemsRes.error);
        const simpleRes = await supabase.from('menu_items')
          .select('*')
          .eq('restaurant_id', restId);
        if (simpleRes.error) throw simpleRes.error;
        itemsRes.data = simpleRes.data;
      }

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
        setMenuItems(itemsRes.data.map((i: any) => ({
          id: i.id,
          categoryId: i.category_id,
          name: i.name,
          price: parseFloat(i.price || i.base_price || 0),
          basePrice: parseFloat(i.base_price || i.price || 0),
          imageUrl: i.image_url,
          description: i.description,
          isActive: i.is_active,
          status: i.status || 'Available',
          productType: (i.product_type || 'single') as ProductType,
          groups: i.groups?.map((g: any) => ({
            id: g.id,
            name: g.name,
            description: g.description,
            groupType: g.group_type,
            required: g.required,
            minSelect: g.min_select,
            maxSelect: g.max_select,
            sortOrder: g.sort_order,
            items: g.items?.map((gi: any) => ({
              id: gi.id,
              groupId: gi.group_id,
              childProductId: gi.child_product_id,
              priceDelta: parseFloat(gi.price_delta || 0),
              defaultSelected: gi.default_selected,
              sortOrder: gi.sort_order,
              childProduct: gi.child_product ? {
                id: gi.child_product.id,
                name: gi.child_product.name,
                basePrice: parseFloat(gi.child_product.base_price || 0)
              } : undefined
            }))
          })) || []
        })));
      }

      if (tablesRes.data) {
        setTables(tablesRes.data.map(t => ({ id: t.id, name: t.name, status: t.status })));
      }
    } catch (err: any) {
      console.error("Fetch data failed:", err);
      setError(err.message || "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  const updateRestaurantSettings = async () => {
    if (!restaurant || !restId) return;
    setSavingSettings(true);
    setSettingsError(null);
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
      setSettingsError(err.message || "Failed to save settings");
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
    if (!window.confirm("Are you sure you want to delete this category? Items in this category will remain but will be uncategorized.")) return;
    
    setLoading(true);
    try {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) throw error;
      setCategories(categories.filter(c => c.id !== id));
    } catch (err: any) {
      console.error("Delete category failed:", err);
      alert("Failed to delete category");
    } finally {
      setLoading(false);
    }
  };

  const ensureModifierItems = async (groups: ProductGroup[]) => {
    let modifierCat = categories.find(c => c.name.toUpperCase() === 'MODIFIERS');
    let modCatId = modifierCat?.id;

    if (!modCatId) {
      const { data, error } = await supabase
        .from('categories')
        .insert({ 
          restaurant_id: restId, 
          name: 'MODIFIERS', 
          sort_order: categories.length 
        })
        .select()
        .single();
      
      if (error) throw error;
      modCatId = data.id;
      // We don't update local categories state yet because we'll refetch or it's just for this save
    }

    const updatedGroups = [...groups];

    for (let gIdx = 0; gIdx < updatedGroups.length; gIdx++) {
      const group = updatedGroups[gIdx];
      if (!group.items) continue;

      const updatedItems = [...group.items];
      for (let iIdx = 0; iIdx < updatedItems.length; iIdx++) {
        const item = updatedItems[iIdx];
        
        if (item.customName && !item.childProductId) {
          // Check if this modifier already exists in the MODIFIERS category
          let existingMod = menuItems.find(mi => 
            mi.name.toLowerCase() === item.customName?.toLowerCase() && 
            mi.categoryId === modCatId
          );

          if (!existingMod) {
            const { data, error } = await supabase
              .from('menu_items')
              .insert({
                restaurant_id: restId,
                category_id: modCatId,
                name: item.customName.trim(),
                price: 0,
                base_price: 0,
                is_active: true,
                status: 'Available',
                product_type: 'single'
              })
              .select()
              .single();
            
            if (error) throw error;
            existingMod = data;
          }

          updatedItems[iIdx] = {
            ...item,
            childProductId: existingMod.id,
            childProduct: existingMod as any
          };
        }
      }
      updatedGroups[gIdx] = { ...group, items: updatedItems };
    }

    return updatedGroups;
  };

  const saveMenuItem = async () => {
    setSaveError(null);
    if (!editingItem?.name?.trim()) {
      setSaveError("Please enter a dish name.");
      return;
    }
    if (!editingItem?.categoryId) {
      setSaveError("Please select a category first.");
      return;
    }
    if (editingItem.price === undefined || editingItem.price < 0) {
      setSaveError("Price must be 0 or a positive number.");
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
        setSaveError("Please select or create a category.");
        setLoading(false);
        return;
      }

      const itemData = {
        restaurant_id: restId,
        category_id: finalCategoryId,
        name: editingItem.name.trim(),
        price: editingItem.price || 0,
        base_price: editingItem.price || 0,
        image_url: editingItem.imageUrl || '',
        description: editingItem.description || '',
        is_active: editingItem.isActive !== false,
        status: editingItem.status || 'Available',
        product_type: editingItem.productType || 'single'
      };

      let itemId = editingItem.id;

      // Ensure modifier items exist before proceeding with groups
      let groupsToSave = editingItem.groups || [];
      if (editingItem.productType === 'configurable' && groupsToSave.length > 0) {
        groupsToSave = await ensureModifierItems(groupsToSave);
      }

      if (itemId) {
        const { error } = await supabase.from('menu_items').update(itemData).eq('id', itemId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('menu_items').insert(itemData).select().single();
        if (error) throw error;
        itemId = data.id;
      }

      // Sync Groups and Items
      if (itemId && editingItem.productType !== 'single') {
        // 1. Clean up existing groups (cascade will handle product_group_items)
        const { error: deleteError } = await supabase
          .from('product_groups')
          .delete()
          .eq('product_id', itemId);
        
        if (deleteError) {
          console.error("Failed to clear existing groups:", deleteError);
          throw new Error("Failed to sync product groups: " + deleteError.message);
        }

        // 2. Insert new groups and their items
        if (groupsToSave && groupsToSave.length > 0) {
          for (const group of groupsToSave) {
            const { data: newGroup, error: groupError } = await supabase
              .from('product_groups')
              .insert({
                product_id: itemId,
                name: group.name,
                description: group.description,
                group_type: group.groupType || 'required',
                required: group.required,
                min_select: group.minSelect || 0,
                max_select: group.maxSelect || 1,
                display_behavior: group.displayBehavior || 'only_if_changed',
                sort_order: group.sortOrder || 0
              })
              .select()
              .single();
            
            if (groupError) throw groupError;

            if (group.items && group.items.length > 0) {
              const itemsToInsert = group.items
                .filter(item => item.childProductId && item.childProductId.trim() !== '')
                .map((item, idx) => ({
                  group_id: newGroup.id,
                  child_product_id: item.childProductId,
                  price_delta: item.priceDelta || 0,
                  default_selected: item.defaultSelected || false,
                  display_behavior: item.displayBehavior || null,
                  sort_order: item.sortOrder !== undefined ? item.sortOrder : idx
                }));

              if (itemsToInsert.length > 0) {
                const { error: itemsError } = await supabase.from('product_group_items').insert(itemsToInsert);
                if (itemsError) throw itemsError;
              }
            }
          }
        }
      } else if (itemId && editingItem.productType === 'single') {
        // Ensure groups are cleared for single items
        await supabase.from('product_groups').delete().eq('product_id', itemId);
      }
      
      setEditingItem(null);
      await fetchData();
    } catch (err: any) {
      console.error("Save failed:", err);
      setSaveError(err.message || "Failed to save dish. Please check your permissions.");
    } finally {
      setLoading(false);
    }
  };

  const deleteMenuItem = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this item?")) return;
    
    setLoading(true);
    try {
      const { error } = await supabase.from('menu_items').delete().eq('id', id);
      if (error) throw error;
      setMenuItems(menuItems.filter(i => i.id !== id));
    } catch (err: any) {
      console.error("Delete menu item failed:", err);
      alert("Failed to delete item: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const addTable = async () => {
    const name = prompt("Table Name (e.g. T1)");
    if (!name || !restId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tables')
        .insert({ restaurant_id: restId, name, status: 'available' })
        .select()
        .single();
      
      if (error) throw error;
      if (data) setTables([...tables, { id: data.id, name: data.name, status: data.status }]);
    } catch (err: any) {
      console.error("Add table failed:", err);
      alert("Failed to add table");
    } finally {
      setLoading(false);
    }
  };

  const deleteTable = async (id: string) => {
    if (!window.confirm("Delete this table?")) return;
    
    setLoading(true);
    try {
      const { error } = await supabase.from('tables').delete().eq('id', id);
      if (error) throw error;
      setTables(tables.filter(t => t.id !== id));
    } catch (err: any) {
      console.error("Delete table failed:", err);
      alert("Failed to delete table");
    } finally {
      setLoading(false);
    }
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

  if (loading) return (
    <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
      <p className="text-gray-400 font-bold text-xs uppercase tracking-widest animate-pulse">Initializing Management Studio...</p>
    </div>
  );

  if (error) return (
    <div className="h-[60vh] flex flex-col items-center justify-center p-8 text-center bg-white rounded-[3rem] border border-gray-100 shadow-sm mx-4">
      <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-6 font-black text-4xl">!</div>
      <h2 className="text-2xl font-black text-gray-900 mb-2">Sync Error</h2>
      <p className="text-gray-500 font-medium mb-8 max-w-xs mx-auto">{error}</p>
      <button 
        onClick={() => fetchData()}
        className="bg-gray-900 text-white px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-black transition-all shadow-xl"
      >
        Retry Sync
      </button>
    </div>
  );

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
          { id: 'localization', icon: Globe, label: 'Translations' },
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

      {/* Main Content Area */}
      {activeTab === 'menu' && (
        <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100">
           <div className="flex justify-between items-center mb-8">
            <h2 className="text-xl font-black text-gray-900">Items List</h2>
            <button
              onClick={() => setEditingItem({ categoryId: categories[0]?.id, isActive: true, status: 'Available', groups: [], productType: 'single' })}
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
        <div className="space-y-8">
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h2 className="text-xl font-black text-gray-900 mb-1">Performance Overview</h2>
              <p className="text-gray-500 text-xs font-bold uppercase tracking-widest">Real-time business insights</p>
            </div>
            <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-2xl">
              <div className="flex flex-col">
                <label className="text-[8px] font-black uppercase text-gray-400 px-2">From</label>
                <input 
                  type="date"
                  value={dateRange.start}
                  onChange={e => setDateRange({ ...dateRange, start: e.target.value })}
                  className="bg-transparent border-none focus:ring-0 text-sm font-bold text-gray-700"
                />
              </div>
              <div className="w-px h-8 bg-gray-200" />
              <div className="flex flex-col">
                <label className="text-[8px] font-black uppercase text-gray-400 px-2">To</label>
                <input 
                  type="date"
                  value={dateRange.end}
                  onChange={e => setDateRange({ ...dateRange, end: e.target.value })}
                  className="bg-transparent border-none focus:ring-0 text-sm font-bold text-gray-700"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-gray-100 text-center">
              <div className="text-gray-400 text-[10px] font-black uppercase tracking-widest mb-4">Total Revenue</div>
              <div className="text-4xl font-black text-gray-900">
                {restaurant?.currency} {analyticsData.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-gray-100 text-center">
              <div className="text-gray-400 text-[10px] font-black uppercase tracking-widest mb-4">Total Orders</div>
              <div className="text-4xl font-black text-gray-900">{analyticsData.orders}</div>
            </div>
            <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-gray-100 text-center">
              <div className="text-gray-400 text-[10px] font-black uppercase tracking-widest mb-4">Average Ticket</div>
              <div className="text-4xl font-black text-gray-900">
                {restaurant?.currency} {analyticsData.avgTicket.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          <section className="bg-white rounded-[2.5rem] p-10 shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-10">
              <h2 className="text-xl font-black text-gray-900">Top Selling Items</h2>
              <div className="bg-orange-50 text-orange-600 text-[10px] font-black px-4 py-2 rounded-full uppercase tracking-wider">
                Sorted by Popularity
              </div>
            </div>
            
            {isAnalyticsLoading ? (
              <div className="flex justify-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-600"></div>
              </div>
            ) : analyticsData.topItems.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Rank</th>
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Item Name</th>
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Orders</th>
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {analyticsData.topItems.map((item, idx) => (
                      <tr key={idx} className="group">
                        <td className="py-6">
                          <span className={`w-8 h-8 flex items-center justify-center rounded-xl font-black text-xs ${
                            idx === 0 ? 'bg-orange-100 text-orange-600' : 
                            idx === 1 ? 'bg-gray-100 text-gray-600' :
                            idx === 2 ? 'bg-orange-50 text-orange-400' : 
                            'text-gray-300'
                          }`}>
                            {idx + 1}
                          </span>
                        </td>
                        <td className="py-6 font-black text-gray-900 mb-1">{item.name}</td>
                        <td className="py-6 text-center font-bold text-gray-600 bg-gray-50/0 group-hover:bg-gray-50/50 transition-colors rounded-xl mx-4">{item.count}</td>
                        <td className="py-6 text-right font-black text-gray-900">
                          {restaurant?.currency} {item.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-20 text-center space-y-4">
                <div className="bg-gray-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto text-gray-300">
                  <BarChart2 size={32} />
                </div>
                <div>
                  <p className="font-black text-gray-900">No data found</p>
                  <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mt-1">Try selecting a different date range</p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'settings' && restaurant && (
        <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100 max-w-2xl">
          <h2 className="text-xl font-black text-gray-900 mb-8">Branch Settings</h2>
          
          <AnimatePresence>
            {settingsError && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="mb-8 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600"
              >
                <AlertCircle size={18} />
                <span className="text-sm font-bold">{settingsError}</span>
              </motion.div>
            )}
          </AnimatePresence>

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

      {activeTab === 'localization' && restaurant && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
          <TranslationStudio 
            restaurantId={restaurant.id} 
            menuItems={menuItems} 
            categories={categories} 
          />
        </div>
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
                <button onClick={() => { setEditingItem(null); setSaveError(null); }} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
              </div>
              
              <AnimatePresence>
                {saveError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-red-50 px-8 py-4 flex items-center gap-3 text-red-600 border-b border-red-100"
                  >
                    <AlertCircle size={18} />
                    <span className="text-xs font-bold">{saveError}</span>
                  </motion.div>
                )}
              </AnimatePresence>

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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">Product Type</label>
                    <select
                      value={editingItem.productType || 'single'}
                      onChange={e => setEditingItem({ ...editingItem, productType: e.target.value as any })}
                      className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-0 font-bold mb-2"
                    >
                      <option value="single">Single Item</option>
                      <option value="combo">Combo Meal</option>
                      <option value="configurable">Configurable</option>
                    </select>
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider px-1">
                      {editingItem.productType === 'single' ? '• Standalone product, fixed price, no options' :
                       editingItem.productType === 'combo' ? '• Bundle with selection groups (e.g. Set Lunch)' :
                       '• Single product with modifiers (e.g. Sugar/Ice levels)'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">Status</label>
                    <select
                      value={editingItem.status || 'Available'}
                      onChange={e => setEditingItem({ ...editingItem, status: e.target.value as any })}
                      className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-0 font-bold"
                    >
                      {['Available', 'Low Stock', 'Out of Stock', 'Paused', 'Hidden', 'Scheduled', 'Seasonal'].map(status => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
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

                {editingItem.productType !== 'single' && (
                  <div className={`pt-6 border-t ${editingItem.productType === 'combo' ? 'border-blue-100' : 'border-purple-100'}`}>
                    <div className="flex justify-between items-center mb-6">
                      <div className="flex items-center gap-3">
                        <div className={`p-3 rounded-2xl ${editingItem.productType === 'combo' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                          {editingItem.productType === 'combo' ? <ShoppingBag size={20} /> : <Settings2 size={20} />}
                        </div>
                        <div>
                          <label className="block text-sm font-black uppercase text-gray-900 leading-none">
                            {editingItem.productType === 'combo' ? 'Combo Bundle Engine' : 'Modifier Engine'}
                          </label>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                            {editingItem.productType === 'combo' ? 'Define selectable bundle items' : 'Define customization groups (Sugar, Ice, etc.)'}
                          </p>
                        </div>
                      </div>
                      <button 
                        type="button"
                        onClick={() => {
                          const currentGroups = editingItem.groups || [];
                          setEditingItem({ 
                            ...editingItem, 
                            groups: [...currentGroups, { 
                              id: crypto.randomUUID(),
                              productId: editingItem.id || '',
                              name: editingItem.productType === 'combo' ? 'Choose 1 Side' : 'Sugar Level',
                              groupType: 'required',
                              required: true,
                              minSelect: 1,
                              maxSelect: 1,
                              sortOrder: currentGroups.length,
                              items: []
                            }] 
                          });
                        }}
                        className={`text-xs font-black px-4 py-2.5 rounded-xl transition-all flex items-center gap-2 shadow-sm ${
                          editingItem.productType === 'combo' 
                            ? 'bg-blue-600 text-white hover:bg-blue-700' 
                            : 'bg-purple-600 text-white hover:bg-purple-700'
                        }`}
                      >
                        <Plus size={16} /> Add {editingItem.productType === 'combo' ? 'Selection' : 'Modifier'} Group
                      </button>
                    </div>
                                   <div className="space-y-8">
                      {editingItem.groups?.map((group, groupIdx) => (
                        <div key={groupIdx} className={`p-8 rounded-[2.5rem] border-2 transition-all ${
                          editingItem.productType === 'combo' 
                            ? 'bg-blue-50/30 border-blue-100/50 hover:border-blue-200' 
                            : 'bg-purple-50/30 border-purple-100/50 hover:border-purple-200'
                        }`}>
                          <div className="flex gap-4 items-start mb-6">
                            <div className="flex-1 space-y-4">
                              <div className="flex items-center gap-3">
                                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-white text-[10px] font-black text-gray-400 border border-gray-100">{groupIdx + 1}</span>
                                <input 
                                  value={group.name}
                                  onChange={e => {
                                    const newGroups = [...(editingItem.groups || [])];
                                    newGroups[groupIdx] = { ...newGroups[groupIdx], name: e.target.value };
                                    setEditingItem({ ...editingItem, groups: newGroups });
                                  }}
                                  className="flex-1 bg-white px-5 py-3.5 rounded-2xl border-transparent focus:border-orange-500 focus:ring-0 font-black text-sm uppercase tracking-wider shadow-sm"
                                  placeholder={editingItem.productType === 'combo' ? "e.g. Choose your Side" : "e.g. Ice Level"}
                                />
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div className="space-y-1.5">
                                  <label className="text-[9px] font-black uppercase text-gray-400 ml-2">Type</label>
                                  <select 
                                    value={group.groupType}
                                    onChange={e => {
                                      const newGroups = [...(editingItem.groups || [])];
                                      newGroups[groupIdx] = { ...newGroups[groupIdx], groupType: e.target.value as any };
                                      setEditingItem({ ...editingItem, groups: newGroups });
                                    }}
                                    className="w-full bg-white px-4 py-2.5 rounded-xl border-transparent text-[10px] font-black uppercase tracking-wider shadow-sm"
                                  >
                                    <option value="required">Required</option>
                                    <option value="optional">Optional</option>
                                    <option value="nested">Nested</option>
                                  </select>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[9px] font-black uppercase text-gray-400 ml-2">Display Mode</label>
                                  <select 
                                    value={group.displayBehavior || 'only_if_changed'}
                                    onChange={e => {
                                      const newGroups = [...(editingItem.groups || [])];
                                      newGroups[groupIdx] = { ...newGroups[groupIdx], displayBehavior: e.target.value as any };
                                      setEditingItem({ ...editingItem, groups: newGroups });
                                    }}
                                    className="w-full bg-white px-4 py-2.5 rounded-xl border-transparent text-[10px] font-black uppercase tracking-wider shadow-sm"
                                  >
                                    <option value="always">Always Show</option>
                                    <option value="only_if_changed">Show if Modified</option>
                                    <option value="kitchen_only">Kitchen Only</option>
                                    <option value="receipt_only">Receipt Only</option>
                                    <option value="hidden">Hidden</option>
                                  </select>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[9px] font-black uppercase text-gray-400 ml-2">Min Select</label>
                                  <input 
                                    type="number"
                                    value={group.minSelect}
                                    onChange={e => {
                                      const newGroups = [...(editingItem.groups || [])];
                                      newGroups[groupIdx] = { ...newGroups[groupIdx], minSelect: parseInt(e.target.value) || 0 };
                                      setEditingItem({ ...editingItem, groups: newGroups });
                                    }}
                                    className="w-full bg-white px-4 py-2.5 rounded-xl border-transparent text-[10px] font-black shadow-sm"
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-[9px] font-black uppercase text-gray-400 ml-2">Max Select</label>
                                  <input 
                                    type="number"
                                    value={group.maxSelect}
                                    onChange={e => {
                                      const newGroups = [...(editingItem.groups || [])];
                                      newGroups[groupIdx] = { ...newGroups[groupIdx], maxSelect: parseInt(e.target.value) || 1 };
                                      setEditingItem({ ...editingItem, groups: newGroups });
                                    }}
                                    className="w-full bg-white px-4 py-2.5 rounded-xl border-transparent text-[10px] font-black shadow-sm"
                                  />
                                </div>
                              </div>
                            </div>
                            <button 
                              type="button"
                              onClick={() => {
                                const newGroups = (editingItem.groups || []).filter((_, i) => i !== groupIdx);
                                setEditingItem({ ...editingItem, groups: newGroups });
                              }}
                              className="p-4 text-gray-300 hover:text-red-500 bg-white rounded-2xl shadow-sm hover:shadow-md transition-all mt-1"
                            >
                              <Trash2 size={20} />
                            </button>
                          </div>
                          
                          <div className="space-y-3 pl-6 border-l-2 border-gray-100 ml-3">
                            <label className="text-xs font-black uppercase tracking-[0.2em] text-gray-400 mb-3 block">
                              {editingItem.productType === 'combo' ? 'Available Items' : 'Modifier Options'}
                            </label>
                            
                            <div className="grid gap-2">
                              {group.items?.map((item, itemIdx) => (
                                <div key={itemIdx} className="flex gap-3 items-center bg-white p-3 rounded-2xl shadow-sm border border-gray-50 group/item">
                                  <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-[10px] font-black text-gray-300 group-hover/item:text-orange-500 transition-colors">
                                    {itemIdx + 1}
                                  </div>
                                  <div className="flex-1 flex gap-2">
                                    {editingItem.productType === 'configurable' && !item.childProductId ? (
                                      <input 
                                        value={item.customName || ''}
                                        onChange={e => {
                                          const newGroups = [...(editingItem.groups || [])];
                                          const newItems = [...(newGroups[groupIdx].items || [])];
                                          newItems[itemIdx] = {
                                            ...newItems[itemIdx],
                                            customName: e.target.value
                                          };
                                          newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                          setEditingItem({ ...editingItem, groups: newGroups });
                                        }}
                                        className="flex-1 bg-white border border-purple-200 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider"
                                        placeholder="Modifier Name (e.g. 50% Sugar)"
                                      />
                                    ) : (
                                      <select
                                        value={item.childProductId || ''}
                                        onChange={e => {
                                          const newGroups = [...(editingItem.groups || [])];
                                          const newItems = [...(newGroups[groupIdx].items || [])];
                                          const child = menuItems.find(mi => mi.id === e.target.value);
                                          newItems[itemIdx] = {
                                            ...newItems[itemIdx],
                                            childProductId: e.target.value,
                                            childProduct: child,
                                            customName: undefined
                                          };
                                          newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                          setEditingItem({ ...editingItem, groups: newGroups });
                                        }}
                                        className="flex-1 bg-gray-50 px-4 py-2.5 rounded-xl border-transparent text-[11px] font-black uppercase tracking-wider"
                                      >
                                        <option value="">{editingItem.productType === 'combo' ? 'Choose Item...' : 'Link to Item...'}</option>
                                        {menuItems.filter(mi => mi.id !== editingItem.id).map(mi => (
                                          <option key={mi.id} value={mi.id}>{mi.name}</option>
                                        ))}
                                      </select>
                                    )}
                                    {editingItem.productType === 'configurable' && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const newGroups = [...(editingItem.groups || [])];
                                          const newItems = [...(newGroups[groupIdx].items || [])];
                                          if (item.childProductId) {
                                            newItems[itemIdx] = { ...newItems[itemIdx], childProductId: undefined, customName: item.childProduct?.name || '' };
                                          } else {
                                            newItems[itemIdx] = { ...newItems[itemIdx], childProductId: '' };
                                          }
                                          newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                          setEditingItem({ ...editingItem, groups: newGroups });
                                        }}
                                        className="px-2 text-gray-400 hover:text-purple-600 transition-colors"
                                        title={item.childProductId ? "Switch to Manual Name" : "Switch to Linked Item"}
                                      >
                                        <RefreshCw size={14} />
                                      </button>
                                    )}
                                  </div>
                                  <div className="relative w-28">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-400">+</span>
                                    <input 
                                      type="number"
                                      value={item.priceDelta}
                                      step="0.1"
                                      onChange={e => {
                                        const newGroups = [...(editingItem.groups || [])];
                                        const newItems = [...(newGroups[groupIdx].items || [])];
                                        newItems[itemIdx] = {
                                          ...newItems[itemIdx],
                                          priceDelta: parseFloat(e.target.value) || 0
                                        };
                                        newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                        setEditingItem({ ...editingItem, groups: newGroups });
                                      }}
                                      className="w-full bg-gray-50 pl-7 pr-3 py-2.5 rounded-xl border-transparent text-xs font-mono font-black text-orange-600"
                                      placeholder="0.00"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newGroups = [...(editingItem.groups || [])];
                                      const newItems = [...(newGroups[groupIdx].items || [])];
                                      // If it's a single select group, toggle others off
                                      const isSingleSelect = group.maxSelect === 1;
                                      if (isSingleSelect) {
                                        newItems.forEach((it, i) => it.defaultSelected = i === itemIdx);
                                      } else {
                                        newItems[itemIdx] = { ...newItems[itemIdx], defaultSelected: !item.defaultSelected };
                                      }
                                      newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                      setEditingItem({ ...editingItem, groups: newGroups });
                                    }}
                                    className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase transition-all border-2 ${
                                      item.defaultSelected 
                                        ? 'bg-orange-500 text-white border-orange-500 shadow-sm' 
                                        : 'bg-white text-gray-400 border-gray-100 hover:border-orange-200'
                                    }`}
                                  >
                                    Default
                                  </button>
                                  <select
                                    value={item.displayBehavior || ''}
                                    onChange={e => {
                                      const newGroups = [...(editingItem.groups || [])];
                                      const newItems = [...(newGroups[groupIdx].items || [])];
                                      newItems[itemIdx] = { 
                                        ...newItems[itemIdx], 
                                        displayBehavior: (e.target.value || undefined) as any 
                                      };
                                      newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                      setEditingItem({ ...editingItem, groups: newGroups });
                                    }}
                                    className="bg-gray-50 px-2 py-2 rounded-xl border-transparent text-[8px] font-bold uppercase tracking-tighter w-16"
                                    title="Item-level display behavior override"
                                  >
                                    <option value="">Inherit</option>
                                    <option value="always">Always</option>
                                    <option value="only_if_changed">Change</option>
                                    <option value="hidden">Hide</option>
                                    <option value="kitchen_only">Kitchen</option>
                                  </select>
                                  <button 
                                    type="button"
                                    onClick={() => {
                                      const newGroups = [...(editingItem.groups || [])];
                                      const newItems = (newGroups[groupIdx].items || []).filter((_, i) => i !== itemIdx);
                                      newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                      setEditingItem({ ...editingItem, groups: newGroups });
                                    }}
                                    className="p-2.5 text-gray-200 hover:text-red-400 hover:bg-red-50 rounded-xl transition-all"
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                              ))}
                            </div>

                            <div className="flex gap-2 mt-3">
                              <button 
                                type="button"
                                onClick={() => {
                                  const newGroups = [...(editingItem.groups || [])];
                                  const group = newGroups[groupIdx];
                                  const items = group.items || [];
                                  const newItems = [...items, { 
                                    id: crypto.randomUUID(), 
                                    groupId: group.id || '', 
                                    childProductId: '', 
                                    priceDelta: 0, 
                                    defaultSelected: false, 
                                    sortOrder: items.length 
                                  }];
                                  newGroups[groupIdx] = { ...group, items: newItems };
                                  setEditingItem({ ...editingItem, groups: newGroups });
                                }}
                                className={`flex-1 py-3 rounded-2xl border-2 border-dashed transition-all text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-2 ${
                                  editingItem.productType === 'combo'
                                    ? 'border-blue-100 text-blue-400 hover:border-blue-400 hover:text-blue-600 bg-blue-50/20'
                                    : 'border-purple-100 text-purple-400 hover:border-purple-400 hover:text-purple-600 bg-purple-50/20'
                                }`}
                              >
                                <Plus size={16} /> Add Option
                              </button>
                              
                                  {editingItem.productType === 'configurable' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const input = window.prompt("Enter modifiers separated by commas or new lines (e.g. No Sugar, Less Sugar, Full Sugar)");
                                        if (input) {
                                          const names = input.split(/[,\n]/).map(n => n.trim()).filter(n => n.length > 0);
                                          const newGroups = [...(editingItem.groups || [])];
                                          const items = newGroups[groupIdx].items || [];
                                          const newItems = [...items, ...names.map((name, i) => ({
                                            id: crypto.randomUUID(),
                                            groupId: group.id || '',
                                            customName: name,
                                            priceDelta: 0,
                                            defaultSelected: false,
                                            sortOrder: items.length + i
                                          }))];
                                          newGroups[groupIdx] = { ...group, items: newItems };
                                          setEditingItem({ ...editingItem, groups: newGroups });
                                        }
                                      }}
                                      className="h-full px-4 rounded-2xl bg-gray-900 text-white hover:bg-black transition-all shadow-lg flex items-center justify-center"
                                      title="Quick add modifiers (e.g. Sugar levels)"
                                    >
                                      <Zap size={16} />
                                    </button>
                                  )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
