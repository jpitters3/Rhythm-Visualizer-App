
import { createClient } from '@supabase/supabase-js';

// No fallback on purpose: this used to default to the PRODUCTION project
// whenever env vars were missing, which meant any misconfigured deploy
// context (e.g. a staging build missing its env vars) would silently
// connect to — and could write test data into — production. Failing loudly
// here is what makes a separate staging environment actually safe.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — set them in .env (local) ' +
    'or this deploy context\'s environment variables. Refusing to start rather than ' +
    'silently falling back to a default project.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
});