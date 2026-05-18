import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
};

const finalUrl = isValidUrl(supabaseUrl) ? supabaseUrl : 'https://missing-project-id.supabase.co';
const finalKey = supabaseAnonKey || 'missing-anon-key';

if (!supabaseUrl || !supabaseAnonKey || !isValidUrl(supabaseUrl)) {
  console.error('Supabase configuration error:', { 
    urlFound: !!supabaseUrl, 
    keyFound: !!supabaseAnonKey,
    urlValid: isValidUrl(supabaseUrl)
  });
  console.info('Please check your AI Studio Settings (Gear icon) for VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

const getAppId = () => {
  try {
    const host = window.location.host.split('.')[0] || 'default';
    // Use a unique session-specific ID to isolate tabs. 
    // This prevents "Lock broken" AbortErrors by giving each tab its own lock namespace.
    // We use sessionStorage because it is unique to the tab but survives reloads.
    let tabId = window.sessionStorage.getItem('supabase_tab_id');
    if (!tabId) {
      tabId = Math.random().toString(36).slice(2, 10);
      window.sessionStorage.setItem('supabase_tab_id', tabId);
    }
    return `${host}-${tabId}`;
  } catch {
    return 'default';
  }
};

// Main client for staff/admin - we use a custom storage key to isolate tabs
// For multi-tenant support and "JWT session" pattern, we manage persistence manually in useAuthStore
export const supabase = createClient(finalUrl, finalKey, {
  auth: {
    persistSession: false, // Disabled for manual JWT control
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
    lock: async (_name: string, _acquireTimeout: number, callback: () => Promise<any>) => {
      return await callback();
    }
  }
});

// Guest client for anonymous QR users - stateless and no locking
export const guestSupabase = createClient(finalUrl, finalKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    lock: async (_name: string, _acquireTimeout: number, callback: () => Promise<any>) => {
      return await callback();
    }
  }
});
