// Everything that defines a season lives in this file.
// Change numbers here; no other code needs to change.

export type Role = 'core' | 'mid' | 'support';

export type Mode = 'casual' | 'grind';

export const SEASON = {
  id: '2026-27',
  name: 'Season 2026–27',
  slots: { core: 2, mid: 1, support: 2 } as Record<Role, number>, // the starting five
  bench: { core: 1, mid: 1, support: 1 } as Record<Role, number>, // play only when a starter's team is not at the tournament
  maxPerTeam: 2, // across the whole squad, bench included
  // Prices are set once, from the previous season (TI to TI), and stay fixed all season.
  // Every top-tier (OpenDota "premium") match after TI 2025 up to the last day of TI 2026.
  priceFrom: { from: '2025-09-15', to: '2026-08-23', label: 'TI 2025 to TI 2026' },
  priceMin: 50,
  priceMax: 300,
  priceMinMatches: 3, // fewer than this last season = priced after their first 3 matches this season
  priceShrink: 5, // each player's average is mixed with this many matches of their role's average
  inactiveAfterDays: 90, // no tracked match for this long = free to replace, cannot be bought

  // Casual: one fixed budget for the whole season.
  // 3 × 300 + 2 × 50 + 3 × 50 (bench) = 1,150: three top-priced players is the most a squad can hold.
  casual: {
    budget: 1150,
    freeTransfersPerWindow: 2,
    extraTransferPenalty: 20, // points per transfer past the free ones
  },

  // Grind: start poor, earn coins after every tournament, buy and sell between tournaments.
  // 650 = 1 × 300 + 7 × 50. Even a manager who tops every tournament has
  // 650 + 8 × 120 = 1,610 before TI, less than 5 × 300 + 3 × 50 = 1,650.
  grind: {
    start: 650,
    // Paid when a tournament ends, by finishing position among grind managers in that tournament.
    income: [
      { top: 0.1, coins: 120 },
      { top: 0.25, coins: 100 },
      { top: 0.5, coins: 75 },
    ],
    incomeRest: 50,
    // A manager who starts late gets the lowest income for every tournament already started.
    lateJoinPerEvent: 50,
    // Selling gives back what you paid.
  },
};

// Points per stat, Valve's TI 2026 base values (no emblems, no multipliers).
// Keys are the field names OpenDota uses on a match's player object.
// The last two are not confirmed against Valve's table yet.
export const SCORING: Record<string, number> = {
  kills: 0.3,
  deaths: -0.3,
  assists: 0.15,
  last_hits: 0.003,
  gold_per_min: 0.002,
  xp_per_min: 0.002,
  stuns: 0.05, // per second
  hero_healing: 0.0004,
  towers_killed: 1,
  roshans_killed: 1,
  firstblood_claimed: 4,
  obs_placed: 0.5,
  camps_stacked: 0.5,
  rune_pickups: 0.25, // to confirm
  teamfight_participation: 3, // to confirm (value is 0..1)
};

export type EventConfig = {
  key: string; // short id used in links, never change once live
  name: string;
  leagueId: number | null; // OpenDota / Valve league id; null = not issued yet
  start: string | null; // YYYY-MM-DD (UTC), first match day; null = not announced
  end: string | null; // YYYY-MM-DD (UTC), last match day
  multiplier: number; // 1 = normal, 3 = TI, 0 = not scored (prices and the player list only)
  kind?: 'main' | 'qualifier'; // qualifiers only add players to the list; prices come from main events
  // While leagueId is null, the sync looks for a new OpenDota league whose name matches this
  // (% is a wildcard) and fills the id in by itself. Set leagueId by hand to override.
  find?: string;
};

// Rosters lock from `start` 00:00 UTC until 06:00 UTC the day after `end`.
// Transfer windows are the gaps in between.
export const EVENTS: EventConfig[] = [
  // Played before the season: starting prices and the player list.
  { key: 'ti2026', name: 'The International 2026', leagueId: 19719, start: '2026-08-13', end: '2026-08-23', multiplier: 0 },
  { key: 'wallachia9', name: 'PGL Wallachia Season 9', leagueId: 20279, start: '2026-09-19', end: '2026-09-27', multiplier: 0 },
  { key: 'blast8', name: 'BLAST Slam VIII', leagueId: 19102, start: '2026-09-29', end: '2026-10-11', multiplier: 0 },
  { key: 'fissure-universe', name: 'PARI Universe by FISSURE', leagueId: 20395, start: '2026-10-22', end: '2026-11-01', multiplier: 0 },
  { key: 'blast9-qual-sea', name: 'BLAST Slam IX Qualifier (SEA)', leagueId: 20144, start: '2026-09-12', end: '2026-09-13', multiplier: 0, kind: 'qualifier' },
  { key: 'dl30-qual', name: 'DreamLeague Season 30 Qualifiers', leagueId: 20359, start: '2026-10-09', end: '2026-10-17', multiplier: 0, kind: 'qualifier' },

  // The season.
  { key: 'blast9', name: 'BLAST Slam IX', leagueId: 20208, start: '2026-11-20', end: '2026-11-29', multiplier: 1 },
  { key: 'dl30', name: 'DreamLeague Season 30', find: 'DreamLeague Season 30', leagueId: null, start: '2026-12-02', end: '2026-12-13', multiplier: 1 },
  { key: 'fissure-jan', name: 'FISSURE (January)', find: '%FISSURE%', leagueId: null, start: '2027-01-09', end: '2027-01-17', multiplier: 1 },
  { key: 'dl31', name: 'DreamLeague Season 31', find: 'DreamLeague Season 31', leagueId: null, start: '2027-01-20', end: '2027-01-31', multiplier: 1 },
  { key: 'wallachia10', name: 'PGL Wallachia Season 10', find: 'PGL Wallachia%Season 10', leagueId: null, start: '2027-03-02', end: '2027-03-14', multiplier: 1 },
  { key: 'esl-munich', name: 'ESL One Munich 2027', find: 'ESL One%Munich%', leagueId: null, start: '2027-04-04', end: '2027-04-11', multiplier: 1 },
  { key: 'dl32', name: 'DreamLeague Season 32', find: 'DreamLeague Season 32', leagueId: null, start: '2027-04-26', end: '2027-05-09', multiplier: 1 },
  { key: 'wallachia11', name: 'PGL Wallachia Season 11', find: 'PGL Wallachia%Season 11', leagueId: null, start: '2027-05-11', end: '2027-05-23', multiplier: 1 },
  { key: 'ti2027', name: 'The International 2027', find: 'The International 2027', leagueId: null, start: null, end: null, multiplier: 3 },
];

// Force a player's role when Valve's role and the automatic guess are both wrong.
// Key is the player's account id (the number in their OpenDota URL).
export const ROLE_OVERRIDES: Record<string, Role> = {};
