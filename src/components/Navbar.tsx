import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChefHat, LayoutDashboard, ShoppingBag, Settings, LogOut, Banknote } from 'lucide-react';
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

  // Don't show Navbar on landing page
  if (location.pathname === '/') return null;

  // Don't show Navbar for customers on mobile (they have their own navigation in CustomerMenu)
  const isCustomerPath = location.pathname.includes('/table/') || location.pathname.includes('/order/');
  if (isCustomerPath && !user) return null;

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-zinc-950 border-t border-zinc-900 px-4 py-2 flex justify-around items-center md:top-0 md:bottom-auto md:flex-col md:w-14 md:h-full md:border-t-0 md:border-r md:pt-4 md:space-y-4 z-50 shadow-2xl">
      <Link 
        to={restId ? `/restaurant/${restId}/table/default` : '/'} 
        className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/table/') ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'text-zinc-600 hover:text-orange-500'}`}
      >
        <ShoppingBag size={20} />
      </Link>
      
      {user && restId && (
        <>
          <Link 
            to={`/restaurant/${restId}/payments`} 
            className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/payments') ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'text-zinc-600 hover:text-emerald-500'}`}
          >
            <Banknote size={20} />
          </Link>
          <Link 
            to={`/restaurant/${restId}/orders`} 
            className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/orders') ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'text-zinc-600 hover:text-blue-500'}`}
          >
            <LayoutDashboard size={20} />
          </Link>
          <Link 
            to={`/restaurant/${restId}/kitchen`} 
            className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/kitchen') ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'text-zinc-600 hover:text-orange-500'}`}
          >
            <ChefHat size={20} />
          </Link>
          <Link 
            to={`/restaurant/${restId}/admin`} 
            className={`p-2 rounded transition-all active:scale-90 ${location.pathname.includes('/admin') ? 'bg-zinc-800 text-zinc-100 border border-zinc-700' : 'text-zinc-600 hover:text-zinc-300'}`}
          >
            <Settings size={20} />
          </Link>
        </>
      )}
      
      {user && (
        <button onClick={handleSignOut} className="p-2 hover:bg-red-500/10 rounded transition-all text-zinc-600 hover:text-red-500 md:mt-auto md:mb-4 active:scale-90">
          <LogOut size={20} />
        </button>
      )}
    </nav>
  );
}
