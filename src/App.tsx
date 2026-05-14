import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { Navbar } from './components/Navbar';

// Pages (to be created)
import { CustomerMenu } from './pages/CustomerMenu';
import { PosDashboard } from './pages/PosDashboard';
import { KitchenDisplay } from './pages/KitchenDisplay';
import { AdminPanel } from './pages/AdminPanel';
import { Login } from './pages/Login';
import { OrderTracker } from './pages/OrderTracker';
import { Checkout } from './pages/Checkout';

import { Onboarding } from './pages/Onboarding';
import { Landing } from './pages/Landing';
import { InternalReview } from './pages/InternalReview';

export default function App() {
  const { init, loading, user, profile } = useAuthStore();

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    
    init().then(cb => {
      if (active) {
        cleanup = cb;
      } else {
        cb();
      }
    });

    return () => {
      active = false;
      if (cleanup) cleanup();
    };
  }, [init]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gray-50 font-sans">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 md:pl-20 font-sans">
        <Navbar />
        <main className="container mx-auto px-4 py-8">
          <Routes>
            {/* Main Landing */}
            <Route path="/" element={<Landing />} />

            {/* Customer Flow */}
            <Route path="/restaurant/:restId/table/:tableId" element={<CustomerMenu />} />
            <Route path="/restaurant/:restId/table/:tableId/order/:orderId/checkout" element={<Checkout />} />
            <Route path="/restaurant/:restId/table/:tableId/order/:orderId" element={<OrderTracker />} />
            
            {/* Staff Flow */}
            <Route path="/restaurant/:restId/orders" element={<PosDashboard />} />
            <Route path="/restaurant/:restId/kitchen" element={<KitchenDisplay />} />
            <Route path="/restaurant/:restId/admin" element={<AdminPanel />} />
            
            {/* Auth & Setup */}
            <Route path="/login" element={<Login />} />
            <Route path="/onboarding" element={<Onboarding />} />
            
            {/* Internal Audit */}
            <Route path="/internal/audit-hub" element={<InternalReview />} />
            
            {/* Catch-all - Dynamic redirect based on auth */}
            <Route path="*" element={
              user ? (
                profile?.restaurantId 
                  ? <Navigate to={`/restaurant/${profile.restaurantId}/orders`} replace />
                  : <Navigate to="/onboarding" replace />
              ) : <Navigate to="/" replace />
            } />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
