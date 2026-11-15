import { NextResponse } from 'next/server';
import { siteUrl, verifySteam, steamName, upsertUser, startSession } from '@/lib/auth';

import { allow, clientIp } from '@/lib/limit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const origin = siteUrl(req);
  if (!(await allow(`login:${clientIp(req.headers)}`, 20, 60))) return NextResponse.redirect(`${origin}/?login=failed`);
  const steamId = await verifySteam(new URL(req.url).searchParams, origin).catch(() => null);
  if (!steamId) return NextResponse.redirect(`${origin}/?login=failed`);
  const id = await upsertUser(steamId, await steamName(steamId));
  await startSession(id);
  return NextResponse.redirect(`${origin}/team`);
}
