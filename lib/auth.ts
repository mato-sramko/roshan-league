import { cookies } from 'next/headers';
import crypto from 'node:crypto';
import { q, now } from './db';
import { secretFor, siteUrlFor } from './secrets';

const COOKIE = 'rl_session';
export const devLoginAllowed = () => process.env.ALLOW_DEV_LOGIN === '1';

function secret(): string {
  const s = secretFor('session');
  if (s) return s;
  if (process.env.NODE_ENV === 'production' && !devLoginAllowed()) throw new Error('No session secret: set DATABASE_URL or SESSION_SECRET');
  return 'local-testing-only';
}
function sign(value: string): string {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

export type User = { id: number; steam_id: string; name: string };

export async function getUser(): Promise<User | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [id, mac] = raw.split('.');
  if (!id || !mac) return null;
  const good = sign(id);
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  const rows = await q(`SELECT id, steam_id, name FROM users WHERE id = $1`, [Number(id)]);
  return (rows[0] as User) ?? null;
}

export async function startSession(userId: number): Promise<void> {
  (await cookies()).set(COOKIE, `${userId}.${sign(String(userId))}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}
export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function upsertUser(steamId: string, name: string): Promise<number> {
  const rows = await q(
    `INSERT INTO users (steam_id, name, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (steam_id) DO UPDATE SET steam_id = EXCLUDED.steam_id RETURNING id`,
    [steamId, name.slice(0, 40), now()],
  );
  return rows[0].id as number;
}

export function siteUrl(req: Request): string {
  return siteUrlFor(req.headers, new URL(req.url).origin);
}

const STEAM = 'https://steamcommunity.com/openid/login';

export function steamLoginUrl(origin: string): string {
  const p = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${origin}/api/auth/callback`,
    'openid.realm': origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM}?${p}`;
}

// Asks Steam itself whether the login it sent back is genuine. Returns the 17-digit Steam id.
export async function verifySteam(params: URLSearchParams, origin: string): Promise<string | null> {
  if (params.get('openid.mode') !== 'id_res') return null;
  if (!(params.get('openid.return_to') || '').startsWith(`${origin}/api/auth/callback`)) return null;
  if (params.get('openid.op_endpoint') !== STEAM) return null;
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(params.get('openid.claimed_id') || '');
  if (!m) return null;
  const body = new URLSearchParams();
  for (const [k, v] of params) if (k.startsWith('openid.')) body.set(k, v);
  body.set('openid.mode', 'check_authentication');
  const res = await fetch(STEAM, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  return /is_valid\s*:\s*true/.test(text) ? m[1] : null;
}

export async function steamName(steamId: string): Promise<string> {
  const key = process.env.STEAM_API_KEY;
  if (key) {
    try {
      const res = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${steamId}`,
        { signal: AbortSignal.timeout(8000) },
      );
      const name = (await res.json())?.response?.players?.[0]?.personaname;
      if (name) return String(name);
    } catch {}
  }
  return `Manager ${steamId.slice(-4)}`;
}
