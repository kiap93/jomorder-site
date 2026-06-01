import { create } from 'zustand';
import { UserProfile } from '../types';
import { getApiUrl } from '../lib/api';
import { indexedDbStorage } from '../lib/indexedDbStorage';
import { offlineService, clearTenantScopedIndexedDB } from '../lib/offlineService';
import { useWorkspaceStore } from './useWorkspaceStore';

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
const currentTabId = typeof window !== 'undefined' ? (Math.random().toString(36).substring(2, 11) + '-' + Date.now()) : 'ssr-env';
let lastProcessedChangeTime = 0;

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
        if (!event.data || typeof event.data !== 'object' || event.data.type !== 'AUTH_STATE_CHANGED') {
          return;
        }
        if (event.data.sourceTab === currentTabId) return;

        const now = Date.now();
        if (now - lastProcessedChangeTime < 1500) {
          console.log("AuthStore (Worker): Throttling redundant sync broadcast");
          return;
        }
        lastProcessedChangeTime = now;

        console.log("AuthStore (Worker): Syncing auth state from another tab...");
        get().refreshSession();
      };
      authChannel.addEventListener('message', channelListener);

      // Cross-tab sync relies on multi-tab BroadcastChannel
      if (window.location.pathname.includes('/table/')) {
        set({ loading: false });
        return () => {
          authChannel.removeEventListener('message', channelListener);
        };
      }

      await get().refreshSession();

      return () => {
        authChannel.removeEventListener('message', channelListener);
        initializationPromise = null;
      };
    })();

    return initializationPromise;
  },

  // Internal helper to refresh session from IndexedDB
  refreshSession: async () => {
    const storageKey = getStorageKey();
    const savedToken = await indexedDbStorage.getItem<string>(storageKey);

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
            role: profile.role ? (profile.role.toLowerCase() as any) : 'owner',
            restaurantId: profile.restaurantId || profile.restaurant_id,
            organizationId: profile.organizationId || profile.organization_id || null,
            status: profile.status,
            permissions: profile.permissions,
            platform_role: profile.platform_role || null
          } as UserProfile,
          token: savedToken,
          loading: false 
        });
      } else {
        const text = await response.text();
        console.warn("Session refresh failed with status:", response.status, text);
        await indexedDbStorage.removeItem(storageKey);
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
      await indexedDbStorage.setItem(getStorageKey(), token);

      set({ 
        user: { id: profile.id, email: profile.email },
        profile: {
          id: profile.id,
          email: profile.email,
          role: profile.role ? (profile.role.toLowerCase() as any) : 'owner',
          restaurantId: profile.restaurantId || profile.restaurant_id,
          organizationId: profile.organizationId || profile.organization_id || null,
          status: profile.status,
          permissions: profile.permissions,
          platform_role: profile.platform_role || null
        } as UserProfile,
        token,
        loading: false 
      });

      // Notify other tabs via worker channel
      authChannel.postMessage({ type: 'AUTH_STATE_CHANGED', sourceTab: currentTabId });
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
      await indexedDbStorage.setItem(getStorageKey(), token);

      set({ 
        user: { id: profile.id, email: profile.email },
        profile: {
          id: profile.id,
          email: profile.email,
          role: profile.role ? (profile.role.toLowerCase() as any) : 'owner',
          restaurantId: profile.restaurantId || profile.restaurant_id,
          organizationId: profile.organizationId || profile.organization_id || null,
          status: profile.status,
          permissions: profile.permissions,
          platform_role: profile.platform_role || null
        } as UserProfile,
        token,
        loading: false 
      });

      // Notify other tabs
      authChannel.postMessage({ type: 'AUTH_STATE_CHANGED', sourceTab: currentTabId });
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
      await indexedDbStorage.setItem(getStorageKey(), token);

      set({ 
        user: { id: profile.id, email: profile.email },
        profile: {
          id: profile.id,
          email: profile.email,
          role: profile.role ? (profile.role.toLowerCase() as any) : 'owner',
          restaurantId: profile.restaurantId || profile.restaurant_id,
          organizationId: profile.organizationId || profile.organization_id || null,
          status: profile.status,
          permissions: profile.permissions,
          platform_role: profile.platform_role || null
        } as UserProfile,
        token,
        loading: false 
      });

      // Notify other tabs via worker channel
      authChannel.postMessage({ type: 'AUTH_STATE_CHANGED', sourceTab: currentTabId });
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  signOut: async () => {
    const storageKey = getStorageKey();
    await indexedDbStorage.removeItem(storageKey);
    
    // Clear all manual JWT keys
    const allKeys = await indexedDbStorage.keys();
    for (const key of allKeys) {
      if (key.startsWith('manual_supabase_')) {
        await indexedDbStorage.removeItem(key);
      }
    }

    // Purge ALL tenant-scoped offline databases and memories immediately before session teardown
    try {
      await clearTenantScopedIndexedDB();
    } catch (err) {
      console.error('[AuthStore] Failed to purge tenant-scoped data during signOut:', err);
    }

    set({ user: null, profile: null, token: null, loading: false });
    useWorkspaceStore.getState().clearWorkspaces();
    
    // Notify other tabs via worker channel
    authChannel.postMessage({ type: 'AUTH_STATE_CHANGED', sourceTab: currentTabId });
    initializationPromise = null;
  },

  switchWorkspace: async (restaurantId: string) => {
    const currentToken = get().token;
    if (!currentToken) throw new Error("No active session found.");

    try {
      // Clear current offline state so workspace switches don't leak or reuse old session data
      try {
        await clearTenantScopedIndexedDB();
      } catch (err) {
        console.error('[AuthStore] Failed to purge tenant data prior to workspace switch:', err);
      }

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
      await indexedDbStorage.setItem(getStorageKey(), token);

      set({ 
        user: { id: enrichedUser.id, email: enrichedUser.email },
        profile: {
          id: enrichedUser.id,
          email: enrichedUser.email,
          role: enrichedUser.role ? (enrichedUser.role.toLowerCase() as any) : 'owner',
          restaurantId: enrichedUser.restaurantId || enrichedUser.restaurant_id,
          organizationId: enrichedUser.organizationId || enrichedUser.organization_id || null,
          status: enrichedUser.status,
          permissions: enrichedUser.permissions,
          platform_role: enrichedUser.platform_role || null
        } as UserProfile,
        token,
        loading: false 
      });

      useWorkspaceStore.getState().clearWorkspaces();

      // Notify other tabs via worker channel
      authChannel.postMessage({ type: 'AUTH_STATE_CHANGED', sourceTab: currentTabId });
    } catch (err) {
      throw err;
    }
  }
}));

