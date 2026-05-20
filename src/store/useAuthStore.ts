import { create } from 'zustand';
import { UserProfile } from '../types';
import { getApiUrl } from '../lib/api';

interface AuthState {
  user: { id: string; email: string } | null;
  profile: UserProfile | null;
  token: string | null;
  loading: boolean;
  init: () => Promise<(() => void)>;
  refreshSession: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  switchWorkspace: (restaurantId: string) => Promise<void>;
}

let initializationPromise: Promise<(() => void)> | null = null;

const getStorageKey = () => 'manual_supabase_jwt';

// Worker channel for cross-tab synchronization
const authChannel = new BroadcastChannel('auth_worker');

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  token: null,
  loading: true,
  init: async () => {
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
      // Set up worker listener for cross-tab sync
      const channelListener = (event: MessageEvent) => {
        if (event.data.type === 'AUTH_STATE_CHANGED') {
          console.log("AuthStore (Worker): Syncing auth state from another tab...");
          get().refreshSession();
        }
      };
      authChannel.addEventListener('message', channelListener);

      // Handle storage event for extra robustness (legacy sync)
      const storageListener = (e: StorageEvent) => {
        if (e.key === getStorageKey()) {
          console.log("AuthStore (Storage): Storage changed, refreshing session...");
          get().refreshSession();
        }
      };
      window.addEventListener('storage', storageListener);

      if (window.location.pathname.includes('/table/')) {
        set({ loading: false });
        return () => {
          authChannel.removeEventListener('message', channelListener);
          window.removeEventListener('storage', storageListener);
        };
      }

      await get().refreshSession();

      return () => {
        authChannel.removeEventListener('message', channelListener);
        window.removeEventListener('storage', storageListener);
        initializationPromise = null;
      };
    })();

    return initializationPromise;
  },

  // Internal helper to refresh session from localStorage
  refreshSession: async () => {
    const storageKey = getStorageKey();
    const savedToken = window.localStorage.getItem(storageKey);

    if (!savedToken) {
      set({ user: null, profile: null, token: null, loading: false });
      return;
    }

    try {
      const response = await fetch(getApiUrl('/api/me'), {
        headers: {
          'Authorization': `Bearer ${savedToken}`
        }
      });

      if (response.ok) {
        const profile = await response.json();
        set({ 
          user: { id: profile.id, email: profile.email },
          profile: {
            id: profile.id,
            email: profile.email,
            role: profile.role,
            restaurantId: profile.restaurantId || profile.restaurant_id
          } as UserProfile,
          token: savedToken,
          loading: false 
        });
      } else {
        const text = await response.text();
        console.warn("Session refresh failed with status:", response.status, text);
        window.localStorage.removeItem(storageKey);
        set({ user: null, profile: null, token: null, loading: false });
      }
    } catch (err) {
      console.error("Session refresh failed:", err);
      set({ loading: false });
    }
  },

  signIn: async (email, password) => {
    set({ loading: true });
    try {
      const response = await fetch(getApiUrl('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const responseText = await response.text();
      let responseData: any;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        responseData = null;
      }

      if (!response.ok) {
        const errorMsg = responseData?.error || `Server error (${response.status}): ${responseText.slice(0, 100)}`;
        throw new Error(errorMsg);
      }

      const { token, user: profile } = responseData;
      window.localStorage.setItem(getStorageKey(), token);

      set({ 
        user: { id: profile.id, email: profile.email },
        profile: {
          id: profile.id,
          email: profile.email,
          role: profile.role,
          restaurantId: profile.restaurantId || profile.restaurant_id
        } as UserProfile,
        token,
        loading: false 
      });

      // Notify other tabs via worker channel
      authChannel.postMessage({ type: 'AUTH_STATE_CHANGED' });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  signUp: async (email, password) => {
    set({ loading: true });
    try {
      const response = await fetch(getApiUrl('/api/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const responseText = await response.text();
      let responseData: any;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        responseData = null;
      }

      if (!response.ok) {
        const errorMsg = responseData?.error || `Server error (${response.status}): ${responseText.slice(0, 100)}`;
        throw new Error(errorMsg);
      }

      const { token, user: profile } = responseData;
      window.localStorage.setItem(getStorageKey(), token);

      set({ 
        user: { id: profile.id, email: profile.email },
        profile: {
          id: profile.id,
          email: profile.email,
          role: profile.role,
          restaurantId: profile.restaurantId || profile.restaurant_id
        } as UserProfile,
        token,
        loading: false 
      });

      // Notify other tabs
      authChannel.postMessage({ type: 'AUTH_STATE_CHANGED' });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  signInWithGoogle: async (idToken: string) => {
    set({ loading: true });
    try {
      const apiUrl = getApiUrl('/api/google-login');
      console.log("Authenticating with Google via API:", apiUrl);
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });

      const responseText = await response.text();
      let responseData: any;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        responseData = null;
      }

      if (!response.ok) {
        const errorMsg = responseData?.error || `Server error (${response.status}): ${responseText.slice(0, 100)}`;
        throw new Error(errorMsg);
      }

      const { token, user: profile } = responseData;
      window.localStorage.setItem(getStorageKey(), token);

      set({ 
        user: { id: profile.id, email: profile.email },
        profile: {
          id: profile.id,
          email: profile.email,
          role: profile.role,
          restaurantId: profile.restaurantId || profile.restaurant_id
        } as UserProfile,
        token,
        loading: false 
      });

      // Notify other tabs via worker channel
      authChannel.postMessage({ type: 'AUTH_STATE_CHANGED' });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  signOut: async () => {
    const storageKey = getStorageKey();
    window.localStorage.removeItem(storageKey);
    
    // Clear all manual JWT keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key?.startsWith('manual_supabase_')) {
          keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(k => window.localStorage.removeItem(k));

    set({ user: null, profile: null, token: null, loading: false });
    
    // Notify other tabs via worker channel
    authChannel.postMessage({ type: 'AUTH_STATE_CHANGED' });
    initializationPromise = null;
  },

  switchWorkspace: async (restaurantId: string) => {
    const currentToken = get().token;
    if (!currentToken) throw new Error("No active session found.");

    set({ loading: true });
    try {
      const response = await fetch(getApiUrl(`/api/switch-workspace/${restaurantId}`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Workspace switch failed: ${text}`);
      }

      const { token, user: enrichedUser } = await response.json();
      window.localStorage.setItem(getStorageKey(), token);

      set({ 
        user: { id: enrichedUser.id, email: enrichedUser.email },
        profile: {
          id: enrichedUser.id,
          email: enrichedUser.email,
          role: enrichedUser.role,
          restaurantId: enrichedUser.restaurantId || enrichedUser.restaurant_id,
          status: enrichedUser.status,
          permissions: enrichedUser.permissions
        } as UserProfile,
        token,
        loading: false 
      });

      // Notify other tabs via worker channel
      authChannel.postMessage({ type: 'AUTH_STATE_CHANGED' });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  }
}));

