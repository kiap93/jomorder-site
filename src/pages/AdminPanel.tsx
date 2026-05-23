import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { getApiUrl } from '../lib/api';
import { Category, MenuItem, Table, Restaurant, ProductType, LanguageCode, ProductGroup, DisplayBehavior, RenderImportance, ProductGroupItem, Product, VisibilityFlags, ComboGroup, ModifierGroup, DiningSession } from '../types';
import { hasCircularDependency } from '../lib/graphUtils';
import { ProductConfigurator } from '../components/ProductConfigurator';
import { Plus, Trash2, Edit2, BarChart2, List, Grid, UtensilsCrossed, Monitor, X, Save, Image as ImageIcon, CheckCircle2, Globe, AlertCircle, ShoppingBag, Settings2, RefreshCw, Zap, ClipboardList, Users, Shield } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import { TranslationStudio } from '../components/TranslationStudio';
import { useLanguageStore } from '../store/useLanguageStore';

const VisibilityManager = ({ 
  value, 
  onChange 
}: { 
  value?: DisplayBehavior, 
  onChange: (val: DisplayBehavior) => void 
}) => {
  const flags = (typeof value === 'object' && value !== null && 'visible_in' in value) 
    ? (value as { visible_in: VisibilityFlags }).visible_in 
    : {
        menu_listing: true,
        product_configurator: true,
        qr_cart: true,
        kds: true,
        receipt: true
      };

  const toggle = (key: keyof VisibilityFlags) => {
    onChange({
      visible_in: {
        ...flags,
        [key]: !flags[key]
      }
    });
  };

  return (
    <div className="grid grid-cols-5 gap-1 pt-1">
      {(Object.keys(flags) as Array<keyof VisibilityFlags>).map((key) => {
        const enabled = flags[key];
        const label = String(key).split('_')[0];
        return (
          <button
            key={String(key)}
            type="button"
            onClick={() => toggle(key)}
            className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all ${
              enabled 
                ? 'bg-orange-50 border-orange-200 text-orange-600 shadow-sm' 
                : 'bg-white border-gray-100 text-gray-300 hover:border-orange-100'
            }`}
            title={String(key).replace('_', ' ')}
          >
            {key === 'menu_listing' && <List size={11} />}
            {key === 'product_configurator' && <Settings2 size={11} />}
            {key === 'qr_cart' && <ShoppingBag size={11} />}
            {key === 'kds' && <Monitor size={11} />}
            {key === 'receipt' && <UtensilsCrossed size={11} />}
            <span className="text-[7px] font-black uppercase tracking-tighter truncate w-full text-center">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export function AdminPanel() {
  const { t } = useLanguageStore();
  const { restId } = useParams();
  const navigate = useNavigate();
  const { user, profile, loading: loadingAuth } = useAuthStore();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<(Table & { dining_sessions?: DiningSession })[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'menu' | 'categories' | 'tables' | 'analytics' | 'localization' | 'settings' | 'orders' | 'staff'>('menu');
  const [openTableActionsId, setOpenTableActionsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingItem, setEditingItem] = useState<Partial<MenuItem & { newCategoryName?: string }> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  // Staff and Audits states
  const [staffList, setStaffList] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isStaffLoading, setIsStaffLoading] = useState(false);
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<'owner' | 'manager' | 'cashier' | 'kitchen' | 'waiter' | 'runner'>('waiter');
  const [newStaffPermissions, setNewStaffPermissions] = useState<Record<string, boolean>>({
    can_refund: false,
    can_edit_menu: false,
    can_cancel_order: false,
    can_view_analytics: false,
    can_manage_staff: false
  });
  const [editingStaff, setEditingStaff] = useState<any | null>(null);

  const fetchStaffData = async () => {
    if (!restId) return;
    setIsStaffLoading(true);
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const [staffRes, logsRes] = await Promise.all([
        fetch(getApiUrl(`/api/restaurants/${restId}/staff`), {
          headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json()),
        fetch(getApiUrl(`/api/restaurants/${restId}/audit-logs`), {
          headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.json())
      ]);

      if (staffRes && !staffRes.error) setStaffList(staffRes);
      if (logsRes && !logsRes.error) setAuditLogs(logsRes);
    } catch (err) {
      console.error("Failed to load staff list or audit logs:", err);
    } finally {
      setIsStaffLoading(false);
    }
  };

  const handleRoleChangeForNewStaff = (role: string) => {
    setNewStaffRole(role as any);
    const isOwner = role === 'owner';
    const isManager = role === 'manager';
    const isCashier = role === 'cashier';
    setNewStaffPermissions({
      can_refund: isOwner || isManager,
      can_edit_menu: isOwner || isManager,
      can_cancel_order: isOwner || isManager || isCashier,
      can_view_analytics: isOwner || isManager,
      can_manage_staff: isOwner
    });
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaffEmail || !newStaffPassword || !newStaffRole || !restId) return;
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const response = await fetch(getApiUrl(`/api/restaurants/${restId}/staff`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: newStaffEmail,
          password: newStaffPassword,
          role: newStaffRole,
          permissions: newStaffPermissions
        })
      });

      const data = await response.json();
      if (!response.ok) {
        alert(data.error || "Failed to create staff account");
        return;
      }

      setIsAddingStaff(false);
      setNewStaffEmail('');
      setNewStaffPassword('');
      fetchStaffData();
    } catch (err) {
      console.error("Create staff account failed:", err);
    }
  };

  const handleSaveStaffEdit = async () => {
    if (!editingStaff || !restId) return;
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const response = await fetch(getApiUrl(`/api/restaurants/${restId}/staff/${editingStaff.id}`), {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          role: editingStaff.role,
          status: editingStaff.status,
          permissions: editingStaff.permissions
        })
      });

      const data = await response.json();
      if (!response.ok) {
        alert(data.error || "Failed to update staff account");
        return;
      }

      setEditingStaff(null);
      fetchStaffData();
    } catch (err) {
      console.error("Save staff editing failed:", err);
    }
  };

  const handleDeleteStaff = async (staffId: string) => {
    if (!confirm("Are you sure you want to delete this staff member? This will completely wipe their auth account and profile data.")) return;
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const response = await fetch(getApiUrl(`/api/restaurants/${restId}/staff/${staffId}`), {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();
      if (!response.ok) {
        alert(data.error || "Failed to delete staff account.");
        return;
      }

      fetchStaffData();
    } catch (err) {
      console.error("Delete staff failed:", err);
    }
  };

  useEffect(() => {
    if (activeTab === 'staff' && restId) {
      fetchStaffData();
    }
  }, [activeTab, restId]);

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
    if (!restId || loadingAuth) return;
    
    // Safety check: Don't fetch if no user
    if (!user) {
      setLoading(false);
      return;
    }

    fetchData();
  }, [restId, loadingAuth, !!user]);

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
            if (!item || typeof item.price !== 'number' || typeof item.quantity !== 'number') return;
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
    
    // Safety timeout for fetching data
    const timeoutTimer = setTimeout(() => {
      if (loading) {
        console.warn("Data sync is taking longer than expected...");
      }
    }, 15000);

    try {
      console.log(`Starting data sync for restaurant ${restId}...`);
      const startTime = Date.now();
      const token = useAuthStore.getState().token;
      if (!token) return;

      const fetchOptions = {
        headers: { 'Authorization': `Bearer ${token}` }
      };
      
      const [restData, catsData, itemsData, tablesData, ordersData] = await Promise.all([
        fetch(getApiUrl(`/api/restaurants/${restId}`), fetchOptions).then(r => r.json()),
        fetch(getApiUrl(`/api/restaurants/${restId}/categories`), fetchOptions).then(r => r.json()),
        fetch(getApiUrl(`/api/restaurants/${restId}/menu-items`), fetchOptions).then(r => r.json()),
        fetch(getApiUrl(`/api/restaurants/${restId}/tables`), fetchOptions).then(r => r.json()),
        fetch(getApiUrl(`/api/restaurants/${restId}/orders?limit=100`), fetchOptions).then(r => r.json())
      ]);

      const duration = Date.now() - startTime;
      console.log(`Data sync completed in ${duration}ms`);

      clearTimeout(timeoutTimer);

      if (restData.error) throw new Error(restData.error);
      if (catsData.error) throw new Error(catsData.error);
      if (itemsData.error) throw new Error(itemsData.error);
      if (tablesData.error) throw new Error(tablesData.error);
      if (ordersData.error) throw new Error(ordersData.error);
      
      if (restData) {
        setRestaurant({
          id: restData.id,
          name: restData.name,
          currency: restData.currency,
          serviceCharge: parseFloat(restData.service_charge || 0) / 100,
          sst: parseFloat(restData.sst || 0) / 100
        });
      }

      if (catsData) {
        setCategories(catsData.map((c: any) => ({ id: c.id, name: c.name, order: c.sort_order })));
      }

      if (itemsData) {
        setMenuItems(itemsData.map((i: any) => ({
          id: i.id,
          restaurantId: restId,
          categoryId: i.category_id,
          name: i.name,
          price: parseFloat(i.price || i.base_price || 0),
          basePrice: parseFloat(i.base_price || i.price || 0),
          imageUrl: i.image_url,
          description: i.description,
          isActive: i.is_active,
          status: i.status || 'Available',
          productType: (i.product_type || 'single') as ProductType,
          displayBehavior: i.display_behavior,
          comboGroups: (i.combo_groups || []).map((g: any) => ({
            id: g.id,
            productId: g.combo_product_id,
            name: g.name,
            description: g.description,
            required: g.required,
            minSelect: g.min_select,
            maxSelect: g.max_select,
            displayBehavior: g.display_behavior,
            importance: g.importance as RenderImportance,
            sortOrder: g.sort_order,
            items: (g.combo_group_items || []).map((gi: any) => ({
              id: gi.id,
              groupId: gi.group_id,
              childProductId: gi.child_product_id,
              customName: gi.custom_name,
              priceDelta: parseFloat(gi.price_delta || 0),
              defaultSelected: gi.default_selected,
              displayBehavior: gi.display_behavior,
              importance: gi.importance as RenderImportance,
              sortOrder: gi.sort_order,
              childProduct: gi.child_product ? {
                id: gi.child_product.id,
                name: gi.child_product.name,
                basePrice: parseFloat(gi.child_product.base_price || 0),
                productType: gi.child_product.product_type
              } : undefined
            }))
          })),
          modifierGroups: (i.modifier_groups || []).map((g: any) => ({
            id: g.id,
            productId: g.product_id,
            parentModifierId: g.parent_modifier_id,
            name: g.name,
            required: g.required,
            minSelect: g.min_select,
            maxSelect: g.max_select,
            displayBehavior: g.display_behavior,
            sortOrder: g.sort_order,
            modifiers: (g.modifiers || []).map((m: any) => ({
              id: m.id,
              groupId: m.group_id,
              name: m.name,
              priceDelta: parseFloat(m.price_delta || 0),
              isDefault: m.is_default,
              renderImportance: m.render_importance as RenderImportance,
              displayBehavior: m.display_behavior,
              sortOrder: m.sort_order
            }))
          }))
        })));
      }

      if (tablesData) {
        setTables(tablesData.map((t: any) => {
          const rawSession = t.current_session;
          let session = null;
          if (rawSession) {
            session = {
              id: rawSession.id,
              restaurantId: rawSession.restaurant_id,
              tableId: rawSession.table_id,
              sessionToken: rawSession.session_token || '',
              status: rawSession.status,
              startedAt: rawSession.started_at,
              lastActivityAt: rawSession.last_activity_at,
              closedAt: rawSession.closed_at
            };
          }
          return {
            id: t.id,
            name: t.name,
            status: t.status,
            current_session_id: t.current_session_id,
            dining_sessions: session
          };
        }));
      }

      if (ordersData) {
        setOrders(ordersData);
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
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const response = await fetch(getApiUrl(`/api/restaurants/${restId}`), {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: restaurant.name,
          service_charge: restaurant.serviceCharge * 100,
          sst: restaurant.sst * 100,
          currency: restaurant.currency
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to save settings");
      }

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
    const token = useAuthStore.getState().token;
    if (!token) return;

    const response = await fetch(getApiUrl(`/api/categories`), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        restaurant_id: restId,
        name: newCategoryName.trim(),
        sort_order: categories.length
      })
    });

    if (response.ok) {
      const data = await response.json();
      setCategories([...categories, { id: data.id, name: data.name, order: data.sort_order }]);
      setNewCategoryName('');
      setIsAddingCategory(false);
    }
  };

  const deleteCategory = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this category? Items in this category will remain but will be uncategorized.")) return;
    const token = useAuthStore.getState().token;
    if (!token) return;

    setLoading(true);
    try {
      const response = await fetch(getApiUrl(`/api/categories/${id}`), {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("Delete failed");
      setCategories(categories.filter(c => c.id !== id));
    } catch (err: any) {
      console.error("Delete category failed:", err);
      alert("Failed to delete category");
    } finally {
      setLoading(false);
    }
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

    // 🚀 Circular Dependency Protection
    if (editingItem.productType === 'combo' && editingItem.comboGroups) {
      if (hasCircularDependency(editingItem as Product, menuItems)) {
        setSaveError("Configuration Error: Circular dependency detected. A product cannot be a child of itself (directly or indirectly).");
        return;
      }
    }
    
    setLoading(true);
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      let finalCategoryId = editingItem.categoryId;

      // Handle direct category creation
      if (finalCategoryId === 'CREATE_NEW' && editingItem.newCategoryName?.trim()) {
        const catResponse = await fetch(getApiUrl(`/api/categories`), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            restaurant_id: restId,
            name: editingItem.newCategoryName.trim(),
            sort_order: categories.length
          })
        });
        
        if (!catResponse.ok) throw new Error("Category creation failed");
        const newCat = await catResponse.json();
        finalCategoryId = newCat.id;
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

      if (itemId) {
        const response = await fetch(getApiUrl(`/api/menu-items/${itemId}`), {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(itemData)
        });
        if (!response.ok) throw new Error("Update failed");
      } else {
        const response = await fetch(getApiUrl(`/api/menu-items`), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(itemData)
        });
        if (!response.ok) throw new Error("Creation failed");
        const data = await response.json();
        itemId = data.id;
      }

      // Sync Combo Groups
      if (itemId) {
        // Clear old combos and modifiers for safety
        await Promise.all([
          supabase.from('combo_groups').delete().eq('combo_product_id', itemId),
          supabase.from('modifier_groups').delete().eq('product_id', itemId)
        ]);

        if (editingItem.productType === 'combo' && editingItem.comboGroups) {
          for (const group of editingItem.comboGroups) {
            const { data: newGroup, error: groupError } = await supabase
              .from('combo_groups')
              .insert({
                combo_product_id: itemId,
                name: group.name,
                description: group.description,
                required: group.required,
                min_select: group.minSelect || 0,
                max_select: group.maxSelect || 1,
                display_behavior: group.displayBehavior || null,
                importance: group.importance || 'normal',
                sort_order: group.sortOrder || 0
              })
              .select()
              .single();
            
            if (groupError) throw groupError;

            if (group.items && group.items.length > 0) {
              const itemsToInsert = group.items
                .filter(item => item.childProductId)
                .map((item, idx) => ({
                  group_id: newGroup.id,
                  child_product_id: item.childProductId,
                  custom_name: item.customName || null,
                  price_delta: item.priceDelta || 0,
                  default_selected: item.defaultSelected || false,
                  display_behavior: item.displayBehavior || null,
                  importance: item.importance || 'normal',
                  sort_order: item.sortOrder !== undefined ? item.sortOrder : idx
                }));

              if (itemsToInsert.length > 0) {
                await supabase.from('combo_group_items').insert(itemsToInsert);
              }
            }
          }
        } else if (editingItem.productType === 'configurable' && editingItem.modifierGroups) {
          for (const group of editingItem.modifierGroups) {
            const { data: newGroup, error: groupError } = await supabase
              .from('modifier_groups')
              .insert({
                product_id: itemId,
                parent_modifier_id: group.parentModifierId || null,
                name: group.name,
                required: group.required,
                min_select: group.minSelect || 0,
                max_select: group.maxSelect || 1,
                display_behavior: group.displayBehavior || null,
                sort_order: group.sortOrder || 0
              })
              .select()
              .single();
            
            if (groupError) throw groupError;

            if (group.modifiers && group.modifiers.length > 0) {
              const modifiersToInsert = group.modifiers.map((m, idx) => ({
                group_id: newGroup.id,
                name: m.name,
                price_delta: m.priceDelta || 0,
                is_default: m.isDefault || false,
                render_importance: m.renderImportance || 'normal',
                display_behavior: m.displayBehavior || null,
                sort_order: m.sortOrder !== undefined ? m.sortOrder : idx
              }));

              if (modifiersToInsert.length > 0) {
                await supabase.from('modifiers').insert(modifiersToInsert);
              }
            }
          }
        }
      }
      
      setEditingItem(null);
      await fetchData();
    } catch (err: any) {
      console.error("Save failed:", err);
      setSaveError(err.message || "Failed to save dish.");
    } finally {
      setLoading(false);
    }
  };

  const deleteMenuItem = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this item?")) return;
    const token = useAuthStore.getState().token;
    if (!token) return;
    
    setLoading(true);
    try {
      const response = await fetch(getApiUrl(`/api/menu-items/${id}`), {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("Delete failed");
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
    const token = useAuthStore.getState().token;
    if (!token) return;

    setLoading(true);
    try {
      const response = await fetch(getApiUrl(`/api/tables`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ restaurant_id: restId, name, status: 'available' })
      });
      
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      if (data) setTables([...tables, { id: data.id, name: data.name, status: data.status }]);
    } catch (err: any) {
      console.error("Add table failed:", err);
      alert("Failed to add table");
    } finally {
      setLoading(false);
    }
  };

  const deleteTable = async (id: string) => {
    if (!window.confirm("Delete this table? This will invalidate any active sessions.")) return;
    const token = useAuthStore.getState().token;
    if (!token) return;

    setLoading(true);
    try {
      const response = await fetch(getApiUrl(`/api/tables/${id}`), {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("Delete failed");
      setTables(tables.filter(t => t.id !== id));
    } catch (err: any) {
      console.error("Delete table failed:", err);
      alert("Failed to delete table");
    } finally {
      setLoading(false);
    }
  };

  const closeDiningSession = async (session: DiningSession) => {
    if (!window.confirm("Close this dining session? The customer will no longer be able to order using their current link.")) return;
    const token = useAuthStore.getState().token;
    if (!token) return;

    setLoading(true);
    try {
      await fetch(getApiUrl(`/api/dining-sessions/${session.id}`), {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: 'closed', closed_at: new Date().toISOString() })
      });

      // Reset table pointer
      await fetch(getApiUrl(`/api/tables/${session.tableId}`), {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ current_session_id: null, status: 'available' })
      });
      
      await fetchData();
    } catch (err: any) {
      console.error("Close session failed:", err);
      alert("Failed to close session: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateTableStatus = async (id: string, status: 'available' | 'occupied') => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    const response = await fetch(getApiUrl(`/api/tables/${id}`), {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status })
    });
    
    if (response.ok) {
      setTables(tables.map(t => t.id === id ? { ...t, status } : t));
    }
  };

  if (loading) return (
    <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
      <p className="text-gray-400 font-bold text-xs uppercase tracking-widest animate-pulse">{t('admin.initializing')}</p>
      {/* Show retry after 20s if still loading */}
      <button 
        onClick={() => fetchData()}
        className="mt-4 text-[10px] font-black underline uppercase tracking-widest text-zinc-400 hover:text-zinc-600"
      >
        {t('admin.takingLonger')}
      </button>
    </div>
  );

  if (error) return (
    <div className="h-[60vh] flex flex-col items-center justify-center p-8 text-center bg-white rounded-[3rem] border border-gray-100 shadow-sm mx-4">
      <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-6 font-black text-4xl">!</div>
      <h2 className="text-2xl font-black text-gray-900 mb-2">{t('pos.error')}</h2>
      <p className="text-gray-500 font-medium mb-8 max-w-xs mx-auto">{error}</p>
      <button 
        onClick={() => fetchData()}
        className="bg-gray-900 text-white px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-black transition-all shadow-xl"
      >
        {t('admin.retrySync')}
      </button>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">{t('admin.management')}</h1>
          <p className="text-gray-500 font-medium">{t('admin.controlCenter').replace('{name}', restaurant?.name || 'Branch')}</p>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
        {[
          { id: 'menu', icon: UtensilsCrossed, key: 'admin.menuItems' },
          { id: 'categories', icon: List, key: 'admin.categories' },
          { id: 'tables', icon: Monitor, key: 'admin.tablesQR' },
          { id: 'orders', icon: ClipboardList, key: 'admin.orderHistory' },
          { id: 'analytics', icon: BarChart2, key: 'admin.analytics' },
          { id: 'localization', icon: Globe, key: 'admin.translations' },
          { id: 'staff', icon: Users, key: 'admin.staffAudits' },
          { id: 'settings', icon: Save, key: 'admin.settings' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all whitespace-nowrap ${
              activeTab === tab.id ? 'bg-gray-900 text-white shadow-xl' : 'bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            <tab.icon size={20} />
            {t(tab.key)}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      {activeTab === 'menu' && (
        <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100">
           <div className="flex justify-between items-center mb-8">
            <h2 className="text-xl font-black text-gray-900">{t('admin.itemsList')}</h2>
            <button
              onClick={() => setEditingItem({ categoryId: categories[0]?.id, isActive: true, status: 'Available', comboGroups: [], modifierGroups: [], productType: 'single' })}
              className="bg-gray-900 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-black transition-all shadow-lg"
            >
              <Plus size={20} /> {t('admin.addDish')}
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
            <h2 className="text-xl font-black text-gray-900">{t('admin.categories')}</h2>
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
                    placeholder={t('admin.categoryName')}
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
          {tables.map(table => {
            const activeSession = table.dining_sessions;

            return (
              <div key={table.id} className={`p-8 rounded-[2.5rem] shadow-sm border transition-all ${
                activeSession ? 'bg-orange-50/30 border-orange-100' : 'bg-white border-zinc-100'
              }`}>
                <div className="mb-6 bg-white p-4 rounded-3xl shadow-inner border border-zinc-50 flex flex-col items-center">
                  <QRCodeSVG 
                    value={`${window.location.origin}/restaurant/${restId}/table/${table.id}`} 
                    size={150}
                    level="H"
                    includeMargin={true}
                  />
                </div>
                
                <div className="text-center mb-6">
                  <h3 className="font-bold text-xl text-zinc-900 leading-none mb-2">{t('kds.table').replace('{table}', table.name)}</h3>
                  <div className="flex items-center justify-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${activeSession ? 'bg-orange-500 animate-pulse' : 'bg-zinc-200'}`} />
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${activeSession ? 'text-orange-600' : 'text-zinc-400'}`}>
                      {activeSession ? t('admin.activeSession') : t('admin.available')}
                    </span>
                  </div>
                </div>
                
                <div className="flex flex-col gap-3 w-full">
                  {activeSession ? (
                    <div className="space-y-3">
                      <div className="bg-white p-4 rounded-2xl border border-orange-100 shadow-sm">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Started</span>
                          <span className="text-[10px] font-bold text-zinc-600">
                            {new Date(activeSession.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">Token</span>
                          <span className="text-[10px] font-mono font-bold text-orange-600">
                            {activeSession.sessionToken ? `${activeSession.sessionToken.slice(0, 8)}...` : 'N/A'}
                          </span>
                        </div>
                      </div>
                      
                      <button 
                        onClick={() => closeDiningSession(activeSession)}
                        className="w-full h-11 bg-zinc-900 text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-black transition-all flex items-center justify-center gap-2"
                      >
                        <X size={14} />
                        {t('admin.closeSession')}
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 bg-zinc-100 p-1 rounded-xl">
                      <button
                        onClick={() => updateTableStatus(table.id, 'available')}
                        className={`py-2 rounded-lg text-[10px] font-bold uppercase transition-all ${
                          table.status === 'available' ? 'bg-white text-emerald-600 shadow-sm' : 'text-zinc-400 font-medium'
                        }`}
                      >
                        {t('admin.available')}
                      </button>
                      <button
                        onClick={() => updateTableStatus(table.id, 'occupied')}
                        className={`py-2 rounded-lg text-[10px] font-bold uppercase transition-all ${
                          table.status === 'occupied' ? 'bg-white text-orange-600 shadow-sm' : 'text-zinc-400 font-medium'
                        }`}
                      >
                        {t('admin.occupied')}
                      </button>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button 
                      onClick={() => deleteTable(table.id)} 
                      className="flex-1 h-10 rounded-xl bg-zinc-50 text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-all flex items-center justify-center gap-2"
                    >
                      <Trash2 size={13} />
                      <span className="text-[10px] font-bold uppercase">{t('admin.delete')}</span>
                    </button>
                    <div className="relative flex-1">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenTableActionsId(openTableActionsId === table.id ? null : table.id);
                        }}
                        className="w-full h-10 rounded-xl bg-zinc-50 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-all flex items-center justify-center gap-2"
                      >
                        <Settings2 size={13} />
                        <span className="text-[10px] font-bold uppercase">{t('admin.actions')}</span>
                      </button>
                      <AnimatePresence>
                        {openTableActionsId === table.id && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            className="absolute bottom-full right-0 z-[2] p-2 shadow-2xl bg-white rounded-2xl w-48 mb-2 border border-blue-50"
                          >
                            <div className="px-3 py-2 border-b border-gray-50 mb-1">
                              <span className="text-[8px] font-black uppercase tracking-widest text-gray-400">{t('admin.management')}</span>
                            </div>
                            <button 
                              onClick={() => navigate(`/restaurant/${restId}/table/${table.id}`)} 
                              className="w-full text-left text-xs font-bold py-3 px-3 flex items-center gap-2 rounded-xl hover:bg-gray-50 transition-colors"
                            >
                              <Monitor size={14} className="text-zinc-400" />
                              {t('admin.openTablePage')}
                            </button>
                            <button 
                              onClick={() => {
                                setActiveTab('localization');
                                setOpenTableActionsId(null);
                              }} 
                              className="w-full text-left text-xs font-bold py-3 px-3 flex items-center gap-2 rounded-xl hover:bg-gray-50 transition-colors"
                            >
                              <Globe size={14} className="text-zinc-400" />
                              {t('admin.translateMenu')}
                            </button>
                            <button 
                              onClick={() => setOpenTableActionsId(null)}
                              className="w-full text-left text-xs font-bold py-3 px-3 flex items-center gap-2 rounded-xl hover:bg-gray-50 transition-colors"
                            >
                              <Edit2 size={14} className="text-zinc-400" />
                              {t('admin.editDetails')}
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <button 
            onClick={addTable}
            className="border-2 border-dashed border-gray-200 p-8 rounded-3xl flex flex-col items-center justify-center gap-3 text-gray-400 font-bold hover:border-orange-200 hover:text-orange-500 transition-all hover:bg-orange-50/20"
          >
            <Plus size={32} />
            {t('admin.addTable')}
          </button>
        </div>
      )}

      {activeTab === 'orders' && (
        <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100 min-h-[60vh]">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h2 className="text-xl font-black text-gray-900">{t('admin.recentTransactions')}</h2>
              <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mt-1">{t('admin.liveOrderArchive')}</p>
            </div>
            <button
               onClick={() => fetchData()}
               className="p-3 bg-zinc-100 text-zinc-600 rounded-2xl hover:bg-zinc-200"
            >
              <RefreshCw size={20} />
            </button>
          </div>

          <div className="overflow-x-auto -mx-8">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-100">
                  <th className="px-8 py-4 text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest">{t('admin.orderId')}</th>
                  <th className="px-4 py-4 text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest">{t('admin.table')}</th>
                  <th className="px-4 py-4 text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest">{t('admin.items')}</th>
                  <th className="px-4 py-4 text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest">{t('admin.total')}</th>
                  <th className="px-4 py-4 text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest">{t('admin.status')}</th>
                  <th className="px-8 py-4 text-left text-[10px] font-black text-zinc-400 uppercase tracking-widest">{t('admin.time')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {orders.map(order => (
                  <tr key={order.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="px-8 py-4">
                      <span className="font-mono font-bold text-xs text-zinc-400">#{order.id.slice(-6).toUpperCase()}</span>
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-xs font-black text-zinc-900">{t('admin.table')} {order.tables?.name || 'Walk-in'}</span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1">
                        {order.items?.map((item: any, i: number) => (
                          <span key={i} className="text-[10px] font-bold text-zinc-600">
                            {item.quantity}x {item.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="text-xs font-black text-orange-600">RM {(parseFloat(order.total_price) || 0).toFixed(2)}</span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider ${
                        order.status === 'completed' ? 'bg-emerald-50 text-emerald-600' :
                        order.status === 'cancelled' ? 'bg-red-50 text-red-600' :
                        'bg-blue-50 text-blue-600'
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-8 py-4">
                      <span className="text-[10px] font-bold text-zinc-400">
                        {new Date(order.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {orders.length === 0 && (
              <div className="py-20 text-center">
                <div className="bg-zinc-50 w-16 h-16 rounded-3xl flex items-center justify-center text-zinc-300 mx-auto mb-4">
                  <ShoppingBag size={32} />
                </div>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{t('admin.noTransactionsYet')}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === 'analytics' && (
        <div className="space-y-8">
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h2 className="text-xl font-black text-gray-900 mb-1">{t('admin.performanceOverview')}</h2>
              <p className="text-gray-500 text-xs font-bold uppercase tracking-widest">{t('admin.realTimeInsights')}</p>
            </div>
            <div className="flex items-center gap-3 bg-gray-50 p-2 rounded-2xl">
              <div className="flex flex-col">
                <label className="text-[8px] font-black uppercase text-gray-400 px-2">{t('admin.from')}</label>
                <input 
                  type="date"
                  value={dateRange.start}
                  onChange={e => setDateRange({ ...dateRange, start: e.target.value })}
                  className="bg-transparent border-none focus:ring-0 text-sm font-bold text-gray-700"
                />
              </div>
              <div className="w-px h-8 bg-gray-200" />
              <div className="flex flex-col">
                <label className="text-[8px] font-black uppercase text-gray-400 px-2">{t('admin.to')}</label>
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
              <div className="text-gray-400 text-[10px] font-black uppercase tracking-widest mb-4">{t('admin.totalRevenue')}</div>
              <div className="text-4xl font-black text-gray-900">
                {restaurant?.currency} {analyticsData.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-gray-100 text-center">
              <div className="text-gray-400 text-[10px] font-black uppercase tracking-widest mb-4">{t('admin.totalOrders')}</div>
              <div className="text-4xl font-black text-gray-900">{analyticsData.orders}</div>
            </div>
            <div className="bg-white p-10 rounded-[2.5rem] shadow-sm border border-gray-100 text-center">
              <div className="text-gray-400 text-[10px] font-black uppercase tracking-widest mb-4">{t('admin.avgTicket')}</div>
              <div className="text-4xl font-black text-gray-900">
                {restaurant?.currency} {analyticsData.avgTicket.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          <section className="bg-white rounded-[2.5rem] p-10 shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-10">
              <h2 className="text-xl font-black text-gray-900">{t('admin.topSellingItems')}</h2>
              <div className="bg-orange-50 text-orange-600 text-[10px] font-black px-4 py-2 rounded-full uppercase tracking-wider">
                {t('admin.sortedByPopularity')}
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
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('admin.rank')}</th>
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Item Name</th>
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">{t('admin.ordersCount')}</th>
                      <th className="pb-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">{t('admin.revenue')}</th>
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
                  <p className="font-black text-gray-900">{t('admin.noDataFound')}</p>
                  <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mt-1">{t('admin.trySelectingDifferent')}</p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'settings' && restaurant && (
        <section className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-gray-100 max-w-2xl">
          <h2 className="text-xl font-black text-gray-900 mb-8">{t('admin.branchSettings')}</h2>
          
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
              <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">{t('admin.restaurantName')}</label>
              <input
                value={restaurant.name}
                onChange={e => setRestaurant({ ...restaurant, name: e.target.value })}
                className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-0 font-bold"
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">{t('admin.serviceCharge')}</label>
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
                <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">{t('admin.sst')}</label>
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
              <label className="block text-xs font-black uppercase text-gray-400 mb-2 ml-1">{t('admin.currency')}</label>
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
                  {t('admin.saveSettings')}
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

      {activeTab === 'staff' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Left side: Staff List */}
            <div className="md:col-span-2 bg-white rounded-3xl p-8 border border-gray-100 shadow-sm space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-black text-gray-900">{t('admin.staffDirectory')}</h2>
                  <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-1">{t('admin.rbacProfiles')}</p>
                </div>
                <button
                  onClick={fetchStaffData}
                  className="p-3 bg-gray-50 text-gray-700 hover:bg-gray-100 rounded-2xl transition"
                  title="Refresh List"
                >
                  <RefreshCw size={16} className={isStaffLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              {isStaffLoading && staffList.length === 0 ? (
                <div className="flex h-48 items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                </div>
              ) : staffList.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center border-2 border-dashed border-gray-100 rounded-3xl p-6 text-center text-gray-400">
                  <Users size={40} className="mb-2 text-gray-200" />
                  <p className="font-bold text-gray-700">{t('admin.noStaffProfiles')}</p>
                  <p className="text-xs mt-1">{t('admin.createUniqueLogins')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {staffList.map((st: any) => (
                    <div 
                      key={st.id} 
                      className={`p-6 rounded-2xl border transition-all ${
                        st.status === 'suspended' ? 'bg-red-50/40 border-red-100' : 'bg-gray-50/50 border-gray-100 hover:border-gray-200'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-gray-900">{st.email}</span>
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                              st.status === 'suspended' ? 'bg-red-200 text-red-800' : 'bg-green-100 text-green-800'
                            }`}>
                              {st.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs bg-gray-900 text-white font-black px-2 py-0.5 rounded uppercase tracking-wider">
                              {st.role}
                            </span>
                            <span className="text-xs text-gray-400 font-medium font-mono">
                              ID: {st.id.slice(0, 8)}...
                            </span>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingStaff(st)}
                            className="p-2 text-gray-600 hover:bg-gray-100 rounded-xl transition"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteStaff(st.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-xl transition cursor-pointer"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      {/* Display active permissions chips */}
                      {st.permissions && (
                        <div className="mt-4 pt-4 border-t border-gray-200/50 flex flex-wrap gap-1.5">
                          {Object.entries(st.permissions).map(([perm, val]) => (
                            <span 
                              key={perm}
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                val ? 'bg-orange-50 text-orange-700 border border-orange-100' : 'bg-gray-100 text-gray-400'
                              }`}
                            >
                              {perm.replace('can_', '')}: {val ? 'YES' : 'NO'}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right side: Add/Edit Account view */}
            <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm space-y-6 self-start">
              {editingStaff ? (
                <div className="space-y-6">
                  <div>
                    <div className="flex justify-between items-center">
                      <h3 className="text-lg font-black text-gray-900">{t('admin.editSettings')}</h3>
                      <button 
                        onClick={() => setEditingStaff(null)}
                        className="text-gray-400 hover:text-black"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <p className="text-xs text-brand-dark/60 font-medium font-mono truncate mt-1">{editingStaff.email}</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.staffRole')}</label>
                      <select
                        value={editingStaff.role}
                        onChange={e => {
                          const updatedRole = e.target.value;
                          const isO = updatedRole === 'owner';
                          const isM = updatedRole === 'manager';
                          const isC = updatedRole === 'cashier';
                          setEditingStaff({
                            ...editingStaff,
                            role: updatedRole,
                            permissions: {
                              can_refund: isO || isM,
                              can_edit_menu: isO || isM,
                              can_cancel_order: isO || isM || isC,
                              can_view_analytics: isO || isM,
                              can_manage_staff: isO
                            }
                          });
                        }}
                        className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent font-bold capitalize text-sm focus:bg-white focus:border-brand"
                      >
                        {['owner', 'manager', 'cashier', 'kitchen', 'waiter', 'runner'].map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1 font-mono">{t('admin.accountStatus')}</label>
                      <select
                        value={editingStaff.status}
                        onChange={e => setEditingStaff({ ...editingStaff, status: e.target.value as any })}
                        className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent font-bold capitalize text-sm focus:bg-white focus:border-brand"
                      >
                        <option value="active">Active (Access Allowed)</option>
                        <option value="suspended">Suspended (Access Revoked)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-400 mb-2 ml-1">{t('admin.customOverrules')}</label>
                      <div className="space-y-2.5 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                        {Object.entries(editingStaff.permissions || {}).map(([perm, val]) => (
                          <label key={perm} className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!!val}
                              onChange={e => {
                                setEditingStaff({
                                  ...editingStaff,
                                  permissions: {
                                    ...(editingStaff.permissions || {}),
                                    [perm]: e.target.checked
                                  }
                                });
                              }}
                              className="rounded border-gray-300 text-orange-600 focus:ring-orange-500 h-4.5 w-4.5"
                            />
                            <span className="text-xs font-bold text-gray-700 capitalize">{perm.replace(/_/g, ' ')}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2 flex gap-3">
                      <button
                        onClick={() => setEditingStaff(null)}
                        className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs hover:bg-gray-200 transition"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveStaffEdit}
                        className="flex-1 px-4 py-3 bg-gray-900 text-white font-bold rounded-xl text-xs hover:bg-black transition shadow-lg"
                      >
                        {t('admin.saveSettings')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleCreateStaff} className="space-y-4">
                  <div>
                    <h3 className="text-lg font-black text-gray-900">{t('admin.registerStaff')}</h3>
                    <p className="text-xs text-gray-400 mt-1">{t('admin.provisionNewUser')}</p>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1 text-xs">{t('admin.emailAddress')}</label>
                    <input
                      type="email"
                      required
                      placeholder="name@restaurant.com"
                      value={newStaffEmail}
                      onChange={e => setNewStaffEmail(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 font-bold text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1 text-xs">{t('admin.temporalPassword')}</label>
                    <input
                      type="password"
                      required
                      placeholder="Minimum 6 characters"
                      value={newStaffPassword}
                      onChange={e => setNewStaffPassword(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 font-bold text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1 text-xs">{t('admin.staffRole')}</label>
                    <select
                      value={newStaffRole}
                      onChange={e => handleRoleChangeForNewStaff(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-gray-50 border-transparent font-bold capitalize text-xs focus:bg-white focus:border-brand"
                    >
                      {['owner', 'manager', 'cashier', 'kitchen', 'waiter', 'runner'].map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-2 ml-1 text-xs">{t('admin.systemPermissions')}</label>
                    <div className="space-y-2 bg-gray-50 p-4 rounded-xl border border-gray-100">
                      {Object.entries(newStaffPermissions).map(([perm, val]) => (
                        <label key={perm} className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={val}
                            onChange={e => {
                              setNewStaffPermissions({
                                ...newStaffPermissions,
                                [perm]: e.target.checked
                              });
                            }}
                            className="rounded border-gray-355 text-orange-600 focus:ring-orange-500 h-4 w-4"
                          />
                          <span className="text-xs font-bold text-gray-700 capitalize">{perm.replace(/_/g, ' ')}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-orange-600 hover:bg-orange-700 text-white py-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition"
                  >
                    <Plus size={16} />
                    {t('admin.deployStaffAccount')}
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Bottom Section: Audit Trail Hub */}
          <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm space-y-6">
            <div>
              <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <Shield className="text-orange-600" size={24} />
                {t('admin.orgAuditTrail')}
              </h2>
              <p className="text-xs text-gray-400 mt-1">{t('admin.immutableSessionHistory')}</p>
            </div>

            {auditLogs.length === 0 ? (
              <div className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-gray-100 rounded-3xl p-6 text-center text-gray-400">
                <Shield size={32} className="mb-2 text-gray-200" />
                <p className="text-xs font-bold">No Audit Log Data Registered</p>
              </div>
            ) : (
              <div className="border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-[10px] font-black uppercase text-gray-400 tracking-wider">
                      <th className="p-4 pl-6">Timestamp</th>
                      <th className="p-4">Staff Member</th>
                      <th className="p-4">Role</th>
                      <th className="p-4 pr-6">Action / Secure Log Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log: any) => (
                      <tr key={log.id} className="border-b border-gray-150/50 hover:bg-gray-50/50 text-xs">
                        <td className="p-4 pl-6 text-gray-400 font-mono">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td className="p-4 font-bold text-gray-800">
                          {log.user_email}
                          <div className="text-[10px] text-gray-400 font-mono">ID: {log.user_id.slice(0, 8)}...</div>
                        </td>
                        <td className="p-4">
                          <span className="text-[10px] bg-gray-100 text-gray-800 px-2 py-0.5 rounded font-black uppercase tracking-wider">
                            {log.role}
                          </span>
                        </td>
                        <td className="p-4 pr-6 font-bold text-gray-700">
                          {log.action}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
                          if (editingItem.productType === 'combo') {
                            const currentGroups = editingItem.comboGroups || [];
                            setEditingItem({ 
                              ...editingItem, 
                              comboGroups: [...currentGroups, { 
                                id: crypto.randomUUID(),
                                productId: editingItem.id || '',
                                name: 'New Section',
                                required: true,
                                minSelect: 1,
                                maxSelect: 1,
                                sortOrder: currentGroups.length,
                                items: []
                              }] 
                            });
                          } else {
                            const currentGroups = editingItem.modifierGroups || [];
                            setEditingItem({ 
                              ...editingItem, 
                              modifierGroups: [...currentGroups, { 
                                id: crypto.randomUUID(),
                                productId: editingItem.id || '',
                                name: 'New Modifier Group',
                                required: false,
                                minSelect: 0,
                                maxSelect: 1,
                                sortOrder: currentGroups.length,
                                modifiers: []
                              }] 
                            });
                          }
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
                      {(editingItem.productType === 'combo' ? editingItem.comboGroups : editingItem.modifierGroups)?.map((group, groupIdx) => (
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
                                    if (editingItem.productType === 'combo') {
                                      const newGroups = [...(editingItem.comboGroups || [])];
                                      newGroups[groupIdx] = { ...newGroups[groupIdx], name: e.target.value };
                                      setEditingItem({ ...editingItem, comboGroups: newGroups });
                                    } else {
                                      const newGroups = [...(editingItem.modifierGroups || [])];
                                      newGroups[groupIdx] = { ...newGroups[groupIdx], name: e.target.value };
                                      setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                    }
                                  }}
                                  className="flex-1 bg-white px-5 py-3.5 rounded-2xl border-transparent focus:border-orange-500 focus:ring-0 font-black text-sm uppercase tracking-wider shadow-sm"
                                  placeholder={editingItem.productType === 'combo' ? "e.g. Choose your Side" : "e.g. Ice Level"}
                                />
                              </div>
                              <div className="space-y-4">
                                <div className="space-y-1.5">
                                  <label className="text-[9px] font-black uppercase text-gray-400 ml-2">Display Mode</label>
                                  <VisibilityManager 
                                    value={group.displayBehavior}
                                    onChange={val => {
                                      if (editingItem.productType === 'combo') {
                                        const newGroups = [...(editingItem.comboGroups || [])];
                                        newGroups[groupIdx] = { ...newGroups[groupIdx], displayBehavior: val };
                                        setEditingItem({ ...editingItem, comboGroups: newGroups });
                                      } else {
                                        const newGroups = [...(editingItem.modifierGroups || [])];
                                        newGroups[groupIdx] = { ...newGroups[groupIdx], displayBehavior: val };
                                        setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                      }
                                    }}
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1.5">
                                    <label className="text-[9px] font-black uppercase text-gray-400 ml-2">Min Select</label>
                                    <input 
                                      type="number"
                                      value={group.minSelect}
                                      onChange={e => {
                                        if (editingItem.productType === 'combo') {
                                          const newGroups = [...(editingItem.comboGroups || [])];
                                          newGroups[groupIdx] = { ...newGroups[groupIdx], minSelect: parseInt(e.target.value) || 0 };
                                          setEditingItem({ ...editingItem, comboGroups: newGroups });
                                        } else {
                                          const newGroups = [...(editingItem.modifierGroups || [])];
                                          newGroups[groupIdx] = { ...newGroups[groupIdx], minSelect: parseInt(e.target.value) || 0 };
                                          setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                        }
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
                                        if (editingItem.productType === 'combo') {
                                          const newGroups = [...(editingItem.comboGroups || [])];
                                          newGroups[groupIdx] = { ...newGroups[groupIdx], maxSelect: parseInt(e.target.value) || 1 };
                                          setEditingItem({ ...editingItem, comboGroups: newGroups });
                                        } else {
                                          const newGroups = [...(editingItem.modifierGroups || [])];
                                          newGroups[groupIdx] = { ...newGroups[groupIdx], maxSelect: parseInt(e.target.value) || 1 };
                                          setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                        }
                                      }}
                                      className="w-full bg-white px-4 py-2.5 rounded-xl border-transparent text-[10px] font-black shadow-sm"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                            <button 
                              type="button"
                              onClick={() => {
                                if (editingItem.productType === 'combo') {
                                  const newGroups = (editingItem.comboGroups || []).filter((_, i) => i !== groupIdx);
                                  setEditingItem({ ...editingItem, comboGroups: newGroups });
                                } else {
                                  const newGroups = (editingItem.modifierGroups || []).filter((_, i) => i !== groupIdx);
                                  setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                }
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
                              {(editingItem.productType === 'combo' ? (group as ComboGroup).items : (group as ModifierGroup).modifiers)?.map((item: any, itemIdx) => (
                                <div key={itemIdx} className="flex gap-3 items-start bg-white p-4 rounded-3xl shadow-sm border border-gray-50 group/item">
                                  <div className="w-8 h-8 shrink-0 rounded-lg bg-gray-50 flex items-center justify-center text-[10px] font-black text-gray-300 group-hover/item:text-orange-500 transition-colors mt-1">
                                    {itemIdx + 1}
                                  </div>
                                  <div className="flex-1 space-y-2.5">
                                    <div className="flex gap-2 items-center">
                                      {editingItem.productType === 'combo' ? (
                                        <select
                                          value={item.childProductId || ''}
                                          onChange={e => {
                                            const newGroups = [...(editingItem.comboGroups || [])];
                                            const newItems = [...(newGroups[groupIdx].items || [])];
                                            const child = menuItems.find(mi => mi.id === e.target.value);
                                            newItems[itemIdx] = {
                                              ...newItems[itemIdx],
                                              childProductId: e.target.value,
                                              childProduct: child as any
                                            };
                                            newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                            setEditingItem({ ...editingItem, comboGroups: newGroups });
                                          }}
                                          className="flex-1 bg-gray-50 px-4 py-2.5 rounded-xl border-transparent text-[11px] font-black uppercase tracking-wider"
                                        >
                                          <option value="">Choose Item...</option>
                                          {menuItems.filter(mi => mi.id !== editingItem.id).map(mi => (
                                            <option key={mi.id} value={mi.id}>{mi.name}</option>
                                          ))}
                                        </select>
                                      ) : (
                                        <input 
                                          value={item.name || ''}
                                          onChange={e => {
                                            const newGroups = [...(editingItem.modifierGroups || [])];
                                            const newModifiers = [...(newGroups[groupIdx].modifiers || [])];
                                            newModifiers[itemIdx] = {
                                              ...newModifiers[itemIdx],
                                              name: e.target.value
                                            };
                                            newGroups[groupIdx] = { ...newGroups[groupIdx], modifiers: newModifiers };
                                            setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                          }}
                                          className="flex-1 bg-white border border-purple-100 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider shadow-sm"
                                          placeholder="Modifier Name (e.g. 50% Sugar)"
                                        />
                                      )}

                                      <div className="relative w-24 shrink-0">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400">+$</span>
                                        <input 
                                          type="number"
                                          value={item.priceDelta}
                                          step="0.1"
                                          onChange={e => {
                                            if (editingItem.productType === 'combo') {
                                              const newGroups = [...(editingItem.comboGroups || [])];
                                              const newItems = [...(newGroups[groupIdx].items || [])];
                                              newItems[itemIdx] = { ...newItems[itemIdx], priceDelta: parseFloat(e.target.value) || 0 };
                                              newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                              setEditingItem({ ...editingItem, comboGroups: newGroups });
                                            } else {
                                              const newGroups = [...(editingItem.modifierGroups || [])];
                                              const newModifiers = [...(newGroups[groupIdx].modifiers || [])];
                                              newModifiers[itemIdx] = { ...newModifiers[itemIdx], priceDelta: parseFloat(e.target.value) || 0 };
                                              newGroups[groupIdx] = { ...newGroups[groupIdx], modifiers: newModifiers };
                                              setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                            }
                                          }}
                                          className="w-full bg-gray-50 pl-8 pr-3 py-2.5 rounded-xl border-transparent text-xs font-mono font-black text-orange-600"
                                          placeholder="0.00"
                                        />
                                      </div>

                                      <button 
                                        type="button"
                                        onClick={() => {
                                          if (editingItem.productType === 'combo') {
                                            const newGroups = [...(editingItem.comboGroups || [])];
                                            const newItems = (newGroups[groupIdx].items || []).filter((_, i) => i !== itemIdx);
                                            newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                            setEditingItem({ ...editingItem, comboGroups: newGroups });
                                          } else {
                                            const newGroups = [...(editingItem.modifierGroups || [])];
                                            const newModifiers = (newGroups[groupIdx].modifiers || []).filter((_, i) => i !== itemIdx);
                                            newGroups[groupIdx] = { ...newGroups[groupIdx], modifiers: newModifiers };
                                            setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                          }
                                        }}
                                        className="p-2.5 text-gray-200 hover:text-red-400 hover:bg-red-50 rounded-xl transition-all shrink-0"
                                      >
                                        <X size={16} />
                                      </button>
                                    </div>
                                    <div className="space-y-3 pt-2">
                                      <div className="w-full">
                                        <label className="text-[7px] font-black uppercase text-gray-400 ml-1 mb-1 block">Context Visibility</label>
                                        <VisibilityManager
                                          value={item.displayBehavior}
                                          onChange={val => {
                                            if (editingItem.productType === 'combo') {
                                              const newGroups = [...(editingItem.comboGroups || [])];
                                              const newItems = [...(newGroups[groupIdx].items || [])];
                                              newItems[itemIdx] = { ...newItems[itemIdx], displayBehavior: val };
                                              newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                              setEditingItem({ ...editingItem, comboGroups: newGroups });
                                            } else {
                                              const newGroups = [...(editingItem.modifierGroups || [])];
                                              const newModifiers = [...(newGroups[groupIdx].modifiers || [])];
                                              newModifiers[itemIdx] = { ...newModifiers[itemIdx], displayBehavior: val };
                                              newGroups[groupIdx] = { ...newGroups[groupIdx], modifiers: newModifiers };
                                              setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                            }
                                          }}
                                        />
                                      </div>
                                      <div className="flex gap-3 items-end w-full">
                                        <div className="shrink-0">
                                          <label className="text-[7px] font-black uppercase text-gray-400 ml-1 mb-1 block">Importance</label>
                                          <select
                                            value={(item.importance || item.renderImportance) || ''}
                                            onChange={e => {
                                              if (editingItem.productType === 'combo') {
                                                const newGroups = [...(editingItem.comboGroups || [])];
                                                const newItems = [...(newGroups[groupIdx].items || [])];
                                                newItems[itemIdx] = { ...newItems[itemIdx], importance: (e.target.value || undefined) as any };
                                                newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                                setEditingItem({ ...editingItem, comboGroups: newGroups });
                                              } else {
                                                const newGroups = [...(editingItem.modifierGroups || [])];
                                                const newModifiers = [...(newGroups[groupIdx].modifiers || [])];
                                                newModifiers[itemIdx] = { ...newModifiers[itemIdx], renderImportance: (e.target.value || undefined) as any };
                                                newGroups[groupIdx] = { ...newGroups[groupIdx], modifiers: newModifiers };
                                                setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                              }
                                            }}
                                            className="bg-gray-50 px-2 py-2 rounded-xl border-transparent text-[8px] font-bold uppercase tracking-tighter w-20 shrink-0"
                                            title="Importance"
                                          >
                                            <option value="">Imp.</option>
                                            <option value="normal">Norm</option>
                                            <option value="critical">Crit</option>
                                            <option value="silent">Sile</option>
                                          </select>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (editingItem.productType === 'combo') {
                                              const newGroups = [...(editingItem.comboGroups || [])];
                                              const newItems = [...(newGroups[groupIdx].items || [])];
                                              if (group.maxSelect === 1) {
                                                newItems.forEach((it, i) => it.defaultSelected = i === itemIdx);
                                              } else {
                                                newItems[itemIdx] = { ...newItems[itemIdx], defaultSelected: !item.defaultSelected };
                                              }
                                              newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                              setEditingItem({ ...editingItem, comboGroups: newGroups });
                                            } else {
                                              const newGroups = [...(editingItem.modifierGroups || [])];
                                              const newModifiers = [...(newGroups[groupIdx].modifiers || [])];
                                              if (group.maxSelect === 1) {
                                                newModifiers.forEach((it, i) => it.isDefault = i === itemIdx);
                                              } else {
                                                newModifiers[itemIdx] = { ...newModifiers[itemIdx], isDefault: !item.isDefault };
                                              }
                                              newGroups[groupIdx] = { ...newGroups[groupIdx], modifiers: newModifiers };
                                              setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                            }
                                          }}
                                          className={`px-3 py-2 rounded-xl text-[9px] font-black uppercase transition-all border-2 flex-1 h-[34px] flex items-center justify-center ${
                                            (item.defaultSelected || item.isDefault)
                                              ? 'bg-orange-500 text-white border-orange-500 shadow-sm' 
                                              : 'bg-white text-gray-400 border-gray-100 hover:border-orange-200'
                                          }`}
                                        >
                                          {(item.defaultSelected || item.isDefault) ? 'Default' : 'Set Default'}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="flex gap-2 mt-3">
                              <button 
                                type="button"
                                onClick={() => {
                                  if (editingItem.productType === 'combo') {
                                    const newGroups = [...(editingItem.comboGroups || [])];
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
                                    setEditingItem({ ...editingItem, comboGroups: newGroups });
                                  } else {
                                    const newGroups = [...(editingItem.modifierGroups || [])];
                                    const group = newGroups[groupIdx];
                                    const modifiers = group.modifiers || [];
                                    const newModifiers = [...modifiers, { 
                                      id: crypto.randomUUID(), 
                                      groupId: group.id || '', 
                                      name: '', 
                                      priceDelta: 0, 
                                      isDefault: false, 
                                      sortOrder: modifiers.length,
                                      renderImportance: 'normal' as RenderImportance
                                    }];
                                    newGroups[groupIdx] = { ...group, modifiers: newModifiers };
                                    setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                  }
                                }}
                                className={`flex-1 py-3 rounded-2xl border-2 border-dashed transition-all text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-2 ${
                                  editingItem.productType === 'combo'
                                    ? 'border-blue-100 text-blue-400 hover:border-blue-400 hover:text-blue-600 bg-blue-50/20'
                                    : 'border-purple-100 text-purple-400 hover:border-purple-400 hover:text-purple-600 bg-purple-50/20'
                                }`}
                              >
                                <Plus size={16} /> Add {editingItem.productType === 'combo' ? 'Option' : 'Modifier'}
                              </button>
                              
                              {editingItem.productType === 'configurable' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const input = window.prompt("Enter modifiers separated by commas or new lines (e.g. No Sugar, Less Sugar, Full Sugar)");
                                    if (input) {
                                      const names = input.split(/[,\n]/).map(n => n.trim()).filter(n => n.length > 0);
                                      const newGroups = [...(editingItem.modifierGroups || [])];
                                      const modifiers = newGroups[groupIdx].modifiers || [];
                                      const newModifiers = [...modifiers, ...names.map((name, i) => ({
                                        id: crypto.randomUUID(),
                                        groupId: group.id || '',
                                        name: name,
                                        priceDelta: 0,
                                        isDefault: false,
                                        sortOrder: modifiers.length + i,
                                        renderImportance: 'normal' as RenderImportance
                                      }))];
                                      newGroups[groupIdx] = { ...group, modifiers: newModifiers };
                                      setEditingItem({ ...editingItem, modifierGroups: newGroups });
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
