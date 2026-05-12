import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Category, MenuItem, OrderItem, Restaurant, Table, ProductSelection, SelectedGroupItem, LanguageCode, Product } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingBag, ChevronRight, Minus, Plus, Search, Info, X, Camera, QrCode, AlertCircle, Clock, Check, Globe } from 'lucide-react';
import { resolveMenuTranslations, resolveCategoryTranslations, TranslationContext, getKitchenCanonical } from '../lib/translationEngine';
import { calculateSelectionPrice, validateSelection, flattenSelections } from '../lib/configEngine';
import { ProductConfigurator } from '../components/ProductConfigurator';
import { getVisibleModifiers } from '../lib/modifierEngine';

export function CustomerMenu() {
  const { restId, tableId } = useParams();
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [originalCategories, setOriginalCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [originalMenuItems, setOriginalMenuItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItemForDetail, setSelectedItemForDetail] = useState<MenuItem | null>(null);
  const [selectionState, setSelectionState] = useState<ProductSelection | null>(null);
  
  const [currentLanguage, setCurrentLanguage] = useState<LanguageCode>('en');
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);

  const [isReviewingOrder, setIsReviewingOrder] = useState(false);
  const [orderType, setOrderType] = useState<'dine-in' | 'takeaway'>('dine-in');
  const [lastOrderId, setLastOrderId] = useState<string | null>(localStorage.getItem(`last_order_${restId}`));
  const [diningSession, setDiningSession] = useState<{ id: string; token: string } | null>(null);

  const isPreviewMode = tableId === 'preview' || tableId === 'default';

  const languages: { code: LanguageCode, label: string }[] = [
    { code: 'en', label: 'English' },
    { code: 'zh', label: '中文' },
    { code: 'ms', label: 'Melayu' }
  ];

  const initializeSelection = (item: MenuItem) => {
    const initialState: ProductSelection = {
      productId: item.id,
      selections: {}
    };

    // Auto-select defaults for Combo Groups
    item.comboGroups?.forEach(group => {
      const defaults = group.items?.filter(i => i.defaultSelected) || [];
      if (defaults.length > 0) {
        initialState.selections[group.id] = defaults.map(d => ({
          id: d.id,
          comboItemId: d.id,
          productId: d.childProductId,
          name: d.customName || d.childProduct?.name || 'Option',
          priceDelta: d.priceDelta,
          childProduct: d.childProduct
        }));
      }
    });

    // Auto-select defaults for Modifier Groups
    item.modifierGroups?.forEach(group => {
      const defaults = group.modifiers?.filter(i => i.isDefault) || [];
      if (defaults.length > 0) {
        initialState.selections[group.id] = defaults.map(d => ({
          id: d.id,
          modifierId: d.id,
          name: d.name || 'Option',
          priceDelta: d.priceDelta
        }));
      }
    });

    setSelectionState(initialState);
  };

  const getCartItemIndex = (itemId: string, selections?: Record<string, string>, selectionState?: ProductSelection | null) => {
    return cart.findIndex(i => {
      if (i.menuItemId !== itemId) return false;
      
      if (selectionState && i.selection) {
        return JSON.stringify(i.selection) === JSON.stringify(selectionState);
      }

      if (selections && !i.selection) {
        // Get current item options to match selections
        const item = menuItems.find(m => m.id === itemId);
        if (!item) return false;

        const selectionOptions = Object.entries(selections).map(([optName, valName]) => {
          const opt = item.options?.find(o => o.name === optName);
          const val = opt?.values.find(v => v.name === valName);
          return {
            optionName: optName,
            valueName: valName,
            priceDelta: val?.priceDelta || 0
          };
        });

        if (i.options.length !== selectionOptions.length) return false;
        return selectionOptions.every(so => {
          const matched = i.options.find(io => io.optionName === so.optionName);
          return matched && matched.valueName === so.valueName;
        });
      }

      return false;
    });
  };

  useEffect(() => {
    if (!restId) return;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Resolve Dining Session if not in preview mode
        let currentSession = null;
        if (!isPreviewMode && tableId && tableId !== 'default') {
          const storageKey = `dining_session_token_${tableId}`;
          const existingToken = localStorage.getItem(storageKey);

          const { data: sessionData, error: sessionError } = await supabase
            .rpc('resolve_dining_session', {
              p_restaurant_id: restId,
              p_table_id: tableId,
              p_device_info: navigator.userAgent,
              p_client_token: existingToken
            });

          if (sessionError) {
            console.error("Session resolution failed:", sessionError);
          } else if (sessionData && sessionData[0]) {
            currentSession = {
              id: sessionData[0].session_id,
              token: sessionData[0].token
            };
            
            // Persist the token tightly to this table
            localStorage.setItem(storageKey, sessionData[0].token);
            setDiningSession(currentSession);
          }
        }

        const fetchPromise = Promise.all([
          supabase.from('restaurants').select('*, franchise_id').eq('id', restId).maybeSingle(),
          supabase.from('categories').select('*').eq('restaurant_id', restId).order('sort_order', { ascending: true }),
          supabase.from('menu_items')
            .select(`
              *,
              display_behavior,
              combo_groups (
                *,
                items:combo_group_items (
                  *,
                  child_product:menu_items (
                    *,
                    combo_groups (
                      *,
                      items:combo_group_items (*)
                    ),
                    modifier_groups (
                      *,
                      modifiers!modifiers_group_id_fkey (*)
                    )
                  )
                )
              ),
              modifier_groups (
                *,
                modifiers!modifiers_group_id_fkey (*)
              )
            `)
            .eq('restaurant_id', restId)
            .eq('is_active', true),
          tableId !== 'default' && tableId ? supabase.from('tables').select('*').eq('id', tableId).maybeSingle() : Promise.resolve({ data: null, error: null })
        ]);

        const [restRes, catsRes, itemsRes, tableRes] = await fetchPromise;

        if (restRes.error) throw restRes.error;
        if (!restRes.data) throw new Error("Restaurant not found. Please check the URL.");
        
        if (catsRes.error) throw catsRes.error;
        
        // Handle menu items with possible null itemsRes (if timeout didn't catch properly or strange response)
        let processedItems = [];
        if (itemsRes?.data) {
          processedItems = itemsRes.data.map((i: any) => ({
            id: i.id,
            restaurantId: i.restaurant_id,
            categoryId: i.category_id,
            name: i.name,
            price: parseFloat(i.price || i.base_price || 0),
            basePrice: parseFloat(i.base_price || i.price || 0),
            imageUrl: i.image_url,
            description: i.description,
            isActive: i.is_active,
            status: i.status || 'Available',
            displayBehavior: i.display_behavior,
            productType: i.product_type || 'single',
            comboGroups: i.combo_groups?.map((g: any) => ({
              id: g.id,
              name: g.name,
              description: g.description,
              required: g.required,
              minSelect: g.min_select,
              maxSelect: g.max_select,
              displayBehavior: g.display_behavior,
              importance: g.importance,
              sortOrder: g.sort_order,
              items: g.items?.map((gi: any) => ({
                id: gi.id,
                groupId: gi.group_id,
                childProductId: gi.child_product_id,
                priceDelta: parseFloat(gi.price_delta || 0),
                defaultSelected: gi.default_selected,
                displayBehavior: gi.display_behavior,
                importance: gi.importance,
                sortOrder: gi.sort_order,
                childProduct: gi.child_product ? {
                  id: gi.child_product.id,
                  name: gi.child_product.name,
                  basePrice: parseFloat(gi.child_product.base_price || 0),
                  productType: gi.child_product.product_type,
                  comboGroups: gi.child_product.combo_groups?.map((ng: any) => ({
                    id: ng.id,
                    name: ng.name,
                    description: ng.description,
                    required: ng.required,
                    minSelect: ng.min_select,
                    maxSelect: ng.max_select,
                    displayBehavior: ng.display_behavior,
                    importance: ng.importance,
                    sortOrder: ng.sort_order,
                    items: ng.items?.map((ni: any) => ({
                      id: ni.id,
                      groupId: ni.group_id,
                      childProductId: ni.child_product_id,
                      priceDelta: parseFloat(ni.price_delta || 0),
                      defaultSelected: ni.default_selected,
                      displayBehavior: ni.display_behavior,
                      importance: ni.importance,
                      sortOrder: ni.sort_order
                    })) || []
                  })),
                  modifierGroups: gi.child_product.modifier_groups?.map((ng: any) => ({
                    id: ng.id,
                    name: ng.name,
                    required: ng.required,
                    minSelect: ng.min_select,
                    maxSelect: ng.max_select,
                    displayBehavior: ng.display_behavior,
                    sortOrder: ng.sort_order,
                    modifiers: ng.modifiers?.map((nm: any) => ({
                      id: nm.id,
                      groupId: nm.group_id,
                      name: nm.name,
                      priceDelta: parseFloat(nm.price_delta || 0),
                      isDefault: nm.is_default,
                      renderImportance: nm.render_importance,
                      displayBehavior: nm.display_behavior,
                      sortOrder: nm.sort_order
                    })) || []
                  }))
                } : undefined
              })) || []
            })) || [],
            modifierGroups: i.modifier_groups?.map((g: any) => ({
              id: g.id,
              name: g.name,
              required: g.required,
              minSelect: g.min_select,
              maxSelect: g.max_select,
              displayBehavior: g.display_behavior,
              sortOrder: g.sort_order,
              modifiers: g.modifiers?.map((m: any) => ({
                id: m.id,
                groupId: m.group_id,
                name: m.name,
                priceDelta: parseFloat(m.price_delta || 0),
                isDefault: m.is_default,
                renderImportance: m.render_importance,
                displayBehavior: m.display_behavior,
                sortOrder: m.sort_order
              })) || []
            })) || []
          }));
        } else if (itemsRes?.error || !itemsRes?.data) {
          console.warn("Complex items fetch failed or empty, trying simple list.");
          const simpleRes = await supabase.from('menu_items')
            .select('*')
            .eq('restaurant_id', restId)
            .eq('is_active', true);
          
          if (simpleRes.error) throw simpleRes.error;
          processedItems = (simpleRes.data || []).map((i: any) => ({
            id: i.id,
            restaurantId: i.restaurant_id,
            categoryId: i.category_id,
            name: i.name,
            price: parseFloat(i.price || i.base_price || 0),
            basePrice: parseFloat(i.base_price || i.price || 0),
            imageUrl: i.image_url,
            description: i.description,
            isActive: i.is_active,
            status: i.status || 'Available',
            productType: i.product_type || 'single'
          }));
        }

        if (!restRes.data) throw new Error("Restaurant not found");
        
        setRestaurant({
          id: restRes.data.id,
          name: restRes.data.name,
          currency: restRes.data.currency,
          serviceCharge: parseFloat(restRes.data.service_charge),
          sst: parseFloat(restRes.data.sst),
          franchiseId: restRes.data.franchise_id
        } as any);
        
        if (tableRes.data) {
          setTable({ id: tableRes.data.id, name: tableRes.data.name, status: tableRes.data.status });
        }
        if (catsRes.data) {
          const processedCats = catsRes.data.map(c => ({ id: c.id, name: c.name, order: c.sort_order }));
          setOriginalCategories(processedCats);
          setCategories(processedCats);
        }
        setOriginalMenuItems(processedItems);
        setMenuItems(processedItems);
      } catch (err: any) {
        console.error("Fetch data failed:", err);
        setError(err.message || "Failed to load menu data");
      } finally {
        setLoading(false);
      }
    };
    fetchData();

    const handleFocus = () => {
      fetchData();
    };
    window.addEventListener('focus', handleFocus);

    // Subscribe to table changes if it's a specific table
    let subscription: any;
    if (tableId && tableId !== 'default') {
      subscription = supabase
        .channel(`table-${tableId}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'tables',
          filter: `id=eq.${tableId}`
        }, (payload) => {
          if (payload.new) {
            setTable(prev => ({ ...prev!, status: payload.new.status }));
          }
        })
        .subscribe();
    }

    return () => {
      if (subscription) supabase.removeChannel(subscription);
      window.removeEventListener('focus', handleFocus);
    };
  }, [restId, tableId]);

  // Handle translation updates
  useEffect(() => {
    if (!restaurant || (originalMenuItems.length === 0 && originalCategories.length === 0)) return;

    const translateMenu = async () => {
      const context: TranslationContext = {
        restaurantId: restaurant.id,
        franchiseId: (restaurant as any).franchiseId,
        targetLanguage: currentLanguage
      };

      const [translatedItems, translatedCats] = await Promise.all([
        resolveMenuTranslations(originalMenuItems, context),
        resolveCategoryTranslations(originalCategories, context)
      ]);
      
      setMenuItems(translatedItems);
      setCategories(translatedCats);
    };

    const timeoutId = setTimeout(translateMenu, 100);
    return () => clearTimeout(timeoutId);
  }, [currentLanguage, originalMenuItems, originalCategories, restaurant]);

  const addToCart = (item: MenuItem, selection: ProductSelection) => {
    const itemTotalPrice = calculateSelectionPrice(item, selection);
    
    // Generate smart lines for local display
    const kdsMods = getVisibleModifiers(item as any as Product, selection, 'kds');
    const customerMods = getVisibleModifiers(item as any as Product, selection, 'qr_cart');
    const receiptMods = getVisibleModifiers(item as any as Product, selection, 'receipt');

    const smartLines = {
      kds: kdsMods.map(m => `${"  ".repeat(m.depth)}• ${m.name}`),
      customer: customerMods.map(m => `${"  ".repeat(m.depth)}• ${m.name}`),
      receipt: receiptMods.map(m => `${"  ".repeat(m.depth)}• ${m.name}`)
    };

    setCart(prev => {
      const existingIndex = prev.findIndex(i => {
        if (i.menuItemId !== item.id) return false;
        return i.selection && JSON.stringify(i.selection) === JSON.stringify(selection);
      });

      if (existingIndex > -1) {
        const newCart = [...prev];
        const existingItem = newCart[existingIndex];
        newCart[existingIndex] = {
          ...existingItem,
          quantity: existingItem.quantity + 1,
          smartRenderedLines: smartLines
        };
        return newCart;
      }

      return [...prev, {
        menuItemId: item.id,
        name: item.name,
        price: itemTotalPrice,
        quantity: 1,
        options: [],
        selection: selection,
        smartRenderedLines: smartLines
      }];
    });
  };

  const updateQuantity = (index: number, delta: number) => {
    setCart(prev => {
      const existingItem = prev[index];
      if (!existingItem) return prev;
      
      const newQty = Math.max(0, existingItem.quantity + delta);
      if (newQty === 0) {
        return prev.filter((_, i) => i !== index);
      }
      
      const newCart = [...prev];
      newCart[index] = {
        ...existingItem,
        quantity: newQty
      };
      return newCart;
    });
  };

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const serviceCharge = subtotal * (restaurant?.serviceCharge || 0);
  const sst = (subtotal + serviceCharge) * (restaurant?.sst || 0);
  const total = subtotal + serviceCharge + sst;
  
  const confirmOrder = async () => {
    if (!restId || !tableId || cart.length === 0) return;
    
    setLoading(true);
    try {
      // Resolve kitchen names and smart modifier lines for order
      const itemsWithMetadata = await Promise.all(cart.map(async (item) => {
        const canonical = await getKitchenCanonical(item.menuItemId);
        const product = menuItems.find(m => m.id === item.menuItemId);
        
        const smartLines: OrderItem['smartRenderedLines'] = {
          kds: [],
          customer: [],
          receipt: []
        };

        if (product && item.selection) {
          const kdsMods = getVisibleModifiers(product, item.selection, 'kds');
          smartLines.kds = kdsMods.map(m => `${"  ".repeat(m.depth)}• ${m.name}`);
          
          const customerMods = getVisibleModifiers(product, item.selection, 'qr_cart');
          smartLines.customer = customerMods.map(m => `${"  ".repeat(m.depth)}• ${m.name}`);

          const receiptMods = getVisibleModifiers(product, item.selection, 'receipt');
          smartLines.receipt = receiptMods.map(m => `${"  ".repeat(m.depth)}• ${m.name}`);
        } else {
          // Fallback to basic flattening if product info is missing
          smartLines.customer = item.selection ? flattenSelections(item.selection) : [];
          smartLines.kds = smartLines.customer;
          smartLines.receipt = smartLines.customer;
        }

        return {
          ...item,
          kitchenName: canonical || item.name,
          smartRenderedLines: smartLines
        };
      }));

      const { data, error } = await supabase
        .from('orders')
        .insert({
          restaurant_id: restId,
          table_id: tableId,
          session_id: diningSession?.id,
          order_type: orderType,
          status: 'pending',
          total_price: total,
          items: itemsWithMetadata,
          payment_method: 'counter'
        })
        .select()
        .single();

      if (error) throw error;
      localStorage.setItem(`last_order_${restId}`, data.id);
      setLastOrderId(data.id);
      navigate(`/restaurant/${restId}/order/${data.id}`);
    } catch (err: any) {
      alert(err.message || "Failed to place order");
      setLoading(false);
    }
  };

  const filteredItems = menuItems.filter(item => {
    if (item.status === 'Hidden') return false;
    
    const matchesCat = selectedCategory === 'all' || item.categoryId === selectedCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  if (loading) return (
    <div className="h-screen flex flex-col items-center justify-center bg-white gap-4">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
      <p className="text-zinc-500 font-semibold text-[10px] uppercase tracking-wider animate-pulse">Loading Menu...</p>
    </div>
  );

  if (error) return (
    <div className="h-screen flex flex-col items-center justify-center bg-white p-8 text-center">
      <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-6">
        <AlertCircle size={32} />
      </div>
      <h2 className="text-xl font-bold text-zinc-900 mb-2">Something went wrong</h2>
      <p className="text-zinc-500 font-medium text-sm mb-8 max-w-xs mx-auto">{error}</p>
      <button 
        onClick={() => window.location.reload()}
        className="bg-zinc-900 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-black transition-all shadow-lg"
      >
        Try Again
      </button>
    </div>
  );
  // if (tableId === 'default') {
  //   return (
  //     <div className="min-h-screen bg-white flex flex-col items-center justify-center p-12 text-center font-sans">
  //       <motion.div
  //         initial={{ scale: 0.8, opacity: 0 }}
  //         animate={{ scale: 1, opacity: 1 }}
  //         className="w-32 h-32 bg-orange-100 rounded-[2.5rem] flex items-center justify-center text-orange-600 mb-10 shadow-inner"
  //       >
  //         <Camera size={56} strokeWidth={1.5} />
  //       </motion.div>
  //       
  //       <div className="space-y-4 mb-12">
  //         <h1 className="text-4xl font-black text-gray-900 tracking-tighter leading-none">
  //           Scan to Order
  //         </h1>
  //         <p className="text-gray-500 font-bold text-lg leading-relaxed max-w-[18rem] mx-auto">
  //           Please scan the QR code on your table to browse our delicious menu.
  //         </p>
  //       </div>

  //       <div className="w-full max-w-xs relative group">
  //         <div className="absolute -inset-4 bg-gradient-to-br from-orange-400 to-orange-600 rounded-[3.5rem] opacity-20 blur-2xl group-hover:opacity-30 transition-opacity"></div>
  //         <div className="relative bg-white p-8 rounded-[3rem] border-2 border-gray-100 shadow-2xl flex flex-col items-center justify-center gap-6">
  //           <div className="relative">
  //             <div className="absolute -inset-1 rounded-2xl bg-orange-100/50 animate-pulse"></div>
  //             <QrCode size={160} strokeWidth={1} className="text-gray-200 relative" />
  //             
  //             {/* Corner Accents */}
  //             <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-orange-500 rounded-tl-xl"></div>
  //             <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-orange-500 rounded-tr-xl"></div>
  //             <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-orange-500 rounded-bl-xl"></div>
  //             <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-orange-500 rounded-br-xl"></div>
  //           </div>
  //           
  //           <div className="bg-gray-900 px-6 py-2 rounded-full shadow-lg">
  //             <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">READY FOR SCAN</span>
  //           </div>
  //         </div>
  //       </div>

  //       <div className="mt-16 text-[10px] font-black uppercase tracking-[0.3em] text-gray-300">
  //         JomOrder System • Branch v1.0
  //       </div>
  //     </div>
  //   );
  // }

  return (
    <div className="max-w-md mx-auto bg-white min-h-screen pb-32">
      {/* Preview Mode Banner */}
      {isPreviewMode && (
        <div className="bg-zinc-900 text-white py-2.5 px-6 flex items-center justify-center gap-2 sticky top-0 z-[60]">
          <ShoppingBag size={14} className="text-orange-500" />
          <span className="text-[9px] font-bold uppercase tracking-wider">Preview Mode</span>
        </div>
      )}
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-zinc-100">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex flex-col">
            <h1 className="text-lg font-bold text-zinc-900 leading-tight">
              {restaurant?.name}
            </h1>
            <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2">
              <span>Table {table?.name || tableId}</span>
              {!isPreviewMode && diningSession && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[8px] font-bold tracking-wider">
                  <span className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse" />
                  SECURED
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <button 
                onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
                className="p-2 rounded-xl bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-all cursor-pointer"
              >
                <Globe size={18} />
              </button>
              <AnimatePresence>
                {showLanguageDropdown && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="absolute right-0 z-[100] p-2 shadow-2xl bg-white rounded-2xl w-44 mt-3 border border-zinc-100"
                  >
                    <div className="px-3 py-2 border-b border-zinc-50 mb-1">
                      <span className="text-[10px] font-black uppercase tracking-[0.1em] text-zinc-400">Language</span>
                    </div>
                    {languages.map(lang => (
                      <button 
                        key={lang.code}
                        onClick={() => {
                          setCurrentLanguage(lang.code);
                          setShowLanguageDropdown(false);
                        }}
                        className={`text-xs font-bold py-2.5 px-3 flex items-center justify-between w-full rounded-xl transition-colors ${currentLanguage === lang.code ? 'text-orange-600 bg-orange-50' : 'text-zinc-600 hover:bg-zinc-50'}`}
                      >
                        <span>{lang.label}</span>
                        {currentLanguage === lang.code && <div className="w-1 h-1 bg-orange-500 rounded-full" />}
                      </button>
                    ))}
                    <div className="h-px bg-zinc-100 my-1 mx-2" />
                    <button 
                      onClick={() => setShowLanguageDropdown(false)}
                      className="text-xs font-bold text-zinc-600 py-2.5 px-3 flex items-center gap-2 rounded-xl hover:bg-zinc-50 w-full text-left"
                    >
                      <Info size={14} className="text-zinc-400" />
                      Help & Info
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              type="text"
              placeholder="Search dishes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-zinc-100 text-sm font-medium outline-none border border-transparent focus:bg-white focus:border-zinc-200 focus:ring-2 focus:ring-orange-100 placeholder:text-zinc-400 transition-all"
            />
          </div>
        </div>

        {/* Categories Bar */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-hide">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 h-8 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
              selectedCategory === 'all' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'
            }`}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 h-8 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                selectedCategory === cat.id ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </header>

      {/* Menu Grid */}
      <div className="px-4 py-4 space-y-3">
        {filteredItems.map(item => (
          <motion.div
            layout
            key={item.id}
            onClick={() => {
              if (item.productType === 'single' && (!item.groups || item.groups.length === 0)) {
                addToCart(item, { productId: item.id, selections: {} });
                return;
              }
              setSelectedItemForDetail(item);
              initializeSelection(item);
            }}
            className="bg-white border border-zinc-100 rounded-2xl p-3 flex gap-3 hover:shadow-md transition-all group cursor-pointer"
          >
            <div className="w-20 h-20 rounded-xl bg-zinc-50 flex-shrink-0 overflow-hidden relative border border-zinc-100">
              {item.imageUrl ? (
                <img src={item.imageUrl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-200">
                  <ShoppingBag size={24} />
                </div>
              )}
              {item.status !== 'Available' && (
                <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-sm py-0.5">
                  <p className="text-[8px] text-center font-bold text-white uppercase tracking-wider">{item.status}</p>
                </div>
              )}
            </div>
            <div className={`flex-1 flex flex-col justify-center min-w-0 ${(item.status === 'Out of Stock' || item.status === 'Paused') ? 'opacity-50' : ''}`}>
              <div className="flex justify-between items-start">
                <h3 className="text-sm font-semibold text-zinc-900 truncate leading-snug">{item.name}</h3>
                {item.status === 'Low Stock' && <span className="text-[7px] bg-yellow-50 text-yellow-600 font-bold px-1.5 py-0.5 rounded-full border border-yellow-100 ml-2">LOW</span>}
              </div>
              <p className="text-[11px] text-zinc-500 line-clamp-2 mt-0.5 leading-relaxed">{item.description}</p>
              <div className="mt-2.5 flex justify-between items-center">
                <span className="text-sm font-bold text-orange-600">RM {item.price.toFixed(2)}</span>
                
                {(item.status === 'Out of Stock' || item.status === 'Paused' || isPreviewMode) ? (
                  <span className="text-[10px] font-bold text-zinc-400">
                    {isPreviewMode ? 'View' : 'Sold Out'}
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    {cart.some(i => i.menuItemId === item.id) ? (
                      <div className="flex items-center gap-2.5 bg-zinc-100 rounded-lg px-2 py-1">
                        <span className="text-[11px] font-bold text-zinc-900">{cart.filter(i => i.menuItemId === item.id).reduce((sum, i) => sum + i.quantity, 0)}</span>
                        <div className="w-px h-3 bg-zinc-200" />
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            if (item.productType === 'single' && (!item.groups || item.groups.length === 0)) {
                              addToCart(item, { productId: item.id, selections: {} });
                              return;
                            }
                            setSelectedItemForDetail(item);
                            initializeSelection(item);
                          }} 
                          className="text-zinc-600 hover:text-orange-600"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (item.productType === 'single' && (!item.groups || item.groups.length === 0)) {
                            addToCart(item, { productId: item.id, selections: {} });
                            return;
                          }
                          setSelectedItemForDetail(item);
                          initializeSelection(item);
                        }}
                        className="h-8 px-3 rounded-lg bg-orange-500 text-white text-xs font-semibold flex items-center gap-1 shadow-sm shadow-orange-500/20 active:scale-95 transition-all"
                      >
                        <Plus size={14} />
                        Add
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Item Detail Configurator (Bottom Sheet Style) */}
      <AnimatePresence>
        {selectedItemForDetail && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItemForDetail(null)}
              className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-x-0 bottom-0 z-[101] bg-white rounded-t-[2rem] flex flex-col md:max-w-md md:mx-auto h-[90vh] shadow-2xl overflow-hidden"
            >
              {/* Close Handle */}
              <div className="w-12 h-1 bg-zinc-200 rounded-full mx-auto my-3 shrink-0" />

              {/* Body */}
              <div className="flex-1 overflow-y-auto scrollbar-hide pb-32">
                <div className="relative h-48 sm:h-56 shrink-0">
                  {selectedItemForDetail.imageUrl ? (
                    <img 
                      src={selectedItemForDetail.imageUrl} 
                      className="w-full h-full object-cover"
                      alt={selectedItemForDetail.name}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-zinc-50 text-zinc-200">
                      <ShoppingBag size={64} strokeWidth={1} />
                    </div>
                  )}
                  <button
                    onClick={() => setSelectedItemForDetail(null)}
                    className="absolute top-4 right-4 bg-white/80 backdrop-blur shadow-md p-2 rounded-full text-zinc-600 hover:text-zinc-900"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="px-5 pt-5">
                  <div className="flex justify-between items-start mb-1">
                    <h2 className="text-xl font-bold text-zinc-900 leading-tight">{selectedItemForDetail.name}</h2>
                    <span className="text-lg font-bold text-orange-600">
                      {restaurant?.currency}{selectedItemForDetail.price.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-zinc-500 text-sm leading-relaxed mb-6">{selectedItemForDetail.description}</p>
                  
                  <div className="h-px bg-zinc-100 mb-8" />

                  {selectionState ? (
                    <ProductConfigurator 
                      product={selectedItemForDetail} 
                      selection={selectionState} 
                      onChange={setSelectionState}
                      currency={restaurant?.currency || 'RM'}
                    />
                  ) : (
                    <div className="text-center py-10 text-zinc-400 font-medium text-xs">
                      No customization available
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="absolute bottom-0 inset-x-0 p-5 bg-white border-t border-zinc-100 flex items-center gap-3">
                {(() => {
                  const validation = selectionState ? validateSelection(selectedItemForDetail, selectionState) : { isValid: true, errors: [] };
                  const isValid = validation.isValid;
                  const cartIndex = selectionState ? getCartItemIndex(selectedItemForDetail.id, undefined, selectionState) : -1;
                  const quantity = cartIndex > -1 ? cart[cartIndex].quantity : 0;

                  return (
                    <div className="w-full flex gap-3">
                      {quantity > 0 ? (
                        <div className="flex-1 flex h-12 bg-zinc-100 rounded-xl items-center justify-between px-1">
                          <button 
                            onClick={() => updateQuantity(cartIndex, -1)}
                            className="w-10 h-10 rounded-lg flex items-center justify-center text-zinc-600 hover:bg-white hover:text-red-500 transition-all font-bold"
                          >
                            <Minus size={18} />
                          </button>
                          <div className="text-center">
                            <span className="text-sm font-bold text-zinc-900">{quantity}</span>
                            <span className="text-[10px] text-zinc-500 block -mt-1 font-medium">In Cart</span>
                          </div>
                          <button 
                            onClick={() => updateQuantity(cartIndex, 1)}
                            className="w-10 h-10 rounded-lg flex items-center justify-center text-zinc-600 hover:bg-white hover:text-orange-500 transition-all font-bold"
                          >
                            <Plus size={18} />
                          </button>
                        </div>
                      ) : (
                        <button
                          disabled={!isValid}
                          onClick={() => {
                            if (selectionState) {
                              addToCart(selectedItemForDetail, selectionState);
                            } else if (selectedItemForDetail.productType === 'single') {
                              addToCart(selectedItemForDetail, { productId: selectedItemForDetail.id, selections: {} });
                            }
                          }}
                          className={`flex-1 h-12 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] ${
                            isValid 
                              ? 'bg-orange-500 text-white shadow-orange-500/10' 
                              : 'bg-zinc-100 text-zinc-400 cursor-not-allowed shadow-none'
                          }`}
                        >
                          {isValid ? <Plus size={18} /> : <AlertCircle size={18} />}
                          {isValid ? `Add to Basket • ${restaurant?.currency}${selectionState ? calculateSelectionPrice(selectedItemForDetail, selectionState).toFixed(2) : selectedItemForDetail.price.toFixed(2)}` : 'Incomplete'}
                        </button>
                      )}
                      
                      <button
                        onClick={() => setSelectedItemForDetail(null)}
                        className="w-12 h-12 rounded-xl border border-zinc-200 flex items-center justify-center text-zinc-400 hover:text-zinc-900 transition-colors"
                      >
                        <Check size={20} />
                      </button>
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Cart Navigation Bar (Minimal Floating Pill) */}
      <AnimatePresence>
        {cart.length > 0 && !isReviewingOrder && !isPreviewMode && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="fixed bottom-6 left-4 right-4 z-50 flex justify-center"
          >
            <button
              onClick={() => setIsReviewingOrder(true)}
              className="w-full max-w-sm bg-zinc-900 text-white h-14 rounded-2xl shadow-xl shadow-zinc-900/20 flex items-center justify-between px-4 group hover:bg-black transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="bg-orange-500 text-white w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold">
                  {cart.reduce((a, b) => a + b.quantity, 0)}
                </div>
                <div className="text-left">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-zinc-400">View basket</p>
                  <p className="text-sm font-bold">RM {subtotal.toFixed(2)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 py-1 pl-4 border-l border-zinc-800">
                <span className="text-sm font-semibold pr-1">Checkout</span>
                <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Order Review Overlay */}
      <AnimatePresence>
        {isReviewingOrder && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-[102] bg-zinc-50 flex flex-col"
          >
            <header className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between bg-white sticky top-0 z-10">
              <button 
                onClick={() => setIsReviewingOrder(false)}
                className="p-2 rounded-xl bg-zinc-100 text-zinc-600 hover:text-zinc-900"
              >
                <X size={20} />
              </button>
              <h2 className="text-base font-bold text-zinc-900">Checkout</h2>
              <div className="w-10" />
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Order Type Selector */}
              <div className="flex p-1 bg-zinc-100 rounded-xl">
                <button
                  onClick={() => setOrderType('dine-in')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                    orderType === 'dine-in' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500'
                  }`}
                >
                  Dine In
                </button>
                <button
                  onClick={() => setOrderType('takeaway')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                    orderType === 'takeaway' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500'
                  }`}
                >
                  Takeaway
                </button>
              </div>

              <div className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
                <div className="p-4 border-b border-zinc-100 bg-zinc-50/50">
                  <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Order Summary</h3>
                </div>
                <div className="divide-y divide-zinc-50">
                  {cart.map((item, index) => (
                    <div key={index} className="p-4 flex gap-3 items-start">
                      <div className="w-6 h-6 bg-orange-50 text-orange-600 rounded flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">
                        {item.quantity}x
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2">
                          <h4 className="text-sm font-semibold text-zinc-900 leading-tight truncate">{item.name}</h4>
                          <span className="text-sm font-bold text-zinc-900 shrink-0">RM {(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                        {item.smartRenderedLines?.customer ? (
                          <div className="mt-1 space-y-0.5">
                            {item.smartRenderedLines.customer.map((line, i) => (
                              <p key={i} className="text-[11px] text-zinc-500 font-medium leading-tight whitespace-pre-wrap">{line}</p>
                            ))}
                          </div>
                        ) : item.selection ? (
                          <div className="mt-1 space-y-0.5">
                            {flattenSelections(item.selection).map((line, i) => (
                              <p key={i} className="text-[11px] text-zinc-500 font-medium leading-tight whitespace-pre-wrap">{line}</p>
                            ))}
                          </div>
                        ) : null}
                        
                        <div className="flex items-center gap-3 mt-3">
                          <button 
                            onClick={() => updateQuantity(index, -1)}
                            className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-500 hover:text-red-500"
                          >
                            <Minus size={14} />
                          </button>
                          <span className="text-sm font-bold text-zinc-900">{item.quantity}</span>
                          <button 
                            onClick={() => updateQuantity(index, 1)}
                            className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-500 hover:text-orange-600"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-zinc-100 p-4 space-y-3">
                <div className="flex justify-between text-xs font-medium text-zinc-500">
                  <span>Subtotal</span>
                  <span className="text-zinc-900">RM {subtotal.toFixed(2)}</span>
                </div>
                {serviceCharge > 0 && (
                  <div className="flex justify-between text-xs font-medium text-zinc-500">
                    <span>Service Charge ({(restaurant?.serviceCharge || 0) * 100}%)</span>
                    <span className="text-zinc-900">RM {serviceCharge.toFixed(2)}</span>
                  </div>
                )}
                {sst > 0 && (
                  <div className="flex justify-between text-xs font-medium text-zinc-500">
                    <span>SST ({(restaurant?.sst || 0) * 100}%)</span>
                    <span className="text-zinc-900">RM {sst.toFixed(2)}</span>
                  </div>
                )}
                <div className="pt-3 border-t border-zinc-100 flex justify-between items-center">
                  <span className="text-sm font-bold text-zinc-900">Order Total</span>
                  <span className="text-lg font-bold text-orange-600">RM {total.toFixed(2)}</span>
                </div>
              </div>
              
              <div className="p-3.5 flex gap-3 bg-blue-50/50 rounded-xl border border-blue-100">
                <Info className="text-blue-500 shrink-0" size={18} />
                <p className="text-[11px] font-medium text-blue-700 leading-relaxed">
                  Your order will be sent to the kitchen. Payment can be made at the counter during or after your meal.
                </p>
              </div>
            </div>

            <div className="p-4 bg-white border-t border-zinc-100 shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
              <button
                onClick={confirmOrder}
                disabled={loading || cart.length === 0}
                className="w-full h-14 bg-orange-600 text-white rounded-xl font-bold text-base hover:bg-orange-700 transition-all flex items-center justify-center shadow-lg shadow-orange-600/20 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none transition-all"
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                ) : (
                  "Place Order"
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
