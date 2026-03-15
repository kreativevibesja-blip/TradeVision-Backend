import { createClient } from '@supabase/supabase-js';
import { config } from './index';

if (!config.supabase.url || !config.supabase.anonKey) {
  throw new Error('Missing Supabase backend configuration. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
}

export const supabase = createClient(config.supabase.url, config.supabase.anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});