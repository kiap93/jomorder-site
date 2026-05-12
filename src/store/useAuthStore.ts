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

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  loading: true,
  init: async () => {
    const fetchProfile = async (currentUser: User | null) => {
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

        if (error) throw error;
        
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
          set({ user: currentUser, profile: null, loading: false });
        }
      } catch (err) {
        console.error("Profile fetch failed:", err);
        set({ user: currentUser, profile: null, loading: false });
      }
    };

    const checkSession = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          if (
            sessionError.message.includes('Refresh Token') || 
            sessionError.message.includes('not found') || 
            sessionError.status === 400 ||
            sessionError.status === 401
          ) {
            console.warn("Stale session detected, clearing...");
            await supabase.auth.signOut();
            set({ user: null, profile: null, loading: false });
            return;
          }
          throw sessionError;
        }
        
        if (session?.user) {
          await fetchProfile(session.user);
        } else {
          set({ loading: false });
        }
      } catch (err) {
        console.error("Session check failed:", err);
        set({ loading: false });
      }
    };

    // Initial check
    await checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        set({ user: null, profile: null });
      }
      
      if (session) {
        await fetchProfile(session.user);
      } else {
        set({ user: null, profile: null, loading: false });
      }
    });

    // Handle window focus - check if session is still valid after a long time
    const handleFocus = () => {
      checkSession();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('focus', handleFocus);
    };
  },
  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, profile: null });
  }
}));
