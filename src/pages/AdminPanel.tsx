import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { collection, query, onSnapshot, doc, setDoc, addDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Category, MenuItem, Table, Restaurant } from '../types';
import { Plus, Trash2, Edit2, BarChart2, List, Grid, UtensilsCrossed, Monitor } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

export function AdminPanel() {
  const { restId } = useParams();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [activeTab, setActiveTab] = useState<'menu' | 'categories' | 'tables' | 'analytics'>('menu');
  const [tables, setTables] = useState<Table[]>([]);

  useEffect(() => {
    if (!restId) return;

    onSnapshot(doc(db, 'restaurants', restId), (s) => setRestaurant({ id: s.id, ...s.data() } as Restaurant));
    onSnapshot(collection(db, 'restaurants', restId, 'categories'), (s) => setCategories(s.docs.map(d => ({ id: d.id, ...d.data() })) as Category[]));
    onSnapshot(collection(db, 'restaurants', restId, 'menu_items'), (s) => setMenuItems(s.docs.map(d => ({ id: d.id, ...d.data() })) as MenuItem[]));
    onSnapshot(collection(db, 'restaurants', restId, 'tables'), (s) => setTables(s.docs.map(d => ({ id: d.id, ...d.data() })) as Table[]));
  }, [restId]);

  const setupDefaultData = async () => {
    if (!restId) return;
    
    // Create categories
    const foodRef = await addDoc(collection(db, 'restaurants', restId, 'categories'), { name: 'Local Food', order: 1 });
    const drinkRef = await addDoc(collection(db, 'restaurants', restId, 'categories'), { name: 'Drinks', order: 2 });

    // Create menu items
    await addDoc(collection(db, 'restaurants', restId, 'menu_items'), {
      categoryId: foodRef.id,
      name: 'Nasi Lemak Ayam Berempah',
      price: 12.50,
      description: 'Fragrant coconut milk rice served with fried spiced chicken, sambal, anchovies, peanuts, and boiled egg.',
      isActive: true,
      imageUrl: 'https://images.unsplash.com/photo-1619604176278-2f6d8609c8b1?auto=format&fit=crop&q=80&w=300'
    });

    await addDoc(collection(db, 'restaurants', restId, 'menu_items'), {
      categoryId: foodRef.id,
      name: 'Char Kway Teow',
      price: 9.50,
      description: 'Stir-fried flat rice noodles with prawns, cockles, and bean sprouts.',
      isActive: true
    });

    await addDoc(collection(db, 'restaurants', restId, 'menu_items'), {
      categoryId: drinkRef.id,
      name: 'Teh Tarik',
      price: 3.50,
      description: 'Hot frothy milk tea.',
      isActive: true,
      options: [
        { name: 'Sugar Level', values: [{ name: 'Normal', priceDelta: 0 }, { name: 'Less Sugar', priceDelta: 0 }, { name: 'No Sugar', priceDelta: 0 }] },
        { name: 'Ice', values: [{ name: 'Hot', priceDelta: 0 }, { name: 'Iced', priceDelta: 0.50 }] }
      ]
    });
    
    alert("Sample data loaded!");
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Management</h1>
          <p className="text-gray-500 font-medium">Control center for {restaurant?.name || 'Branch'}</p>
        </div>
        {!menuItems.length && (
          <button 
            onClick={setupDefaultData}
            className="bg-orange-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-orange-100 hover:bg-orange-700 transition-colors"
          >
            Load Sample Menu
          </button>
        )}
      </div>

      <div className="flex gap-4">
        {[
          { id: 'menu', icon: UtensilsCrossed, label: 'Menu Items' },
          { id: 'categories', icon: List, label: 'Categories' },
          { id: 'tables', icon: Monitor, label: 'Tables / QR' },
          { id: 'analytics', icon: BarChart2, label: 'Analytics' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all ${
              activeTab === tab.id ? 'bg-gray-900 text-white shadow-xl' : 'bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            <tab.icon size={20} />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'menu' && (
        <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-gray-100">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 text-gray-400 text-[10px] font-black uppercase tracking-widest border-b">
                <th className="px-8 py-4">Item</th>
                <th className="px-8 py-4">Price</th>
                <th className="px-8 py-4">Status</th>
                <th className="px-8 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {menuItems.map(item => (
                <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} className="w-12 h-12 rounded-xl object-cover" />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-gray-400">
                          <Grid size={20} />
                        </div>
                      )}
                      <div>
                        <div className="font-bold text-gray-900">{item.name}</div>
                        <div className="text-xs text-gray-400">{categories.find(c => c.id === item.categoryId)?.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6 font-bold text-orange-600">RM {item.price.toFixed(2)}</td>
                  <td className="px-8 py-6">
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${item.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {item.isActive ? 'Active' : 'Hidden'}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-right space-x-2">
                    <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-blue-500 transition-colors"><Edit2 size={18} /></button>
                    <button onClick={() => deleteDoc(doc(db, 'restaurants', restId!, 'menu_items', item.id))} className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'categories' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map(cat => (
            <div key={cat.id} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex justify-between items-center group">
              <h3 className="font-bold text-gray-900">{cat.name}</h3>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"><Edit2 size={16} /></button>
                <button onClick={() => deleteDoc(doc(db, 'restaurants', restId!, 'categories', cat.id))} className="p-2 hover:bg-gray-100 rounded-lg text-red-400"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
          <button className="border-2 border-dashed border-gray-200 p-6 rounded-3xl flex items-center justify-center gap-3 text-gray-400 font-bold hover:border-orange-200 hover:text-orange-500 transition-all hover:bg-orange-50/20">
            <Plus size={24} />
            Add Category
          </button>
        </div>
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
              <div className="flex gap-2 w-full">
                <button className="flex-1 p-2 bg-gray-50 text-gray-400 rounded-xl hover:text-blue-500 transition-colors"><Edit2 size={16} className="mx-auto" /></button>
                <button onClick={() => deleteDoc(doc(db, 'restaurants', restId!, 'tables', table.id))} className="flex-1 p-2 bg-gray-50 text-gray-400 rounded-xl hover:text-red-500 transition-colors"><Trash2 size={16} className="mx-auto" /></button>
              </div>
            </div>
          ))}
          <button 
            onClick={() => {
              const name = prompt("Table Name (e.g. T1)");
              if (name) addDoc(collection(db, 'restaurants', restId!, 'tables'), { name, status: 'available' });
            }}
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
                <div className="text-gray-400 text-xs font-black uppercase tracking-widest mb-4">Average Tiket</div>
                <div className="text-5xl font-black text-gray-900">RM 0</div>
            </div>
        </div>
      )}
    </div>
  );
}
