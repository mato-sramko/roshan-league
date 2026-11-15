import Link from 'next/link';
import { headers } from 'next/headers';
import { getUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { siteUrlFor } from '@/lib/secrets';
import { createLeague, leaveLeague } from '../actions';

export const metadata = { title: 'Leagues' };

export default async function Leagues({ searchParams }: { searchParams: Promise<{ slow?: string }> }) {
  const sp = await searchParams;
  const user = await getUser();
  if (!user) {
    return (
      <section className="hero">
        <h1 className="page">Private leagues</h1>
        <p>A league is a leaderboard for you and your friends. Sign in to start one or to join by invite link.</p>
        <a href="/api/auth/steam" className="btn">
          Sign in with Steam
        </a>
      </section>
    );
  }
  const h = await headers();
  const origin = siteUrlFor(h, `${h.get('x-forwarded-proto') || 'http'}://${h.get('host')}`);
  const leagues = await q(
    `SELECT l.id, l.name, l.code, l.owner_id, (SELECT COUNT(*)::int FROM league_members x WHERE x.league_id = l.id) AS members
     FROM leagues l JOIN league_members m ON m.league_id = l.id WHERE m.user_id = $1 ORDER BY l.name`,
    [user.id],
  );

  return (
    <>
      <section className="hero" style={{ paddingBottom: 0 }}>
        <h1 className="page">Private leagues</h1>
        <p>A league is a leaderboard for you and your friends. Everyone still plays in the main table too.</p>
      </section>

      {sp.slow && <p className="note bad">Too many changes in a short time. Wait a few minutes and try again.</p>}

      <h2>Start a league</h2>
      <form action={createLeague} className="row">
        <input type="text" name="name" placeholder="League name" aria-label="League name" maxLength={40} required />
        <button className="btn">Create league</button>
      </form>

      <h2>Your leagues</h2>
      {leagues.length === 0 ? (
        <p className="muted">You are not in a league yet. Create one above, or open an invite link a friend sent you.</p>
      ) : (
        <ul className="cards">
          {leagues.map((l) => (
            <li key={l.id} className="card">
              <h3>{l.name}</h3>
              <span className="small muted">
                {l.members} {l.members === 1 ? 'manager' : 'managers'}
              </span>
              <span className="small" style={{ display: 'block', marginTop: 8 }}>
                Invite link
              </span>
              <code className="link">{`${origin}/join/${l.code}`}</code>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <Link href={`/leaderboard?league=${l.code}`} className="btn plain sm">
                  Open table
                </Link>
                <form action={leaveLeague}>
                  <input type="hidden" name="id" value={l.id} />
                  <button className="linkbtn small">Leave league</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
