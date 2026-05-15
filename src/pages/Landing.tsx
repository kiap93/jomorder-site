import { useNavigate, Link } from 'react-router-dom';
import { ChefHat, ShoppingBag, ArrowRight, Eye } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuthStore } from '../store/useAuthStore';

export function Landing() {
  const navigate = useNavigate();
  const { profile, init } = useAuthStore();
  const restId = profile?.restaurantId;

  const handleManagementClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    // Ensure auth is initialized/refreshed before navigating
    await init();
    
    // Check current state after init
    const currentProfile = useAuthStore.getState().profile;
    if (currentProfile?.restaurantId) {
      navigate(`/restaurant/${currentProfile.restaurantId}/orders`);
    } else {
      navigate('/login');
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full space-y-12"
      >
        <div className="flex justify-center">
          <div className="w-20 h-20 bg-orange-600 rounded-[2.5rem] flex items-center justify-center shadow-2xl shadow-orange-200">
            <ChefHat size={40} className="text-white" />
          </div>
        </div>

        <div className="space-y-4">
          <h1 className="text-5xl font-black text-gray-900 tracking-tighter leading-none">
            EAT.<br />
            ORDER.<br />
            ENJOY.
          </h1>
          <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">
            Digital Ordering System
          </p>
        </div>

        <div className="grid gap-4 pt-8">
          <Link 
            to="/login"
            onClick={handleManagementClick}
            className="w-full bg-gray-900 text-white py-6 rounded-[2rem] font-bold text-lg flex items-center justify-center gap-3 hover:bg-black transition-all shadow-xl hover:shadow-orange-200/40 group"
          >
            Restaurant Management
            <ArrowRight className="group-hover:translate-x-1 transition-transform" />
          </Link>

          <Link 
            to={restId ? `/restaurant/${restId}/table/default` : "/login"}
            className="w-full bg-white text-gray-900 border-2 border-gray-100 py-6 rounded-[2rem] font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 hover:border-orange-200 transition-all shadow-sm group"
          >
            <Eye size={16} className="text-orange-500 group-hover:scale-110 transition-transform" />
            Preview Online Menu
          </Link>
        </div>

        <p className="text-[10px] text-gray-300 font-black uppercase tracking-widest">
          Powered by SmartMenu Pro
        </p>
      </motion.div>
    </div>
  );
}
