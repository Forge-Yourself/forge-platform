import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json({ status: 'degraded', supabase: 'not_configured' }, { status: 503 });
  }

  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey },
      cache: 'no-store',
    });
    return NextResponse.json(
      { status: res.ok ? 'ok' : 'degraded', supabase: res.ok ? 'reachable' : res.status },
      { status: res.ok ? 200 : 503 },
    );
  } catch {
    return NextResponse.json({ status: 'degraded', supabase: 'unreachable' }, { status: 503 });
  }
}
