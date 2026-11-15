import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { saveSquad, isMode, refreshStandings } from '@/lib/game';
import { allow } from '@/lib/limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (!(await allow(`roster:${user.id}`, 20, 60))) {
    return NextResponse.json({ ok: false, error: 'Too many changes in a short time. Wait a minute and try again.' }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  if (!isMode(body?.mode)) return NextResponse.json({ ok: false, error: 'Unknown game mode.' }, { status: 400 });
  const result = await saveSquad(user.id, body.mode, body?.starters, body?.bench);
  if (result.ok) await refreshStandings({ userId: user.id, mode: body.mode }).catch(() => {});
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
