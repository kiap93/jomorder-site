import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Category, MenuItem, OrderItem, Restaurant } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingBag, ChevronRight, Minus, Plus, Search, Info, X } from 'lucide-react';

export function CustomerMenu() {
  const { restId, tableId } = useParams();
  const navigate = useNavigate();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItemForOptions, setSelectedItemForOptions] = useState<MenuItem | null>(null);
  const [currentOptionSelections, setCurrentOptionSelections] = useState<Record<string, string>>({});

  const [isReviewingOrder, setIsReviewingOrder] = useState(false);

  useEffect(() => {
    if (!restId) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [restRes, catsRes, itemsRes] = await Promise.all([
          supabase.from('restaurants').select('*').eq('id', restId).single(),
          supabase.from('categories').select('*').eq('restaurant_id', restId).order('sort_order', { ascending: true }),
          supabase.from('menu_items').select('*').eq('restaurant_id', restId).eq('is_active', true)
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
        if (catsRes.data) setCategories(catsRes.data.map(c => ({ id: c.id, name: c.name, order: c.sort_order })));
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
      } catch (err) {
        console.error("Fetch data failed:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [restId]);

  const addToCart = (item: MenuItem, selectedOptions?: Record<string, string>) => {
    const hasOptions = item.options && item.options.length > 0;
    
    if (hasOptions && !selectedOptions) {
      setSelectedItemForOptions(item);
      const initialSelections: Record<string, string> = {};
      item.options?.forEach(opt => {
        if (opt.values.length > 0) {
          initialSelections[opt.name] = opt.values[0].name;
        }
      });
      setCurrentOptionSelections(initialSelections);
      return;
    }

    const orderOptions = item.options?.map(opt => {
      const selectedValueName = selectedOptions?.[opt.name];
      const val = opt.values.find(v => v.name === selectedValueName);
      return {
        optionName: opt.name,
        valueName: selectedValueName || '',
        priceDelta: val?.priceDelta || 0
      };
    }) || [];

    const itemTotalPrice = item.price + orderOptions.reduce((sum, o) => sum + o.priceDelta, 0);

    setCart(prev => {
      // Check if item with exact same options already exists
      const existingIndex = prev.findIndex(i => {
        if (i.menuItemId !== item.id) return false;
        if (i.options.length !== orderOptions.length) return false;
        return orderOptions.every(oo => {
          const matched = i.options.find(io => io.optionName === oo.optionName);
          return matched && matched.valueName === oo.valueName;
        });
      });

      if (existingIndex > -1) {
        const newCart = [...prev];
        newCart[existingIndex].quantity += 1;
        return newCart;
      }

      return [...prev, {
        menuItemId: item.id,
        name: item.name,
        price: itemTotalPrice,
        quantity: 1,
        options: orderOptions
      }];
    });

    setSelectedItemForOptions(null);
  };

  const updateQuantity = (index: number, delta: number) => {
    setCart(prev => {
      const newCart = [...prev];
      const newQty = Math.max(0, newCart[index].quantity + delta);
      if (newQty === 0) {
        return newCart.filter((_, i) => i !== index);
      }
      newCart[index].quantity = newQty;
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
      const { data, error } = await supabase
        .from('orders')
        .insert({
          restaurant_id: restId,
          table_id: tableId,
          status: 'pending',
          total_price: total,
          items: cart,
          payment_method: 'counter'
        })
        .select()
        .single();

      if (error) throw error;
      navigate(`/restaurant/${restId}/order/${data.id}`);
    } catch (err: any) {
      alert(err.message || "Failed to place order");
      setLoading(false);
    }
  };

  const filteredItems = menuItems.filter(item => {
    const matchesCat = selectedCategory === 'all' || item.categoryId === selectedCategory;
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  if (loading) return <div className="h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div></div>;

  return (
    <div className="max-w-md mx-auto bg-white min-h-screen pb-32">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md p-6 border-b border-gray-100">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tighter">{restaurant?.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="bg-orange-100 text-orange-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">Table {tableId}</span>
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
            className="bg-white border border-gray-100 rounded-[2rem] p-4 flex gap-4 hover:shadow-lg hover:shadow-orange-100/20 transition-all group"
          >
            <div className="w-24 h-24 rounded-2xl bg-gray-50 flex-shrink-0 overflow-hidden">
              {item.imageUrl ? (
                <img src={item.imageUrl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-200">
                  <ShoppingBag size={30} />
                </div>
              )}
            </div>
            <div className="flex-1 flex flex-col pt-1">
              <h3 className="font-bold text-gray-800 leading-tight mb-1">{item.name}</h3>
              <p className="text-[10px] text-gray-400 line-clamp-2 mb-2 font-medium">{item.description}</p>
              <div className="mt-auto flex justify-between items-center">
                <span className="font-black text-orange-600 text-sm">RM {item.price.toFixed(2)}</span>
                
                {cart.some(i => i.menuItemId === item.id) ? (
                  <div className="flex items-center gap-3 bg-gray-100 rounded-xl px-2 py-1">
                    <span className="text-xs font-black">{cart.filter(i => i.menuItemId === item.id).reduce((sum, i) => sum + i.quantity, 0)} in bag</span>
                    <button onClick={() => addToCart(item)} className="p-1 text-gray-500 hover:text-orange-600 font-black"><Plus size={14} /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => addToCart(item)}
                    className="bg-orange-50 text-orange-600 p-2 rounded-xl hover:bg-orange-600 hover:text-white transition-all shadow-sm"
                  >
                    <Plus size={18} />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Options Modal */}
      <AnimatePresence>
        {selectedItemForOptions && (
          <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItemForOptions(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="relative w-full max-w-md bg-white rounded-t-[3rem] sm:rounded-[3rem] p-8 overflow-hidden shadow-2xl"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-xl font-black text-gray-900">{selectedItemForOptions.name}</h3>
                  <p className="text-orange-600 font-bold">RM {selectedItemForOptions.price.toFixed(2)}</p>
                </div>
                <button 
                  onClick={() => setSelectedItemForOptions(null)}
                  className="bg-gray-100 p-2 rounded-full text-gray-400 hover:text-gray-600"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 scrollbar-thin">
                {selectedItemForOptions.options?.map(opt => (
                  <div key={opt.name} className="space-y-3">
                    <label className="text-xs font-black uppercase text-gray-400 tracking-widest">{opt.name}</label>
                    <div className="grid grid-cols-1 gap-2">
                      {opt.values.map(val => (
                        <button
                          key={val.name}
                          onClick={() => setCurrentOptionSelections(prev => ({ ...prev, [opt.name]: val.name }))}
                          className={`flex justify-between items-center p-4 rounded-2xl border-2 transition-all font-bold ${
                            currentOptionSelections[opt.name] === val.name
                              ? 'border-orange-500 bg-orange-50 text-orange-900'
                              : 'border-transparent bg-gray-50 text-gray-500 hover:bg-gray-100'
                          }`}
                        >
                          <span>{val.name}</span>
                          {val.priceDelta > 0 && (
                            <span className="text-[10px] font-black uppercase tracking-tighter opacity-60">
                              + RM {val.priceDelta.toFixed(2)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => addToCart(selectedItemForOptions, currentOptionSelections)}
                className="w-full bg-gray-900 text-white py-5 rounded-[2rem] font-bold text-lg mt-8 hover:bg-black transition-all shadow-xl hover:shadow-orange-200/40"
              >
                Add to Basket
              </button>
            </motion.div>
          </div>
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
                      {item.options.length > 0 && (
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
