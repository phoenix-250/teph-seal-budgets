// Supabase Edge Function: admin-users
// Lets an admin add people, reset passwords, lock/unlock and remove logins.
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → Via Editor
//         name it exactly  admin-users  and paste this whole file.
// It runs on Supabase's servers, so the powerful service key never reaches the browser.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["admin", "district", "manager"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Who is calling? Must be an active admin.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: auth, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !auth?.user) return json({ error: "Please sign in again." }, 401);
    const caller = auth.user;
    const { data: me } = await admin.from("profiles").select("role, active").eq("id", caller.id).single();
    if (!me || me.role !== "admin" || !me.active) return json({ error: "Only admins can do that." }, 403);

    const body = await req.json();
    const action = body.action;

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const full_name = String(body.full_name || "").trim();
      const role = ROLES.includes(body.role) ? body.role : "manager";
      if (!email.includes("@")) return json({ error: "Enter a valid email." }, 400);
      if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name },
      });
      if (error) return json({ error: error.message }, 400);
      const { error: pErr } = await admin.from("profiles").upsert({
        id: data.user.id, email, full_name, role, can_move: !!body.can_move, active: true,
      });
      if (pErr) return json({ error: pErr.message }, 400);
      return json({ id: data.user.id });
    }

    const userId = String(body.user_id || "");
    if (!userId) return json({ error: "Missing person." }, 400);

    if (action === "reset_password") {
      const password = String(body.password || "");
      if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "set_active") {
      const active = !!body.active;
      if (userId === caller.id && !active) return json({ error: "You can't lock yourself out." }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ active }).eq("id", userId);
      return json({ ok: true });
    }

    if (action === "delete") {
      if (userId === caller.id) return json({ error: "You can't remove yourself." }, 400);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || "Something went wrong." }, 500);
  }
});
