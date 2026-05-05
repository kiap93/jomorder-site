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
    // 1. Get initial session
    const { data: { session } } = await supabase.auth.getSession();
    
    const fetchProfile = async (userId: string) => {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (data) {
        set({ 
          user: session?.user ?? null, 
          profile: {
            id: data.id,
            email: data.email,
            role: data.role,
            restaurantId: data.restaurant_id // mapping snake_case to camelCase
          } as UserProfile, 
          loading: false 
        });
      } else {
        set({ user: session?.user ?? null, profile: null, loading: false });
      }
    };

    if (session?.user) {
      await fetchProfile(session.user.id);
    } else {
      set({ user: null, profile: null, loading: false });
    }

    // 2. Listen for auth changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        await fetchProfile(session.user.id);
      } else {
        set({ user: null, profile: null, loading: false });
      }
    });
  },
  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, profile: null });
  }
}));
