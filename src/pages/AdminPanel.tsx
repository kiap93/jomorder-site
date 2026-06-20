import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { getApiUrl, getOrderDisplayNo } from '../lib/api';
import { Category, MenuItem, Table, Restaurant, ProductType, MenuItemStatus, LanguageCode, ProductGroup, DisplayBehavior, RenderImportance, ProductGroupItem, Product, VisibilityFlags, ComboGroup, ComboGroupItem, Modifier, ModifierGroup, DiningSession, Order, WorkspaceMembership, QueueJob, AuditLog, OrderItem } from '../types';
import { hasCircularDependency } from '../lib/graphUtils';
import { ProductConfigurator } from '../components/ProductConfigurator';
import { Plus, Trash2, Edit2, BarChart2, List, Grid, UtensilsCrossed, Monitor, X, Save, Image as ImageIcon, CheckCircle2, Globe, AlertCircle, ShoppingBag, Settings2, RefreshCw, Zap, ClipboardList, Users, Shield, Printer, Download, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import { TranslationStudio } from '../components/TranslationStudio';
import { PrinterManager } from '../components/PrinterManager';
import { useLanguageStore } from '../store/useLanguageStore';
import { offlineService } from '../lib/offlineService';
import { MenuTab } from './admin/MenuTab';
import { CategoriesTab } from './admin/CategoriesTab';
import { TablesTab } from './admin/TablesTab';
import { OrdersTab } from './admin/OrdersTab';
import { AnalyticsTab } from './admin/AnalyticsTab';
import { SettingsTab } from './admin/SettingsTab';
import { StaffTab } from './admin/StaffTab';
import { OfflineSyncTab } from './admin/OfflineSyncTab';
import { MenuImportTab } from './admin/MenuImportTab';
import { FileSpreadsheet } from 'lucide-react';

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

export interface StaffMember {
  id: string;
  email: string;
  role: string;
  status: 'active' | 'suspended';
  permissions?: Record<string, boolean>;
  custom_permissions?: {
    can_refund?: boolean;
    can_edit_menu?: boolean;
    can_cancel_order?: boolean;
    can_manage_staff?: boolean;
    can_view_analytics?: boolean;
  };
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  user_email: string;
  user_id: string;
  role: string;
  action: string;
}

export function AdminPanel() {
  const { t } = useLanguageStore();
  const { restId, activeTab: tabFromUrl } = useParams();
  const navigate = useNavigate();
  const { user, profile, loading: loadingAuth } = useAuthStore();
  const loggedInRole = profile?.role?.toLowerCase();
  const isActualOwner = loggedInRole === 'owner' || loggedInRole === 'admin';
  const hasStaffManagementPermission = !!profile?.permissions?.can_manage_staff;
  const canManageStaff = isActualOwner || hasStaffManagementPermission;

  // Map and translate URL parameters dynamically
  const mapUrlToTab = (urlTab: string | undefined): 'menu' | 'categories' | 'tables' | 'analytics' | 'localization' | 'settings' | 'orders' | 'staff' | 'printers' | 'offline-sync' | 'import-export' => {
    if (!urlTab) return 'menu';
    const tab = urlTab.toLowerCase();
    if (tab === 'staff-audits') return 'staff';
    
    const validTabs: Array<'menu' | 'categories' | 'tables' | 'analytics' | 'localization' | 'settings' | 'orders' | 'staff' | 'printers' | 'offline-sync' | 'import-export'> = [
      'menu', 'categories', 'tables', 'analytics', 'localization', 'settings', 'orders', 'staff', 'printers', 'offline-sync', 'import-export'
    ];
    if (validTabs.includes(tab as any)) {
      return tab as any;
    }
    return 'menu';
  };

  const mapTabToUrl = (tabId: string): string => {
    if (tabId === 'staff') return 'staff-audits';
    return tabId;
  };

  const activeTab = mapUrlToTab(tabFromUrl);
  
  const setActiveTab = (tabId: 'menu' | 'categories' | 'tables' | 'analytics' | 'localization' | 'settings' | 'orders' | 'staff' | 'printers' | 'offline-sync' | 'import-export') => {
    const urlSegment = mapTabToUrl(tabId);
    navigate(`/restaurant/${restId}/admin/${urlSegment}`, { replace: true });
  };

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<(Table & { dining_sessions?: DiningSession })[]>([]);
  const [orders, setOrders] = useState<(Order & { total_price?: string, created_at?: string, tables?: { name: string } })[]>([]);
  const [openTableActionsId, setOpenTableActionsId] = useState<string | null>(null);

  // Offline conflict states
  const [activeConflictPolicy, setActiveConflictPolicy] = useState(offlineService.getConflictPolicy());
  const [conflictLogs, setConflictLogs] = useState(offlineService.getConflictLogs());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [setupCompleted, setSetupCompleted] = useState<boolean>(true);
  const [editingItem, setEditingItem] = useState<Partial<MenuItem & { newCategoryName?: string }> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  // Staff and Audits states
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
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
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);

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

  const handleRoleChangeForNewStaff = (role: 'owner' | 'manager' | 'cashier' | 'kitchen' | 'waiter' | 'runner') => {
    setNewStaffRole(role);
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
    if (!canManageStaff) {
      alert("Unauthorized: You do not have permissions to register staff.");
      return;
    }
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
    if (!canManageStaff) {
      alert("Unauthorized: You do not have permissions to edit staff settings.");
      return;
    }
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
    if (!canManageStaff) {
      alert("Unauthorized: You do not have permissions to delete staff accounts.");
      return;
    }
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
    topItems: [] as { name: string, count: number, revenue: number }[],
    grossSales: 0,
    totalDiscounts: 0,
    discountCount: 0,
    voidedItemsCount: 0,
    voidedAmount: 0,
    discountList: [] as any[],
    voidList: [] as any[]
  });
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);

  useEffect(() => {
    if (!restId || restId === 'undefined' || restId === 'null' || loadingAuth) return;
    
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
      const token = useAuthStore.getState().token;
      if (!token) return;

      const res = await fetch(getApiUrl(`/api/restaurants/${restId}/orders?limit=3000&startDate=${dateRange.start}&endDate=${dateRange.end}`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error(`Analytics API error: ${res.statusText}`);
      }
      const orders = await res.json();

      if (orders) {
        let grossSalesSum = 0;
        let totalDiscountsSum = 0;
        let discountCountSum = 0;
        let voidedItemsCountSum = 0;
        let voidedAmountSum = 0;
        const discountList: any[] = [];
        const voidList: any[] = [];
        let activeOrdersCount = 0;

        const stats = {
          revenue: 0,
          orders: 0,
          avgTicket: 0,
          topItems: [] as { name: string, count: number, revenue: number }[],
          grossSales: 0,
          totalDiscounts: 0,
          discountCount: 0,
          voidedItemsCount: 0,
          voidedAmount: 0,
          discountList: [] as any[],
          voidList: [] as any[]
        };

        const itemMap = new Map<string, { count: number, revenue: number }>();

        orders.forEach((order: any) => {
          const isOrderFullyCancelled = order.status === 'cancelled' || order.voided === true;

          if (isOrderFullyCancelled) {
            order.items?.forEach((item: any) => {
              if (!item || typeof item.quantity !== 'number') return;

              const itemPrice = parseFloat(String(item.originalUnitPrice !== undefined ? item.originalUnitPrice : item.price || 0));
              const optionsTotal = Array.isArray(item.options) ? item.options.reduce((sum: number, opt: any) => sum + (parseFloat(opt.priceDelta) || 0), 0) : 0;
              const fullBasePrice = itemPrice + optionsTotal;
              const itemQuantity = item.quantity;
              const baseSubtotal = fullBasePrice * itemQuantity;

              voidedItemsCountSum += itemQuantity;
              voidedAmountSum += baseSubtotal;
              voidList.push({
                orderId: order.id,
                itemName: item.name,
                amount: baseSubtotal,
                reason: item.voidReason || item.void_reason || order.void_reason || order.voidReason || 'Order Cancelled',
                staff: item.voidedBy || order.voided_by || order.cancelled_by || 'Staff',
                date: item.voidedAt || order.voided_at || order.cancelled_at || order.created_at || new Date().toISOString()
              });
            });
            return;
          }

          activeOrdersCount++;
          const finalPriceSum = parseFloat(String(order.total_price || order.totalPrice || 0));
          stats.revenue += finalPriceSum;
          
          order.items?.forEach((item: any) => {
            if (!item || typeof item.quantity !== 'number') return;
            
            const itemPrice = parseFloat(String(item.originalUnitPrice !== undefined ? item.originalUnitPrice : item.price || 0));
            const optionsTotal = Array.isArray(item.options) ? item.options.reduce((sum: number, opt: any) => sum + (parseFloat(opt.priceDelta) || 0), 0) : 0;
            const fullBasePrice = itemPrice + optionsTotal;
            const itemQuantity = item.quantity;
            const baseSubtotal = fullBasePrice * itemQuantity;

            const isVoided = item.status === 'voided' || item.voided === true;
            const isCancelled = item.status === 'cancelled';

            if (isVoided || isCancelled) {
              voidedItemsCountSum += itemQuantity;
              voidedAmountSum += baseSubtotal;
              voidList.push({
                orderId: order.id,
                itemName: item.name,
                amount: baseSubtotal,
                reason: item.voidReason || item.void_reason || 'Unspecified',
                staff: item.voidedBy || 'Staff',
                date: item.voidedAt || order.created_at || new Date().toISOString()
              });
              return; // Skip accounting for active sales
            }

            // Gross sales
            grossSalesSum += baseSubtotal;

            // Check if there is an item level discount active
            let itemDiscAmt = 0;
            if (item.discount) {
              discountCountSum += 1;
              if (item.discount.type === 'percentage') {
                itemDiscAmt = baseSubtotal * (parseFloat(item.discount.value) / 100);
              } else if (item.discount.type === 'fixed') {
                itemDiscAmt = parseFloat(item.discount.value) * itemQuantity;
              } else if (item.discount.type === 'override') {
                itemDiscAmt = Math.max(0, baseSubtotal - (parseFloat(item.discount.value) * itemQuantity));
              }
              itemDiscAmt = Math.round(itemDiscAmt * 100) / 100;
              totalDiscountsSum += itemDiscAmt;

              discountList.push({
                orderId: order.id,
                itemName: item.name,
                type: item.discount.type,
                value: parseFloat(item.discount.value),
                amount: itemDiscAmt,
                reason: item.discount.reason || 'Manual discount',
                staff: item.discount.discountedBy || 'Staff',
                date: item.discount.discountedAt || order.created_at || new Date().toISOString()
              });
            }

            // Normal pricing compilation for top-selling items
            const finalComputedItemPrice = parseFloat(item.finalUnitPrice !== undefined ? item.finalUnitPrice : (item.price || 0));
            const current = itemMap.get(item.name) || { count: 0, revenue: 0 };
            itemMap.set(item.name, {
              count: current.count + itemQuantity,
              revenue: current.revenue + (finalComputedItemPrice * itemQuantity)
            });
          });
        });

        stats.orders = activeOrdersCount;
        stats.grossSales = grossSalesSum;
        stats.totalDiscounts = totalDiscountsSum;
        stats.discountCount = discountCountSum;
        stats.voidedItemsCount = voidedItemsCountSum;
        stats.voidedAmount = voidedAmountSum;
        stats.discountList = discountList;
        stats.voidList = voidList;

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
    if (!restId || restId === 'undefined' || restId === 'null') {
      setLoading(false);
      return;
    }
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
      
      const [restData, catsData, itemsData, tablesData, ordersData, setupData] = await Promise.all([
        fetch(getApiUrl(`/api/restaurants/${restId}`), fetchOptions).then(r => r.json()),
        fetch(getApiUrl(`/api/restaurants/${restId}/categories`), fetchOptions).then(r => r.json()),
        fetch(getApiUrl(`/api/restaurants/${restId}/menu-items`), fetchOptions).then(r => r.json()),
        fetch(getApiUrl(`/api/restaurants/${restId}/tables`), fetchOptions).then(r => r.json()),
        fetch(getApiUrl(`/api/restaurants/${restId}/orders?limit=100`), fetchOptions).then(r => r.json()),
        fetch(getApiUrl(`/api/setup/progress/${restId}`), fetchOptions).then(r => r.json()).catch(() => ({ completed: true }))
      ]);

      const duration = Date.now() - startTime;
      console.log(`Data sync completed in ${duration}ms`);

      clearTimeout(timeoutTimer);

      if (restData.error) throw new Error(restData.error);
      if (catsData.error) throw new Error(catsData.error);
      if (itemsData.error) throw new Error(itemsData.error);
      if (tablesData.error) throw new Error(tablesData.error);
      if (ordersData.error) throw new Error(ordersData.error);
      
      if (setupData && setupData.completed !== undefined) {
        setSetupCompleted(!!setupData.completed);
      }
      
      if (restData) {
        setRestaurant({
          id: restData.id,
          name: restData.name,
          currency: restData.currency,
          serviceCharge: parseFloat(restData.service_charge || 0) / 100,
          sst: (() => {
            const activeProfile = restData.tax_profiles?.find((tp: any) => tp.is_active);
            if (activeProfile) {
              return parseFloat(activeProfile.tax_rate || 0) / 100;
            }
            return parseFloat(restData.sst || 0) / 100;
          })(),
          payment_mode: restData.payment_mode || 'both',
          show_voided_on_receipt: restData.show_voided_on_receipt !== false,
          business_settings: restData.business_settings
        });

        if (restData.business_settings?.language) {
          useLanguageStore.getState().setLanguage(restData.business_settings.language);
        }
      }

      if (catsData) {
        setCategories(catsData.map((c: Record<string, any>) => ({ id: c.id, name: c.name, order: c.sort_order })));
      }

      if (itemsData) {
        setMenuItems(itemsData.map((i: Record<string, any>) => ({
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
          comboGroups: (i.combo_groups || []).map((g: Record<string, any>) => ({
            id: g.id,
            productId: g.combo_product_id || g.productId,
            name: g.name,
            description: g.description,
            required: g.required,
            minSelect: g.min_select !== undefined ? g.min_select : g.minSelect,
            maxSelect: g.max_select !== undefined ? g.max_select : g.maxSelect,
            displayBehavior: g.display_behavior || g.displayBehavior,
            importance: (g.importance || g.render_importance) as RenderImportance,
            sortOrder: g.sort_order !== undefined ? g.sort_order : g.sortOrder,
            items: (g.items || g.combo_group_items || []).map((gi: Record<string, any>) => ({
              id: gi.id,
              groupId: gi.group_id || gi.groupId,
              childProductId: gi.child_product_id || gi.childProductId,
              customName: gi.custom_name || gi.customName,
              priceDelta: parseFloat(gi.price_delta || gi.priceDelta || 0),
              defaultSelected: gi.default_selected !== undefined ? gi.default_selected : gi.defaultSelected,
              displayBehavior: gi.display_behavior || gi.displayBehavior,
              importance: (gi.importance || gi.render_importance) as RenderImportance,
              sortOrder: gi.sort_order !== undefined ? gi.sort_order : gi.sortOrder,
              childProduct: (gi.child_product || gi.childProduct) ? {
                id: (gi.child_product || gi.childProduct).id,
                name: (gi.child_product || gi.childProduct).name,
                basePrice: parseFloat((gi.child_product || gi.childProduct).base_price || (gi.child_product || gi.childProduct).basePrice || (gi.child_product || gi.childProduct).price || 0),
                productType: (gi.child_product || gi.childProduct).product_type || (gi.child_product || gi.childProduct).productType
              } : undefined
            }))
          })),
          modifierGroups: (i.modifier_groups || []).map((g: Record<string, any>) => ({
            id: g.id,
            productId: g.product_id,
            parentModifierId: g.parent_modifier_id,
            name: g.name,
            required: g.required,
            minSelect: g.min_select,
            maxSelect: g.max_select,
            displayBehavior: g.display_behavior,
            sortOrder: g.sort_order,
            modifiers: (g.modifiers || []).map((m: Record<string, any>) => ({
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
        setTables(tablesData.map((t: Record<string, any>) => {
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
          currency: restaurant.currency,
          payment_mode: restaurant.payment_mode || 'pay_first',
          show_voided_on_receipt: restaurant.show_voided_on_receipt !== false,
          business_settings: restaurant.business_settings
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save settings");
      }

      const updatedVal = await response.json();
      if (updatedVal) {
        setRestaurant({
          id: updatedVal.id,
          name: updatedVal.name,
          currency: updatedVal.currency,
          serviceCharge: parseFloat(updatedVal.service_charge || 0) / 100,
          sst: (() => {
            const activeProfile = updatedVal.tax_profiles?.find((tp: any) => tp.is_active);
            if (activeProfile) {
              return parseFloat(activeProfile.tax_rate || 0) / 100;
            }
            return parseFloat(updatedVal.sst || 0) / 100;
          })(),
          payment_mode: updatedVal.payment_mode || 'both',
          show_voided_on_receipt: updatedVal.show_voided_on_receipt !== false,
          business_settings: updatedVal.business_settings
        });

        if (updatedVal.business_settings?.language) {
          useLanguageStore.getState().setLanguage(updatedVal.business_settings.language);
        }
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

  const downloadQRCode = (tableId: string, tableName: string) => {
    const container = document.getElementById(`qr-container-${tableId}`);
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;

    const svgString = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const blobURL = window.URL.createObjectURL(svgBlob);
    
    const image = new Image();
    image.onload = () => {
      // Create high-res canvas for crystal clear image export
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 700;
      const context = canvas.getContext('2d');
      if (context) {
        // Clear background with white
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        
        // Render QR Code centered
        const qrSize = 420;
        const xOffset = (canvas.width - qrSize) / 2;
        const yOffset = 70;
        context.drawImage(image, xOffset, yOffset, qrSize, qrSize);
        
        // Draw Restaurant Name
        context.shadowColor = 'rgba(0, 0, 0, 0)';
        context.fillStyle = '#a1a1aa'; // zinc-405
        context.font = 'bold 16px Inter, system-ui, sans-serif';
        context.textAlign = 'center';
        context.fillText(restaurant?.name?.toUpperCase() || 'SMART RESTAURANT', canvas.width / 2, 45);

        // Draw Table name and Scan instructions
        context.fillStyle = '#18181b'; // zinc-901
        context.font = '900 36px Inter, system-ui, sans-serif';
        context.fillText(tableName, canvas.width / 2, 535);
        
        context.fillStyle = '#f97316'; // orange-501
        context.font = 'bold 20px Inter, system-ui, sans-serif';
        context.fillText('SCAN TO ORDER & PAY', canvas.width / 2, 580);

        // Footer note
        context.fillStyle = '#a1a1aa'; // zinc-403
        context.font = 'italic 12px Inter, system-ui, sans-serif';
        context.fillText('Please ask staff if you need assistance', canvas.width / 2, 635);

        // Download PNG
        const pngURL = canvas.toDataURL('image/png');
        const downloadLink = document.createElement('a');
        downloadLink.href = pngURL;
        downloadLink.download = `QR_${tableName.replace(/\s+/g, '_')}.png`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
      }
      window.URL.revokeObjectURL(blobURL);
    };
    image.src = blobURL;
  };

  const printQRCode = (tableId: string, tableName: string) => {
    const container = document.getElementById(`qr-container-${tableId}`);
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;

    const svgString = new XMLSerializer().serializeToString(svg);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print the QR code.');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Print QR - ${tableName}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Inter:wght@400;500;700;900&display=swap');
          body {
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            background-color: #ffffff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .ticket {
            width: 80mm;
            min-height: 120mm;
            background: #ffffff;
            border: 1.5px solid #e4e4e7;
            border-radius: 16px;
            padding: 24px;
            box-sizing: border-box;
            text-align: center;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
          }
          .header {
            margin-bottom: 12px;
          }
          .restaurant {
            font-size: 14px;
            font-weight: 950;
            text-transform: uppercase;
            letter-spacing: 2px;
            color: #18181b;
            margin-bottom: 4px;
          }
          .sub {
            font-size: 9px;
            font-weight: 700;
            color: #71717a;
            letter-spacing: 1.5px;
            text-transform: uppercase;
          }
          .qr-wrapper {
            background: #fafafa;
            border: 1px solid #f4f4f5;
            padding: 12px;
            border-radius: 12px;
            margin: 16px 0;
            display: flex;
            justify-content: center;
            align-items: center;
          }
          .qr-wrapper svg {
            width: 140mm;
            height: auto;
            max-width: 100%;
          }
          .table-info {
            margin-top: 12px;
          }
          .table-name {
            font-family: 'Space Grotesk', 'Inter', sans-serif;
            font-size: 28px;
            font-weight: 900;
            color: #18181b;
            letter-spacing: -1px;
            margin-bottom: 4px;
          }
          .instructions {
            font-size: 10px;
            font-weight: 700;
            color: #f97316;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            margin-bottom: 16px;
          }
          .footer {
            font-size: 8px;
            color: #a1a1aa;
            text-transform: uppercase;
            letter-spacing: 1px;
            border-top: 1px dashed #e4e4e7;
            width: 100%;
            padding-top: 12px;
          }
          @media print {
            body {
              background-color: #ffffff;
            }
            .ticket {
              border: none;
              box-shadow: none;
              padding: 10px;
              width: 100%;
              height: auto;
            }
          }
        </style>
      </head>
      <body>
        <div class="ticket">
          <div class="header">
            <div class="restaurant">${restaurant?.name || 'WELCOME'}</div>
            <div class="sub">Order & Pay At Your Table</div>
          </div>
          
          <div class="qr-wrapper">
            ${svgString}
          </div>
          
          <div class="table-info">
            <div class="table-name">${tableName}</div>
            <div class="instructions">← SCAN TO ORDER & PAY →</div>
          </div>
          
          <div class="footer">
            Thank you for dining with us
          </div>
        </div>
        <script>
          window.addEventListener('load', () => {
            setTimeout(() => {
              window.print();
              window.close();
            }, 400);
          });
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const printAllQRCodes = () => {
    if (tables.length === 0) return;
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print QR codes.');
      return;
    }

    let ticketsHTML = '';
    
    for (const table of tables) {
      const container = document.getElementById(`qr-container-${table.id}`);
      if (!container) continue;
      const svg = container.querySelector('svg');
      if (!svg) continue;
      
      const svgString = new XMLSerializer().serializeToString(svg);
      ticketsHTML += `
        <div class="ticket">
          <div class="header">
            <div class="restaurant">${restaurant?.name || 'WELCOME'}</div>
            <div class="sub">Order & Pay At Your Table</div>
          </div>
          
          <div class="qr-wrapper">
            ${svgString}
          </div>
          
          <div class="table-info">
            <div class="table-name">Table ${table.name}</div>
            <div class="instructions">← SCAN TO ORDER & PAY →</div>
          </div>
          
          <div class="footer">
            Thank you for dining with us
          </div>
        </div>
      `;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Print All Table QR Codes</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Inter:wght@400;500;700;900&display=swap');
          body {
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            background-color: #f4f4f5;
            font-family: 'Inter', system-ui, sans-serif;
          }
          .page-header-tip {
            background: #181c24;
            color: white;
            padding: 12px 24px;
            font-size: 11px;
            font-weight: bold;
            text-align: center;
            width: 100%;
            box-sizing: border-box;
            text-transform: uppercase;
            letter-spacing: 1.5px;
          }
          .ticket {
            width: 80mm;
            min-height: 120mm;
            background: #ffffff;
            border: 1px solid #e4e4e7;
            border-radius: 16px;
            padding: 24px;
            box-sizing: border-box;
            text-align: center;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: center;
            margin: 20px auto;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
            page-break-after: always;
          }
          .header {
            margin-bottom: 12px;
          }
          .restaurant {
            font-size: 14px;
            font-weight: 950;
            text-transform: uppercase;
            letter-spacing: 2px;
            color: #181c24;
            margin-bottom: 4px;
          }
          .sub {
            font-size: 9px;
            font-weight: 700;
            color: #71717a;
            letter-spacing: 1.5px;
            text-transform: uppercase;
          }
          .qr-wrapper {
            background: #fafafa;
            border: 1px solid #f4f4f5;
            padding: 12px;
            border-radius: 12px;
            margin: 16px 0;
            display: flex;
            justify-content: center;
            align-items: center;
          }
          .qr-wrapper svg {
            width: 140mm;
            height: auto;
            max-width: 100%;
          }
          .table-info {
            margin-top: 12px;
          }
          .table-name {
            font-family: 'Space Grotesk', 'Inter', sans-serif;
            font-size: 28px;
            font-weight: 900;
            color: #181c24;
            letter-spacing: -1px;
            margin-bottom: 4px;
          }
          .instructions {
            font-size: 10px;
            font-weight: 700;
            color: #f97316;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            margin-bottom: 16px;
          }
          .footer {
            font-size: 8px;
            color: #a1a1aa;
            text-transform: uppercase;
            letter-spacing: 1px;
            border-top: 1px dashed #e4e4e7;
            width: 100%;
            padding-top: 12px;
          }
          @media print {
            .page-header-tip {
              display: none !important;
            }
            body {
              background-color: #ffffff;
              padding: 0;
              margin: 0;
            }
            .ticket {
              border: none;
              box-shadow: none;
              margin: 0;
              width: 100%;
              height: 100vh;
              justify-content: space-around;
            }
          }
        </style>
      </head>
      <body>
        <div class="page-header-tip">Print Preview - All table QR sheets. Click Print or Use Ctrl+P</div>
        <div>
          ${ticketsHTML}
        </div>
        <script>
          window.addEventListener('load', () => {
            setTimeout(() => {
              window.print();
            }, 500);
          });
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
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
    <div className="h-[60vh] flex flex-col items-center justify-center p-4 text-center bg-white rounded-xl border border-gray-100 shadow-sm mx-4">
      <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-6 font-black text-2xl">!</div>
      <h2 className="text-xl font-black text-gray-900 mb-2">{t('pos.error')}</h2>
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
    <div className="max-w-7xl mx-auto space-y-4 pb-12 p-3 sm:p-5 md:p-6">
      {!setupCompleted && (
        <div className="bg-gradient-to-r from-orange-500/5 via-orange-500/10 to-orange-500/5 p-4 sm:p-5 rounded-2xl border border-orange-500/25 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-sm">
          <div className="flex gap-3 items-center">
            <div className="w-2 h-2 bg-orange-600 rounded-full animate-ping shrink-0" />
            <div>
              <p className="text-xs font-black uppercase text-orange-600 tracking-wider">Setup Incomplete</p>
              <h3 className="text-sm font-extrabold text-gray-950 font-sans mt-0.5 tracking-tight">Complete your setup to start accepting orders</h3>
              <p className="text-[11px] text-gray-400 mt-0.5 font-bold leading-none">Required steps: Business Information, Localization settings & Order payment settings</p>
            </div>
          </div>
          <button
            onClick={() => navigate(`/business/setup?restaurantId=${restId}`)}
            className="w-full sm:w-auto bg-orange-600 hover:bg-orange-700 text-white font-black text-[11px] px-5 py-2.5 rounded-xl uppercase shadow-md shadow-orange-600/10 active:scale-95 transition-all text-center cursor-pointer"
          >
            Launch Setup Wizard
          </button>
        </div>
      )}

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center text-center sm:text-left">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">{t('admin.management')}</h1>
          <p className="text-xs text-gray-500 font-medium">{t('admin.controlCenter').replace('{name}', restaurant?.name || 'Branch')}</p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-none">
        {(
          [
            { id: 'menu', icon: UtensilsCrossed, key: 'admin.menuItems' },
            { id: 'categories', icon: List, key: 'admin.categories' },
            { id: 'tables', icon: Monitor, key: 'admin.tablesQR' },
            { id: 'printers', icon: Printer, name: 'Kitchen Printers', key: 'admin.kitchenPrinters' },
            { id: 'orders', icon: ClipboardList, key: 'admin.orderHistory' },
            { id: 'analytics', icon: BarChart2, key: 'admin.analytics' },
            { id: 'localization', icon: Globe, key: 'admin.translations' },
            ...(canManageStaff ? [{ id: 'staff', icon: Users, key: 'admin.staffAudits' }] : []),
            { id: 'offline-sync', icon: RefreshCw, name: 'Sync & Conflicts', key: 'admin.offlineSync' },
            { id: 'import-export', icon: FileSpreadsheet, name: 'Import/Export', key: 'admin.importExport' },
            { id: 'settings', icon: Save, key: 'admin.settings' }
          ] as Array<{
            id: 'menu' | 'categories' | 'tables' | 'analytics' | 'localization' | 'settings' | 'orders' | 'staff' | 'printers' | 'offline-sync' | 'import-export';
            icon: React.ComponentType<{ size?: number }>;
            key: string;
            name?: string;
          }>
        ).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-bold text-xs transition-all whitespace-nowrap ${
              activeTab === tab.id ? 'bg-gray-900 text-white shadow-md' : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-100'
            }`}
          >
            <tab.icon size={16} />
            {tab.name || t(tab.key)}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      {activeTab === 'menu' && (
        <MenuTab
          menuItems={menuItems}
          categories={categories}
          setEditingItem={setEditingItem}
          deleteMenuItem={deleteMenuItem}
          t={t}
          currency={restaurant?.currency}
        />
      )}

      {activeTab === 'categories' && (
        <CategoriesTab
          categories={categories}
          isAddingCategory={isAddingCategory}
          setIsAddingCategory={setIsAddingCategory}
          newCategoryName={newCategoryName}
          setNewCategoryName={setNewCategoryName}
          addCategory={addCategory}
          deleteCategory={deleteCategory}
          t={t}
        />
      )}

      {activeTab === 'tables' && (
        <TablesTab
          tables={tables}
          restId={restId}
          restaurant={restaurant}
          printAllQRCodes={printAllQRCodes}
          downloadQRCode={downloadQRCode}
          printQRCode={printQRCode}
          closeDiningSession={closeDiningSession}
          updateTableStatus={updateTableStatus}
          deleteTable={deleteTable}
          addTable={addTable}
          openTableActionsId={openTableActionsId}
          setOpenTableActionsId={setOpenTableActionsId}
          navigate={navigate}
          setActiveTab={setActiveTab}
          t={t}
        />
      )}

      {/* tables dead block removed */}

      {activeTab === 'orders' && (
        <OrdersTab
          orders={orders}
          fetchData={fetchData}
          t={t}
          currency={restaurant?.currency}
        />
      )}

      {/* orders dead block removed */}

      {activeTab === 'analytics' && (
        <AnalyticsTab
          restaurant={restaurant}
          analyticsData={analyticsData}
          dateRange={dateRange}
          setDateRange={setDateRange}
          isAnalyticsLoading={isAnalyticsLoading}
          t={t}
        />
      )}

      {/* analytics dead block removed */}

      {activeTab === 'settings' && restaurant && (
        <SettingsTab
          restaurant={restaurant}
          setRestaurant={setRestaurant}
          settingsError={settingsError}
          savingSettings={savingSettings}
          updateRestaurantSettings={updateRestaurantSettings}
          t={t}
        />
      )}

      {/* settings dead block removed */}

      {activeTab === 'printers' && restaurant && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <PrinterManager 
            restaurantId={restaurant.id} 
            categories={categories} 
          />
        </div>
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

      {activeTab === 'staff' && canManageStaff && (
        <StaffTab
          staffList={staffList}
          auditLogs={auditLogs}
          isStaffLoading={isStaffLoading}
          fetchStaffData={fetchStaffData}
          canManageStaff={canManageStaff}
          editingStaff={editingStaff}
          setEditingStaff={setEditingStaff}
          handleSaveStaffEdit={handleSaveStaffEdit}
          handleDeleteStaff={handleDeleteStaff}
          handleCreateStaff={handleCreateStaff}
          newStaffEmail={newStaffEmail}
          setNewStaffEmail={setNewStaffEmail}
          newStaffPassword={newStaffPassword}
          setNewStaffPassword={setNewStaffPassword}
          newStaffRole={newStaffRole}
          handleRoleChangeForNewStaff={handleRoleChangeForNewStaff}
          newStaffPermissions={newStaffPermissions}
          setNewStaffPermissions={setNewStaffPermissions}
          t={t}
        />
      )}

      {/* staff dead block removed */}

      {activeTab === 'offline-sync' && (
        <OfflineSyncTab
          activeConflictPolicy={activeConflictPolicy}
          setActiveConflictPolicy={setActiveConflictPolicy}
          conflictLogs={conflictLogs}
          setConflictLogs={setConflictLogs}
          t={t}
        />
      )}

      {activeTab === 'import-export' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
          <MenuImportTab t={t} />
        </div>
      )}

      {/* offline sync dead block removed */}

      {/* Edit Modal */}
      <AnimatePresence>
        {showSuccessToast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2.5 rounded-xl shadow-2xl z-50 flex items-center gap-3 border border-white/10"
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
              className="bg-white rounded-xl w-full max-w-xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col max-h-[90vh]"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h3 className="text-base font-black text-gray-900">{editingItem.id ? t('admin.editDish') : t('admin.newDish')}</h3>
                <button onClick={() => { setEditingItem(null); setSaveError(null); }} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X size={18} /></button>
              </div>
              
              <AnimatePresence>
                {saveError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-red-50 px-6 py-3 flex items-center gap-2.5 text-red-600 border-b border-red-100"
                  >
                    <AlertCircle size={15} />
                    <span className="text-xs font-bold">{saveError}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="p-6 space-y-4 flex-1 overflow-y-auto scrollbar-thin">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.dishName')}</label>
                  <input
                    value={editingItem.name || ''}
                    onChange={e => setEditingItem({ ...editingItem, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-150 focus:bg-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 font-bold text-xs"
                    placeholder="e.g. Nasi Lemak Ayam Goreng"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">
                      {t('admin.priceMyr').replace('MYR', restaurant?.currency || 'MYR')}
                    </label>
                    <input
                      type="number"
                      value={editingItem.price || ''}
                      onChange={e => setEditingItem({ ...editingItem, price: parseFloat(e.target.value) })}
                      className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-150 focus:bg-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 font-bold text-xs"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.categories')}</label>
                    <select
                      value={editingItem.categoryId || ''}
                      onChange={e => setEditingItem({ ...editingItem, categoryId: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-150 focus:bg-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 font-bold text-xs"
                    >
                      <option value="">{t('admin.selectCategory')}</option>
                      {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      <option value="CREATE_NEW" className="text-orange-600 font-bold">{t('admin.createNewCategory')}</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.productType')}</label>
                    <select
                      value={editingItem.productType || 'single'}
                      onChange={e => setEditingItem({ ...editingItem, productType: e.target.value as ProductType })}
                      className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-150 focus:bg-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 font-bold text-xs mb-1"
                    >
                      <option value="single">{t('admin.singleItem')}</option>
                      <option value="combo">{t('admin.comboMeal')}</option>
                      <option value="configurable">{t('admin.configurable')}</option>
                    </select>
                    <p className="text-[8px] text-gray-400 font-bold uppercase tracking-wider px-1 leading-normal">
                      {editingItem.productType === 'single' ? '• Standalone product, fixed price, no options' :
                       editingItem.productType === 'combo' ? '• Bundle with selection groups (e.g. Set Lunch)' :
                       '• Single product with modifiers (e.g. Sugar/Ice levels)'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.status')}</label>
                    <select
                      value={editingItem.status || 'Available'}
                      onChange={e => setEditingItem({ ...editingItem, status: e.target.value as MenuItemStatus })}
                      className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-150 focus:bg-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 font-bold text-xs"
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
                    <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.categoryName')}</label>
                    <input
                      autoFocus
                      value={editingItem.newCategoryName || ''}
                      onChange={e => setEditingItem({ ...editingItem, newCategoryName: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-orange-50 border border-orange-150 focus:bg-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 font-bold text-xs"
                      placeholder="e.g. Signature Mains"
                    />
                  </motion.div>
                )}
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.imageUrl')}</label>
                  <input
                    value={editingItem.imageUrl || ''}
                    onChange={e => setEditingItem({ ...editingItem, imageUrl: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-150 focus:bg-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 font-bold text-xs"
                    placeholder="https://images.unsplash.com/..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">{t('admin.description')}</label>
                  <textarea
                    value={editingItem.description || ''}
                    onChange={e => setEditingItem({ ...editingItem, description: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-150 focus:bg-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 font-bold text-xs h-20"
                    placeholder="Freshly prepared coconut rice with crispy chicken..."
                  />
                </div>

                {editingItem.productType !== 'single' && (
                  <div className={`pt-4 border-t ${editingItem.productType === 'combo' ? 'border-blue-100' : 'border-purple-100'}`}>
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg ${editingItem.productType === 'combo' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                          {editingItem.productType === 'combo' ? <ShoppingBag size={14} /> : <Settings2 size={14} />}
                        </div>
                        <div>
                          <label className="block text-xs font-black uppercase text-gray-900 leading-none">
                            {editingItem.productType === 'combo' ? 'Combo Bundle Engine' : 'Modifier Engine'}
                          </label>
                          <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest mt-0.5 font-mono">
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
                        className={`text-[10px] font-black px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 shadow-sm cursor-pointer ${
                          editingItem.productType === 'combo' 
                            ? 'bg-blue-600 text-white hover:bg-blue-700' 
                            : 'bg-purple-600 text-white hover:bg-purple-700'
                        }`}
                      >
                        <Plus size={13} /> Add {editingItem.productType === 'combo' ? 'Selection' : 'Modifier'} Group
                      </button>
                    </div>

                    <div className="space-y-4">
                      {(editingItem.productType === 'combo' ? editingItem.comboGroups : editingItem.modifierGroups)?.map((group, groupIdx) => (
                        <div key={groupIdx} className={`p-4 rounded-xl border transition-all ${
                          editingItem.productType === 'combo' 
                            ? 'bg-blue-50/10 border-blue-100 hover:border-blue-200' 
                            : 'bg-purple-50/10 border-purple-100 hover:border-purple-200'
                        }`}>
                          <div className="flex gap-2.5 items-start mb-3">
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center gap-2">
                                <span className="flex items-center justify-center w-5 h-5 shrink-0 rounded-full bg-white text-[9px] font-black text-gray-400 border border-gray-100">{groupIdx + 1}</span>
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
                                  className="flex-1 bg-white px-3 py-1.5 rounded-lg border border-gray-150 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 font-black text-xs uppercase tracking-wider shadow-sm"
                                  placeholder={editingItem.productType === 'combo' ? "e.g. Choose your Side" : "e.g. Ice Level"}
                                />
                              </div>
                              <div className="space-y-2">
                                <div className="space-y-1">
                                  <label className="text-[8px] font-black uppercase text-gray-400 ml-1.5">Display Mode</label>
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
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <label className="text-[8px] font-black uppercase text-gray-400 ml-1.5">Min Select</label>
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
                                      className="w-full bg-white px-2.5 py-1.5 rounded-lg border border-gray-150 text-[10px] font-black shadow-sm"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[8px] font-black uppercase text-gray-400 ml-1.5">Max Select</label>
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
                                      className="w-full bg-white px-2.5 py-1.5 rounded-lg border border-gray-150 text-[10px] font-black shadow-sm"
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
                              className="p-2 cursor-pointer text-gray-300 hover:text-red-500 bg-white border border-gray-150 rounded-lg shadow-sm hover:shadow-md transition-all mt-0.5"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                          
                          <div className="space-y-2.5 pl-4 border-l-2 border-gray-200/50 ml-2">
                            <label className="text-[10px] font-black uppercase tracking-[0.15em] text-gray-400 mb-2 block font-sans">
                              {editingItem.productType === 'combo' ? 'Available Items' : 'Modifier Options'}
                            </label>
                            
                            <div className="grid gap-1.5">
                              {(editingItem.productType === 'combo' ? (group as ComboGroup).items : (group as ModifierGroup).modifiers)?.map((item: ComboGroupItem | Modifier, itemIdx) => (
                                <div key={itemIdx} className="flex gap-2.5 items-start bg-white p-3 rounded-xl shadow-sm border border-gray-150 group/item">
                                  <div className="w-6 h-6 shrink-0 rounded-md bg-gray-50 flex items-center justify-center text-[9px] font-black text-gray-400 group-hover/item:text-orange-500 transition-colors mt-0.5">
                                    {itemIdx + 1}
                                  </div>
                                  <div className="flex-1 space-y-2 bg-transparent">
                                    <div className="flex gap-1.5 items-center">
                                      {editingItem.productType === 'combo' ? (
                                        <select
                                          value={(item as ComboGroupItem).childProductId || ''}
                                          onChange={e => {
                                            const newGroups = [...(editingItem.comboGroups || [])];
                                            const newItems = [...(newGroups[groupIdx].items || [])];
                                            const child = menuItems.find(mi => mi.id === e.target.value);
                                            newItems[itemIdx] = {
                                              ...newItems[itemIdx],
                                              childProductId: e.target.value,
                                              childProduct: child as Product
                                            };
                                            newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                            setEditingItem({ ...editingItem, comboGroups: newGroups });
                                          }}
                                          className="flex-1 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-150 text-[10px] font-black uppercase tracking-wider font-sans focus:outline-none"
                                        >
                                          <option value="">Choose Item...</option>
                                          {menuItems.filter(mi => mi.id !== editingItem.id).map(mi => (
                                            <option key={mi.id} value={mi.id}>{mi.name}</option>
                                          ))}
                                        </select>
                                      ) : (
                                        <input 
                                          value={(item as Modifier).name || ''}
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
                                          className="flex-1 bg-white border border-purple-100 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm focus:outline-none"
                                          placeholder="Modifier Name (e.g. 50% Sugar)"
                                        />
                                      )}

                                      <div className="relative w-20 shrink-0">
                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-gray-400 font-sans">+$</span>
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
                                          className="w-full bg-gray-50 border border-gray-150 pl-6 pr-1.5 py-1.5 rounded-lg text-2xs font-mono font-black text-orange-600 focus:outline-none"
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
                                        className="p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded-lg transition-all shrink-0 cursor-pointer"
                                      >
                                        <X size={14} />
                                      </button>
                                    </div>
                                    <div className="space-y-2 pt-1">
                                      <div className="w-full">
                                        <label className="text-[7px] font-black uppercase text-gray-400 mb-0.5 block">Context Visibility</label>
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
                                      <div className="flex gap-2 items-end w-full">
                                        <div className="shrink-0 animate-none">
                                          <label className="text-[7px] font-black uppercase text-gray-400 mb-0.5 block">Importance</label>
                                          <select
                                            value={(editingItem.productType === 'combo' ? (item as ComboGroupItem).importance : (item as Modifier).renderImportance) || ''}
                                            onChange={e => {
                                              if (editingItem.productType === 'combo') {
                                                const newGroups = [...(editingItem.comboGroups || [])];
                                                const newItems = [...(newGroups[groupIdx].items || [])];
                                                newItems[itemIdx] = { ...newItems[itemIdx], importance: (e.target.value || undefined) as RenderImportance };
                                                newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                                setEditingItem({ ...editingItem, comboGroups: newGroups });
                                              } else {
                                                const newGroups = [...(editingItem.modifierGroups || [])];
                                                const newModifiers = [...(newGroups[groupIdx].modifiers || [])];
                                                newModifiers[itemIdx] = { ...newModifiers[itemIdx], renderImportance: (e.target.value || undefined) as RenderImportance };
                                                newGroups[groupIdx] = { ...newGroups[groupIdx], modifiers: newModifiers };
                                                setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                              }
                                            }}
                                            className="bg-gray-50 border border-gray-150 px-1.5 py-1.5 rounded-lg text-[8px] font-bold uppercase tracking-tighter w-16 shrink-0"
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
                                                newItems[itemIdx] = { ...newItems[itemIdx], defaultSelected: !(item as ComboGroupItem).defaultSelected };
                                              }
                                              newGroups[groupIdx] = { ...newGroups[groupIdx], items: newItems };
                                              setEditingItem({ ...editingItem, comboGroups: newGroups });
                                            } else {
                                              const newGroups = [...(editingItem.modifierGroups || [])];
                                              const newModifiers = [...(newGroups[groupIdx].modifiers || [])];
                                              if (group.maxSelect === 1) {
                                                newModifiers.forEach((it, i) => it.isDefault = i === itemIdx);
                                              } else {
                                                newModifiers[itemIdx] = { ...newModifiers[itemIdx], isDefault: !(item as Modifier).isDefault };
                                              }
                                              newGroups[groupIdx] = { ...newGroups[groupIdx], modifiers: newModifiers };
                                              setEditingItem({ ...editingItem, modifierGroups: newGroups });
                                            }
                                          }}
                                          className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all border flex-1 h-[28px] flex items-center justify-center cursor-pointer ${
                                            (editingItem.productType === 'combo' ? (item as ComboGroupItem).defaultSelected : (item as Modifier).isDefault)
                                              ? 'bg-orange-500 text-white border-orange-500 shadow-sm' 
                                              : 'bg-white text-gray-400 border-gray-150 hover:border-orange-200'
                                          }`}
                                        >
                                          {(editingItem.productType === 'combo' ? (item as ComboGroupItem).defaultSelected : (item as Modifier).isDefault) ? 'Default' : 'Set Default'}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="flex gap-2 mt-2 h-[34px]">
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
                                className={`flex-1 py-1.5 rounded-lg border border-dashed transition-all text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer ${
                                  editingItem.productType === 'combo'
                                    ? 'border-blue-200 text-blue-500 hover:border-blue-400 hover:text-blue-600 bg-blue-50/10'
                                    : 'border-purple-200 text-purple-500 hover:border-purple-400 hover:text-purple-600 bg-purple-50/10'
                                }`}
                              >
                                <Plus size={13} /> Add {editingItem.productType === 'combo' ? 'Option' : 'Modifier'}
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
                                  className="px-3 rounded-lg bg-gray-900 text-white hover:bg-black transition-all shadow-sm flex items-center justify-center cursor-pointer"
                                  title="Quick add modifiers (e.g. Sugar levels)"
                                >
                                  <Zap size={13} />
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
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex gap-2">
                <button
                  onClick={() => setEditingItem(null)}
                  className="flex-1 px-4 py-2.5 rounded-lg text-xs font-bold bg-white text-gray-500 hover:bg-gray-100 transition-all border border-gray-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={saveMenuItem}
                  className="flex-1 px-4 py-1.5 rounded-lg text-xs font-bold bg-gray-900 text-white hover:bg-black transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer h-9"
                >
                  <Save size={14} /> {t('admin.saveProduct')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
