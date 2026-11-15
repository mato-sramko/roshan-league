import { NextResponse } from 'next/server';
import { siteUrl, steamLoginUrl } from '@/lib/auth';

import { allow, clientIp } from '@/lib/limit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await allow(`login:${clientIp(req.headers)}`, 20, 60))) return new NextResponse('Too many sign-in attempts. Wait a minute and try again.', { status: 429 });
  return NextResponse.redirect(steamLoginUrl(siteUrl(req)));
}
