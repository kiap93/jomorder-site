import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, orderBy, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Category, MenuItem, OrderItem } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingCart, Plus, Minus, X, Info } from 'lucide-react';
import { useBasketStore } from '../store/useBasketStore';

export function CustomerMenu() {
  const { restId, tableId } = useParams();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [itemQuantity, setItemQuantity] = useState(1);
  const [itemOptions, setItemOptions] = useState<Record<string, string>>({});
  
  const { items: basketItems, addItem, clearBasket, getTotal } = useBasketStore();
  const [isBasketOpen, setIsBasketOpen] = useState(false);

  useEffect(() => {
    if (!restId) return;

    // Fetch categories
    const catQuery = query(collection(db, 'restaurants', restId, 'categories'), orderBy('order', 'asc'));
    const unsubCats = onSnapshot(catQuery, (snapshot) => {
      const cats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Category[];
      setCategories(cats);
      if (cats.length > 0 && !selectedCategory) setSelectedCategory(cats[0].id);
    });

    // Fetch menu items
    const itemQuery = query(collection(db, 'restaurants', restId, 'menu_items'), where('isActive', '==', true));
    const unsubItems = onSnapshot(itemQuery, (snapshot) => {
      setMenuItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as MenuItem[]);
    });

    return () => {
      unsubCats();
      unsubItems();
    };
  }, [restId]);

  const addToBasket = () => {
    if (!selectedItem) return;

    const selectedOptions = (selectedItem.options || []).map(opt => {
      const valName = itemOptions[opt.name];
      const val = opt.values.find(v => v.name === valName);
      return {
        optionName: opt.name,
        valueName: valName,
        priceDelta: val?.priceDelta || 0
      };
    });

    const orderItem: OrderItem = {
      menuItemId: selectedItem.id,
      name: selectedItem.name,
      price: selectedItem.price,
      quantity: itemQuantity,
      options: selectedOptions
    };

    addItem(orderItem);
    setSelectedItem(null);
    setItemQuantity(1);
    setItemOptions({});
  };

  const placeOrder = async () => {
    if (!restId || !tableId || basketItems.length === 0) return;

    try {
      const docRef = await addDoc(collection(db, 'restaurants', restId, 'orders'), {
        tableId,
        status: 'pending',
        totalPrice: getTotal(),
        paymentMethod: 'counter',
        items: basketItems,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      clearBasket();
      navigate(`/restaurant/${restId}/order/${docRef.id}`);
    } catch (error) {
      console.error("Error placing order:", error);
      alert("Failed to place order. Please try again.");
    }
  };

  const filteredItems = selectedCategory 
    ? menuItems.filter(item => item.categoryId === selectedCategory)
    : menuItems;

  return (
    <div className="max-w-md mx-auto">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Malay Delights</h1>
        <p className="text-gray-500 text-sm mt-1">Table: {tableId}</p>
      </header>

      {/* Categories */}
      <div className="flex space-x-2 overflow-x-auto pb-4 scrollbar-hide">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-4 py-2 rounded-full whitespace-nowrap transition-all text-sm font-medium ${
              selectedCategory === cat.id 
                ? 'bg-orange-600 text-white shadow-lg shadow-orange-200' 
                : 'bg-white text-gray-600 border border-gray-100'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Menu Grid */}
      <div className="grid grid-cols-1 gap-4 mt-6">
        {filteredItems.map(item => (
          <motion.div
            layout
            key={item.id}
            onClick={() => setSelectedItem(item)}
            className="bg-white rounded-2xl p-4 flex gap-4 cursor-pointer hover:shadow-md transition-shadow border border-gray-50"
          >
            {item.imageUrl && (
              <img 
                src={item.imageUrl} 
                alt={item.name} 
                className="w-24 h-24 rounded-xl object-cover bg-gray-100" 
              />
            )}
            <div className="flex-1 flex flex-col justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">{item.name}</h3>
                <p className="text-gray-500 text-xs mt-1 line-clamp-2">{item.description}</p>
              </div>
              <div className="flex justify-between items-end mt-2">
                <span className="font-bold text-orange-600">RM {item.price.toFixed(2)}</span>
                <div className="bg-gray-50 p-1.5 rounded-lg">
                  <Plus size={16} className="text-gray-400" />
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Floating Cart Button */}
      <AnimatePresence>
        {basketItems.length > 0 && (
          <motion.button
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            onClick={() => setIsBasketOpen(true)}
            className="fixed bottom-24 left-4 right-4 bg-gray-900 text-white rounded-2xl py-4 px-6 flex justify-between items-center shadow-2xl z-40 md:left-auto md:w-80 md:right-8"
          >
            <div className="flex items-center gap-3">
              <div className="bg-orange-600 rounded-lg p-1 px-2 text-xs font-bold">
                {basketItems.length}
              </div>
              <span className="font-semibold text-sm">View order</span>
            </div>
            <span className="font-bold">RM {getTotal().toFixed(2)}</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Item Detail Modal */}
      <AnimatePresence>
        {selectedItem && (
          <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
              onClick={() => setSelectedItem(null)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              className="relative bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl"
            >
              {selectedItem.imageUrl && (
                <img src={selectedItem.imageUrl} alt={selectedItem.name} className="w-full h-64 object-cover" />
              )}
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">{selectedItem.name}</h2>
                    <p className="text-gray-500 mt-1">{selectedItem.description}</p>
                  </div>
                  <button onClick={() => setSelectedItem(null)} className="p-2 bg-gray-100 rounded-full">
                    <X size={20} />
                  </button>
                </div>

                {/* Options */}
                {selectedItem.options?.map(opt => (
                  <div key={opt.name} className="mb-6">
                    <h4 className="text-sm font-bold text-gray-900 uppercase tracking-widest mb-3">{opt.name}</h4>
                    <div className="flex flex-wrap gap-2">
                      {opt.values.map(val => (
                        <button
                          key={val.name}
                          onClick={() => setItemOptions(prev => ({ ...prev, [opt.name]: val.name }))}
                          className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${
                            itemOptions[opt.name] === val.name
                              ? 'bg-orange-50 border-orange-600 text-orange-600'
                              : 'bg-white border-gray-200 text-gray-600'
                          }`}
                        >
                          {val.name}
                          {val.priceDelta > 0 && <span className="ml-1 text-xs opacity-60"> (+RM{val.priceDelta})</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Quantity */}
                <div className="flex items-center justify-between mb-8 py-4 border-y border-gray-100">
                  <span className="font-bold text-gray-900">Quantity</span>
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => setItemQuantity(q => Math.max(1, q - 1))}
                      className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      <Minus size={20} />
                    </button>
                    <span className="font-bold text-xl w-8 text-center">{itemQuantity}</span>
                    <button 
                      onClick={() => setItemQuantity(q => q + 1)}
                      className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                </div>

                <button
                  onClick={addToBasket}
                  className="w-full bg-orange-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-orange-200 active:scale-95 transition-transform"
                >
                  Add to basket • RM {(selectedItem.price * itemQuantity).toFixed(2)}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Basket Modal */}
      <AnimatePresence>
        {isBasketOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md" 
              onClick={() => setIsBasketOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b flex justify-between items-center">
                <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-orange-600 to-orange-400">Your Basket</h2>
                <button onClick={() => setIsBasketOpen(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={20} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {basketItems.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-start group">
                    <div className="flex gap-4">
                      <div className="bg-orange-50 text-orange-600 font-bold p-1 px-2 h-fit rounded-lg text-sm">
                        {item.quantity}x
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-900">{item.name}</h4>
                        <p className="text-gray-400 text-xs mt-0.5">
                          {item.options.map(o => `${o.optionName}: ${o.valueName}`).join(' • ')}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-gray-900">RM {item.price.toFixed(2)}</div>
                      <button onClick={() => useBasketStore.getState().removeItem(idx)} className="text-red-500 text-xs font-semibold mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Remove</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-6 bg-gray-50/50">
                <div className="flex justify-between items-center mb-6">
                  <span className="text-gray-500 font-medium">Total Amount</span>
                  <span className="text-2xl font-black text-gray-900">RM {getTotal().toFixed(2)}</span>
                </div>
                <button
                  onClick={placeOrder}
                  className="w-full bg-gray-900 text-white font-bold py-4 rounded-2xl shadow-xl hover:bg-black transition-colors"
                >
                  Complete Order
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
