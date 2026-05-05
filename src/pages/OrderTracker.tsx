import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Order } from '../types';
import { motion } from 'motion/react';
import { CheckCircle2, Clock, Utensils, CreditCard } from 'lucide-react';

const STATUS_CONFIG = {
  pending: { icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-50', label: 'Order Received' },
  preparing: { icon: Utensils, color: 'text-orange-500', bg: 'bg-orange-50', label: 'Cooking' },
  ready: { icon: CheckCircle2, color: 'text-blue-500', bg: 'bg-blue-50', label: 'Ready for Serving' },
  completed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-50', label: 'Completed' },
  cancelled: { icon: CreditCard, color: 'text-red-500', bg: 'bg-red-50', label: 'Cancelled' },
};

export function OrderTracker() {
  const { restId, orderId } = useParams();
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    if (!restId || !orderId) return;
    const unsub = onSnapshot(doc(db, 'restaurants', restId, 'orders', orderId), (snapshot) => {
      if (snapshot.exists()) {
        setOrder({ id: snapshot.id, ...snapshot.data() } as Order);
      }
    });
    return unsub;
  }, [restId, orderId]);

  if (!order) return <div className="p-8 text-center text-gray-500">Loading order...</div>;

  const StatusIcon = STATUS_CONFIG[order.status]?.icon || Clock;

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <div className="text-center mb-12">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center mb-6 shadow-xl ${STATUS_CONFIG[order.status]?.bg}`}
        >
          <StatusIcon className={`w-12 h-12 ${STATUS_CONFIG[order.status]?.color}`} />
        </motion.div>
        <h1 className="text-3xl font-black text-gray-900 mb-2">{STATUS_CONFIG[order.status]?.label}</h1>
        <p className="text-gray-500">Order #{order.id.slice(-6).toUpperCase()}</p>
      </div>

      <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 mb-6">
        <h3 className="font-bold text-gray-900 mb-4 border-b pb-4">Order Summary</h3>
        <div className="space-y-4">
          {order.items.map((item, idx) => (
            <div key={idx} className="flex justify-between">
              <div>
                <span className="font-bold text-sm text-gray-400 mr-2">{item.quantity}x</span>
                <span className="font-medium text-gray-800">{item.name}</span>
              </div>
              <span className="font-bold text-gray-900">RM {(item.price * item.quantity).toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 pt-4 border-t flex justify-between items-center text-lg">
          <span className="font-bold text-gray-500">Total</span>
          <span className="font-black text-2xl text-orange-600">RM {order.totalPrice.toFixed(2)}</span>
        </div>
      </div>

      <div className="bg-orange-50 rounded-2xl p-4 flex gap-4 items-start">
        <div className="bg-white p-2 rounded-lg shadow-sm">
          <CreditCard className="text-orange-600" size={20} />
        </div>
        <div>
          <p className="text-sm font-bold text-orange-900">Please pay at the counter</p>
          <p className="text-xs text-orange-700 mt-1 opacity-80">Show your order number to the staff when you finish your meal.</p>
        </div>
      </div>
    </div>
  );
}
