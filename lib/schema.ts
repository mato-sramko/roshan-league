// Tables are created on first start. Ids that come from Steam / Dota are kept as
// text because they do not fit a normal integer. Times are unix seconds.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  steam_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  league_id INTEGER,
  starts_at INTEGER,
  ends_at INTEGER,
  multiplier REAL NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pro_players (
  account_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  team_id TEXT,
  team_name TEXT,
  role TEXT NOT NULL DEFAULT 'core',
  price INTEGER NOT NULL DEFAULT 50,
  avg_points REAL,
  last_match INTEGER
);
CREATE TABLE IF NOT EXISTS matches (
  match_id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  radiant_name TEXT,
  dire_name TEXT,
  radiant_win BOOLEAN,
  parsed BOOLEAN NOT NULL DEFAULT FALSE,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_event ON matches (event_key, start_time);
CREATE TABLE IF NOT EXISTS player_match_points (
  match_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  points REAL NOT NULL,
  role TEXT,
  breakdown TEXT,
  PRIMARY KEY (match_id, account_id)
);
CREATE INDEX IF NOT EXISTS pmp_account ON player_match_points (account_id);
CREATE TABLE IF NOT EXISTS rosters (
  user_id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS roster_slots (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  from_ts INTEGER NOT NULL,
  to_ts INTEGER
);
CREATE INDEX IF NOT EXISTS slots_user ON roster_slots (user_id);
CREATE INDEX IF NOT EXISTS slots_account ON roster_slots (account_id);
CREATE TABLE IF NOT EXISTS transfers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  window_key TEXT NOT NULL,
  out_account TEXT NOT NULL,
  in_account TEXT NOT NULL,
  ts INTEGER NOT NULL,
  free_reason TEXT,
  penalty REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS transfers_user ON transfers (user_id);
CREATE TABLE IF NOT EXISTS leagues (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  owner_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS league_members (
  league_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (league_id, user_id)
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  win INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, win)
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
