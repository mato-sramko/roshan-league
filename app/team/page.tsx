import Link from 'next/link';
import { getUser, devLoginAllowed } from '@/lib/auth';
import { getEvents, computeStatus, getPlayers, getSquad, getEditMode, grindStartCoins, computePoints, fmtDate, fmtPts, isMode } from '@/lib/game';
import { q } from '@/lib/db';
import { SEASON } from '@/season.config';
import { rename } from '../actions';
import TeamBuilder from './TeamBuilder';

export const metadata = { title: 'My team' };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const sp = await searchParams;
  const mode = isMode(sp.mode) ? sp.mode : 'casual';
  const user = await getUser();
  if (!user) {
    return (
      <section className="hero">
        <h1 className="page">Sign in to build your team</h1>
        <p>Roshan League uses your Steam account to sign you in. It only receives your public Steam id and name.</p>
        <div className="row">
          <a href="/api/auth/steam" className="btn">
            Sign in with Steam
          </a>
        </div>
        {devLoginAllowed() && (
          <form action="/api/auth/dev" method="get" className="row" style={{ marginTop: 24 }}>
            <input type="text" name="name" placeholder="Test name" aria-label="Test name" required />
            <button className="btn plain">Sign in as a test user</button>
          </form>
        )}
      </section>
    );
  }

  const events = await getEvents();
  const status = computeStatus(events);
  const [players, squad, edit, points] = await Promise.all([
    getPlayers(),
    getSquad(user.id, mode),
    getEditMode(user.id, mode, status, events),
    computePoints(mode, [user.id]),
  ]);
  const total = points.get(user.id)?.total ?? 0;
  const penalties =
    mode === 'casual'
      ? (await q(`SELECT COALESCE(SUM(penalty), 0)::float8 AS p FROM transfers WHERE user_id = $1 AND mode = 'casual'`, [user.id]))[0].p
      : 0;
  const income = mode === 'grind' ? await q(`SELECT gi.*, e.name FROM grind_income gi JOIN events e ON e.key = gi.event_key WHERE gi.user_id = $1 ORDER BY gi.ts`, [user.id]) : [];

  // Players already in the squad always appear in the list, even if they dropped out of the recent pool.
  const pool = [...players];
  for (const r of squad?.players ?? []) if (!pool.some((p) => p.account_id === r.account_id)) pool.push(r);
  const coins = mode === 'grind' ? (squad ? squad.coins ?? 0 : grindStartCoins(events)) : 0;

  return (
    <>
      <section className="hero" style={{ paddingBottom: 0 }}>
        <div className="tabs" aria-label="Game mode">
          <Link href="/team?mode=casual" className={mode === 'casual' ? 'on' : ''}>
            Casual
          </Link>
          <Link href="/team?mode=grind" className={mode === 'grind' ? 'on' : ''}>
            Grind
          </Link>
        </div>
        <h1 className="page">{squad ? (mode === 'grind' ? 'Your grind squad' : 'Your squad') : mode === 'grind' ? 'Start a grind squad' : 'Build your squad'}</h1>
        <p className="muted">
          {mode === 'grind'
            ? `Grind: start with ${SEASON.grind.start} coins, earn more after every tournament, buy and sell between tournaments.`
            : `Casual: ${SEASON.casual.budget.toLocaleString('en')} coins for the whole season and ${SEASON.casual.freeTransfersPerWindow} free transfers between tournaments.`}{' '}
          <Link href="/rules">Rules</Link>
        </p>
        {squad && (
          <p className="lede">
            <b className="num">{fmtPts(total - penalties)}</b> points this season
            {penalties > 0 && <span className="muted"> (after {fmtPts(penalties)} in transfer penalties)</span>}
          </p>
        )}
      </section>

      {players.length === 0 ? (
        <p className="note">The player list is empty because no matches have been loaded yet. It fills itself the first time the match sync runs.</p>
      ) : (
        <TeamBuilder
          key={mode}
          mode={mode}
          players={pool.map((p) => ({
            id: p.account_id,
            name: p.name,
            team: p.team_name,
            teamId: p.team_id,
            role: p.role,
            price: p.price,
            avg: p.avg_points,
            inactive: p.inactive,
          }))}
          starters={(squad?.players ?? []).filter((r) => !r.bench).map((r) => r.account_id)}
          bench={(squad?.players ?? []).filter((r) => r.bench).map((r) => r.account_id)}
          owned={Object.fromEntries((squad?.players ?? []).map((r) => [r.account_id, { sell: r.sell, buy: r.buy_price, pts: r.pts }]))}
          coins={coins}
          edit={edit.mode}
          freeLeft={edit.freeLeft}
          rules={{
            budget: SEASON.casual.budget,
            slots: SEASON.slots,
            bench: SEASON.bench,
            maxPerTeam: SEASON.maxPerTeam,
            penalty: SEASON.casual.extraTransferPenalty,
            freePerWindow: SEASON.casual.freeTransfersPerWindow,
          }}
          liveName={status.live?.name ?? null}
          liveUntil={status.live ? fmtDate(status.live.ends_at) : null}
          nextName={status.next?.name ?? null}
          nextStart={status.next ? fmtDate(status.next.starts_at) : null}
        />
      )}

      {mode === 'grind' && income.length > 0 && (
        <>
          <h2>Income</h2>
          <div className="tablewrap">
            <table className="table" style={{ maxWidth: 560 }}>
              <thead>
                <tr>
                  <th>Tournament</th>
                  <th className="r">Place</th>
                  <th className="r">Coins</th>
                </tr>
              </thead>
              <tbody>
                {income.map((r) => (
                  <tr key={r.event_key}>
                    <td>{r.name}</td>
                    <td className="r num">
                      {r.rank} of {r.of_count}
                    </td>
                    <td className="r num">+{r.coins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Your manager name</h2>
      <form action={rename} className="row">
        <input type="text" name="name" defaultValue={user.name} minLength={2} maxLength={30} aria-label="Manager name" required />
        <button className="btn plain">Save name</button>
      </form>
    </>
  );
}
