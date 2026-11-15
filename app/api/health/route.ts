// Is the match data fresh? 200 when the last error-free sync was less than 90 minutes ago, 503 otherwise.
// (The sync runs every 30 minutes on GitHub, whose timer can run late.)
// Point a free uptime monitor at this address to get an e-mail when the sync gets stuck.
import { NextResponse } from 'next/server';
import { q, now } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const meta = Object.fromEntries((await q(`SELECT key, value FROM meta WHERE key IN ('last_ok', 'last_sync', 'roles_at', 'prices_for', 'standings_at')`)).map((r) => [r.key, r.value]));
    const t = now();
    const age = (k: string) => (meta[k] ? Math.round((t - Number(meta[k])) / 60) : null);
    const lastOk = age('last_ok');
    const ok = lastOk != null && lastOk < 90;
    return NextResponse.json(
      { ok, minutesSinceGoodSync: lastOk, minutesSinceAnySync: age('last_sync'), hoursSinceRoles: meta.roles_at ? Math.round((t - Number(meta.roles_at)) / 3600) : null, pricesFrom: meta.prices_for ?? null, minutesSinceLeaderboards: age('standings_at') },
      { status: ok ? 200 : 503 },
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Database not reachable.' }, { status: 503 });
  }
}
