const SUPABASE_URL = "https://dacboefvooxgsngxkavx.supabase.co";

const SUPABASE_ANON_KEY =
    "sb_publishable_amKa8N585WyB41bXibtTKQ_GTx3B7a8";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

window.supabaseClient = supabaseClient;

console.log("✅ Supabase connected");