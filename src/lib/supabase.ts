import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('CRITICAL: Supabase environment variables are missing!');
  console.info('Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your environment.');
}

// Default to empty strings to avoid immediate crash in some environments, 
// but Supabase will throw a clearer error if you try to use it.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder-please-set-env-var.supabase.co', 
  supabaseAnonKey || 'placeholder-anon-key'
);
