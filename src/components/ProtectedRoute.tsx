import { ReactNode, useState, useEffect } from 'react';
import { Navigate, useParams, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { hasPermission, PermissionCode } from '../lib/rbac';
import { ShieldAlert, LogOut } from 'lucide-react';
import { getApiUrl } from '../lib/api';

// Simple global cache for completed restaurant IDs to avoid redundant fetch requests
const completedRestaurantsCache = new Set<string>();

interface ProtectedRouteProps {
  children: ReactNode;
  permissions?: PermissionCode[];
}

export function ProtectedRoute({ children, permissions }: ProtectedRouteProps) {
  const { user, profile, loading, signOut, token } = useAuthStore();
  const { restId } = useParams<{ restId?: string }>();
  const location = useLocation();
  const [checkingSetup, setCheckingSetup] = useState(false);
  const [setupIncomplete, setSetupIncomplete] = useState(false);

  const currentRestaurantId = restId || profile?.restaurantId;
  const isSetupPage = location.pathname.startsWith('/business/setup');

  useEffect(() => {
    // We only need to check if:
    // 1. User and token exist
    // 2. We have a restaurant ID
    // 3. User is an Owner, Manager, or Admin
    // 4. We are NOT already on the setup page
    // 5. This restaurant is NOT already confirmed completed in our memory cache
    if (!user || !token || !currentRestaurantId || isSetupPage) {
      return;
    }

    const lowerRole = profile?.role?.toLowerCase() || '';
    const needsSetupCheck = lowerRole === 'owner' || lowerRole === 'manager' || lowerRole === 'admin';

    if (!needsSetupCheck) {
      return;
    }

    if (completedRestaurantsCache.has(currentRestaurantId)) {
      setSetupIncomplete(false);
      return;
    }

    let isMounted = true;
    const checkSetupStatus = async () => {
      setCheckingSetup(true);
      try {
        const checkRes = await fetch(getApiUrl(`/api/setup/progress/${currentRestaurantId}`), {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!isMounted) return;

        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData && checkData.completed === false) {
            setSetupIncomplete(true);
          } else {
            completedRestaurantsCache.add(currentRestaurantId);
            setSetupIncomplete(false);
          }
        } else if (checkRes.status === 403) {
          // If 403 Forbidden, they aren't authorized to view or configure setup anyway, so they shouldn't be blocked!
          completedRestaurantsCache.add(currentRestaurantId);
          setSetupIncomplete(false);
        }
      } catch (e) {
        console.warn("Could not check setup progress in route guard:", e);
      } finally {
        if (isMounted) {
          setCheckingSetup(false);
        }
      }
    };

    checkSetupStatus();

    return () => {
      isMounted = false;
    };
  }, [user, token, currentRestaurantId, profile?.role, isSetupPage]);

  if (loading || checkingSetup) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-zinc-950 font-sans">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
      </div>
    );
  }

  // 1. Unauthenticated users are redirected to login
  if (!user || !profile) {
    return <Navigate to="/login" replace />;
  }

  // 2. Redirect to setup wizard if setup is incomplete and not on setup page
  if (setupIncomplete && !isSetupPage) {
    return <Navigate to={`/business/setup?restaurantId=${currentRestaurantId}`} replace />;
  }

  // 3. Cross-tenant workspace validation
  const currentRestaurantIdOrProfile = restId || profile.restaurantId;
  if (restId && profile.restaurantId && restId !== profile.restaurantId) {
    console.warn(`[Security Guard] Tenant mismatch. User restricted to: ${profile.restaurantId}, requested: ${restId}`);
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full bg-zinc-900 border border-zinc-850 p-8 rounded-[2rem] text-center shadow-2xl">
          <ShieldAlert className="mx-auto text-red-500 w-16 h-16 mb-4 animate-bounce" />
          <h2 className="text-xl font-black mb-2 tracking-tight">Establishment Boundary Conflict</h2>
          <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
            You do not hold workspace membership access to restaurant establishment code 
            <span className="font-mono text-xs block bg-zinc-950 p-2 rounded-lg text-red-400 border border-zinc-800 mt-2 break-all">{restId}</span>
          </p>
          <a
            href={`/restaurant/${profile.restaurantId}/orders`}
            className="inline-block w-full py-4 bg-orange-600 hover:bg-orange-700 text-white font-black text-xs uppercase tracking-wider rounded-2xl transition-all shadow-lg shadow-orange-950/20 active:scale-95 duration-100"
          >
            Return to Allowed Workspace
          </a>
        </div>
      </div>
    );
  }

  // 3. Permission Checks
  if (permissions && permissions.length > 0) {
    const userRole = profile.role;
    const userCustomPerms = profile.permissions;

    const isAuthorized = permissions.every(perm => 
      hasPermission(userRole, perm, userCustomPerms)
    );

    if (!isAuthorized) {
      console.warn(`[Security Alert] Access Denied: User role ${userRole} missing required permissions: ${permissions.join(', ')}`);
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full bg-zinc-900 border border-zinc-850 p-8 rounded-[2rem] text-center shadow-2xl">
            <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ShieldAlert size={32} />
            </div>
            <h2 className="text-xl font-black mb-2 tracking-tight">Access Restricted</h2>
            <p className="text-zinc-400 text-xs mb-6 leading-relaxed">
              Your active staff credentials (<span className="text-orange-500 font-extrabold capitalize">{userRole.toLowerCase()}</span>) 
              do not hold permission keys required to review this dashboard. Contact your organization owner to upgrade your profile capabilities.
            </p>
            
            <div className="grid grid-cols-2 gap-3">
              <a
                href={userRole.toLowerCase() === 'kitchen' ? `/restaurant/${currentRestaurantId}/kitchen` : `/restaurant/${currentRestaurantId}/orders`}
                className="py-3.5 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 font-bold text-[11px] uppercase tracking-wider rounded-xl transition-all text-center border border-zinc-700"
              >
                Back to Dashboard
              </a>
              <button
                onClick={() => signOut()}
                className="flex items-center justify-center gap-1.5 py-3.5 bg-red-950/30 text-red-400 font-bold text-[11px] uppercase tracking-wider rounded-xl transition-all text-center border border-red-900/30 hover:bg-red-950/50"
              >
                <LogOut size={12} />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
