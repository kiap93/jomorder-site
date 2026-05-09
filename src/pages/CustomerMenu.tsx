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

  const [isReviewingOrder, setIsReviewingOrder] = useState(false);
  const [orderType, setOrderType] = useState<'dine-in' | 'takeaway'>('dine-in');
  const [lastOrderId, setLastOrderId] = useState<string | null>(localStorage.getItem(`last_order_${restId}`));

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

    // Auto-select defaults
    item.groups?.forEach(group => {
      const defaults = group.items?.filter(i => i.defaultSelected) || [];
      if (defaults.length > 0) {
        initialState.selections[group.id] = defaults.map(d => ({
          groupItemId: d.id,
          productId: d.childProductId,
          name: d.childProduct?.name || 'Option',
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
        const fetchPromise = Promise.all([
          supabase.from('restaurants').select('*, franchise_id').eq('id', restId).single(),
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
            .eq('restaurant_id', restId)
            .eq('is_active', true),
          tableId !== 'default' && tableId ? supabase.from('tables').select('*').eq('id', tableId).single() : Promise.resolve({ data: null, error: null })
        ]);

        const [restRes, catsRes, itemsRes, tableRes] = await fetchPromise;

        if (restRes.error) throw restRes.error;
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
            productType: i.product_type || 'single',
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
          quantity: existingItem.quantity + 1
        };
        return newCart;
      }

      return [...prev, {
        menuItemId: item.id,
        name: item.name,
        price: itemTotalPrice,
        quantity: 1,
        options: [],
        selection: selection
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
          smartLines.kds = kdsMods.map(m => `• ${m.name}`);
          
          const customerMods = getVisibleModifiers(product, item.selection, 'qr_cart');
          smartLines.customer = customerMods.map(m => `• ${m.name}`);

          const receiptMods = getVisibleModifiers(product, item.selection, 'receipt');
          smartLines.receipt = receiptMods.map(m => `• ${m.name}`);
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
      <p className="text-gray-400 font-bold text-xs uppercase tracking-widest animate-pulse">Loading Menu...</p>
    </div>
  );

  if (error) return (
    <div className="h-screen flex flex-col items-center justify-center bg-white p-8 text-center">
      <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500 mb-6">
        <AlertCircle size={40} />
      </div>
      <h2 className="text-2xl font-black text-gray-900 mb-2">Oops! Something went wrong</h2>
      <p className="text-gray-500 font-medium mb-8 max-w-xs mx-auto">{error}</p>
      <button 
        onClick={() => window.location.reload()}
        className="bg-gray-900 text-white px-8 py-4 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-black transition-all shadow-xl"
      >
        Try Again
      </button>
    </div>
  );
  if (tableId === 'default') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-12 text-center font-sans">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-32 h-32 bg-orange-100 rounded-[2.5rem] flex items-center justify-center text-orange-600 mb-10 shadow-inner"
        >
          <Camera size={56} strokeWidth={1.5} />
        </motion.div>
        
        <div className="space-y-4 mb-12">
          <h1 className="text-4xl font-black text-gray-900 tracking-tighter leading-none">
            Scan to Order
          </h1>
          <p className="text-gray-500 font-bold text-lg leading-relaxed max-w-[18rem] mx-auto">
            Please scan the QR code on your table to browse our delicious menu.
          </p>
        </div>

        <div className="w-full max-w-xs relative group">
          <div className="absolute -inset-4 bg-gradient-to-br from-orange-400 to-orange-600 rounded-[3.5rem] opacity-20 blur-2xl group-hover:opacity-30 transition-opacity"></div>
          <div className="relative bg-white p-8 rounded-[3rem] border-2 border-gray-100 shadow-2xl flex flex-col items-center justify-center gap-6">
            <div className="relative">
              <div className="absolute -inset-1 rounded-2xl bg-orange-100/50 animate-pulse"></div>
              <QrCode size={160} strokeWidth={1} className="text-gray-200 relative" />
              
              {/* Corner Accents */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-orange-500 rounded-tl-xl"></div>
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-orange-500 rounded-tr-xl"></div>
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-orange-500 rounded-bl-xl"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-orange-500 rounded-br-xl"></div>
            </div>
            
            <div className="bg-gray-900 px-6 py-2 rounded-full shadow-lg">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">READY FOR SCAN</span>
            </div>
          </div>
        </div>

        <div className="mt-16 text-[10px] font-black uppercase tracking-[0.3em] text-gray-300">
          JomOrder System • Branch v1.0
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-white min-h-screen pb-32">
      {/* Language Shell */}
      <div className="bg-gray-50/50 px-6 py-2 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-gray-400">
          <Globe size={12} strokeWidth={2.5} />
          <span className="text-[10px] font-black uppercase tracking-widest leading-none">Language</span>
        </div>
        <div className="flex gap-4">
          {languages.map(lang => (
            <button
              key={lang.code}
              onClick={() => setCurrentLanguage(lang.code)}
              className={`text-[10px] font-black uppercase tracking-[0.1em] transition-all relative ${
                currentLanguage === lang.code ? 'text-orange-600 after:absolute after:-bottom-2 after:left-0 after:right-0 after:h-0.5 after:bg-orange-600' : 'text-gray-300 hover:text-gray-500'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table Status Bar */}
      <AnimatePresence>
        {table?.status === 'occupied' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-orange-600 text-white overflow-hidden py-3 px-6 flex items-center justify-center gap-2"
          >
            <AlertCircle size={14} className="animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.1em]">This table is currently marked as OCCUPIED</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md p-6 border-b border-gray-100">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tighter">{restaurant?.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="bg-orange-100 text-orange-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">Table {table?.name || tableId}</span>
              <span className="text-gray-400 text-xs font-medium">Ordering now</span>
            </div>
          </div>
          <button className="bg-gray-100 p-2.5 rounded-2xl text-gray-400">
            <Info size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search for dishes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-50 border-none rounded-2xl py-4 pl-12 pr-4 font-bold text-sm focus:ring-2 focus:ring-orange-500/20 transition-all"
          />
        </div>

        {/* Categories Bar */}
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-5 py-2.5 rounded-xl text-xs font-black whitespace-nowrap transition-all ${
              selectedCategory === 'all' ? 'bg-gray-900 text-white shadow-lg' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}
          >
            ALL DISHES
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-5 py-2.5 rounded-xl text-xs font-black whitespace-nowrap transition-all ${
                selectedCategory === cat.id ? 'bg-gray-900 text-white shadow-lg' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
              }`}
            >
              {cat.name.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {/* Menu Grid */}
      <div className="p-4 space-y-4">
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
            className="bg-white border border-gray-100 rounded-[2rem] p-4 flex gap-4 hover:shadow-lg hover:shadow-orange-100/20 transition-all group cursor-pointer"
          >
            <div className="w-24 h-24 rounded-2xl bg-gray-50 flex-shrink-0 overflow-hidden relative">
              {item.imageUrl ? (
                <img src={item.imageUrl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-200">
                  <ShoppingBag size={30} />
                </div>
              )}
              {item.status !== 'Available' && (
                <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-sm py-1">
                  <p className="text-[7px] text-center font-black text-white uppercase tracking-[0.15em]">{item.status}</p>
                </div>
              )}
            </div>
            <div className={`flex-1 flex flex-col pt-1 ${(item.status === 'Out of Stock' || item.status === 'Paused') ? 'opacity-50' : ''}`}>
              <div className="flex justify-between items-start mb-1">
                <h3 className="font-bold text-gray-800 leading-tight">{item.name}</h3>
                {item.status === 'Low Stock' && <span className="text-[8px] bg-yellow-100 text-yellow-700 font-black px-1.5 py-0.5 rounded-full uppercase ml-2 flex-shrink-0">Low</span>}
              </div>
              <p className="text-[10px] text-gray-400 line-clamp-2 mb-2 font-medium">{item.description}</p>
              <div className="mt-auto flex justify-between items-center">
                <span className="font-black text-orange-600 text-sm">RM {item.price.toFixed(2)}</span>
                
                {(item.status === 'Out of Stock' || item.status === 'Paused') ? (
                  <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest bg-gray-50 px-3 py-2 rounded-xl">
                    Unavailable
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {item.productType !== 'single' && (
                      <span className="text-[8px] font-black text-gray-300 uppercase tracking-widest">
                        {item.productType === 'combo' ? 'Bundle' : 'Custom'}
                      </span>
                    )}
                    {cart.some(i => i.menuItemId === item.id) ? (
                      <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-2 py-1">
                        <span className="text-[9px] font-black">{cart.filter(i => i.menuItemId === item.id).reduce((sum, i) => sum + i.quantity, 0)}</span>
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
                          className="p-1 text-gray-500 hover:text-orange-600 font-black"
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
                        className={`p-2 rounded-xl transition-all shadow-sm flex items-center gap-2 ${
                          item.productType === 'single' 
                            ? 'bg-orange-50 text-orange-600 hover:bg-orange-600 hover:text-white' 
                            : 'bg-gray-900 text-white hover:bg-black'
                        }`}
                      >
                        <Plus size={18} />
                        {item.productType !== 'single' && <span className="text-[10px] font-black uppercase tracking-wider pr-1">Customize</span>}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Item Detail Configurator */}
      <AnimatePresence>
        {selectedItemForDetail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex flex-col md:max-w-md md:mx-auto h-[100dvh]"
          >
            {/* Header / Hero */}
            <div className="relative h-[35vh] shrink-0 overflow-hidden">
              <motion.button
                onClick={() => setSelectedItemForDetail(null)}
                className="absolute top-6 left-6 z-20 bg-white/10 backdrop-blur-md p-3 rounded-2xl text-white hover:bg-white/20 border border-white/10"
                whileTap={{ scale: 0.9 }}
              >
                <X size={24} />
              </motion.button>
              
              {selectedItemForDetail.imageUrl ? (
                <img 
                  src={selectedItemForDetail.imageUrl} 
                  className="w-full h-full object-cover opacity-60"
                  alt={selectedItemForDetail.name}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-800">
                  <ShoppingBag size={100} strokeWidth={1} />
                </div>
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
              
              <div className="absolute bottom-8 left-8 right-8 text-white">
                <div className="flex items-center gap-3 mb-3">
                  <span className="bg-orange-500 text-white text-[9px] font-black uppercase px-2.5 py-1 rounded-md tracking-[0.2em] shadow-[0_0_15px_rgba(249,115,22,0.4)]">
                    {selectedItemForDetail.productType}
                  </span>
                  {selectedItemForDetail.status !== 'Available' && (
                    <span className="bg-zinc-800 text-zinc-400 text-[9px] font-black uppercase px-2.5 py-1 rounded-md tracking-[0.2em] border border-white/5">
                      {selectedItemForDetail.status}
                    </span>
                  )}
                </div>
                <h2 className="text-4xl font-black tracking-tight leading-none mb-2">{selectedItemForDetail.name}</h2>
                <p className="text-zinc-500 text-xs font-medium line-clamp-2">{selectedItemForDetail.description}</p>
              </div>
            </div>

            {/* Configurator Body */}
            <div className="flex-1 overflow-y-auto px-8 py-10 space-y-12 scrollbar-hide">
              <div className="flex justify-between items-center bg-white/[0.03] border border-white/[0.05] p-6 rounded-[2rem]">
                <div>
                  <p className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.2em] mb-1">Configuration Total</p>
                  <p className="text-3xl font-black text-white leading-none">
                    <span className="text-lg opacity-40 font-bold mr-1">{restaurant?.currency || 'RM'}</span>
                    {selectionState ? calculateSelectionPrice(selectedItemForDetail, selectionState).toFixed(2) : selectedItemForDetail.price.toFixed(2)}
                  </p>
                </div>
                <div className="flex flex-col items-end">
                  <p className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.2em] mb-1">Base Price</p>
                  <p className="font-bold text-zinc-400">{restaurant?.currency} {selectedItemForDetail.price.toFixed(2)}</p>
                </div>
              </div>

              {selectionState ? (
                <ProductConfigurator 
                  product={selectedItemForDetail} 
                  selection={selectionState} 
                  onChange={setSelectionState}
                  currency={restaurant?.currency || 'RM'}
                />
              ) : (
                <div className="text-center py-20 text-zinc-700 font-black uppercase tracking-widest text-xs">
                  Simple product (no options)
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-8 bg-black/60 backdrop-blur-2xl border-t border-white/5">
              {(() => {
                const validation = selectionState ? validateSelection(selectedItemForDetail, selectionState) : { isValid: true, errors: [] };
                const isValid = validation.isValid;
                const cartIndex = selectionState ? getCartItemIndex(selectedItemForDetail.id, undefined, selectionState) : -1;
                const quantity = cartIndex > -1 ? cart[cartIndex].quantity : 0;

                return (
                  <div className="space-y-4">
                    {!isValid && (
                      <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-start gap-3">
                        <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1">Attention Required</p>
                          <div className="space-y-0.5">
                            {validation.errors.map((err, i) => (
                              <p key={i} className="text-xs text-white/70 font-medium">{err}</p>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {quantity > 0 ? (
                      <div className="flex items-center gap-4">
                        <div className="flex-1 flex items-center justify-between bg-white/5 border border-white/10 p-2 rounded-[2.5rem]">
                          <button 
                            onClick={() => updateQuantity(cartIndex, -1)}
                            className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center text-white hover:bg-red-500/20 hover:text-red-500 transition-all font-black"
                          >
                            <Minus size={24} />
                          </button>
                          <div className="text-center">
                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">In Basket</p>
                            <p className="text-2xl font-black text-white">{quantity}</p>
                          </div>
                          <button 
                            onClick={() => updateQuantity(cartIndex, 1)}
                            className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center text-white hover:bg-orange-500/20 hover:text-orange-500 transition-all font-black"
                          >
                            <Plus size={24} />
                          </button>
                        </div>
                        <button
                          onClick={() => setSelectedItemForDetail(null)}
                          className="bg-white text-black px-10 h-18 rounded-[2.5rem] font-black text-xs uppercase tracking-widest hover:bg-zinc-200 transition-all shadow-xl"
                        >
                          Done
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
                        className={`w-full py-7 rounded-[2.5rem] font-black text-lg transition-all shadow-2xl flex items-center justify-center gap-3 active:scale-[0.98] ${
                          isValid 
                            ? 'bg-orange-500 text-white hover:bg-orange-600 shadow-orange-500/20' 
                            : 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50'
                        }`}
                      >
                        {isValid ? <Plus size={24} strokeWidth={3} /> : <AlertCircle size={24} />}
                        {isValid 
                          ? (selectedItemForDetail.productType === 'single' ? 'Add to Basket' : `Add to Basket • ${restaurant?.currency}${selectionState ? calculateSelectionPrice(selectedItemForDetail, selectionState).toFixed(2) : selectedItemForDetail.price.toFixed(2)}`)
                          : 'Incomplete Selection'}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cart Navigation Bar */}
      <AnimatePresence>
        {cart.length > 0 && !isReviewingOrder && (
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-8 left-4 right-4 z-50"
          >
            <button
              onClick={() => setIsReviewingOrder(true)}
              className="w-full bg-gray-900 text-white p-6 rounded-[2.5rem] shadow-2xl flex items-center justify-between group hover:bg-black transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="bg-orange-600 text-white w-10 h-10 rounded-full flex items-center justify-center font-black animate-pulse">
                  {cart.reduce((a, b) => a + b.quantity, 0)}
                </div>
                <div className="text-left">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">View Basket</p>
                  <p className="text-lg font-black tracking-tight">RM {subtotal.toFixed(2)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black uppercase tracking-widest bg-white/10 px-4 py-2 rounded-full">Checkout</span>
                <ChevronRight className="group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Order Review Overlay */}
      <AnimatePresence>
        {isReviewingOrder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-white flex flex-col"
          >
            <header className="p-6 border-b border-gray-100 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0">
              <button 
                onClick={() => setIsReviewingOrder(false)}
                className="p-2 bg-gray-50 rounded-2xl text-gray-400 hover:text-gray-900 transition-colors"
              >
                <X size={24} />
              </button>
              <h2 className="text-xl font-black text-gray-900">Your Order</h2>
              <div className="w-10" /> {/* Spacer */}
            </header>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Order Type Selector */}
              <div className="grid grid-cols-2 gap-3 p-1.5 bg-gray-100 rounded-[2rem]">
                <button
                  onClick={() => setOrderType('dine-in')}
                  className={`py-4 rounded-[1.5rem] font-black text-xs uppercase tracking-widest transition-all ${
                    orderType === 'dine-in' ? 'bg-white shadow-md text-gray-900' : 'text-gray-400'
                  }`}
                >
                  🧍 Dine In
                </button>
                <button
                  onClick={() => setOrderType('takeaway')}
                  className={`py-4 rounded-[1.5rem] font-black text-xs uppercase tracking-widest transition-all ${
                    orderType === 'takeaway' ? 'bg-white shadow-md text-gray-900' : 'text-gray-400'
                  }`}
                >
                  🚶 Takeaway
                </button>
              </div>

              <div className="space-y-4">
                {cart.map((item, index) => (
                  <div key={index} className="flex gap-4 items-start pb-4 border-b border-gray-50 last:border-0">
                    <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400 font-bold">
                      {item.quantity}x
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-gray-900 leading-tight">{item.name}</h4>
                        <span className="font-black text-sm text-gray-900">RM {(item.price * item.quantity).toFixed(2)}</span>
                      </div>
                      {item.smartRenderedLines?.customer ? (
                        <div className="mt-1 space-y-0.5">
                          {item.smartRenderedLines.customer.map((line, i) => (
                            <p key={i} className="text-[10px] text-zinc-400 font-bold leading-tight">{line}</p>
                          ))}
                        </div>
                      ) : item.selection ? (
                        <div className="mt-1 space-y-0.5">
                          {flattenSelections(item.selection).map((line, i) => (
                            <p key={i} className="text-[10px] text-zinc-400 font-bold leading-tight">{line}</p>
                          ))}
                        </div>
                      ) : item.options.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.options.map((opt, i) => (
                            <span key={i} className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-bold">
                              {opt.optionName}: {opt.valueName}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-4 mt-3">
                        <div className="flex items-center gap-3 bg-gray-100 rounded-xl px-2 py-1">
                          <button onClick={() => updateQuantity(index, -1)} className="p-1 text-gray-500 hover:text-red-500"><Minus size={14} /></button>
                          <span className="text-xs font-black">{item.quantity}</span>
                          <button onClick={() => updateQuantity(index, 1)} className="p-1 text-gray-500 hover:text-orange-600"><Plus size={14} /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-orange-50 rounded-[2.5rem] p-8 space-y-4">
                <div className="flex justify-between text-sm font-bold text-gray-500">
                  <span>Subtotal</span>
                  <span>RM {subtotal.toFixed(2)}</span>
                </div>
                {serviceCharge > 0 && (
                  <div className="flex justify-between text-sm font-bold text-gray-500">
                    <span>Service Charge ({(restaurant?.serviceCharge || 0) * 100}%)</span>
                    <span>RM {serviceCharge.toFixed(2)}</span>
                  </div>
                )}
                {sst > 0 && (
                  <div className="flex justify-between text-sm font-bold text-gray-500">
                    <span>SST ({(restaurant?.sst || 0) * 100}%)</span>
                    <span>RM {sst.toFixed(2)}</span>
                  </div>
                )}
                <div className="pt-4 border-t-2 border-orange-200 flex justify-between items-center">
                  <span className="text-xl font-black text-gray-900 uppercase tracking-tighter">Total</span>
                  <span className="text-2xl font-black text-orange-600">RM {total.toFixed(2)}</span>
                </div>
              </div>
              
              <div className="p-4 flex gap-3 text-start bg-gray-50 rounded-2xl">
                <Info className="text-gray-400 shrink-0" size={20} />
                <p className="text-[11px] font-bold text-gray-400 leading-relaxed">
                  Your order will be sent to the kitchen once you confirm. You can pay at the counter later.
                </p>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 bg-white">
              <button
                onClick={confirmOrder}
                disabled={loading || cart.length === 0}
                className="w-full bg-gray-900 text-white py-6 rounded-[2rem] font-bold text-xl hover:bg-black transition-all shadow-2xl disabled:bg-gray-400 disabled:shadow-none relative overflow-hidden"
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
                ) : (
                  "Confirm & Order Now"
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
