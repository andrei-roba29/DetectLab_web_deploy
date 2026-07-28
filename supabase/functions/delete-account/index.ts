// supabase/functions/delete-account/index.ts
//
// Deploy with:  supabase functions deploy delete-account
// (run from your project root, where the supabase/ folder lives)
//
// This function must run server-side because deleting an Auth user
// requires the `service_role` key, which should NEVER be shipped to
// the browser. The browser only ever sends its own access token; this
// function verifies that token, figures out which user it belongs to,
// and deletes exactly that user — nothing else.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Browsers send a CORS preflight (OPTIONS) request before the real POST,
// and every response (including error responses) needs these headers or
// the browser blocks the whole thing before your code's answer is even read.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  // Handle the CORS preflight request.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");

    if (!jwt) {
      return jsonResponse({ error: "Missing auth token" }, 401);
    }

    // Client scoped to the caller's own token, just to verify who they are.
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await callerClient.auth.getUser(jwt);
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Invalid session" }, 401);
    }

    const userId = userData.user.id;

    // Admin client with service_role, used only inside this server function.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // If you keep app data in your own tables (e.g. "profiles"), delete
    // those rows first. Uncomment and adjust to your schema:
    //
    // await adminClient.from("profiles").delete().eq("id", userId);

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      return jsonResponse({ error: deleteError.message }, 500);
    }

    return jsonResponse({ success: true }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
