import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getApiUrl } from '../lib/api';
import { indexedDbStorage } from '../lib/indexedDbStorage';
import { guestSupabase as supabase } from '../lib/supabase';
import { MutationQueue } from '../lib/mutationQueue';
import { Category, MenuItem, OrderItem, Restaurant, Table, ProductSelection, SelectedGroupItem, LanguageCode, Product, BasketItem, SessionEpoch } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingBag, ChevronRight, Minus, Plus, Search, Info, X, Camera, QrCode, AlertCircle, Clock, Check, Globe, ChefHat } from 'lucide-react';
import { resolveMenuTranslations, resolveCategoryTranslations, TranslationContext, getKitchenCanonical } from '../lib/translationEngine';
import { calculateSelectionPrice, validateSelection, flattenSelections } from '../lib/configEngine';
import { formatCurrency } from '../lib/localization';
import { ProductConfigurator } from '../components/ProductConfigurator';
import { getVisibleModifiers } from '../lib/modifierEngine';
import { offlineService } from '../lib/offlineService';
import { printerService } from '../services/printerService';
import { Order } from '../types';

interface RawDbProduct {
  id: string;
  restaurant_id: string;
  category_id: string;
  name: string;
  price?: number | string;
  base_price?: number | string;
  image_url?: string;
  description?: string;
  is_active: boolean;
  status?: string;
  product_type?: string;
  combo_groups?: any[];
  modifier_groups?: any[];
}

async function getSessionEpochAsync(tableId: string): Promise<SessionEpoch | null> {
  const storageKey = `dining_session_token_${tableId}`;
  const raw = await indexedDbStorage.getItem<unknown>(storageKey);
  if (!raw) return null;
  if (typeof raw === 'object' && raw !== null) {
    const rawObj = raw as Record<string, unknown>;
    if (typeof rawObj.token === 'string') {
      return {
        token: rawObj.token,
        version: typeof rawObj.version === 'number' ? rawObj.version : 1,
        issued_at: typeof rawObj.issued_at === 'number' ? rawObj.issued_at : Date.now()
      };
    }
  }
  if (typeof raw === 'string') {
    if (raw.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && typeof parsed.token === 'string') {
          return {
            token: parsed.token,
            version: typeof parsed.version === 'number' ? parsed.version : 1,
            issued_at: typeof parsed.issued_at === 'number' ? parsed.issued_at : Date.now()
          };
        }
      } catch (_) {}
    }
    return {
      token: raw,
      version: 1,
      issued_at: Date.now()
    };
  }
  return null;
}

async function updateSessionEpochAsync(tableId: string, token: string): Promise<SessionEpoch> {
  const storageKey = `dining_session_token_${tableId}`;
  const existing = await getSessionEpochAsync(tableId);
  const now = Date.now();
  
  let newEpoch: SessionEpoch;
  if (existing) {
    if (existing.token === token) {
      newEpoch = {
        token,
        version: existing.version,
        issued_at: existing.issued_at
      };
    } else {
      newEpoch = {
        token,
        version: existing.version + 1,
        issued_at: now
      };
      console.log(`[Token Versioning] Session epoch advanced to version ${newEpoch.version} due to new session token.`);
    }
  } else {
    newEpoch = {
      token,
      version: 1,
      issued_at: now
    };
  }
  
  await indexedDbStorage.setItem(storageKey, newEpoch);
  return newEpoch;
}

export function CustomerMenu() {
  const { restId, tableId, sessionId: urlSessionId } = useParams();
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [originalCategories, setOriginalCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [originalMenuItems, setOriginalMenuItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [basketId, setBasketId] = useState<string | null>(null);

  const syncLocalCartFromServer = (basketItems: (BasketItem & { product_id?: string; menu_item_id?: string; special_instructions?: string; special_Instructions?: string; notes?: string })[], allProducts: MenuItem[]) => {
    const newCart: OrderItem[] = basketItems.map(item => {
      const product = allProducts.find(p => p.id === item.product_id || p.id === item.menu_item_id);
      if (!product) return null;

      const selection = item.configuration as ProductSelection;
      const kdsMods = getVisibleModifiers(product, selection, 'kds');
      const customerMods = getVisibleModifiers(product, selection, 'qr_cart');
      const receiptMods = getVisibleModifiers(product, selection, 'receipt');

      return {
        id: item.id,
        menuItemId: product.id,
        name: product.name,
        price: calculateSelectionPrice(product, selection),
        quantity: item.quantity,
        options: [],
        selection: selection,
        specialInstructions: item.special_instructions || item.special_Instructions || item.notes || '',
        smartRenderedLines: {
          kds: kdsMods.map(m => `${"  ".repeat(m.depth)}• ${m.name}`),
          customer: customerMods.map(m => `${"  ".repeat(m.depth)}• ${m.name}`),
          receipt: receiptMods.map(m => `${"  ".repeat(m.depth)}• ${m.name}`)
        }
      };
    }).filter(i => i !== null) as OrderItem[];

    setCart(newCart);
  };
  
  // Persistence for Cart is now handled by the server. 
  // We keep a local cache for offline/optimistic if needed, but primarily use server data.

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItemForDetail, setSelectedItemForDetail] = useState<MenuItem | null>(null);
  const [selectionState, setSelectionState] = useState<ProductSelection | null>(null);
  
  const [currentLanguage, setCurrentLanguage] = useState<LanguageCode>('en');
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);

  const [isReviewingOrder, setIsReviewingOrder] = useState(false);
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>('dine_in');
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  const [hasActiveOrders, setHasActiveOrders] = useState(false);
  const [diningSession, setDiningSession] = useState<{ id: string; token: string; status?: string } | null>(null);
  const [basketVersion, setBasketVersion] = useState<number>(0);
  const [isOnline, setIsOnline] = useState(true);
  const [paymentSettings, setPaymentSettings] = useState<{ provider?: string; enabled_methods?: string[] } | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [restId, tableId]);

  useEffect(() => {
    return offlineService.subscribeConnectivity(setIsOnline);
  }, []);
  const mutationQueue = useRef<MutationQueue | null>(null);
  const fetchDataInProgress = useRef(false);

  useEffect(() => {
    mutationQueue.current = new MutationQueue((data) => {
      // If mutation returns a new version or status, update it
      if (data?.basket_version) setBasketVersion(data.basket_version);
    });
  }, []);

  useEffect(() => {
    if (cart && cart.length > 0) {
      offlineService.saveLocalCart(cart.map(item => ({
        id: item.id || Math.random().toString(36).slice(2),
        menuItemId: item.menuItemId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        selection: item.selection || { productId: item.menuItemId, selections: {} },
        subtotal: item.price * item.quantity,
        notes: item.specialInstructions
      })));
    } else {
      offlineService.clearLocalCart();
    }
  }, [cart]);

  useEffect(() => {
    const loadLastOrder = async () => {
      const orderId = await indexedDbStorage.getItem<string>(`last_order_${restId}_${tableId}`);
      setLastOrderId(orderId);
    };
    loadLastOrder();
  }, [restId, tableId]);

  useEffect(() => {
    if (!diningSession?.id) return;

    const checkOrders = async () => {
      try {
        const response = await fetch(getApiUrl(`/api/public/orders/check?sessionId=${diningSession.id}`));
        if (!response.ok) throw new Error("Failed to check orders");
        const { orders: data, count } = await response.json();
        
        setHasActiveOrders(!!count && count > 0);
        if (data && data.length > 0) {
          setLastOrderId(data[0].id);
        }
      } catch (err) {
        console.error("Error checking orders:", err);
      }
    };

    checkOrders();

    // Subscribe to changes
    const channel = supabase.channel(`orders-${diningSession.id}`)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'orders',
        filter: `session_id=eq.${diningSession.id}`
      }, () => checkOrders())
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [diningSession?.id]);

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

  const lastFocusRefresh = useRef(0);
  const restaurantRef = useRef<Restaurant | null>(null);
  const menuItemsLengthRef = useRef(0);

  useEffect(() => {
    restaurantRef.current = restaurant;
    menuItemsLengthRef.current = menuItems.length;
  }, [restaurant, menuItems.length]);

  const fetchData = useCallback(async (isInitial = false) => {
    if (!restId || restId === 'undefined' || restId === 'null') {
      setLoading(false);
      return;
    }
    // Only prevent concurrent MANUAL or FOCUS refreshes.
    // Initial effect-triggered ones must ALWAYS proceed to set loading state correctly.
    if (fetchDataInProgress.current && !isInitial) return;
    fetchDataInProgress.current = true;
    
    const shouldShowLoading = isInitial || (!restaurantRef.current && menuItemsLengthRef.current === 0);
    if (shouldShowLoading) {
      setLoading(true);
      setDiningSession(null); // Only clear session on initial/full load
    }
    setError(null);
    let processedItems: MenuItem[] = [];

    const maxRetries = 2;
    let attempt = 0;

    const tryFetch = async (): Promise<void> => {
      try {
        console.time("fetchData-initial");
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tableId || '');
        const tableQuery = (tableId && tableId !== 'default')
          ? (isUuid 
              ? supabase.from('tables').select('id,restaurant_id,name,status,created_at').eq('id', tableId).maybeSingle()
              : supabase.from('tables').select('id,restaurant_id,name,status,created_at').eq('restaurant_id', restId).eq('name', tableId).maybeSingle())
          : Promise.resolve({ data: null, error: null });

        // Add a safety timeout for the parallel fetch
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Loading restaurant data timed out. Please try again or check your connection.")), 30000)
        );

        let restRes, catsRes, tableRes, itemsRes, paymentSettingsRes;

        try {
          console.log("Fetching primary data: restaurant, categories, table...");
          const responses = await Promise.race([
            Promise.all([
              fetch(getApiUrl(`/api/public/restaurants/${restId}`)).then(r => r.json()),
              fetch(getApiUrl(`/api/public/restaurants/${restId}/categories`)).then(r => r.json()),
              fetch(getApiUrl(`/api/public/tables/${tableId}?restId=${restId}`)).then(r => r.json()),
              fetch(getApiUrl(`/api/public/restaurants/${restId}/menu-items`)).then(r => r.json()),
              fetch(getApiUrl(`/api/restaurants/${restId}/public-payment-settings`)).then(r => r.ok ? r.json() : null).catch(() => null)
            ]),
            timeoutPromise
          ]) as [unknown, unknown, unknown, unknown, unknown];

          restRes = responses[0];
          catsRes = responses[1];
          tableRes = responses[2];
          itemsRes = responses[3];
          paymentSettingsRes = responses[4];

          if (paymentSettingsRes) {
            setPaymentSettings(paymentSettingsRes);
          }

          // Store successful payloads to local cache
          if (restRes && !(restRes as any).error) {
            await indexedDbStorage.setItem(`pos_rest_cache_${restId}`, restRes);
          }
          if (catsRes && Array.isArray(catsRes)) {
            await indexedDbStorage.setItem(`pos_cats_cache_${restId}`, catsRes);
          }
          if (tableRes) {
            await indexedDbStorage.setItem(`pos_table_cache_${restId}_${tableId}`, tableRes);
          }
          if (itemsRes && Array.isArray(itemsRes)) {
            await indexedDbStorage.setItem(`pos_menu_items_cache_${restId}`, itemsRes);
          }
        } catch (netErr) {
          console.warn("Network request failed, loading cached offline configuration:", netErr);
          // Restore from cache
          const cachedRest = await indexedDbStorage.getItem(`pos_rest_cache_${restId}`);
          const cachedCats = await indexedDbStorage.getItem(`pos_cats_cache_${restId}`);
          const cachedTable = await indexedDbStorage.getItem(`pos_table_cache_${restId}_${tableId}`);
          const cachedItems = await indexedDbStorage.getItem(`pos_menu_items_cache_${restId}`);

          if (cachedRest) restRes = cachedRest;
          if (cachedCats) catsRes = cachedCats;
          if (cachedTable) tableRes = cachedTable;
          if (cachedItems) itemsRes = cachedItems;

          if (!restRes) {
            throw new Error("Working Offline: No cached content found. Please connect to internet once to download the restaurant settings.");
          }
        }

        if (restRes.error) throw new Error(restRes.error);
        if (!restRes) throw new Error("Restaurant not found. Please check correctly.");
        
        const resolvedTable = tableRes as Table | null;
        if (resolvedTable) {
          setTable(prev => (prev?.id === resolvedTable.id && prev?.status === resolvedTable.status) ? prev : resolvedTable);
        }

        // Resolve Dining Session if not in preview mode and we have a resolved UUID
        let currentSession: { id: string; token: string; status: string } | null = null;
        if (!isPreviewMode && resolvedTable?.id) {
          console.time("fetchData-session");
          const epoch = await getSessionEpochAsync(resolvedTable.id);
          const clientToken = epoch ? epoch.token : null;

          try {
            console.log("Resolving dining session...");
            const sessionRes = await fetch(getApiUrl(`/api/public/resolve-session`), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                restaurantId: restId,
                tableId: resolvedTable.id,
                deviceInfo: navigator.userAgent,
                clientToken: clientToken,
                fulfillment: orderType
              })
            });

            if (sessionRes.ok) {
              const sessionData = await sessionRes.json();

              if (sessionData && sessionData[0]) {
                currentSession = {
                  id: sessionData[0].session_id,
                  token: sessionData[0].token,
                  status: sessionData[0].session_status
                };
                await updateSessionEpochAsync(resolvedTable.id, sessionData[0].token);
                setDiningSession(prev => (prev?.id === currentSession?.id && prev?.status === currentSession?.status) ? prev : currentSession);
                if (urlSessionId !== currentSession.id) {
                  navigate(`/restaurant/${restId}/table/${tableId}/session/${currentSession.id}`, { replace: true });
                }
              }
            }
          } catch (e: unknown) {
            console.warn("Session resolution non-fatal error", e);
          }
          console.timeEnd("fetchData-session");
        }

        processedItems = (itemsRes as RawDbProduct[] || []).map((i) => ({
          id: i.id,
          restaurantId: i.restaurant_id,
          categoryId: i.category_id,
          name: i.name,
          price: typeof i.price === 'string' ? parseFloat(i.price) : (i.price || 0),
          basePrice: typeof i.base_price === 'string' ? parseFloat(i.base_price) : (i.base_price || (typeof i.price === 'string' ? parseFloat(i.price) : (i.price || 0))),
          imageUrl: i.image_url,
          description: i.description,
          isActive: i.is_active,
          status: (i.status || 'Available') as any,
          productType: (i.product_type || 'single') as any,
          comboGroups: (i.combo_groups || []).map((g: any) => ({
            id: g.id,
            productId: g.combo_product_id,
            name: g.name,
            description: g.description,
            required: g.required,
            minSelect: g.min_select,
            maxSelect: g.max_select,
            displayBehavior: g.display_behavior,
            importance: g.importance,
            sortOrder: g.sort_order,
            items: (g.items || g.combo_group_items || []).map((gi: any) => ({
              id: gi.id,
              groupId: gi.group_id,
              childProductId: gi.child_product_id,
              customName: gi.custom_name,
              priceDelta: parseFloat(gi.price_delta || 0),
              defaultSelected: gi.default_selected,
              displayBehavior: gi.display_behavior,
              importance: gi.importance,
              sortOrder: gi.sort_order,
              childProduct: gi.child_product ? {
                id: gi.child_product.id,
                name: gi.child_product.name,
                price: parseFloat(gi.child_product.base_price || 0),
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
              renderImportance: m.render_importance,
              displayBehavior: m.display_behavior,
              sortOrder: m.sort_order
            }))
          }))
        }));

        setRestaurant(prev => {
          const nr: Restaurant = { 
            id: restRes.id, 
            name: restRes.name, 
            currency: restRes.currency, 
            serviceCharge: parseFloat(restRes.service_charge || 0) / 100, 
            sst: (() => {
              const activeProfile = restRes.tax_profiles?.find((tp: any) => tp.is_active);
              if (activeProfile) {
                return parseFloat(activeProfile.tax_rate || 0) / 100;
              }
              return parseFloat(restRes.sst || 0) / 100;
            })(),
            franchiseId: restRes.franchise_id,
            payment_mode: restRes.payment_mode || 'pay_first'
          };
          return JSON.stringify(prev) === JSON.stringify(nr) ? prev : nr;
        });
        
        if (Array.isArray(catsRes)) {
          const mappedCats = catsRes.map(c => ({ id: c.id, name: c.name, order: c.sort_order }));
          setCategories(mappedCats);
          setOriginalCategories(mappedCats);
        }
        setOriginalMenuItems(processedItems);
        setMenuItems(processedItems);

        let basketLoaded = false;
        if (currentSession?.id) {
          try {
            const bRes = await fetch(getApiUrl(`/api/public/baskets?sessionId=${currentSession.id}`));
            if (bRes.ok) {
              const basketData = await bRes.json();
              if (basketData) {
                setBasketId(basketData.id);
                if (basketData.basket_version) setBasketVersion(basketData.basket_version);
                const biRes = await fetch(getApiUrl(`/api/public/baskets/${basketData.id}/items`));
                if (biRes.ok) {
                  const items = await biRes.json();
                  if (items) {
                    syncLocalCartFromServer(items, processedItems);
                    basketLoaded = true;
                  }
                }
              }
            }
          } catch (bErr) {
            console.warn("Failed session-basket online load, falling back to local cached basket", bErr);
          }
        }

        if (!basketLoaded) {
          const offlineCart = await offlineService.getLocalCart();
          if (offlineCart && offlineCart.length > 0) {
            console.log("Loading offline basket cache from IndexedDB:", offlineCart);
            setCart(offlineCart.map(i => ({
              id: i.id,
              menuItemId: i.menuItemId,
              name: i.name,
              price: i.price,
              quantity: i.quantity,
              options: [],
              selection: i.selection,
              specialInstructions: i.notes,
              smartRenderedLines: {}
            })));
          }
        }
      } catch (err: unknown) {
        const errorObject = err as (Error & { name?: string });
        const isLockError = errorObject?.name === 'AbortError' || errorObject?.message?.includes('Lock broken');
        if (isLockError && attempt < maxRetries) {
          attempt++;
          console.warn(`FetchData attempt ${attempt} lock conflict, retrying...`);
          await new Promise(r => setTimeout(r, 500 * attempt));
          return tryFetch();
        }
        throw err;
      }
    };

    try {
      await tryFetch();
    } catch (err: unknown) {
      const errorObject = err as (Error & { name?: string });
      if (errorObject?.name === 'AbortError' || errorObject?.message?.includes('Lock broken')) {
         console.warn("Fetch data permanently aborted by lock contention.");
         return;
      }
      console.error("Fetch data failed:", err);
      setError(errorObject?.message || "Failed to load menu data");
    } finally {
      fetchDataInProgress.current = false;
      setLoading(false);
    }
  }, [restId, tableId, orderType, isPreviewMode, urlSessionId, navigate]); // Stabilized dependencies

  useEffect(() => {
    if (!restId || restId === 'undefined' || restId === 'null') return;
    const controller = new AbortController();
    
    fetchData(true);

    const handleFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefresh.current < 30000) return; // 30s throttle
      lastFocusRefresh.current = now;
      
      console.log("Window focused, refreshing menu...");
      if (!fetchDataInProgress.current) fetchData(false);
    };
    window.addEventListener('focus', handleFocus);

    // Subscribe to table changes if it's a specific table
    let subscription: ReturnType<typeof supabase.channel> | null = null;
    if (tableId && tableId !== 'default') {
      subscription = supabase
        .channel(`table-${tableId}-${Math.random().toString(36).slice(2)}`)
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
      controller.abort();
      if (subscription) supabase.removeChannel(subscription);
      window.removeEventListener('focus', handleFocus);
    };
  }, [restId, tableId]);

  useEffect(() => {
    // Re-resolve session if orderType changes (e.g. switching to Takeaway might create a different session behavior)
    if (diningSession && table?.id && restId) {
       const tryResolve = async () => {
         const epoch = await getSessionEpochAsync(table.id);
         const clientToken = epoch ? epoch.token : null;
         const maxRetries = 2;
         let attempt = 0;

         const attemptResolve = async (): Promise<void> => {
           try {
             let res = await supabase.rpc('resolve_dining_session_v2', {
                p_restaurant_id: restId,
                p_table_id: table.id,
                p_device_info: navigator.userAgent,
                p_client_token: clientToken,
                p_fulfillment: orderType
             });

             if (res.error && (res.error.code === 'PGRST202' || res.error.message.includes('p_fulfillment'))) {
               res = await supabase.rpc('resolve_dining_session_v2', {
                  p_restaurant_id: restId,
                  p_table_id: table.id,
                  p_device_info: navigator.userAgent,
                  p_client_token: clientToken
               });
             }

             if (res.error) {
                if ((res.error.message?.includes('Lock broken') || res.error.name === 'AbortError') && attempt < maxRetries) {
                  attempt++;
                  await new Promise(r => setTimeout(r, 500 * attempt));
                  return attemptResolve();
                }
                console.error("Secondary session resolution failed:", res.error);
                return;
             }

             if (res.data && res.data[0]) {
               await updateSessionEpochAsync(table.id, res.data[0].token);
               setDiningSession({
                  id: res.data[0].session_id,
                  token: res.data[0].token,
                  status: res.data[0].session_status
               });
             }
           } catch (e: unknown) {
             const errObj = e as (Error & { name?: string });
             if ((errObj?.message?.includes('Lock broken') || errObj?.name === 'AbortError') && attempt < maxRetries) {
               attempt++;
               await new Promise(r => setTimeout(r, 500 * attempt));
               return attemptResolve();
             }
           }
         };

         await attemptResolve();
       };

       tryResolve();
    }
  }, [orderType]);

  // Listen for storage changes to prevent stale tabs overwriting sessions
  useEffect(() => {
    if (!table?.id) return;
    
    const handleStorageChange = (e: StorageEvent) => {
      const storageKey = `dining_session_token_${table.id}`;
      if (e.key === storageKey && e.newValue) {
        console.log("[Token Versioning] Storage change detected on other tab:", e.newValue);
        try {
          let newToken = '';
          if (e.newValue.trim().startsWith('{')) {
            const parsed = JSON.parse(e.newValue);
            newToken = parsed.token;
          } else {
            newToken = e.newValue;
          }
          
          if (newToken && diningSession && newToken !== diningSession.token) {
            console.log("[Token Versioning] Session token updated on another tab. Reloading active session to avoid stale tab overwrites.");
            window.location.reload();
          }
        } catch (_) {}
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [table?.id, diningSession?.token]);

  // Subscription for session changes
  useEffect(() => {
    if (!diningSession?.id || !table?.id) return;
    
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(`session-${diningSession.id}-${uniqueSuffix}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'dining_sessions',
        filter: `id=eq.${diningSession.id}`
      }, (payload) => {
        setDiningSession(prev => ({
          ...prev!,
          status: payload.new.status
        }));
        
        if (payload.new.status === 'closed' || payload.new.status === 'expired' || payload.new.status === 'replaced') {
          indexedDbStorage.removeItem(`dining_session_token_${table.id}`);
          indexedDbStorage.removeItem(`last_order_${restId}_${tableId}`);
          
          if (payload.new.status === 'replaced') {
             window.location.href = `/restaurant/${restId}/table/${tableId}`;
             return;
          }

          setDiningSession(null);
          setCart([]);
          // Redirect to base URL to clear session from URL
          navigate(`/restaurant/${restId}/table/${tableId}`, { replace: true });
          window.location.reload();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [diningSession?.id, table?.id]);

  // Real-time synchronization for collaborative ordering
  useEffect(() => {
    if (!basketId) return;

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(`basket-${basketId}-${uniqueSuffix}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'basket_items',
        filter: `basket_id=eq.${basketId}`
      }, async (payload) => {
        // Only reconcile if we aren't currently pushing mutations
        // or if it's a mutation from another device/tab
        if (mutationQueue.current?.isIdle) {
          try {
            const { data: items, error } = await supabase
              .from('basket_items')
              .select('id, basketId:basket_id, productId:product_id, quantity, configuration, deviceInfo:device_info, createdAt:created_at, updatedAt:updated_at')
              .eq('basket_id', basketId);
            
            if (items) {
              syncLocalCartFromServer(items, originalMenuItems);
            }
          } catch (err: unknown) {
             const errorObject = err as Error;
             console.error("Basket reconciliation error:", errorObject?.message || err);
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [basketId, originalMenuItems]);

  // Handle translation updates
  useEffect(() => {
    if (!restaurant || (originalMenuItems.length === 0 && originalCategories.length === 0)) return;

    const translateMenu = async () => {
      const context: TranslationContext = {
        restaurantId: restaurant.id,
        franchiseId: restaurant.franchiseId,
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

  const addToCart = async (item: MenuItem, selection: ProductSelection) => {
    // 1. Ensure we have a session
    let currentSessionId = diningSession?.id;
    let currentSessionToken = diningSession?.token;
    
    if (!currentSessionId) {
      if (isPreviewMode) {
        alert("Ordering is disabled in Preview Mode. Scan a real QR at a table to start a session.");
        return;
      }
      
      console.log("No session found for addToCart, attempting recovery...");
      // Proactive recovery attempt
      await fetchData(false);
      currentSessionId = diningSession?.id;
      currentSessionToken = diningSession?.token;
      
      if (!currentSessionId) {
        console.error("Could not resolve session for addToCart.");
        return;
      }
    }

    // 2. Optimistic Update for immediate feedback
    const kdsMods = getVisibleModifiers(item, selection, 'kds');
    const customerMods = getVisibleModifiers(item, selection, 'qr_cart');
    const receiptMods = getVisibleModifiers(item, selection, 'receipt');

    const optimisticItem: OrderItem = {
      id: 'optimistic-' + Math.random().toString(36).substr(2, 9),
      menuItemId: item.id,
      name: item.name,
      price: calculateSelectionPrice(item, selection),
      quantity: 1,
      options: [],
      selection: selection,
      specialInstructions: '',
      smartRenderedLines: {
        kds: kdsMods.map(m => `${"  ".repeat(m.depth)}• ${m.name}`),
        customer: customerMods.map(m => `${"  ".repeat(m.depth)}• ${m.name}`),
        receipt: receiptMods.map(m => `${"  ".repeat(m.depth)}• ${m.name}`)
      }
    };

    const existingIndex = cart.findIndex(i => {
      if (i.menuItemId !== item.id) return false;
      return i.selection && JSON.stringify(i.selection) === JSON.stringify(selection);
    });

    if (existingIndex > -1) {
      const newCart = [...cart];
      newCart[existingIndex].quantity += 1;
      setCart(newCart);
    } else {
      setCart(prev => [...prev, optimisticItem]);
    }

    // 3. Sync with Server via Queue
    const mutationKey = Math.random().toString(36).slice(2, 11);
    
    const syncUrl = getApiUrl(`/api/public/sync-basket-item`);
    const syncOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_session_id: currentSessionId,
        p_session_token: currentSessionToken,
        p_product_id: item.id,
        p_delta: 1,
        p_configuration: selection,
        p_device_info: navigator.userAgent,
        p_idempotency_key: mutationKey
      })
    };

    mutationQueue.current?.enqueue(async () => {
      const response = await fetch(syncUrl, syncOptions);

      if (!response.ok) {
        console.error("Failed to sync basket item");
        return null;
      }

      const result = await response.json();
      if (result?.basket_id && !basketId) {
        setBasketId(result.basket_id);
      }
      return result;
    }, { url: syncUrl, options: syncOptions });
  };

  const updateQuantity = async (index: number, delta: number) => {
    let currentSessionId = diningSession?.id;
    let currentSessionToken = diningSession?.token;
    const item = cart[index];
    if (!item) return;

    // 1. Session Recovery
    if (!currentSessionId) {
      console.log("No session found for updateQuantity, attempting recovery...");
      await fetchData(false);
      currentSessionId = diningSession?.id;
      currentSessionToken = diningSession?.token;
      if (!currentSessionId) return;
    }

    const newQty = Math.max(0, item.quantity + delta);

    // 2. Optimistic Update
    const newCart = [...cart];
    if (newQty === 0) {
      newCart.splice(index, 1);
    } else {
      newCart[index] = { ...item, quantity: newQty };
    }
    setCart(newCart);

    // 3. Sync with Server via Queue
    const mutationKey = Math.random().toString(36).slice(2, 11);

    const updateUrl = getApiUrl(`/api/public/sync-basket-item`);
    const updateOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_session_id: currentSessionId,
        p_session_token: currentSessionToken,
        p_product_id: item.menuItemId,
        p_delta: delta,
        p_configuration: item.selection,
        p_device_info: navigator.userAgent,
        p_idempotency_key: mutationKey
      })
    };

    mutationQueue.current?.enqueue(async () => {
      const response = await fetch(updateUrl, updateOptions);

      if (!response.ok) {
        console.error("Failed to update basket quantity");
        return null;
      }
      return await response.json();
    }, { url: updateUrl, options: updateOptions });
  };

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const serviceCharge = subtotal * (restaurant?.serviceCharge || 0);
  const sst = (subtotal + serviceCharge) * (restaurant?.sst || 0);
  const total = subtotal + serviceCharge + sst;

  const isCashOnly = paymentSettings?.provider === 'none' || 
    (paymentSettings?.enabled_methods?.length === 1 && paymentSettings?.enabled_methods[0] === 'cash') ||
    (paymentSettings && !paymentSettings.provider);
  
  const placeOrderAtCounter = async () => {
    if (!restId || !tableId || cart.length === 0) return;
    setLoading(true);
    
    const maxRetries = 2;
    let attempt = 0;
    const idempotencyKey = Math.random().toString(36).slice(2, 15);
    
    const tryInsert = async (): Promise<{ order_id?: string; message?: string }> => {
      try {
        const itemsWithMetadata = await prepareItemsForOrder();
        const response = await fetch(getApiUrl(`/api/public/place-order`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_restaurant_id: restId,
            p_table_id: table?.id || tableId,
            p_session_id: diningSession?.id,
            p_session_token: diningSession?.token,
            p_order_type: orderType,
            p_items: itemsWithMetadata,
            p_total_price: total,
            p_payment_method: 'counter',
            p_idempotency_key: idempotencyKey
          })
        });

        if (!response.ok) {
          throw new Error("Order placement failed");
        }
        return await response.json() as Promise<{ order_id?: string; message?: string }>;
      } catch (err: unknown) {
        throw err;
      }
    };

    try {
      const result = await tryInsert();
      const orderId = result?.order_id;
      
      if (!orderId) {
        throw new Error(result?.message || "Order placement rejected by server. This may happen if the session was closed or the table was reassigned.");
      }

      await indexedDbStorage.setItem(`last_order_${restId}_${tableId}`, orderId);
      setLastOrderId(orderId);

      try {
        const itemsWithMetadata = await prepareItemsForOrder();
        const currentOrder: Order = {
          id: orderId,
          tableId: table?.id || tableId || '',
          tableName: table?.name || tableId || '',
          orderType: orderType === 'takeaway' ? 'takeaway' : 'dine_in',
          status: 'pending' as any,
          totalPrice: total,
          paymentMethod: 'counter',
          items: itemsWithMetadata.map((i: any, idx: number) => ({
            id: i.id || `item_${idx}_${Math.random().toString(36).slice(2, 9)}`,
            menuItemId: i.menuItemId,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            options: i.options || [],
            configuration: i.configuration || i.selection || {},
            specialInstructions: i.specialInstructions,
            product: menuItems.find(m => m.id === i.menuItemId)
          })),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          restaurant_id: restId
        };
        await printerService.routeAndQueueOrder(restId || '', currentOrder);
      } catch (printErr) {
        console.warn("KOT Auto Print flow failed to queue for counter order:", printErr);
      }

      setCart([]);
      navigate(`/restaurant/${restId}/table/${tableId}/session/${diningSession?.id}/order/${orderId}`);
    } catch (err: unknown) {
      console.error("Order completion failed:", err);
      alert(err instanceof Error ? err.message : "Failed to place order");
      setLoading(false);
    }
  };

  const prepareItemsForOrder = async () => {
    // Resolve kitchen names and smart modifier lines for order
    return await Promise.all(cart.map(async (item) => {
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
  };

  const confirmOrder = async () => {
    if (!restId || !tableId || cart.length === 0) return;
    setLoading(true);

    const paymentMode = restaurant?.payment_mode || 'pay_first';

    if (paymentMode === 'pay_first' || paymentMode === 'both') {
      try {
        const itemsWithMetadata = await prepareItemsForOrder();
        const prepaidPayload = {
          p_restaurant_id: restId,
          p_table_id: table?.id || tableId,
          p_session_id: diningSession?.id,
          p_session_token: diningSession?.token,
          p_order_type: orderType,
          p_items: itemsWithMetadata,
          p_total_price: total,
          p_payment_method: 'online',
          p_idempotency_key: Math.random().toString(36).slice(2, 15)
        };

        const storageKey = `prepaid_payload_${diningSession?.id}`;
        await indexedDbStorage.setItem(storageKey, prepaidPayload);

        setLoading(false);
        navigate(`/restaurant/${restId}/table/${tableId}/session/${diningSession?.id}/order/prepaid/checkout`);
        return;
      } catch (err: unknown) {
        console.error("Prepaid checkout flow failed:", err);
        alert(err instanceof Error ? err.message : "Failed to initiate checkout");
        setLoading(false);
        return;
      }
    }

    const maxRetries = 2;
    let attempt = 0;
    const idempotencyKey = Math.random().toString(36).slice(2, 15);

    const tryInsert = async (): Promise<{ order_id?: string; message?: string }> => {
      try {
        const itemsWithMetadata = await prepareItemsForOrder();

        const response = await fetch(getApiUrl(`/api/public/place-order`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            p_restaurant_id: restId,
            p_table_id: table?.id || tableId,
            p_session_id: diningSession?.id,
            p_session_token: diningSession?.token,
            p_order_type: orderType,
            p_items: itemsWithMetadata,
            p_total_price: total,
            p_payment_method: 'online',
            p_idempotency_key: idempotencyKey
          })
        });

        if (!response.ok) {
          throw new Error("Checkout placement failed");
        }
        return await response.json() as Promise<{ order_id?: string; message?: string }>;
      } catch (err: unknown) {
        throw err;
      }
    };

    try {
      const result = await tryInsert();
      const orderId = result?.order_id;

      if (!orderId) {
        throw new Error(result?.message || "Checkout failed. This may happen if the session was closed or the table was reassigned.");
      }

      await indexedDbStorage.setItem(`last_order_${restId}_${tableId}`, orderId);
      setLastOrderId(orderId);

      try {
        const itemsWithMetadata = await prepareItemsForOrder();
        const currentOrder: Order = {
          id: orderId,
          tableId: table?.id || tableId || '',
          tableName: table?.name || tableId || '',
          orderType: orderType === 'takeaway' ? 'takeaway' : 'dine_in',
          status: 'pending' as any,
          totalPrice: total,
          paymentMethod: 'online',
          items: itemsWithMetadata.map((i: any, idx: number) => ({
            id: i.id || `item_${idx}_${Math.random().toString(36).slice(2, 9)}`,
            menuItemId: i.menuItemId,
            name: i.name,
            price: i.price,
            quantity: i.quantity,
            options: i.options || [],
            configuration: i.configuration || i.selection || {},
            specialInstructions: i.specialInstructions,
            product: menuItems.find(m => m.id === i.menuItemId)
          })),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          restaurant_id: restId
        };
        await printerService.routeAndQueueOrder(restId || '', currentOrder);
      } catch (printErr) {
        console.warn("KOT Auto Print flow failed to queue for online order:", printErr);
      }

      setCart([]);
      // Lead to the dedicated elegant checkout page
      navigate(`/restaurant/${restId}/table/${tableId}/session/${diningSession?.id}/order/${orderId}/checkout`);
    } catch (err: unknown) {
      console.error("Checkout placement failed:", err);
      alert(err instanceof Error ? err.message : "Failed to place order");
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
    <div className="h-screen flex flex-col items-center justify-center bg-white gap-6 px-12 text-center">
      <div className="relative">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-orange-600"></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-2 w-2 bg-orange-600 rounded-full animate-ping"></div>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-zinc-500 font-bold text-xs uppercase tracking-[0.2em] animate-pulse">Loading Menu</p>
        <p className="text-[10px] text-zinc-400 font-medium max-w-[180px] mx-auto leading-relaxed">
          Retrieving the latest delicious offerings for you...
        </p>
      </div>
      
      {/* Delayed hint */}
      <motion.p 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 20 }}
        className="text-[9px] text-zinc-300 font-bold max-w-[200px]"
      >
        Taking a bit longer than usual. Please stay with us or check your connection.
      </motion.p>
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
      
      {/* Offline Warning for Guest */}
      {!isOnline && (
        <div className="bg-amber-500 text-zinc-950 py-2 px-4 flex items-center justify-center gap-2 text-xs font-black tracking-wide shrink-0 sticky top-0 z-[60] shadow-sm">
          <span className="w-2 h-2 rounded-full bg-red-650 animate-ping shrink-0" />
          Offline Mode — Orders will auto-synergize when network resumes!
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

        {/* Existing Order Shortcut */}
        {!isPreviewMode && lastOrderId && cart.length === 0 && (!diningSession || diningSession.status === 'active') && (
          <div className="px-4 pb-2">
            <button 
              onClick={() => navigate(`/restaurant/${restId}/table/${tableId}/session/${diningSession?.id}/order/${lastOrderId}`)}
              className="w-full bg-orange-600 rounded-2xl p-4 flex items-center justify-between group active:scale-[0.98] transition-all shadow-lg shadow-orange-600/20"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white">
                  <Clock size={20} />
                </div>
                <div className="text-left">
                  <p className="text-[10px] uppercase tracking-wider font-black text-white/70">Ongoing Session</p>
                  <p className="text-sm font-bold text-white">Track Order & Checkout</p>
                </div>
              </div>
              <ChevronRight size={20} className="text-white/50 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        )}
      </header>

      {/* Menu Grid */}
      <div className="px-4 py-4 space-y-3">
        {filteredItems.map(item => {
          const hasOptions = (item.modifierGroups?.length || 0) > 0 || (item.comboGroups?.length || 0) > 0 || (item.groups?.length || 0) > 0;
          const isUnavailable = item.status === 'Out of Stock' || item.status === 'Paused';
          
          return (
            <motion.div
              layout
              key={item.id}
              onClick={() => {
                if (isUnavailable) return;
                setSelectedItemForDetail(item);
                initializeSelection(item);
              }}
              className={`bg-white border border-zinc-100 rounded-2xl p-3 flex gap-3 hover:shadow-md transition-all group cursor-pointer ${isUnavailable ? 'opacity-60 grayscale-[0.5]' : ''}`}
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
              <div className="flex-1 flex flex-col justify-center min-w-0">
                <div className="flex justify-between items-start">
                  <h3 className="text-sm font-semibold text-zinc-900 truncate leading-snug">{item.name}</h3>
                  {item.status === 'Low Stock' && <span className="text-[7px] bg-yellow-50 text-yellow-600 font-bold px-1.5 py-0.5 rounded-full border border-yellow-100 ml-2">LOW</span>}
                </div>
                <p className="text-[11px] text-zinc-500 line-clamp-2 mt-0.5 leading-relaxed">{item.description}</p>
                <div className="mt-2.5 flex justify-between items-center">
                  <span className="text-sm font-bold text-orange-600">{formatCurrency(item.price, restaurant?.currency)}</span>
                  
                  {isUnavailable ? (
                    <span className="text-[10px] font-bold text-zinc-400">Sold Out</span>
                  ) : isPreviewMode ? (
                    <span className="text-[10px] font-bold text-orange-500 bg-orange-50 px-2 py-1 rounded-md">View Item</span>
                  ) : (
                    <div className="flex items-center">
                      {cart.some(i => i.menuItemId === item.id) ? (
                        <div className="flex items-center bg-zinc-100 rounded-xl overflow-hidden shadow-sm border border-zinc-200/50">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              const index = [...cart].reverse().findIndex(i => i.menuItemId === item.id);
                              if (index !== -1) {
                                updateQuantity(cart.length - 1 - index, -1);
                              }
                            }}
                            className="p-2 hover:bg-zinc-200 text-zinc-600 transition-colors"
                          >
                            <Minus size={14} />
                          </button>
                          
                          <div className="px-1 min-w-[24px] text-center">
                            <span className="text-xs font-black text-zinc-900">{cart.filter(i => i.menuItemId === item.id).reduce((sum, i) => sum + i.quantity, 0)}</span>
                          </div>

                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.productType === 'single' && !hasOptions) {
                                addToCart(item, { productId: item.id, selections: {} });
                              } else {
                                setSelectedItemForDetail(item);
                                initializeSelection(item);
                              }
                            }}
                            className="p-2 hover:bg-zinc-200 text-zinc-900 transition-colors"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (item.productType === 'single' && !hasOptions) {
                              addToCart(item, { productId: item.id, selections: {} });
                              return;
                            }
                            setSelectedItemForDetail(item);
                            initializeSelection(item);
                          }}
                          className="h-8 px-3 rounded-lg bg-orange-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-1 shadow-sm shadow-orange-500/20 active:scale-95 transition-all"
                        >
                          <Plus size={13} strokeWidth={3} />
                          Add
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
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
                  <p className="text-sm font-bold">{formatCurrency(subtotal, restaurant?.currency)}</p>
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
                  onClick={() => setOrderType('dine_in')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                    orderType === 'dine_in' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500'
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
                          <span className="text-sm font-bold text-zinc-900 shrink-0">{formatCurrency(item.price * item.quantity, restaurant?.currency)}</span>
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
                  <span className="text-zinc-900">{formatCurrency(subtotal, restaurant?.currency)}</span>
                </div>
                {serviceCharge > 0 && (
                  <div className="flex justify-between text-xs font-medium text-zinc-500">
                    <span>Service Charge ({(restaurant?.serviceCharge || 0) * 100}%)</span>
                    <span className="text-zinc-900">{formatCurrency(serviceCharge, restaurant?.currency)}</span>
                  </div>
                )}
                {sst > 0 && (
                  <div className="flex justify-between text-xs font-medium text-zinc-500">
                    <span>{restaurant?.business_settings?.tax_type || 'SST'} ({(restaurant?.sst || 0) * 100}%)</span>
                    <span className="text-zinc-900">{formatCurrency(sst, restaurant?.currency)}</span>
                  </div>
                )}
                <div className="pt-3 border-t border-zinc-100 flex justify-between items-center">
                  <span className="text-sm font-bold text-zinc-900">Order Total</span>
                  <span className="text-lg font-bold text-orange-600">{formatCurrency(total, restaurant?.currency)}</span>
                </div>
              </div>
              
              <div className="p-3.5 flex gap-3 bg-zinc-50 rounded-xl border border-zinc-100/80">
                <Info className="text-zinc-500 shrink-0" size={18} />
                <p className="text-[11px] font-medium text-zinc-600 leading-relaxed">
                  {restaurant?.payment_mode === 'pay_first' ? (
                    "Please complete your payment to submit your order to the kitchen. Unsubmitted selections are saved in your basket."
                  ) : restaurant?.payment_mode === 'pay_later' ? (
                    "Your order will start preparing when submitted. You can pay at the counter during or after your meal."
                  ) : (
                    "Choose online payment for fast-tracking, or pay at the counter/table during or after your meal."
                  )}
                </p>
              </div>
            </div>

            <div className="p-4 bg-white border-t border-zinc-100 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] space-y-3">
              {!isCashOnly && (restaurant?.payment_mode === 'pay_first' || restaurant?.payment_mode === 'both' || !restaurant?.payment_mode) && (
                <button
                  onClick={confirmOrder}
                  disabled={loading || cart.length === 0 || !diningSession?.id}
                  className="w-full h-14 bg-zinc-900 text-white rounded-xl font-bold text-base hover:bg-black transition-all flex items-center justify-center shadow-lg shadow-zinc-900/10 disabled:bg-zinc-200 disabled:text-zinc-400"
                >
                  {loading ? (
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                  ) : (
                    "Pay Now (DuitNow/TNG)"
                  )}
                </button>
              )}
              {(isCashOnly || restaurant?.payment_mode === 'pay_later' || restaurant?.payment_mode === 'both' || !restaurant?.payment_mode) && (
                <button
                  onClick={placeOrderAtCounter}
                  disabled={loading || cart.length === 0 || !diningSession?.id}
                  className={`w-full font-bold transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ${
                    isCashOnly || restaurant?.payment_mode === 'pay_later'
                      ? "h-14 bg-zinc-900 text-white rounded-xl text-base hover:bg-black shadow-lg shadow-zinc-900/10"
                      : "h-12 bg-white text-zinc-900 border border-zinc-200 rounded-xl text-sm hover:bg-zinc-50"
                  }`}
                >
                  {loading && (isCashOnly || restaurant?.payment_mode === 'pay_later') ? (
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                  ) : (
                    isCashOnly || restaurant?.payment_mode === 'pay_later' ? "Confirm Order & Pay Later" : "Place Order, Pay Later"
                  )}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Active Order Tracker */}
      {hasActiveOrders && lastOrderId && !isReviewingOrder && (
        <div className="fixed bottom-6 left-0 right-0 px-6 z-40 pointer-events-none">
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="pointer-events-auto"
          >
            <button
              onClick={() => navigate(`/restaurant/${restId}/table/${tableId}/session/${diningSession?.id}/order/${lastOrderId}`)}
              className="w-full bg-zinc-900 border border-zinc-800 text-white p-4 rounded-3xl flex items-center justify-between shadow-2xl active:scale-[0.98] transition-transform"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl bg-orange-500 flex items-center justify-center">
                  <ChefHat size={20} className="text-white" />
                </div>
                <div className="text-left">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400 leading-none mb-1">Your Order</p>
                  <p className="text-sm font-bold text-white">Track Progress Live</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
                </span>
                <ChevronRight size={16} className="text-zinc-500" />
              </div>
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );
}
