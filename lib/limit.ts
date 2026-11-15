// Simple flood protection: at most `limit` actions per `windowSec` for one key
// (a user id or an IP address). Counts live in the database so they hold across servers.
import { q } from './db';

export async function allow(key: string, limit: number, windowSec: number): Promise<boolean> {
  const win = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
  try {
    const rows = await q(
      `INSERT INTO rate_limits (key, win, count) VALUES ($1, $2, 1)
       ON CONFLICT (key, win) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`,
      [`${key}:${windowSec}`, win],
    );
    return rows[0].count <= limit;
  } catch {
    return true; // never lock people out because the counter itself failed
  }
}

export function clientIp(h: Headers): string {
  return h.get('x-nf-client-connection-ip') || (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

export async function pruneLimits(): Promise<void> {
  await q(`DELETE FROM rate_limits WHERE win < $1`, [Math.floor(Date.now() / 1000) - 2 * 86400]);
}
