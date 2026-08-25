import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side Supabase client for API routes. The prototype uses permissive
// anon RLS (no auth), so the anon key is sufficient server-side too — no service
// role key is required. Kept separate from lib/supabase.ts so the server never
// depends on the browser singleton and vice-versa.
let _client: SupabaseClient | null = null;

export function getServerSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.",
    );
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}
