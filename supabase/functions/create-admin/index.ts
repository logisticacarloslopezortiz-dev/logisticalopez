// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// CORS headers para Edge Function
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), { headers: corsHeaders, status });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Validar token del admin que invoca
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const accessToken = auth.substring(7);

  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    return jsonResponse({ error: "Invalid session" }, 401);
  }
  const callerId = userData.user.id;

  // Verificar rol del administrador en colaboradores
  const { data: callerCollab, error: collabErr } = await supabaseAnon
    .from("collaborators")
    .select("role")
    .eq("id", callerId)
    .maybeSingle();

  if (collabErr) {
    return jsonResponse({ error: "Failed to verify collaborator role", details: collabErr.message }, 400);
  }
  if (!callerCollab || (callerCollab.role || "").toLowerCase() !== "administrador") {
    return jsonResponse({ error: "Forbidden: admin role required" }, 403);
  }

  // Leer body
  let body: any;
  try {
    body = await req.json();
  } catch (_) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const full_name = String(body?.full_name || "").trim();
  const phone = String(body?.phone || "").trim();

  if (!email || !password || !full_name) {
    return jsonResponse({ error: "Missing required fields: email, password, full_name" }, 400);
  }

  // Evitar duplicados por email
  const { data: existingProfile } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (existingProfile) {
    return jsonResponse({ error: "Profile already exists for this email" }, 409);
  }
  const { data: existingCollab } = await supabaseAdmin
    .from("collaborators")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (existingCollab) {
    return jsonResponse({ error: "Collaborator already exists for this email" }, 409);
  }

  // Crear usuario en Auth (confirmado)
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, phone, role: "Administrador" },
  });
  if (createErr) {
    return jsonResponse({ error: "Failed to create auth user", details: createErr.message }, 400);
  }

  const newUser = created.user;
  if (!newUser) {
    return jsonResponse({ error: "Auth user not returned" }, 500);
  }

  // Insertar en profiles
  const { error: profileErr } = await supabaseAdmin
    .from("profiles")
    .insert({ id: newUser.id, email, full_name, updated_at: new Date().toISOString() });
  if (profileErr) {
    return jsonResponse({ error: "Failed to insert profile", details: profileErr.message }, 400);
  }

  // Insertar en collaborators con rol Administrador
  const { error: collabInsErr } = await supabaseAdmin
    .from("collaborators")
    .insert({ id: newUser.id, full_name, email, phone, role: "Administrador", status: "Activo" });
  if (collabInsErr) {
    return jsonResponse({ error: "Failed to insert collaborator", details: collabInsErr.message }, 400);
  }

  return jsonResponse({ ok: true, user_id: newUser.id });
});