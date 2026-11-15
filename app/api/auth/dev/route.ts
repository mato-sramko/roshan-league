// Sign in without Steam, for testing. Only works when ALLOW_DEV_LOGIN=1.
import { NextResponse } from 'next/server';
import { devLoginAllowed, upsertUser, startSession, siteUrl } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!devLoginAllowed()) return new NextResponse('Not found', { status: 404 });
  const name = (new URL(req.url).searchParams.get('name') || 'tester').slice(0, 30);
  const id = await upsertUser(`dev-${name.toLowerCase()}`, name);
  await startSession(id);
  return NextResponse.redirect(`${siteUrl(req)}/team`);
}
