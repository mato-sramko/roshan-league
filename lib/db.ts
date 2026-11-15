// One small database layer that works two ways:
// - DATABASE_URL set  -> real Postgres (Neon, Supabase, ...)
// - DATABASE_URL empty -> a local file database in .data/ (PGlite), for your own computer
import { SCHEMA_SQL } from './schema';
import { EVENTS } from '@/season.config';
import { dbUrl } from './secrets';
import { migrate } from './migrate';

export type Row = Record<string, any>;
export interface Q {
  (text: string, params?: any[]): Promise<Row[]>;
}
interface Driver {
  q: Q;
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
}

const g = globalThis as unknown as { __rlDriver?: Promise<Driver> };

async function create(): Promise<Driver> {
  let d: Driver;
  const raw = dbUrl();
  if (raw) {
    const postgres = (await import('postgres')).default;
    // The driver would pass options it does not know on to the server, which rejects them.
    const u = new URL(raw);
    u.searchParams.delete('channel_binding');
    const sql = postgres(u.toString(), { prepare: false, max: 3, idle_timeout: 20, ssl: 'require', onnotice: () => {} });
    d = {
      q: async (text, params = []) => (await sql.unsafe(text, params)) as unknown as Row[],
      exec: async (text) => {
        await sql.unsafe(text);
      },
      tx: async (fn) =>
        (await sql.begin(async (t) =>
          fn(async (text, params = []) => (await t.unsafe(text, params)) as unknown as Row[]),
        )) as any,
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR || '.data/pg';
    const fs = await import('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    const pg = new PGlite(dir);
    await pg.waitReady;
    d = {
      q: async (text, params = []) => (await pg.query(text, params)).rows as Row[],
      exec: async (text) => {
        await pg.exec(text);
      },
      tx: async (fn) =>
        pg.transaction(async (t) =>
          fn(async (text, params = []) => (await t.query(text, params)).rows as Row[]),
        ),
    };
  }
  await d.exec(SCHEMA_SQL);
  await migrate(d.tx, !!raw);
  // Keep the events table in step with season.config.ts (one statement, so a cold start stays quick)
  const vals: any[] = [];
  const tuples = EVENTS.map((e, i) => {
    vals.push(e.key, e.name, e.leagueId, dayStart(e.start), dayEnd(e.end), e.multiplier, i, e.kind ?? 'main');
    const n = i * 8;
    return `($${n + 1},$${n + 2},$${n + 3}::int,$${n + 4}::int,$${n + 5}::int,$${n + 6}::real,$${n + 7}::int,$${n + 8})`;
  });
  await d.q(
    `INSERT INTO events (key, name, league_id, starts_at, ends_at, multiplier, sort, kind) VALUES ${tuples.join(',')}
     ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, league_id = COALESCE(EXCLUDED.league_id, events.league_id), starts_at = EXCLUDED.starts_at,
       ends_at = EXCLUDED.ends_at, multiplier = EXCLUDED.multiplier, sort = EXCLUDED.sort, kind = EXCLUDED.kind`,
    vals,
  );
  return d;
}

export function dayStart(d: string | null): number | null {
  return d ? Math.floor(Date.parse(d + 'T00:00:00Z') / 1000) : null;
}
// An event's lock ends at 06:00 UTC on the day after its last match day,
// which leaves room for a final that runs past midnight.
export function dayEnd(d: string | null): number | null {
  return d ? Math.floor(Date.parse(d + 'T00:00:00Z') / 1000) + 30 * 3600 - 1 : null;
}

function driver(): Promise<Driver> {
  if (!g.__rlDriver) g.__rlDriver = create();
  return g.__rlDriver;
}

export const q: Q = async (text, params) => (await driver()).q(text, params);
export async function tx<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  return (await driver()).tx(fn);
}

// Current time in unix seconds. FAKE_NOW (unix seconds or a date) lets you test other dates.
export function now(): number {
  const f = process.env.FAKE_NOW;
  if (f) return /^\d+$/.test(f) ? Number(f) : Math.floor(Date.parse(f) / 1000);
  return Math.floor(Date.now() / 1000);
}
