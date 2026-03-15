import { createClient } from '@supabase/supabase-js';
import { config } from './index';

const supabaseServerKey = config.supabase.serviceRoleKey || config.supabase.anonKey;

if (!config.supabase.url || !supabaseServerKey) {
  throw new Error(
    'Missing Supabase backend configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY.'
  );
}

export const supabase = createClient(config.supabase.url, supabaseServerKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});