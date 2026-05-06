import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChefHat, LayoutDashboard, ShoppingBag, Settings, LogOut } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuthStore();
  
  // Extract restId from path: /restaurant/:restId/...
  const pathParts = location.pathname.split('/');
  const restIndex = pathParts.indexOf('restaurant');
  const urlRestId = restIndex !== -1 ? pathParts[restIndex + 1] : null;
  
  const restId = urlRestId || profile?.restaurantId;

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3 flex justify-around items-center md:top-0 md:bottom-auto md:flex-col md:w-20 md:h-full md:border-t-0 md:border-r z-50">
      <Link 
        to={restId ? `/restaurant/${restId}/table/default` : '/'} 
        className={`p-2 rounded-xl transition-colors ${location.pathname.includes('/table/') ? 'bg-orange-50 text-orange-600' : 'text-gray-500 hover:text-orange-600'}`}
      >
        <ShoppingBag size={24} />
      </Link>
      
      {user && restId && (
        <>
          <Link 
            to={`/restaurant/${restId}/orders`} 
            className={`p-2 rounded-xl transition-colors ${location.pathname.includes('/orders') ? 'bg-orange-50 text-orange-600' : 'text-gray-500 hover:text-orange-600'}`}
          >
            <LayoutDashboard size={24} />
          </Link>
          <Link 
            to={`/restaurant/${restId}/kitchen`} 
            className={`p-2 rounded-xl transition-colors ${location.pathname.includes('/kitchen') ? 'bg-orange-50 text-orange-600' : 'text-gray-500 hover:text-orange-600'}`}
          >
            <ChefHat size={24} />
          </Link>
          <Link 
            to={`/restaurant/${restId}/admin`} 
            className={`p-2 rounded-xl transition-colors ${location.pathname.includes('/admin') ? 'bg-orange-50 text-orange-600' : 'text-gray-500 hover:text-orange-600'}`}
          >
            <Settings size={24} />
          </Link>
        </>
      )}
      
      {user && (
        <button onClick={handleSignOut} className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-500 hover:text-red-600">
          <LogOut size={24} />
        </button>
      )}
    </nav>
  );
}
