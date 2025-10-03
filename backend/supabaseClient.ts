import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Try root .env, then backend/.env (cwd may be project root when using new start script)
if (!process.env.SUPABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}
if (!process.env.SUPABASE_URL) {
  dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });
}

// We support two usage modes:
// 1. Service role key (recommended for backend trusted operations)
// 2. Anon key (restricted) - requires RLS policies that scope access
// If only anon key is present, ensure you have enabled RLS and policies on the user_wallets table.

let supabase: SupabaseClient | undefined;

function init() {
  if (supabase) return supabase;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL) {
    console.warn('[supabase] SUPABASE_URL not set. Supabase client will not function.');
    return undefined;
  }
  const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!key) {
    console.warn('[supabase] Neither service role nor anon key provided.');
    return undefined;
  } else if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[supabase] Using ANON key (limited privileges). Ensure RLS policies are defined.');
  } else {
    console.log('[supabase] Using SERVICE ROLE key.');
  }
  supabase = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  return supabase;
}

export function getSupabase() {
  if (!supabase) {
    init();
  }
  if (!supabase) throw new Error('Supabase client not initialized (missing env vars).');
  return supabase;
}
