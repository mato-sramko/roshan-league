import { SEASON, SCORING } from '@/season.config';
import { getEvents } from '@/lib/game';

export const metadata = { title: 'Rules' };

const LABEL: Record<string, string> = {
  kills: 'Kill',
  deaths: 'Death',
  assists: 'Assist',
  last_hits: 'Last hit',
  gold_per_min: 'Gold per minute, per point',
  xp_per_min: 'Experience per minute, per point',
  stuns: 'Second of enemy stun',
  hero_healing: 'Point of allied healing',
  towers_killed: 'Tower last hit',
  roshans_killed: 'Roshan last hit',
  firstblood_claimed: 'First blood',
  obs_placed: 'Observer ward placed',
  camps_stacked: 'Camp stacked',
  rune_pickups: 'Rune picked up',
  teamfight_participation: 'Teamfight participation, at 100%',
};

export default async function Rules() {
  const s = SEASON;
  const c = s.casual;
  const g = s.grind;
  const ti = (await getEvents()).find((e) => e.multiplier > 1);
  return (
    <>
      <section className="hero" style={{ paddingBottom: 0 }}>
        <h1 className="page">Rules</h1>
      </section>

      <h2>Two ways to play</h2>
      <p>
        <b>Casual</b> gives you {c.budget.toLocaleString('en')} coins for the whole season: build a strong squad and fine-tune it. <b>Grind</b> starts you with{' '}
        {g.start} coins, enough for one star and a squad of underdogs, and pays you after every tournament so you can trade your way up. You can play both,
        with a separate squad in each. Each has its own leaderboard.
      </p>

      <h2>Your squad</h2>
      <p>
        A squad is {s.slots.core} cores, {s.slots.mid} mid and {s.slots.support} supports, plus a bench of one core, one mid and one support. At most{' '}
        {s.maxPerTeam} players may come from the same pro team, bench included.
      </p>
      <p>
        A bench player scores only in a tournament where fewer of your starters in that role play than your squad needs, for example because their team
        was not invited. Until your starter plays, the bench player&apos;s points show provisionally; once the starter plays, they drop out.
      </p>

      <h2>Prices</h2>
      <p>
        A player costs between {s.priceMin} and {s.priceMax} coins. The price comes from their average fantasy points per match over the two most recent
        finished main tournaments, compared with others in the same role. Prices change only when a transfer window opens. A player without{' '}
        {s.priceMinMatches} matches in those tournaments costs {s.priceDefault}.
      </p>

      <h2>Casual: transfers</h2>
      <p>
        Your squad has to fit the {c.budget.toLocaleString('en')}-coin budget at current prices whenever you make a change. A squad you already own stays
        yours if prices rise. In each window between tournaments you get {c.freeTransfersPerWindow} free transfers; every further one costs{' '}
        {c.extraTransferPenalty} points. Moving a player between the bench and the starters is free.
      </p>

      <h2>Grind: coins</h2>
      <p>
        You buy players at their current price and sell them for what you paid plus {Math.round(g.sellShareOfRise * 100)}% of any rise; a fall you take in
        full. There is no limit on trades between tournaments. Coins and points are separate: points decide the leaderboard, coins only buy players.
      </p>
      <p>When a tournament is over, every grind manager whose squad existed when it started is paid by finishing position in that tournament:</p>
      <div className="tablewrap">
        <table className="table" style={{ maxWidth: 420 }}>
          <thead>
            <tr>
              <th>Finishing position</th>
              <th className="r">Coins</th>
            </tr>
          </thead>
          <tbody>
            {g.income.map((t) => (
              <tr key={t.top}>
                <td>Top {Math.round(t.top * 100)}%</td>
                <td className="r num">+{t.coins}</td>
              </tr>
            ))}
            <tr>
              <td>Everyone else</td>
              <td className="r num">+{g.incomeRest}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 12 }}>
        Joining late is no shortcut: a new grind squad starts with {g.start} coins plus {g.lateJoinPerEvent} for every tournament already started, the least
        anyone who played earned.
      </p>

      <h2>Locks</h2>
      <p>
        Squads lock when a tournament starts and unlock at 06:00 UTC the day after it ends. A player who has not played a tracked match for{' '}
        {s.inactiveAfterDays} days can be replaced at any time, for free, and cannot be signed. A squad scores only from matches that start after a player
        joined it.
      </p>

      <h2>Points</h2>
      <p>
        Points use the base values from Valve&apos;s International fantasy, without emblems or multipliers. They are added up for every match a player
        plays, so a deep run matters through the extra matches.
        {ti ? ` Matches at ${ti.name} count ${ti.multiplier} times.` : ''}
      </p>
      <div className="tablewrap">
        <table className="table" style={{ maxWidth: 520 }}>
          <thead>
            <tr>
              <th>For each</th>
              <th className="r">Points</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(SCORING).map(([k, v]) => (
              <tr key={k}>
                <td>{LABEL[k] ?? k}</td>
                <td className="r num">{v > 0 ? `+${v}` : `−${Math.abs(v)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
