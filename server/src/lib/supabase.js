const { createClient } = require('@supabase/supabase-js');

let client;

function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Uses the service-role key, which bypasses RLS: keep this module server-side.
function getSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  client ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return client;
}

module.exports = { getSupabase, isSupabaseConfigured };
