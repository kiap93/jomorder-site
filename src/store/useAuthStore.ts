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

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();
      
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
    };

    // 1. Get initial session
    const { data: { session } } = await supabase.auth.getSession();
    await fetchProfile(session?.user ?? null);

    // 2. Listen for auth changes
    supabase.auth.onAuthStateChange(async (_event, session) => {
      await fetchProfile(session?.user ?? null);
    });
  },
  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, profile: null });
  }
}));
