"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The browser talks to Supabase directly for auth, feed and votes, protected by
// row-level security (design doc §3). Without env vars the hub and feed show an
// honest "not connected" state instead of sample content.

let client: SupabaseClient | null | undefined;

export function supabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key) : null;
  return client;
}
