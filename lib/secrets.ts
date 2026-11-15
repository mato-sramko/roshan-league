// Secrets the site needs but nobody has to type in.
// If SESSION_SECRET / CRON_SECRET are not set, they are derived from the database
// connection string, which is already secret and is the same everywhere the site runs.
import crypto from 'node:crypto';

export function dbUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || undefined;
}

export function secretFor(label: 'session' | 'cron'): string | null {
  const explicit = label === 'session' ? process.env.SESSION_SECRET : process.env.CRON_SECRET;
  if (explicit) return explicit;
  const db = dbUrl();
  return db ? crypto.createHmac('sha256', db).update(label).digest('hex') : null;
}

// Public address of the site, without a trailing slash. URL is set by Netlify.
export function configuredSiteUrl(): string | null {
  const u = process.env.SITE_URL || process.env.URL;
  return u ? u.replace(/\/$/, '') : null;
}

// The address the visitor is actually using, as long as it is one of ours.
// Keeps sign-in working on the netlify.app address and on the custom domain alike.
export function siteUrlFor(h: Headers, fallbackOrigin: string): string {
  const host = (h.get('x-forwarded-host') || h.get('host') || '').toLowerCase();
  const ours = new Set<string>();
  const main = configuredSiteUrl();
  if (main) {
    const m = new URL(main).host;
    ours.add(m);
    ours.add(m.startsWith('www.') ? m.slice(4) : `www.${m}`);
  }
  if (process.env.SITE_NAME) ours.add(`${process.env.SITE_NAME}.netlify.app`);
  if (host && ours.has(host)) return `https://${host}`;
  return main || fallbackOrigin;
}
