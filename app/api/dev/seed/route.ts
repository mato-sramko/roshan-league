// Fills the site with made-up matches and managers. Only works when ALLOW_DEV_LOGIN=1.
import { NextResponse } from 'next/server';
import { devLoginAllowed } from '@/lib/auth';
import { seedDemo } from '@/lib/demo';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!devLoginAllowed()) return new NextResponse('Not found', { status: 404 });
  const sp = new URL(req.url).searchParams;
  return NextResponse.json(await seedDemo(Number(sp.get('managers') || 10), sp.get('keep') === '1'));
}
