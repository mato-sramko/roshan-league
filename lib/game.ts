import { q, tx, now, type Q, type Row } from './db';
import { SEASON, ROLE_OVERRIDES, type Role, type Mode } from '@/season.config';

export type { Mode };
export const MODES: Mode[] = ['casual', 'grind'];
export const isMode = (m: unknown): m is Mode => m === 'casual' || m === 'grind';
const ROLES: Role[] = ['core', 'mid', 'support'];

export type Ev = {
  key: string;
  name: string;
  league_id: number | null;
  starts_at: number | null;
  ends_at: number | null;
  multiplier: number;
  sort: number;
  kind: 'main' | 'qualifier';
};

export async function getEvents(): Promise<Ev[]> {
  return (await q(`SELECT * FROM events ORDER BY sort`)) as Ev[];
}

export type Status = { live: Ev | null; next: Ev | null; windowKey: string };

// live = squads locked. Otherwise a transfer window is open until `next` starts.
export function computeStatus(events: Ev[], t = now()): Status {
  const dated = events.filter((e) => e.multiplier > 0 && e.starts_at != null && e.ends_at != null);
  const live = dated.find((e) => e.starts_at! <= t && t <= e.ends_at!) ?? null;
  const next = dated.filter((e) => e.starts_at! > t).sort((a, b) => a.starts_at! - b.starts_at!)[0] ?? null;
  const windowKey = live ? `live-${live.key}` : next ? `pre-${next.key}` : 'post';
  return { live, next, windowKey };
}

export type Player = {
  account_id: string;
  name: string;
  team_id: string | null;
  team_name: string | null;
  role: Role;
  price: number;
  avg_points: number | null;
  last_match: number | null;
  inactive: boolean;
};

function withInactive(r: Row, t: number): Player {
  const cutoff = t - SEASON.inactiveAfterDays * 86400;
  return {
    account_id: r.account_id,
    name: r.name,
    team_id: r.team_id,
    team_name: r.team_name,
    role: r.role,
    price: r.price,
    avg_points: r.avg_points,
    last_match: r.last_match,
    inactive: !r.last_match || r.last_match < cutoff,
  };
}

// Everyone who played a tracked match in roughly the last half year.
export async function getPlayers(): Promise<Player[]> {
  const t = now();
  const rows = await q(
    `SELECT * FROM pro_players WHERE last_match IS NOT NULL AND last_match > $1 ORDER BY price DESC, name`,
    [t - 180 * 86400],
  );
  return rows.map((r) => withInactive(r, t));
}

export function sellPrice(buy: number | null, current: number): number {
  if (buy == null) return current;
  if (current <= buy) return current;
  return buy + Math.floor((current - buy) * SEASON.grind.sellShareOfRise);
}

// ---------------------------------------------------------------------------
// Points. A squad scores, per tournament:
// - every starter's points from matches played while they were in the squad;
// - a bench player's points only when, in that tournament, fewer starters of the
//   same role played than the squad needs (their team was not there).
// Then times the tournament's multiplier (TI counts 3 times).
// ---------------------------------------------------------------------------

type SlotRow = { id: number; user_id: number; account_id: string; bench: boolean; role: Role; from_ts: number; to_ts: number | null };
export type UserPoints = { total: number; events: Map<string, number>; slots: Map<number, number> };

function inList(start: number, n: number): string {
  return Array.from({ length: n }, (_, i) => `$${start + i}`).join(',');
}

export async function computePoints(mode: Mode, userIds?: number[]): Promise<Map<number, UserPoints>> {
  const out = new Map<number, UserPoints>();
  if (userIds && !userIds.length) return out;
  const userFilter = userIds ? `AND s.user_id IN (${inList(2, userIds.length)})` : '';
  const params = userIds ? [mode, ...userIds] : [mode];

  const slots = (await q(
    `SELECT s.id, s.user_id, s.account_id, s.bench, COALESCE(s.role, p.role) AS role, s.from_ts, s.to_ts
     FROM roster_slots s LEFT JOIN pro_players p ON p.account_id = s.account_id
     WHERE s.mode = $1 ${userFilter}`,
    params,
  )) as SlotRow[];
  const earned = await q(
    `SELECT s.id AS slot_id, m.event_key, SUM(pm.points)::float8 AS pts
     FROM roster_slots s
     JOIN player_match_points pm ON pm.account_id = s.account_id
     JOIN matches m ON m.match_id = pm.match_id AND m.start_time >= s.from_ts AND (s.to_ts IS NULL OR m.start_time < s.to_ts)
     JOIN events e ON e.key = m.event_key AND e.multiplier > 0
     WHERE s.mode = $1 ${userFilter}
     GROUP BY s.id, m.event_key`,
    params,
  );
  const events = (await getEvents()).filter((e) => e.multiplier > 0 && e.starts_at != null && e.ends_at != null);
  const appeared = new Set(
    (
      await q(
        `SELECT DISTINCT pm.account_id, m.event_key FROM player_match_points pm
         JOIN matches m ON m.match_id = pm.match_id JOIN events e ON e.key = m.event_key AND e.multiplier > 0`,
      )
    ).map((r) => `${r.account_id}|${r.event_key}`),
  );
  const pts = new Map<string, number>(earned.map((r) => [`${r.slot_id}|${r.event_key}`, r.pts]));

  const byUser = new Map<number, SlotRow[]>();
  for (const s of slots) {
    if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
    byUser.get(s.user_id)!.push(s);
  }
  for (const [uid, list] of byUser) {
    const up: UserPoints = { total: 0, events: new Map(), slots: new Map() };
    for (const e of events) {
      const held = list.filter((s) => s.from_ts <= e.ends_at! && (s.to_ts == null || s.to_ts > e.starts_at!));
      if (!held.length) continue;
      let raw = 0;
      const counted: [number, number][] = [];
      for (const s of held.filter((s) => !s.bench)) {
        const p = pts.get(`${s.id}|${e.key}`) ?? 0;
        raw += p;
        counted.push([s.id, p]);
      }
      for (const role of ROLES) {
        const played = held.filter((s) => !s.bench && s.role === role && appeared.has(`${s.account_id}|${e.key}`)).length;
        const missing = Math.max(0, SEASON.slots[role] - played);
        if (!missing) continue;
        for (const s of held.filter((s) => s.bench && s.role === role).slice(0, missing)) {
          const p = pts.get(`${s.id}|${e.key}`) ?? 0;
          raw += p;
          counted.push([s.id, p]);
        }
      }
      if (!raw) continue;
      up.events.set(e.key, raw * e.multiplier);
      up.total += raw * e.multiplier;
      for (const [id, p] of counted) up.slots.set(id, (up.slots.get(id) ?? 0) + p * e.multiplier);
    }
    out.set(uid, up);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Squads
// ---------------------------------------------------------------------------

export type SquadPlayer = Player & { slot_id: number; bench: boolean; buy_price: number | null; sell: number; pts: number };
export type Squad = { created_at: number; coins: number | null; players: SquadPlayer[] } | null;

export async function getSquad(userId: number, mode: Mode): Promise<Squad> {
  const r = (await q(`SELECT created_at, coins FROM rosters WHERE user_id = $1 AND mode = $2`, [userId, mode]))[0];
  if (!r) return null;
  const t = now();
  const rows = await q(
    `SELECT p.*, s.id AS slot_id, s.bench, s.buy_price
     FROM roster_slots s JOIN pro_players p ON p.account_id = s.account_id
     WHERE s.user_id = $1 AND s.mode = $2 AND s.to_ts IS NULL`,
    [userId, mode],
  );
  // Points per player = what that player earned for this squad since joining it (current spell only).
  const pts = (await computePoints(mode, [userId])).get(userId);
  const order: Record<string, number> = { core: 0, mid: 1, support: 2 };
  const players = rows
    .map((r) => {
      const p = withInactive(r, t);
      return {
        ...p,
        slot_id: r.slot_id,
        bench: !!r.bench,
        buy_price: r.buy_price,
        sell: mode === 'grind' ? sellPrice(r.buy_price, p.price) : p.price,
        pts: pts?.slots.get(r.slot_id) ?? 0,
      };
    })
    .sort((a, b) => Number(a.bench) - Number(b.bench) || order[a.role] - order[b.role] || b.price - a.price);
  return { created_at: r.created_at, coins: r.coins, players };
}

export type EditMode = 'new' | 'free' | 'window' | 'locked';

// new    = no squad yet
// free   = squad saved, but no tournament has started since: change anything
// window = between tournaments (casual: 2 free transfers, more cost points; grind: buy and sell freely)
// locked = a tournament is being played
export async function getEditMode(
  userId: number,
  mode: Mode,
  status: Status,
  events: Ev[],
  query: Q = q,
): Promise<{ mode: EditMode; freeLeft: number }> {
  const t = now();
  const free = SEASON.casual.freeTransfersPerWindow;
  const r = (await query(`SELECT created_at FROM rosters WHERE user_id = $1 AND mode = $2`, [userId, mode]))[0];
  if (!r) return { mode: 'new', freeLeft: free };
  if (status.live) return { mode: 'locked', freeLeft: 0 };
  const startedSince = events.some(
    (e) => e.multiplier > 0 && e.starts_at != null && e.starts_at > r.created_at && e.starts_at <= t,
  );
  if (!startedSince) return { mode: 'free', freeLeft: free };
  const used = (
    await query(
      `SELECT COUNT(*)::int AS n FROM transfers
       WHERE user_id = $1 AND mode = $2 AND window_key = $3 AND free_reason IS NULL AND out_account IS NOT NULL`,
      [userId, mode, status.windowKey],
    )
  )[0].n;
  return { mode: 'window', freeLeft: Math.max(0, free - used) };
}

// Coins a new grind manager starts with: late starters get the lowest income for each tournament already started.
export function grindStartCoins(events: Ev[], t = now()): number {
  const started = events.filter((e) => e.multiplier > 0 && e.starts_at != null && e.starts_at <= t).length;
  return SEASON.grind.start + started * SEASON.grind.lateJoinPerEvent;
}

export type SaveResult =
  | { ok: true; penalty: number; coins: number | null; transfers: number }
  | { ok: false; error: string };

const fail = (error: string): SaveResult => ({ ok: false, error });

export async function saveSquad(userId: number, mode: Mode, starters: unknown, bench: unknown): Promise<SaveResult> {
  const nStart = ROLES.reduce((a, r) => a + SEASON.slots[r], 0);
  const nBench = ROLES.reduce((a, r) => a + SEASON.bench[r], 0);
  const okList = (l: unknown, n: number): l is string[] =>
    Array.isArray(l) && l.length === n && l.every((x) => typeof x === 'string' && x.length < 20);
  if (!okList(starters, nStart) || !okList(bench, nBench)) {
    return fail(`Pick ${nStart} starters and ${nBench} bench players.`);
  }
  const want = [...starters, ...bench];
  if (new Set(want).size !== want.length) return fail('Each player can be in your squad only once.');
  const wantBench = new Set(bench);

  const t = now();
  const events = await getEvents();
  const status = computeStatus(events, t);

  return tx(async (query) => {
    const cur = await query(
      `SELECT id, account_id, bench, buy_price FROM roster_slots WHERE user_id = $1 AND mode = $2 AND to_ts IS NULL`,
      [userId, mode],
    );
    const curById = new Map(cur.map((r) => [r.account_id as string, r]));
    const outs = cur.filter((r) => !want.includes(r.account_id)).map((r) => r.account_id as string);
    const ins = want.filter((id) => !curById.has(id));
    const moved = want.filter((id) => curById.has(id) && !!curById.get(id)!.bench !== wantBench.has(id));
    const rosterRow = (await query(`SELECT coins FROM rosters WHERE user_id = $1 AND mode = $2`, [userId, mode]))[0];
    if (rosterRow && !outs.length && !ins.length && !moved.length) {
      return { ok: true, penalty: 0, coins: rosterRow.coins ?? null, transfers: 0 } as SaveResult;
    }

    const all = [...new Set([...want, ...cur.map((r) => r.account_id as string)])];
    const rows = await query(`SELECT * FROM pro_players WHERE account_id IN (${inList(1, all.length)})`, all);
    const byId = new Map(rows.map((r) => [r.account_id as string, withInactive(r, t)]));
    if (want.some((id) => !byId.has(id))) return fail('One of those players is not in the player list.');
    const isInactive = (id: string) => byId.get(id)?.inactive ?? true;

    const { mode: edit, freeLeft } = rosterRow
      ? await getEditMode(userId, mode, status, events, query)
      : { mode: 'new' as EditMode, freeLeft: 0 };
    if (edit === 'locked') {
      if (outs.some((o) => !isInactive(o)) || moved.length) {
        return fail(`Squads are locked while ${status.live!.name} is being played. Only players who stopped playing can be replaced.`);
      }
    }
    const newcomerInactive = ins.find((id) => isInactive(id));
    if (newcomerInactive) return fail(`${byId.get(newcomerInactive)!.name} has not played recently and cannot be signed.`);

    // Shape of the squad, using each player's current role.
    const st = starters.map((id) => byId.get(id)!);
    const bn = bench.map((id) => byId.get(id)!);
    for (const role of ROLES) {
      if (st.filter((p) => p.role === role).length !== SEASON.slots[role] || bn.filter((p) => p.role === role).length !== SEASON.bench[role]) {
        const s = SEASON.slots;
        return fail(`Starters are ${s.core} cores, ${s.mid} mid and ${s.support} supports; the bench is one of each.`);
      }
    }
    const perTeam = new Map<string, number>();
    for (const p of [...st, ...bn]) {
      if (!p.team_id) continue;
      const n = (perTeam.get(p.team_id) ?? 0) + 1;
      perTeam.set(p.team_id, n);
      if (n > SEASON.maxPerTeam) return fail(`At most ${SEASON.maxPerTeam} players from one team (${p.team_name}), bench included.`);
    }

    // Money.
    let coins: number | null = null;
    const buyPrice = new Map<string, number>();
    const sold = new Map<string, number>();
    if (mode === 'casual') {
      const cost = [...st, ...bn].reduce((a, p) => a + p.price, 0);
      if (cost > SEASON.casual.budget) return fail(`That squad costs ${cost} coins. The budget is ${SEASON.casual.budget}.`);
    } else {
      let c: number = rosterRow ? rosterRow.coins ?? 0 : grindStartCoins(events, t);
      for (const o of outs) {
        const v = sellPrice(curById.get(o)!.buy_price, byId.get(o)!.price);
        sold.set(o, v);
        c += v;
      }
      for (const i of ins) {
        buyPrice.set(i, byId.get(i)!.price);
        c -= byId.get(i)!.price;
      }
      if (c < 0) return fail(`You are ${-c} coins short.`);
      coins = c;
    }

    if (!rosterRow) {
      await query(`INSERT INTO rosters (user_id, mode, created_at, coins) VALUES ($1, $2, $3, $4)`, [userId, mode, t, coins]);
    } else if (mode === 'grind') {
      await query(`UPDATE rosters SET coins = $3 WHERE user_id = $1 AND mode = $2`, [userId, mode, coins]);
    }

    const close = async (id: string) =>
      query(`UPDATE roster_slots SET to_ts = $4 WHERE user_id = $1 AND mode = $2 AND account_id = $3 AND to_ts IS NULL`, [userId, mode, id, t]);
    const open = async (id: string, buy: number | null) =>
      query(
        `INSERT INTO roster_slots (user_id, mode, account_id, from_ts, bench, role, buy_price) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, mode, id, t, wantBench.has(id), byId.get(id)!.role, buy],
      );

    for (const o of outs) await close(o);
    for (const m of moved) {
      // Moving between bench and starters keeps what was paid.
      await close(m);
      await open(m, curById.get(m)!.buy_price ?? null);
    }
    for (const i of ins) await open(i, mode === 'grind' ? buyPrice.get(i)! : null);

    // Transfers: each player out is one transfer, paired with a player in.
    let penalty = 0;
    let paid = 0;
    const record = rosterRow && edit !== 'free';
    if (record) {
      const insLeft = [...ins];
      for (const o of outs) {
        const inn = insLeft.shift() ?? null;
        let reason: string | null = null;
        let pen = 0;
        if (isInactive(o)) reason = 'inactive';
        else if (mode === 'casual') {
          paid++;
          if (paid > freeLeft) pen = SEASON.casual.extraTransferPenalty;
        }
        penalty += pen;
        await query(
          `INSERT INTO transfers (user_id, mode, window_key, out_account, in_account, ts, free_reason, penalty, sell_price, buy_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [userId, mode, status.windowKey, o, inn ?? '', t, reason, pen, sold.get(o) ?? null, inn ? buyPrice.get(inn) ?? null : null],
        );
      }
    }
    return { ok: true, penalty, coins, transfers: outs.length } as SaveResult;
  });
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export type Standing = { id: number; name: string; total: number; pts: number; pen: number; coins: number | null; value: number | null };
type StandingRow = { mode: Mode; scope: string; user_id: number; pts: number; pen: number; coins: number | null; value: number | null };

// Works out every table row (season and each tournament) for one mode, for all squads or just some.
// Casual: a tournament's table also takes off the penalties paid in the window before it.
async function computeStandingRows(mode: Mode, userIds?: number[]): Promise<StandingRow[]> {
  const filter = userIds ? `AND r.user_id IN (${inList(2, userIds.length)})` : '';
  const users = await q(`SELECT r.user_id, r.coins FROM rosters r WHERE r.mode = $1 ${filter}`, userIds ? [mode, ...userIds] : [mode]);
  if (!users.length) return [];
  const ids = users.map((u) => u.user_id as number);
  const points = await computePoints(mode, ids);
  const t = now();
  const scopes = (await getEvents()).filter((e) => e.multiplier > 0 && e.starts_at != null && e.starts_at <= t).map((e) => e.key);

  const pen = new Map<string, number>(); // `${user}|${scope}`
  if (mode === 'casual') {
    const rows = await q(
      `SELECT user_id, window_key, SUM(penalty)::float8 AS pen FROM transfers WHERE mode = 'casual' AND penalty > 0 GROUP BY user_id, window_key`,
    );
    for (const r of rows) {
      pen.set(`${r.user_id}|season`, (pen.get(`${r.user_id}|season`) ?? 0) + r.pen);
      if (String(r.window_key).startsWith('pre-')) pen.set(`${r.user_id}|${String(r.window_key).slice(4)}`, r.pen);
    }
  }
  const value = new Map<number, number>();
  if (mode === 'grind') {
    const rows = await q(
      `SELECT s.user_id, s.buy_price, p.price FROM roster_slots s JOIN pro_players p ON p.account_id = s.account_id
       WHERE s.mode = 'grind' AND s.to_ts IS NULL`,
    );
    for (const r of rows) value.set(r.user_id, (value.get(r.user_id) ?? 0) + sellPrice(r.buy_price, r.price));
  }

  const out: StandingRow[] = [];
  for (const u of users) {
    const p = points.get(u.user_id);
    for (const scope of ['season', ...scopes]) {
      out.push({
        mode,
        scope,
        user_id: u.user_id,
        pts: scope === 'season' ? p?.total ?? 0 : p?.events.get(scope) ?? 0,
        pen: pen.get(`${u.user_id}|${scope}`) ?? 0,
        coins: mode === 'grind' ? u.coins ?? 0 : null,
        value: mode === 'grind' ? (u.coins ?? 0) + (value.get(u.user_id) ?? 0) : null,
      });
    }
  }
  return out;
}

// Stores the tables, so pages only read them. The sync refreshes everyone after reading matches;
// saving a squad refreshes that one manager straight away.
export async function refreshStandings(only?: { userId: number; mode: Mode }): Promise<number> {
  const rows = only ? await computeStandingRows(only.mode, [only.userId]) : [...(await computeStandingRows('casual')), ...(await computeStandingRows('grind'))];
  await tx(async (query) => {
    if (only) await query(`DELETE FROM standings WHERE mode = $1 AND user_id = $2`, [only.mode, only.userId]);
    else await query(`DELETE FROM standings`);
    for (let i = 0; i < rows.length; i += 150) {
      const chunk = rows.slice(i, i + 150);
      const vals: any[] = [];
      const tuples = chunk.map((r, j) => {
        vals.push(r.mode, r.scope, r.user_id, r.pts, r.pen, r.pts - r.pen, r.coins, r.value);
        const n = j * 8;
        return `($${n + 1}, $${n + 2}, $${n + 3}::int, $${n + 4}::real, $${n + 5}::real, $${n + 6}::real, $${n + 7}::int, $${n + 8}::int)`;
      });
      await query(`INSERT INTO standings (mode, scope, user_id, pts, pen, total, coins, value) VALUES ${tuples.join(',')}`, vals);
    }
    if (!only) {
      await query(`INSERT INTO meta (key, value) VALUES ('standings_at', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [String(now())]);
    }
  });
  return rows.length;
}

export async function getStandings(
  opts: { mode: Mode; eventKey?: string; leagueId?: number; limit?: number },
): Promise<Standing[]> {
  const params: any[] = [opts.mode, opts.eventKey ?? 'season', opts.limit ?? 200];
  let leagueJoin = '';
  if (opts.leagueId) {
    params.push(opts.leagueId);
    leagueJoin = `JOIN league_members lm ON lm.user_id = s.user_id AND lm.league_id = $4`;
  }
  const rows = await q(
    `SELECT s.user_id AS id, u.name, s.pts::float8 AS pts, s.pen::float8 AS pen, s.total::float8 AS total, s.coins, s.value
     FROM standings s JOIN users u ON u.id = s.user_id ${leagueJoin}
     WHERE s.mode = $1 AND s.scope = $2
     ORDER BY s.total DESC, s.user_id LIMIT $3`,
    params,
  );
  return rows as Standing[];
}

export async function standingsUpdatedAt(): Promise<number | null> {
  const v = (await q(`SELECT value FROM meta WHERE key = 'standings_at'`))[0]?.value;
  return v ? Number(v) : null;
}

// ---------------------------------------------------------------------------
// Grind income: paid once per tournament, when it is over, by finishing position
// among the grind managers whose squad existed when it started.
// ---------------------------------------------------------------------------

export function incomeFor(rank: number, of: number): number {
  for (const tier of SEASON.grind.income) if (rank <= Math.ceil(of * tier.top)) return tier.coins;
  return SEASON.grind.incomeRest;
}

export async function payGrindIncome(): Promise<{ paid: string[] }> {
  const t = now();
  const done = new Set((await q(`SELECT key FROM meta WHERE key LIKE 'paid_%'`)).map((r) => (r.key as string).slice(5)));
  const finished = (await getEvents()).filter((e) => e.multiplier > 0 && e.ends_at != null && e.ends_at < t && !done.has(e.key));
  const paid: string[] = [];
  for (const e of finished) {
    const eligible = await q(`SELECT user_id FROM rosters WHERE mode = 'grind' AND created_at < $1`, [e.starts_at]);
    const ids = eligible.map((r) => r.user_id as number);
    const points = await computePoints('grind', ids);
    const scored = ids.map((id) => ({ id, pts: points.get(id)?.events.get(e.key) ?? 0 }));
    await tx(async (query) => {
      // Inside the transaction so two syncs at once cannot pay twice.
      const again = await query(`SELECT 1 FROM meta WHERE key = $1`, [`paid_${e.key}`]);
      if (again.length) return;
      for (const s of scored) {
        const rank = 1 + scored.filter((o) => o.pts > s.pts).length;
        const coins = incomeFor(rank, scored.length);
        await query(
          `INSERT INTO grind_income (user_id, event_key, rank, of_count, points, coins, ts) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, event_key) DO NOTHING`,
          [s.id, e.key, rank, scored.length, s.pts, coins, t],
        );
        await query(`UPDATE rosters SET coins = COALESCE(coins, 0) + $2 WHERE user_id = $1 AND mode = 'grind'`, [s.id, coins]);
      }
      await query(`INSERT INTO meta (key, value) VALUES ($1, $2)`, [`paid_${e.key}`, String(t)]);
      paid.push(e.key);
    });
  }
  return { paid };
}

// ---------------------------------------------------------------------------
// Roles and prices
// ---------------------------------------------------------------------------

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

// Valve's fantasy roles: 1 core, 2 support, 3 offlane (a core here), 4 mid.
export function valveRole(v: number | null | undefined): Role | null {
  return v === 4 ? 'mid' : v === 2 ? 'support' : v === 1 || v === 3 ? 'core' : null;
}

const RECENT_MAIN = `SELECT e.key, (SELECT MAX(start_time) FROM matches m WHERE m.event_key = e.key) AS last
  FROM events e
  WHERE e.kind = 'main' AND (e.ends_at IS NULL OR e.ends_at < $1)
    AND EXISTS (SELECT 1 FROM matches m WHERE m.event_key = e.key)
    -- a past tournament still being loaded does not set prices yet
    AND (e.multiplier > 0 OR EXISTS (SELECT 1 FROM meta WHERE meta.key = 'done_' || e.key))
  ORDER BY last DESC LIMIT 2`;

// Sets every player's role and price.
// Role: ROLE_OVERRIDES, else Valve's role, else what they played most in their last 15 matches.
// Price: average points per match over the two most recent finished main tournaments,
// scaled inside each role so the best costs priceMax and the weakest priceMin.
export async function recomputePrices(): Promise<{ priced: number; from: string[] }> {
  const t = now();
  const recent = (await q(RECENT_MAIN, [t])).map((r) => r.key as string);

  const roleRows = await q(
    `SELECT account_id, role, COUNT(*)::int AS n FROM (
       SELECT pm.account_id, pm.role,
              ROW_NUMBER() OVER (PARTITION BY pm.account_id ORDER BY m.start_time DESC) AS rn
       FROM player_match_points pm JOIN matches m ON m.match_id = pm.match_id
       WHERE pm.role IS NOT NULL) x
     WHERE rn <= 15 GROUP BY account_id, role`,
  );
  const guessed = new Map<string, { role: Role; n: number }>();
  for (const r of roleRows) {
    const cur = guessed.get(r.account_id);
    if (!cur || r.n > cur.n) guessed.set(r.account_id, { role: r.role, n: r.n });
  }

  const stats = new Map<string, { avg: number; n: number }>();
  if (recent.length) {
    const rows = await q(
      `SELECT pm.account_id, AVG(pm.points)::float8 AS avg, COUNT(*)::int AS n
       FROM player_match_points pm JOIN matches m ON m.match_id = pm.match_id
       WHERE m.event_key IN ($1, $2) GROUP BY pm.account_id`,
      [recent[0], recent[1] ?? recent[0]],
    );
    for (const r of rows) stats.set(r.account_id, { avg: r.avg, n: r.n });
  }

  const players = await q(`SELECT account_id, role, valve_role FROM pro_players`);
  const roleOf = (p: Row): Role =>
    ROLE_OVERRIDES[p.account_id] ?? valveRole(p.valve_role) ?? guessed.get(p.account_id)?.role ?? p.role;
  const range: Record<string, { min: number; max: number }> = {};
  for (const p of players) {
    const s = stats.get(p.account_id);
    if (!s || s.n < SEASON.priceMinMatches) continue;
    const g = (range[roleOf(p)] ??= { min: s.avg, max: s.avg });
    g.min = Math.min(g.min, s.avg);
    g.max = Math.max(g.max, s.avg);
  }

  let priced = 0;
  const updates: [string, Role, number, number | null][] = [];
  for (const p of players) {
    const ro = roleOf(p);
    const s = stats.get(p.account_id);
    let price = SEASON.priceDefault;
    let avg: number | null = null;
    if (s && s.n >= SEASON.priceMinMatches && range[ro]) {
      const { min, max } = range[ro];
      const share = max > min ? (s.avg - min) / (max - min) : 0.5;
      price = round5(SEASON.priceMin + share * (SEASON.priceMax - SEASON.priceMin));
      avg = Math.round(s.avg * 100) / 100;
      priced++;
    }
    updates.push([p.account_id, ro, price, avg]);
  }
  await tx(async (query) => {
    for (let i = 0; i < updates.length; i += 200) {
      const chunk = updates.slice(i, i + 200);
      const vals: any[] = [];
      const tuples = chunk.map((u, j) => {
        vals.push(...u);
        const n = j * 4;
        return `($${n + 1}::text, $${n + 2}::text, $${n + 3}::int, $${n + 4}::real)`;
      });
      await query(
        `UPDATE pro_players p SET role = v.role, price = v.price, avg_points = v.avg
         FROM (VALUES ${tuples.join(',')}) AS v(id, role, price, avg) WHERE p.account_id = v.id`,
        vals,
      );
    }
    await query(`INSERT INTO meta (key, value) VALUES ('prices_for', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [
      recent.join(','),
    ]);
  });
  return { priced, from: recent };
}

// Prices move only when a window opens: never while a tournament is live.
// `force` is used once, right after old tournaments finish loading.
export async function maybeRecomputePrices(force = false): Promise<null | { priced: number; from: string[] }> {
  const t = now();
  const status = computeStatus(await getEvents(), t);
  const have = (await q(`SELECT value FROM meta WHERE key = 'prices_for'`))[0]?.value as string | undefined;
  if (have === undefined) return recomputePrices();
  if (status.live) return null;
  if (force) return recomputePrices();
  const recent = (await q(RECENT_MAIN, [t])).map((r) => r.key).join(',');
  if (have === recent) return null;
  return recomputePrices();
}

export function fmtDate(ts: number | null): string {
  if (!ts) return 'Date to be announced';
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export function fmtPts(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}
