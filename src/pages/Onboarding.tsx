import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../lib/firebase';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useAuthStore } from '../store/useAuthStore';
import { Store, ArrowRight, Loader2 } from 'lucide-react';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';

export function Onboarding() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !name.trim()) return;

    setLoading(true);
    try {
      // 1. Create Restaurant
      const restRef = await addDoc(collection(db, 'restaurants'), {
        name: name.trim(),
        currency: 'MYR',
        serviceCharge: 6,
        sst: 10,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      });

      // 2. Update User Profile
      await updateDoc(doc(db, 'users', user.uid), {
        restaurantId: restRef.id,
        role: 'admin'
      });

      // 3. Navigate to Dashboard
      navigate(`/restaurant/${restRef.id}/orders`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'restaurants');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="bg-white p-8 md:p-12 rounded-[3.5rem] shadow-2xl border border-gray-50 max-w-md w-full">
        <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center mb-8">
          <Store size={32} className="text-orange-600" />
        </div>
        
        <h1 className="text-3xl font-black text-gray-900 tracking-tight mb-2">Create your Branch</h1>
        <p className="text-gray-500 font-medium mb-8">Let's set up your restaurant profile to get started.</p>

        <form onSubmit={handleCreate} className="space-y-6">
          <div>
            <label className="block text-xs font-black uppercase tracking-widest text-gray-400 mb-2 ml-1">Restaurant Name</label>
            <input
              required
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mamak Maju Jaya"
              className="w-full px-6 py-4 rounded-2xl bg-gray-50 border-transparent focus:bg-white focus:border-orange-500 focus:ring-0 transition-all font-semibold"
            />
          </div>

          <button
            disabled={loading}
            type="submit"
            className="w-full bg-gray-900 text-white py-5 rounded-2xl font-bold text-lg hover:bg-black transition-all flex items-center justify-center gap-3 shadow-xl disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" /> : <>Start Growing <ArrowRight size={20} /></>}
          </button>
        </form>
      </div>
    </div>
  );
}
