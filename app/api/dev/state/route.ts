// A look at the raw game state, for testing. Only works when ALLOW_DEV_LOGIN=1.
import { NextResponse } from 'next/server';
import { devLoginAllowed, getUser } from '@/lib/auth';
import { q, now } from '@/lib/db';
import { getEvents, computeStatus, getEditMode, getSquad, computePoints, isMode } from '@/lib/game';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!devLoginAllowed()) return new NextResponse('Not found', { status: 404 });
  const m = new URL(req.url).searchParams.get('mode');
  const mode = isMode(m) ? m : 'casual';
  const events = await getEvents();
  const status = computeStatus(events);
  const user = await getUser();
  const pts = user ? (await computePoints(mode, [user.id])).get(user.id) : null;
  return NextResponse.json({
    now: new Date(now() * 1000).toISOString(),
    live: status.live?.key ?? null,
    next: status.next?.key ?? null,
    windowKey: status.windowKey,
    players: await q(`SELECT account_id, name, team_id, team_name, role, valve_role, price, avg_points, last_match FROM pro_players ORDER BY role, price DESC`),
    matches: await q(`SELECT event_key, COUNT(*)::int AS n FROM matches GROUP BY event_key ORDER BY event_key`),
    meta: await q(`SELECT * FROM meta ORDER BY key`),
    income: user ? await q(`SELECT * FROM grind_income WHERE user_id = $1 ORDER BY ts`, [user.id]) : null,
    me: user
      ? {
          user,
          mode,
          edit: await getEditMode(user.id, mode, status, events),
          squad: await getSquad(user.id, mode),
          points: pts ? { total: pts.total, events: Object.fromEntries(pts.events) } : null,
          transfers: await q(`SELECT * FROM transfers WHERE user_id = $1 AND mode = $2 ORDER BY id`, [user.id, mode]),
          slots: await q(`SELECT * FROM roster_slots WHERE user_id = $1 AND mode = $2 ORDER BY id`, [user.id, mode]),
        }
      : null,
  });
}
