import Link from 'next/link';
import { getUser } from '@/lib/auth';
import { q, now } from '@/lib/db';
import { getEvents, computeStatus, getStandings, fmtDate, fmtPts, type Ev } from '@/lib/game';
import { SEASON } from '@/season.config';

function daysUntil(ts: number, t: number): string {
  const d = Math.ceil((ts - t) / 86400);
  return d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ login?: string }> }) {
  const sp = await searchParams;
  const t = now();
  const user = await getUser();
  const events = await getEvents();
  const status = computeStatus(events, t);
  const season = events.filter((e) => e.multiplier > 0);
  const hasTeam = user ? (await q(`SELECT 1 FROM rosters WHERE user_id = $1`, [user.id])).length > 0 : false;
  const [top, topGrind] = await Promise.all([getStandings({ mode: 'casual', limit: 10 }), getStandings({ mode: 'grind', limit: 10 })]);

  const dated = season.filter((e) => e.starts_at && e.ends_at);
  const t0 = Math.min(...dated.map((e) => e.starts_at!)) - 7 * 86400;
  const t1 = Math.max(...dated.map((e) => e.ends_at!)) + 100 * 86400; // room for TI at the end
  const pct = (ts: number) => `${Math.max(0, Math.min(100, ((ts - t0) / (t1 - t0)) * 100)).toFixed(2)}%`;
  const stateOf = (e: Ev) =>
    !e.starts_at || !e.ends_at ? 'later' : e.ends_at < t ? 'done' : e.starts_at <= t ? 'live' : e === status.next ? 'next' : 'later';

  return (
    <>
      <section className="hero">
        <h1>Draft five pros. Run them from one TI to the next.</h1>
        <p className="lede">
          Roshan League is a season-long Dota 2 fantasy game. Pick two cores, a mid, two supports and a bench of three.
          Every tier-one tournament scores, and The International scores triple.
        </p>
        <ul className="modes">
          <li>
            <b>Casual.</b> {SEASON.casual.budget.toLocaleString('en')} coins for the whole season. Build a strong squad and fine-tune it.
          </li>
          <li>
            <b>Grind.</b> Start with {SEASON.grind.start} coins, earn more after every tournament, and trade your way up to a dream squad by TI.
          </li>
        </ul>
        {sp.login === 'failed' && <p className="note bad">Steam did not confirm the sign-in. Try again.</p>}
        {status.live ? (
          <p className="state locked">
            <b>{status.live.name} is being played.</b>
            <span>Squads are locked until {fmtDate(status.live.ends_at)}. New squads score from their next match on.</span>
          </p>
        ) : status.next ? (
          <p className="state">
            <b>The transfer window is open.</b>
            <span>
              Squads lock when {status.next.name} starts {daysUntil(status.next.starts_at!, t)}, on {fmtDate(status.next.starts_at)}.
            </span>
          </p>
        ) : (
          <p className="state">
            <b>Between tournaments.</b>
            <span>The next tournament has no date yet.</span>
          </p>
        )}
        <div className="row">
          {user ? (
            <Link href="/team" className="btn">
              {hasTeam ? 'Manage your squads' : 'Build your squad'}
            </Link>
          ) : (
            <a href="/api/auth/steam" className="btn">
              Sign in with Steam
            </a>
          )}
          <Link href="/rules" className="btn plain">
            How scoring works
          </Link>
        </div>
      </section>

      <h2>The season</h2>
      <div className="track" aria-hidden="true">
        {dated.map((e) => (
          <span
            key={e.key}
            className={`${stateOf(e) === 'done' ? 'done' : stateOf(e) === 'live' ? 'live' : ''}`}
            style={{ left: pct(e.starts_at!), width: `calc(${pct(e.ends_at!)} - ${pct(e.starts_at!)})` }}
          />
        ))}
        <span className="x3" style={{ right: 0, width: '5%' }} />
        {t > t0 && t < t1 && <em style={{ left: pct(t) }} />}
      </div>
      <ol className="season">
        {season.map((e) => {
          const s = stateOf(e);
          return (
            <li key={e.key} className={s}>
              <span className="when">{e.starts_at ? `${fmtDate(e.starts_at)} – ${fmtDate(e.ends_at! - 86400)}` : 'Date to be announced'}</span>
              <span className="name">{e.name}</span>
              <span className="row" style={{ gap: 6 }}>
                {e.multiplier !== 1 && <span className="tag x3">×{e.multiplier} points</span>}
                {s === 'live' && <span className="tag live">Live now</span>}
                {s === 'next' && <span className="tag next">Next</span>}
                {s === 'done' && <span className="muted small">Finished</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <h2>Season standings</h2>
      <div className="twocol">
        {([
          ['Casual', top, '/leaderboard'],
          ['Grind', topGrind, '/leaderboard?mode=grind'],
        ] as const).map(([label, rows, link]) => (
          <section key={label}>
            <h3 className="sub">{label}</h3>
            {rows.length === 0 ? (
              <p className="muted">No squads yet. The first one in leads the table.</p>
            ) : (
              <>
                <div className="tablewrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Manager</th>
                        <th className="r">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.id} className={user?.id === r.id ? 'me' : ''}>
                          <td className="rank">{i + 1}</td>
                          <td>{r.name}</td>
                          <td className="r num">{fmtPts(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small" style={{ marginTop: 10 }}>
                  <Link href={link}>Full {label.toLowerCase()} leaderboard</Link>
                </p>
              </>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
