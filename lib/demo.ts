// Made-up teams, players and matches, pushed through the real scoring code.
// Only for trying the site out. Wipes all game data first.
import { q, now } from './db';
import { ingestMatch } from './opendota';
import { setSeasonPrices, localSeasonStats, getPlayers, saveSquad, refreshStandings } from './game';
import { SEASON, type Role } from '@/season.config';

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEAMS = ['Pit Lords', 'Cheese Thieves', 'Midnight Ward', 'Ninth Rune', 'Tidewall', 'Hollow Crown', 'Static Remnant', 'Long Lane', 'Greevil Co', 'Second Aegis', 'Quiet Courier', 'Frostbite Five'];
const HANDLES = 'Vey Korr Lumen Taz Ishi Brakk Senna Olo Pim Dravo Kesh Yul Mox Aria Fen Juno Rask Tolo Wip Zed Hark Ines Bo Calyx Dune Ekko Flint Gry Hux Ivo Jax Kip Loris Mako Nyx Oz Pax Quill Rune Sol Tov Ume Vox Wren Xan Yara Zeke Arlo Bex Cato Dax Elio Faro Gus Hale Io Jett Kai Lux Mira'.split(' ');

export async function seedDemo(managers = 10, keep = false): Promise<{ matches: number; players: number; managers: number }> {
  const t = now();
  // keep = only add the matches played since last time, leave teams and managers alone
  if (!keep) for (const table of ['player_match_points', 'matches', 'pro_players', 'roster_slots', 'rosters', 'transfers', 'league_members', 'leagues', 'grind_income']) {
    await q(`DELETE FROM ${table}`);
  }
  if (!keep) await q(`DELETE FROM users WHERE steam_id LIKE 'demo-%'`);
  if (!keep) await q(`DELETE FROM meta`);

  const r = rng(42);
  const roles: Role[] = ['core', 'core', 'mid', 'support', 'support'];
  const teams = TEAMS.map((name, ti) => ({
    id: 9000 + ti,
    name,
    skill: 0.75 + r() * 0.5,
    players: roles.map((role, pi) => ({ id: 900000 + ti * 10 + pi, name: HANDLES[ti * 5 + pi], role, skill: 0.7 + r() * 0.6 })),
  }));

  const events = await q(`SELECT * FROM events WHERE starts_at IS NOT NULL AND starts_at <= $1 ORDER BY sort`, [t]);
  let n = 0;
  for (const [ei, e] of events.entries()) {
    const end = e.ends_at - 8 * 3600;
    const count = 44;
    for (let i = 0; i < count; i++) {
      const start = Math.floor(e.starts_at + ((end - e.starts_at) * (i + 0.5)) / count);
      // Pit Lords are not invited to BLAST Slam IX, to try out the bench.
      const field = e.key === 'blast9' ? teams.slice(1) : teams;
      const a = field[Math.floor(r() * field.length)];
      let b = a;
      while (b === a) b = field[Math.floor(r() * field.length)];
      const aWins = r() < a.skill / (a.skill + b.skill);
      const line = (team: typeof a, radiant: boolean, won: boolean) =>
        team.players.map((p, slot) => {
          const f = p.skill * (won ? 1.15 : 0.85) * (0.8 + r() * 0.4);
          const sup = p.role === 'support';
          return {
            account_id: p.id,
            name: p.name,
            isRadiant: radiant,
            player_slot: radiant ? slot : 128 + slot,
            kills: Math.round((sup ? 3 : 8) * f),
            deaths: Math.round((sup ? 7 : 4) / f),
            assists: Math.round((sup ? 16 : 9) * f),
            last_hits: Math.round((sup ? 60 : p.role === 'mid' ? 330 : 380) * f),
            gold_per_min: Math.round((sup ? 300 : p.role === 'mid' ? 590 : 640) * f),
            xp_per_min: Math.round((sup ? 400 : 700) * f),
            stuns: Math.round((sup ? 45 : 15) * f * 10) / 10,
            hero_healing: sup ? Math.round(2500 * f) : 0,
            towers_killed: sup ? 0 : Math.round(1.5 * f),
            roshans_killed: p.role === 'core' && r() < 0.35 ? 1 : 0,
            firstblood_claimed: 0,
            obs_placed: sup ? Math.round(9 * f) : 0,
            camps_stacked: sup ? Math.round(4 * f) : Math.round(r() * 2),
            rune_pickups: Math.round((p.role === 'mid' ? 9 : 4) * f),
            teamfight_participation: Math.min(1, Math.round((0.45 + r() * 0.35) * 100) / 100),
            lane_role: p.role === 'mid' ? 2 : sup ? (slot === 3 ? 1 : 3) : slot === 0 ? 1 : 3,
          };
        });
      const players = [...line(a, true, aWins), ...line(b, false, !aWins)];
      players[Math.floor(r() * 10)].firstblood_claimed = 1;
      if (start > t) continue; // not played yet at the pretend date
      await ingestMatch(
        { match_id: `demo-${ei}-${i}`, start_time: start, radiant_win: aWins, radiant_team_id: a.id, radiant_name: a.name, dire_team_id: b.id, dire_name: b.name, players },
        e.key,
      );
      n++;
    }
  }
  if (keep) {
    await refreshStandings();
    return { matches: n, players: 0, managers: 0 };
  }
  await setSeasonPrices(await localSeasonStats());

  // A few made-up managers in both modes, so the tables are not empty.
  const pool = (await getPlayers()).filter((p) => !p.inactive);
  const names = ['wardbot', 'no_tp_andy', 'RoshAt12', 'smoke_enjoyer', 'divine5_irl', 'buyback_ben', 'courier_sniper', 'gg_go_next', 'tinker_main', 'cheese_pls', 'aegis_denied', 'pos6'];
  let made = 0;
  for (let u = 0; u < Math.min(managers, names.length); u++) {
    const id = (await q(`INSERT INTO users (steam_id, name, created_at) VALUES ($1, $2, $3) RETURNING id`, [`demo-${u}`, names[u], t]))[0].id;
    for (const [mode, budget] of [['casual', SEASON.casual.budget], ['grind', SEASON.grind.start]] as const) {
      // Cheapest legal squad first, then random upgrades while the money lasts.
      const want = (role: Role) => SEASON.slots[role] + SEASON.bench[role];
      const roles: Role[] = ['core', 'mid', 'support'];
      const legal = (pick: typeof pool) => {
        const perTeam = new Map<string, number>();
        pick.forEach((p) => perTeam.set(p.team_id!, (perTeam.get(p.team_id!) ?? 0) + 1));
        return Math.max(...perTeam.values()) <= SEASON.maxPerTeam;
      };
      let pick: typeof pool = [];
      for (const role of roles) {
        for (const p of pool.filter((x) => x.role === role).sort((x, y) => x.price - y.price || r() - 0.5)) {
          if (pick.filter((x) => x.role === role).length >= want(role)) break;
          if (legal([...pick, p])) pick.push(p);
        }
      }
      for (let tries = 0; tries < 60; tries++) {
        const i = Math.floor(r() * pick.length);
        const c = pool.filter((x) => x.role === pick[i].role && !pick.includes(x));
        const p = c[Math.floor(r() * c.length)];
        const next = pick.map((x, j) => (j === i ? p : x));
        if (p && legal(next) && next.reduce((a, x) => a + x.price, 0) <= budget) pick = next;
      }
      const starters: string[] = [];
      const bench: string[] = [];
      for (const role of roles) {
        const c = pick.filter((p) => p.role === role).sort((x, y) => y.price - x.price);
        starters.push(...c.slice(0, SEASON.slots[role]).map((p) => p.account_id));
        bench.push(...c.slice(SEASON.slots[role]).map((p) => p.account_id));
      }
      await saveSquad(id, mode, starters, bench);
    }
    made++;
  }
  await refreshStandings();
  return { matches: n, players: pool.length, managers: made };
}
