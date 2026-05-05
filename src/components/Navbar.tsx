import { Link, useParams } from 'react-router-dom';
import { ChefHat, LayoutDashboard, ShoppingBag, Settings, LogOut } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

export function Navbar() {
  const { restId: urlRestId } = useParams();
  const { user, profile, signOut } = useAuthStore();
  
  const restId = urlRestId || profile?.restaurantId;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3 flex justify-around items-center md:top-0 md:bottom-auto md:flex-col md:w-20 md:h-full md:border-t-0 md:border-r z-50">
      <Link to={restId ? `/restaurant/${restId}/table/default` : '/'} className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-orange-600">
        <ShoppingBag size={24} />
      </Link>
      
      {user && restId && (
        <>
          <Link to={`/restaurant/${restId}/orders`} className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-500 hover:text-orange-600">
            <LayoutDashboard size={24} />
          </Link>
          <Link to={`/restaurant/${restId}/kitchen`} className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-500 hover:text-orange-600">
            <ChefHat size={24} />
          </Link>
          <Link to={`/restaurant/${restId}/admin`} className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-500 hover:text-orange-600">
            <Settings size={24} />
          </Link>
        </>
      )}
      
      {user && (
        <button onClick={() => signOut()} className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-500 hover:text-red-600">
          <LogOut size={24} />
        </button>
      )}
    </nav>
  );
}
