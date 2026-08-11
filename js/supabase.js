const SUPABASE_URL = "https://dacboefvooxgsngxkavx.supabase.co";

const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhY2JvZWZ2b294Z3NuZ3hrYXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyOTc4MjEsImV4cCI6MjA5OTg3MzgyMX0.xiLcmTG8YUaBKlqjYtigvltFD-N2q14LSvkM4AKWY38";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

window.supabaseClient = supabaseClient;

console.log("✅ Supabase connected");