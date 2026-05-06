import { Link } from 'react-router-dom';
import { ChefHat, ShoppingBag, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';

export function Landing() {
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
          <div className="p-8 border-2 border-gray-50 rounded-[3rem] bg-gray-50/50 space-y-4">
            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mx-auto shadow-sm">
              <ShoppingBag size={24} className="text-orange-600" />
            </div>
            <h3 className="font-black text-gray-900">Are you a Customer?</h3>
            <p className="text-gray-400 text-sm font-medium">
              Please scan the QR code located on your table to start ordering.
            </p>
          </div>

          <Link 
            to="/login"
            className="w-full bg-gray-900 text-white py-6 rounded-[2rem] font-bold text-lg flex items-center justify-center gap-3 hover:bg-black transition-all shadow-xl hover:shadow-orange-200/40 group"
          >
            Restaurant Management
            <ArrowRight className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>

        <p className="text-[10px] text-gray-300 font-black uppercase tracking-widest">
          Powered by SmartMenu Pro
        </p>
      </motion.div>
    </div>
  );
}
