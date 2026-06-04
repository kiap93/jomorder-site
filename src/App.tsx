import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { indexedDbStorage } from './lib/indexedDbStorage';
import { Navbar } from './components/Navbar';

// Pages (to be created)
import { CustomerMenu } from './pages/CustomerMenu';
import { PosDashboard } from './pages/PosDashboard';
import { PosPayments } from './pages/PosPayments';
import { KitchenDisplay } from './pages/KitchenDisplay';
import { AdminPanel } from './pages/AdminPanel';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { OrderTracker } from './pages/OrderTracker';
import { Checkout } from './pages/Checkout';
import { PaymentSuccess } from './pages/PaymentSuccess';
import { CheckoutStatusRedirect } from './pages/CheckoutStatusRedirect';
import { BillingPage } from './features/billing/pages/BillingPage';

import { Onboarding } from './pages/Onboarding';
import { Landing } from './pages/Landing';
import { InternalReview } from './pages/InternalReview';
import { SuperAdmin } from './pages/SuperAdmin';
import { WorkspaceSelect } from './pages/WorkspaceSelect';
import { ProtectedRoute } from './components/ProtectedRoute';

function ContextTracker() {
  const location = useLocation();
  const { user, profile } = useAuthStore();

  useEffect(() => {
    if (user?.id && profile?.restaurantId) {
      const path = location.pathname;
      const isAuthOrOnboarding = 
        path.includes('/login') || 
        path.includes('/register') || 
        path.includes('/onboarding') || 
        path.includes('/workspace-select') || 
        path === '/' || 
        path.includes('/table/') || 
        path.includes('/order/');
        
      if (!isAuthOrOnboarding) {
        indexedDbStorage.setItem(`user_last_module_${user.id}`, path);
        indexedDbStorage.setItem(`user_last_branch_${user.id}`, profile.restaurantId);
        if (profile.organizationId) {
          indexedDbStorage.setItem(`user_last_workspace_${user.id}`, profile.organizationId);
        }
      }
    }
  }, [location.pathname, user?.id, profile?.restaurantId, profile?.organizationId]);

  return null;
}

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
      <ContextTracker />
      <div className="min-h-screen bg-gray-50 pb-20 md:pb-0 md:pl-20 font-sans">
        <Navbar />
        <main className="container mx-auto px-4 py-8">
          <Routes>
            {/* Main Landing */}
            <Route path="/" element={
              user ? (
                profile?.restaurantId 
                  ? <Navigate to={`/restaurant/${profile.restaurantId}/orders`} replace />
                  : <Navigate to="/workspace-select" replace />
              ) : <Landing />
            } />

            {/* Customer Flow */}
            <Route path="/restaurant/:restId/table/:tableId" element={<CustomerMenu />} />
            <Route path="/restaurant/:restId/table/:tableId/session/:sessionId" element={<CustomerMenu />} />
            <Route path="/restaurant/:restId/table/:tableId/order/:orderId/checkout" element={<Checkout />} />
            <Route path="/restaurant/:restId/table/:tableId/session/:sessionId/order/:orderId/checkout" element={<Checkout />} />
            <Route path="/restaurant/:restId/table/:tableId/order/:orderId/success" element={<PaymentSuccess />} />
            <Route path="/restaurant/:restId/table/:tableId/session/:sessionId/order/:orderId/success" element={<PaymentSuccess />} />
            <Route path="/restaurant/:restId/table/:tableId/order/:orderId" element={<OrderTracker />} />
            <Route path="/restaurant/:restId/table/:tableId/session/:sessionId/order/:orderId" element={<OrderTracker />} />
            
            {/* Payment Back-Redirect Route Receivers */}
            <Route path="/checkout" element={<CheckoutStatusRedirect />} />
            <Route path="/checkout/status" element={<CheckoutStatusRedirect />} />
            
            {/* Staff Flow */}
            <Route path="/restaurant/:restId/orders" element={
              <ProtectedRoute permissions={['orders.view']}>
                <PosDashboard />
              </ProtectedRoute>
            } />
            <Route path="/restaurant/:restId/payments" element={
              <ProtectedRoute permissions={['payments.view']}>
                <PosPayments />
              </ProtectedRoute>
            } />
            <Route path="/restaurant/:restId/kitchen" element={
              <ProtectedRoute permissions={['kitchen.view']}>
                <KitchenDisplay />
              </ProtectedRoute>
            } />
            <Route path="/restaurant/:restId/admin" element={
              <ProtectedRoute permissions={['settings.manage']}>
                <AdminPanel />
              </ProtectedRoute>
            } />
            <Route path="/restaurant/:restId/billing" element={
              <ProtectedRoute permissions={['settings.manage']}>
                <BillingPage />
              </ProtectedRoute>
            } />
            
            {/* Auth & Setup */}
            <Route path="/login" element={
              user ? (
                profile?.restaurantId 
                  ? <Navigate to={`/restaurant/${profile.restaurantId}/orders`} replace />
                  : <Navigate to="/workspace-select" replace />
              ) : <Login />
            } />
            <Route path="/register" element={
              user ? (
                profile?.restaurantId 
                  ? <Navigate to={`/restaurant/${profile.restaurantId}/orders`} replace />
                  : <Navigate to="/workspace-select" replace />
              ) : <Register />
            } />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/workspace-select" element={<WorkspaceSelect />} />
            
            {/* Internal Audit */}
            <Route path="/internal/audit-hub" element={<InternalReview />} />
            
            {/* Super Admin Panel */}
            <Route path="/superadmin/dashboard" element={<SuperAdmin />} />
            
            {/* Catch-all - Dynamic redirect based on auth */}
            <Route path="*" element={
              user ? (
                profile?.restaurantId 
                  ? <Navigate to={`/restaurant/${profile.restaurantId}/orders`} replace />
                  : <Navigate to="/workspace-select" replace />
              ) : <Navigate to="/" replace />
            } />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
