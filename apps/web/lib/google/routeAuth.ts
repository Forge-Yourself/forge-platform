import { createBearerClient, getBearerToken } from '@/lib/supabase/bearer';

/**
 * Who is calling a /api/google/* route, from the app's bearer token. The role
 * is read under the caller's own token (RLS), the same way the AI broker
 * authorizes, so a forged user id in a body can never matter.
 */
export async function caller(request: Request): Promise<{ userId: string; role: string } | Response> {
  const token = getBearerToken(request);
  if (!token) return Response.json({ error: 'missing bearer token' }, { status: 401 });
  const bearer = createBearerClient(token);
  const {
    data: { user },
  } = await bearer.auth.getUser();
  if (!user) return Response.json({ error: 'invalid token' }, { status: 401 });
  const { data } = await bearer.from('users').select('role').eq('id', user.id).maybeSingle();
  return { userId: user.id, role: data?.role ?? '' };
}
