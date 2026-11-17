// Deletes the calling user's account. Requires a valid user JWT (verified by Supabase before this
// runs). Uses the service role only for the two operations a user cannot perform on themselves:
// removing their storage objects and deleting the auth user. All public tables cascade on user_id.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Not signed in' }, 401);
  const userId = userData.user.id;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Remove every stored object under the user's folder in each bucket (none exist before Stage 4).
  const { data: buckets } = await admin.storage.listBuckets();
  for (const bucket of buckets ?? []) {
    for (;;) {
      const { data: objects, error } = await admin.storage.from(bucket.id).list(userId, { limit: 100 });
      if (error || !objects?.length) break;
      await admin.storage.from(bucket.id).remove(objects.map((o) => `${userId}/${o.name}`));
      if (objects.length < 100) break;
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return json({ error: error.message }, 500);
  return json({ deleted: true }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
