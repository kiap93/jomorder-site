import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { User } from '@supabase/supabase-js';
import { UserProfile } from '../types';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  init: () => void;
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
        // Fetch profile without aggressive timeout
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
          // No profile found - this is a valid state (user needs onboarding)
          set({ user: currentUser, profile: null, loading: false });
        }
      } catch (err) {
        console.error("Profile fetch failed:", err);
        set({ user: currentUser, profile: null, loading: false });
      }
    };

    // 1. Get initial session
    try {
      // Small delay to ensure any parallel auth transitions are stabilized
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        // If we have a refresh token error, the session is definitely invalid
        if (
          sessionError.message.includes('Refresh Token') || 
          sessionError.message.includes('not found') || 
          sessionError.status === 400 ||
          sessionError.status === 401
        ) {
          console.warn("Stale or invalid auth session found, clearing storage...");
          // Fallback: manually clear storage if signOut fails or to be absolutely sure
          try {
            await supabase.auth.signOut();
          } catch (e) {
            localStorage.removeItem('supabase.auth.token');
          }
          set({ user: null, profile: null, loading: false });
          return;
        }
        throw sessionError;
      }
      
      await fetchProfile(session?.user ?? null);
    } catch (err) {
      console.error("Auth init failed:", err);
      // In extreme cases where we can't even get session, clear everything
      set({ user: null, profile: null, loading: false });
    }

    // 2. Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Handle session expiration or signed out events explicitly
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        set({ user: null, profile: null });
      }
      
      if (session) {
        await fetchProfile(session.user);
      } else {
        set({ user: null, profile: null, loading: false });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  },
  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, profile: null });
  }
}));
