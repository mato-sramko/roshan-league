import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import '@fontsource-variable/bricolage-grotesque/wdth.css';
import '@fontsource-variable/instrument-sans';
import './globals.css';
import { getUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Roshan League – season-long Dota 2 fantasy', template: '%s – Roshan League' },
  description: 'Draft five pro Dota 2 players on a 1,000-coin budget and manage them from one International to the next.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = { themeColor: '#15191e', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <html lang="en">
      <body>
        <header className="top">
          <div className="wrap">
            <Link href="/" className="mark">
              <i aria-hidden="true" />
              Roshan League
            </Link>
            <nav className="nav" aria-label="Main">
              <Link href="/team">My team</Link>
              <Link href="/leaderboard">Leaderboard</Link>
              <Link href="/leagues">Leagues</Link>
              <Link href="/rules">Rules</Link>
            </nav>
            <div className="who">
              {user ? (
                <>
                  <span>{user.name}</span>
                  <form action="/api/auth/logout" method="post">
                    <button className="linkbtn">Sign out</button>
                  </form>
                </>
              ) : (
                <a href="/api/auth/steam" className="btn sm">
                  Sign in with Steam
                </a>
              )}
            </div>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer>
          <div className="wrap">
            Roshan League is a fan project and is not affiliated with or endorsed by Valve. Dota 2 is a trademark of Valve
            Corporation. Match data comes from <a href="https://www.opendota.com">OpenDota</a>. Team rosters and positions come from{' '}
            <a href="https://liquipedia.net/dota2/">Liquipedia</a>, licensed under{' '}
            <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>.
          </div>
        </footer>
      </body>
    </html>
  );
}
