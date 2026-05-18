import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { User } from '@supabase/supabase-js';
import { UserProfile } from '../types';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  init: () => Promise<() => void>;
  signOut: () => Promise<void>;
}

let initializationPromise: Promise<(() => void)> | null = null;

const getStorageKey = () => {
  const match = window.location.pathname.match(/\/restaurant\/([^\/]+)/);
  const restId = match ? match[1] : 'global';
  return `manual_supabase_session_${restId}`;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  init: async () => {
    // Return the existing promise if initialization is already in progress
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
      // Skip persistent auth check for guest QR ordering routes
      if (window.location.pathname.includes('/table/')) {
        set({ loading: false });
        // Return a no-op cleanup
        return () => {};
      }

      const fetchProfile = async (currentUser: User | null, retryCount = 0): Promise<void> => {
        if (!currentUser) {
          set({ user: null, profile: null, loading: false });
          return;
        }

        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .maybeSingle();

          if (error) {
            // Retry on connection issues (up to 3 times)
            if (retryCount < 3 && (error.message?.includes('fetch') || error.message?.includes('network') || !error.code)) {
               console.warn(`Profile fetch failed (attempt ${retryCount + 1}), retrying...`);
               await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
               return fetchProfile(currentUser, retryCount + 1);
            }
            throw error;
          }
          
          if (data) {
            set({ 
              user: currentUser, 
              profile: {
                id: data.id,
                email: data.email,
                role: data.role,
                restaurantId: data.restaurant_id
              } as UserProfile, 
              loading: false 
            });
          } else {
            console.warn("No profile found for user:", currentUser.id);
            set({ user: currentUser, profile: null, loading: false });
          }
        } catch (err) {
          console.error("Profile fetch failed:", err);
          set({ user: currentUser, profile: null, loading: false });
        }
      };

      const checkSession = async () => {
        try {
          // Manual session recovery for "JWT session" pattern
          const savedSession = window.sessionStorage.getItem(getStorageKey());
          if (savedSession) {
            const session = JSON.parse(savedSession);
            await supabase.auth.setSession(session);
          }

          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          
          if (sessionError) {
            console.error("Session fetch error:", sessionError);
            if (
              sessionError.message.includes('Refresh Token') || 
              sessionError.message.includes('not found') || 
              sessionError.status === 400 ||
              sessionError.status === 401
            ) {
              console.warn("Stale session detected, clearing...");
              window.sessionStorage.removeItem(getStorageKey());
              await supabase.auth.signOut();
              set({ user: null, profile: null, loading: false });
              return;
            }
            throw sessionError;
          }
          
          if (session?.user) {
            await fetchProfile(session.user);
          } else {
            set({ user: null, profile: null, loading: false });
          }
        } catch (err) {
          console.error("Session check failed:", err);
          set({ user: null, profile: null, loading: false });
        }
      };

      // Initial check
      await checkSession();

      // Listen for auth changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        console.log("Auth Event:", event);
        
        // Persist session manually for multi-tenant isolation
        if (session) {
          window.sessionStorage.setItem(getStorageKey(), JSON.stringify(session));
        } else {
          window.sessionStorage.removeItem(getStorageKey());
        }

        if (event === 'SIGNED_OUT') {
          set({ user: null, profile: null, loading: false });
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          if (session?.user) {
            await fetchProfile(session.user);
          }
        } else if (event === 'INITIAL_SESSION') {
          if (session?.user) {
            await fetchProfile(session.user);
          } else {
            set({ user: null, profile: null, loading: false });
          }
        }
      });

      // Handle window focus - check if session is still valid after a long time
      let lastFocusCheck = 0;
      const handleFocus = () => {
        const now = Date.now();
        if (now - lastFocusCheck < 10000) return; // Only check at most every 10 seconds
        lastFocusCheck = now;
        
        console.log("Window focused, checking session...");
        checkSession();
      };
      window.addEventListener('focus', handleFocus);

      return () => {
        subscription.unsubscribe();
        window.removeEventListener('focus', handleFocus);
        initializationPromise = null;
      };
    })();

    return initializationPromise;
  },
  signOut: async () => {
    window.sessionStorage.removeItem(getStorageKey());
    await supabase.auth.signOut();
    set({ user: null, profile: null });
  }
}));
