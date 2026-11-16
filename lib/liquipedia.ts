// Current team rosters and positions from Liquipedia (LiquipediaDB API, data CC-BY-SA, liquipedia.net).
// Liquipedia knows about transfers and stand-ins as soon as they are announced; OpenDota only after
// a player's first match for the new team. Without LIQUIPEDIA_API_KEY nothing changes and the site
// runs on OpenDota alone. If Liquipedia stops answering, its data is used for 3 more days, then
// OpenDota takes over again (see the lp_at checks in opendota.ts).
import { q, now } from './db';

const BASE = 'https://api.liquipedia.net/api/v3';

async function lp(type: string, params: Record<string, string | number>): Promise<any[]> {
  const key = process.env.LIQUIPEDIA_API_KEY;
  if (!key) throw new Error('LIQUIPEDIA_API_KEY is not set');
  const qs = new URLSearchParams({ wiki: 'dota2', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const res = await fetch(`${BASE}/${type}?${qs}`, {
    headers: { Authorization: `Apikey ${key}`, 'User-Agent': 'RoshanLeague (https://roshanleague.com)', 'Accept-Encoding': 'gzip' },
    signal: AbortSignal.timeout(30000),
  });
  const j: any = await res.json().catch(() => null);
  if (!res.ok || !j || j.error?.length) throw new Error(`Liquipedia ${type}: HTTP ${res.status} ${JSON.stringify(j?.error ?? '').slice(0, 200)}`);
  return j.result ?? [];
}

async function all(type: string, params: Record<string, string | number>): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const page = await lp(type, { ...params, limit: 1000, offset });
    out.push(...page);
    if (page.length < 1000) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return out;
}

const norm = (page: string) => page.trim().replace(/ /g, '_').toLowerCase();

export type LpReport = { squads: number; moved: number };

// Sets team and position of every tracked player who is on a Liquipedia active roster
// (stand-ins excluded). Players on no roster keep their last known team.
export async function refreshRosters(): Promise<LpReport> {
  const [squads, players] = [
    await all('squadplayer', { conditions: '[[status::active]] AND [[type::player]]', query: 'pagename,link,id,position,role' }),
    await all('player', { conditions: '[[status::Active]]', query: 'pagename,extradata' }),
  ];
  // Liquipedia page -> Steam account id
  const idOf = new Map<string, string>();
  for (const p of players) {
    const id = String(p.extradata?.playerid ?? '').trim();
    if (/^\d+$/.test(id)) idOf.set(norm(p.pagename), id);
  }
  const ours = new Map((await q(`SELECT account_id, team_id, team_name, lp_at FROM pro_players`)).map((r) => [r.account_id as string, r]));

  // One roster entry per player: skip stand-ins and players listed on two active rosters.
  const entries = new Map<string, { team: string; pos: number | null }>();
  const twice = new Set<string>();
  for (const s of squads) {
    if (/stand|loan|sub/i.test(String(s.role ?? ''))) continue;
    const id = idOf.get(norm(s.link || s.id || ''));
    if (!id || !ours.has(id)) continue;
    if (entries.has(id)) twice.add(id);
    const pos = Number(s.position);
    entries.set(id, { team: s.pagename, pos: pos >= 1 && pos <= 5 ? pos : null });
  }
  for (const id of twice) entries.delete(id);

  // Keep OpenDota's team ids where we can, so a team stays one team for the 2-per-team limit:
  // a Liquipedia team takes the OpenDota id most of its players already have.
  const votes = new Map<string, Map<string, number>>();
  for (const [id, e] of entries) {
    const od = ours.get(id)!.team_id;
    if (!od || String(od).startsWith('lp:')) continue;
    const v = votes.get(e.team) ?? votes.set(e.team, new Map()).get(e.team)!;
    v.set(od, (v.get(od) ?? 0) + 1);
  }
  const teamKey = new Map<string, string>();
  const usedKeys = new Set<string>();
  for (const [team, v] of [...votes].sort((a, b) => Math.max(...b[1].values()) - Math.max(...a[1].values()))) {
    const best = [...v].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2 && !usedKeys.has(best[0])) {
      teamKey.set(team, best[0]);
      usedKeys.add(best[0]);
    }
  }
  const nameOf = (page: string) => page.replace(/_/g, ' ').replace(/\s*\(.*\)$/, '');

  const t = now();
  const rows: [string, string | null, string | null, number | null][] = [];
  let moved = 0;
  for (const [id, e] of entries) {
    const key = teamKey.get(e.team) ?? `lp:${e.team}`;
    if (ours.get(id)!.team_id !== key) moved++;
    rows.push([id, key, nameOf(e.team), e.pos]);
  }
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const vals: any[] = [t];
    const tuples = chunk.map((r, j) => {
      vals.push(...r);
      const n = 1 + j * 4;
      return `($${n + 1}::text, $${n + 2}::text, $${n + 3}::text, $${n + 4}::int)`;
    });
    await q(
      `UPDATE pro_players p SET team_id = v.tid, team_name = v.tname, lp_pos = v.pos, lp_at = $1
       FROM (VALUES ${tuples.join(',')}) AS v(id, tid, tname, pos) WHERE p.account_id = v.id`,
      vals,
    );
  }
  return { squads: entries.size, moved };
}
