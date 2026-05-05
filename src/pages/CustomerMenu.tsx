import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Category, MenuItem, OrderItem, Restaurant } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingBag, ChevronRight, Minus, Plus, Search, Info } from 'lucide-react';

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

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.menuItemId === item.id);
      if (existing) {
        return prev.map(i => i.menuItemId === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, {
        menuItemId: item.id,
        name: item.name,
        price: item.price,
        quantity: 1,
        options: []
      }];
    });
  };

  const updateQuantity = (menuItemId: string, delta: number) => {
    setCart(prev => prev.map(i => {
      if (i.menuItemId === menuItemId) {
        const newQty = Math.max(0, i.quantity + delta);
        return { ...i, quantity: newQty };
      }
      return i;
    }).filter(i => i.quantity > 0));
  };

  const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  const placeOrder = async () => {
    if (!restId || !tableId || cart.length === 0) return;
    
    try {
      const { data, error } = await supabase
        .from('orders')
        .insert({
          restaurant_id: restId,
          table_id: tableId,
          status: 'pending',
          total_price: totalPrice,
          items: cart,
          payment_method: 'counter'
        })
        .select()
        .single();

      if (error) throw error;
      navigate(`/restaurant/${restId}/order-tracker/${data.id}`);
    } catch (err: any) {
      alert(err.message || "Failed to place order");
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
                
                {cart.find(i => i.menuItemId === item.id) ? (
                  <div className="flex items-center gap-3 bg-gray-100 rounded-xl px-2 py-1">
                    <button onClick={() => updateQuantity(item.id, -1)} className="p-1 text-gray-500 hover:text-red-500"><Minus size={14} /></button>
                    <span className="text-xs font-black">{cart.find(i => i.menuItemId === item.id)?.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, 1)} className="p-1 text-gray-500 hover:text-orange-600"><Plus size={14} /></button>
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

      {/* Cart Navigation Bar */}
      <AnimatePresence>
        {cart.length > 0 && (
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-8 left-4 right-4 z-50"
          >
            <button
              onClick={placeOrder}
              className="w-full bg-gray-900 text-white p-6 rounded-[2.5rem] shadow-2xl flex items-center justify-between group hover:bg-black transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="bg-orange-600 text-white w-10 h-10 rounded-full flex items-center justify-center font-black animate-pulse">
                  {cart.reduce((a, b) => a + b.quantity, 0)}
                </div>
                <div className="text-left">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">View Basket</p>
                  <p className="text-lg font-black tracking-tight">RM {totalPrice.toFixed(2)}</p>
                </div>
              </div>
              <ChevronRight className="group-hover:translate-x-1 transition-transform" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
