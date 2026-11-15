// Pulls finished pro matches from the free OpenDota API and scores them.
import { q, tx, now } from './db';
import { scorePlayer } from './scoring';
import { getEvents, maybeRecomputePrices, payGrindIncome, type Ev } from './game';
import { pruneLimits } from './limit';
import { EVENTS } from '@/season.config';

const BASE = process.env.OPENDOTA_BASE || 'https://api.opendota.com/api';
const RECHECK_DAYS = 3; // how long we keep re-reading a match that is not fully parsed yet

async function od(path: string, init?: RequestInit): Promise<any> {
  const key = process.env.OPENDOTA_API_KEY;
  const url = `${BASE}${path}${key ? `${path.includes('?') ? '&' : '?'}api_key=${key}` : ''}`;
    const ms = path === '/proPlayers' ? 60000 : 20000;
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms), cache: 'no-store' });
  if (!res.ok) throw new Error(`OpenDota ${path} answered ${res.status}`);
  return res.json();
}

type Summary = {
  match_id: number | string;
  start_time: number;
  radiant_team_id?: number;
  radiant_team_name?: string;
  dire_team_id?: number;
  dire_team_name?: string;
};

// Stores one match and each player's points. Safe to run again on the same match.
export async function ingestMatch(m: any, eventKey: string, summary?: Summary): Promise<{ parsed: boolean; players: number }> {
  const players: any[] = (m.players || []).filter((p: any) => p.account_id);
  const parsed = players.length > 0 && players.every((p) => p.obs_placed != null && p.stuns != null);
  const side = (p: any): boolean => (typeof p.isRadiant === 'boolean' ? p.isRadiant : p.player_slot < 128);
  const teams = {
    radiant: {
      id: m.radiant_team_id ?? m.radiant_team?.team_id ?? summary?.radiant_team_id ?? null,
      name: m.radiant_team?.name ?? m.radiant_name ?? summary?.radiant_team_name ?? null,
    },
    dire: {
      id: m.dire_team_id ?? m.dire_team?.team_id ?? summary?.dire_team_id ?? null,
      name: m.dire_team?.name ?? m.dire_name ?? summary?.dire_team_name ?? null,
    },
  };

  // Role guess per match: the two lowest earners on a team are the supports,
  // of the other three the one who laned mid is the mid, the rest are cores.
  const roleOf = new Map<any, string | null>();
  for (const radiant of [true, false]) {
    const five = players.filter((p) => side(p) === radiant).sort((a, b) => (b.gold_per_min ?? 0) - (a.gold_per_min ?? 0));
    five.forEach((p, i) => {
      if (five.length < 5) return roleOf.set(p, null);
      if (i >= 3) return roleOf.set(p, 'support');
      if (!parsed) return roleOf.set(p, null); // lane data is missing until the replay is parsed
      roleOf.set(p, p.lane_role === 2 ? 'mid' : 'core');
    });
  }

  const start = m.start_time ?? summary?.start_time ?? now();
  await tx(async (query) => {
    await query(
      `INSERT INTO matches (match_id, event_key, start_time, radiant_name, dire_name, radiant_win, parsed, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (match_id) DO UPDATE SET parsed = $7, fetched_at = $8, radiant_win = $6`,
      [String(m.match_id), eventKey, start, teams.radiant.name, teams.dire.name, m.radiant_win ?? null, parsed, now()],
    );
    for (const p of players) {
      const id = String(p.account_id);
      const { points, breakdown } = scorePlayer(p);
      const team = side(p) ? teams.radiant : teams.dire;
      await query(
        `INSERT INTO player_match_points (match_id, account_id, points, role, breakdown)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (match_id, account_id) DO UPDATE SET points = $3, role = $4, breakdown = $5`,
        [String(m.match_id), id, points, roleOf.get(p) ?? null, JSON.stringify(breakdown)],
      );
      // The newest match decides a player's current name and team.
      await query(
        `INSERT INTO pro_players (account_id, name, team_id, team_name, role, last_match)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (account_id) DO UPDATE SET
           name = CASE WHEN pro_players.last_match IS NULL OR $6 >= pro_players.last_match THEN $2 ELSE pro_players.name END,
           team_id = CASE WHEN pro_players.last_match IS NULL OR $6 >= pro_players.last_match THEN $3 ELSE pro_players.team_id END,
           team_name = CASE WHEN pro_players.last_match IS NULL OR $6 >= pro_players.last_match THEN $4 ELSE pro_players.team_name END,
           last_match = GREATEST(COALESCE(pro_players.last_match, 0), $6)`,
        [id, p.name || p.personaname || `Player ${id}`, team.id != null ? String(team.id) : null, team.name, roleOf.get(p) ?? 'core', start],
      );
    }
  });
  return { parsed, players: players.length };
}

function wanted(e: Ev, t: number, done: Set<string>): 'backfill' | 'current' | null {
  if (e.league_id == null) return null;
  if (done.has(e.key)) return null;
  if (e.starts_at == null || e.ends_at == null) return e.multiplier === 0 ? 'backfill' : null;
  if (t > e.ends_at + RECHECK_DAYS * 86400) return 'backfill';
  if (t >= e.starts_at - 86400) return 'current';
  return null;
}

export type SyncReport = {
  fetched: number;
  left: number; // matches still waiting; call again while this is above 0
  events: Record<string, { listed: number; new: number; left: number }>;
  prices: null | { priced: number; from: string[] };
  roles?: number;
  income?: string[];
  found?: string[];
  errors: string[];
  ms: number;
};

// One run: reads up to `maxMatches` new matches, then updates prices if a window just opened.
// Run it often (every 30 minutes); each run picks up where the last one stopped.
export async function syncOnce(opts: { maxMatches?: number; budgetMs?: number; gapMs?: number } = {}): Promise<SyncReport> {
  const started = Date.now();
  const max = opts.maxMatches ?? 30;
  const budget = opts.budgetMs ?? 45000;
  const gap = opts.gapMs ?? 1100; // stay under OpenDota's 60 calls a minute
  const t = now();
  const report: SyncReport = { fetched: 0, left: 0, events: {}, prices: null, errors: [], ms: 0 };
  const events = await getEvents();

  // Once a day: Valve's roles and current teams for the players we know.
  const rolesAt = Number((await q(`SELECT value FROM meta WHERE key = 'roles_at'`))[0]?.value ?? 0);
  if (rolesAt < t - 20 * 3600) {
    try {
      report.roles = await refreshValveRoles();
      await setMeta('roles_at', String(t));
    } catch (err: any) {
      report.errors.push(String(err.message || err));
      await setMeta('roles_at', String(t - 18 * 3600)); // try again in about two hours
    }
  }

  // At most once an hour: look up league ids for upcoming tournaments that do not have one yet.
  const leaguesAt = Number((await q(`SELECT value FROM meta WHERE key = 'leagues_at'`))[0]?.value ?? 0);
  if (leaguesAt < t - 3600) {
    await setMeta('leagues_at', String(t));
    try {
      const found = await findLeagues(events, t);
      if (found.length) report.found = found;
    } catch (err: any) {
      report.errors.push(String(err.message || err));
    }
  }
  const done = new Set((await q(`SELECT key FROM meta WHERE key LIKE 'done_%' AND value = '1'`)).map((r) => (r.key as string).slice(5)));
  let backfillLeft = false;
  let backfillFinishedNow = false;

  for (const e of events) {
    const mode = wanted(e, t, done);
    if (!mode) continue;
    let list: Summary[];
    try {
      list = await od(`/leagues/${e.league_id}/matches`);
    } catch (err: any) {
      report.errors.push(String(err.message || err));
      if (mode === 'backfill') backfillLeft = true;
      continue;
    }
    const have = new Map(
      (await q(`SELECT match_id, parsed, fetched_at, start_time FROM matches WHERE event_key = $1`, [e.key])).map((r) => [
        r.match_id as string,
        r,
      ]),
    );
    const todo = list
      .filter((s) => {
        const h = have.get(String(s.match_id));
        if (!h) return true;
        // Not parsed yet: look again later, but give up after a few days.
        return !h.parsed && h.start_time > t - RECHECK_DAYS * 86400 && h.fetched_at < t - 1500;
      })
      .sort((a, b) => a.start_time - b.start_time);
    const rep = (report.events[e.key] = { listed: list.length, new: 0, left: todo.length });

    for (const s of todo) {
      if (report.fetched >= max || Date.now() - started > budget) break;
      try {
        const m = await od(`/matches/${s.match_id}`);
        const first = !have.has(String(s.match_id));
        const r = await ingestMatch(m, e.key, s);
        if (!r.parsed && first) od(`/request/${s.match_id}`, { method: 'POST' }).catch(() => {}); // ask OpenDota to parse the replay
        report.fetched++;
        rep.new++;
        rep.left--;
      } catch (err: any) {
        report.errors.push(String(err.message || err));
      }
      await new Promise((r) => setTimeout(r, gap));
    }
    if (mode === 'backfill') {
      if (rep.left <= 0 && list.length > 0) {
        await q(`INSERT INTO meta (key, value) VALUES ($1, '1') ON CONFLICT (key) DO UPDATE SET value = '1'`, [`done_${e.key}`]);
        backfillFinishedNow = true;
      } else backfillLeft = true;
    }
  }

  // Old tournaments all loaded: prices are recalculated at the next chance (not while a tournament is live).
  if (backfillFinishedNow && !backfillLeft) await setMeta('reprice_pending', '1');
  try {
    const pending = (await q(`SELECT value FROM meta WHERE key = 'reprice_pending'`))[0]?.value === '1';
    report.prices = await maybeRecomputePrices(pending);
    if (report.prices && pending) await q(`DELETE FROM meta WHERE key = 'reprice_pending'`);
  } catch (err: any) {
    report.errors.push(String(err.message || err));
  }
  try {
    const paid = await payGrindIncome();
    if (paid.paid.length) report.income = paid.paid;
  } catch (err: any) {
    report.errors.push(String(err.message || err));
  }
  await pruneLimits().catch(() => {});
  await q(`INSERT INTO meta (key, value) VALUES ('last_sync', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [String(now())]);
  report.left = Object.values(report.events).reduce((a, e) => a + Math.max(0, e.left), 0);
  if (!report.errors.length) await setMeta('last_ok', String(now()));
  report.ms = Date.now() - started;
  return report;
}

// Fills in OpenDota league ids for upcoming season tournaments that do not have one yet.
// Only leagues newer than every league already known, of professional tier, and not qualifiers.
async function findLeagues(events: Ev[], t: number): Promise<string[]> {
  const found: string[] = [];
  const floor = Math.max(0, ...events.map((e) => e.league_id ?? 0));
  for (const e of events) {
    const find = EVENTS.find((c) => c.key === e.key)?.find;
    if (e.league_id != null || !find || e.starts_at == null || e.starts_at > t + 21 * 86400) continue;
    const sql = `SELECT leagueid, name FROM leagues WHERE name ILIKE '${find.replace(/'/g, "''")}'
      AND name NOT ILIKE '%qualif%' AND tier IN ('premium', 'professional') AND leagueid > ${floor}
      ORDER BY leagueid DESC LIMIT 1`;
    const res = await od(`/explorer?sql=${encodeURIComponent(sql)}`);
    const row = res?.rows?.[0];
    if (!row) continue;
    await q(`UPDATE events SET league_id = $2 WHERE key = $1 AND league_id IS NULL`, [e.key, row.leagueid]);
    found.push(`${e.key}=${row.leagueid} (${String(row.name).trim()})`);
  }
  return found;
}

async function setMeta(key: string, value: string): Promise<void> {
  await q(`INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`, [key, value]);
}

// Valve's fantasy role for every player we track (OpenDota's list of registered pros).
export async function refreshValveRoles(): Promise<number> {
  const list: any[] = await od('/proPlayers');
  const ours = new Set((await q(`SELECT account_id FROM pro_players`)).map((r) => r.account_id as string));
  const known = list.filter((p) => p && ours.has(String(p.account_id)));
  // Role: Valve's fantasy role. Team: Valve's current team for registered pros, so a transfer shows
  // within a day instead of only after the player's first match for the new team.
  // A newer match still wins: the sync overwrites the team from every match it reads.
  const rows = known.map(
    (p) =>
      [
        String(p.account_id),
        [1, 2, 3, 4].includes(p.fantasy_role) ? Number(p.fantasy_role) : null,
        p.is_pro === true && p.team_id ? String(p.team_id) : null,
        p.is_pro === true && p.team_id ? String(p.team_name || p.team_tag || '') || null : null,
      ] as [string, number | null, string | null, string | null],
  );
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const vals: any[] = [];
    const tuples = chunk.map((r, j) => {
      vals.push(...r);
      const n = j * 4;
      return `($${n + 1}::text, $${n + 2}::int, $${n + 3}::text, $${n + 4}::text)`;
    });
    await q(
      `UPDATE pro_players p SET valve_role = COALESCE(v.r, p.valve_role),
         team_id = COALESCE(v.tid, p.team_id), team_name = COALESCE(v.tname, p.team_name)
       FROM (VALUES ${tuples.join(',')}) AS v(id, r, tid, tname) WHERE p.account_id = v.id`,
      vals,
    );
  }
  return rows.length;
}
