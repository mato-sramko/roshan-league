// Reads new matches from OpenDota, pays grind income, updates prices and leaderboards.
// Runs in GitHub Actions every 30 minutes (.github/workflows/sync.yml) and writes straight to the database,
// so the website host does no work for it.
//   DATABASE_URL=... npx tsx scripts/sync.ts
import { syncOnce } from '../lib/opendota';
import { refreshStandings, getPlayers } from '../lib/game';

async function main() {
  // Without it the scripts would quietly use a throwaway local database.
  if (process.env.CI && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it under Settings → Secrets and variables → Actions.');
  }
  const budget = Number(process.env.SYNC_BUDGET_SECONDS || 240) * 1000;
  const deadline = Date.now() + budget;
  let fetched = 0;
  for (let round = 1; ; round++) {
    const report = await syncOnce({ maxMatches: 400, budgetMs: Math.max(5000, deadline - Date.now()), gapMs: 1100 });
    fetched += report.fetched;
    console.log(`round ${round}:`, JSON.stringify(report));
    if (!report.left || Date.now() > deadline) break;
    if (!report.fetched && report.errors.length) break; // OpenDota is having trouble: next run tries again
  }
  const rows = await refreshStandings();
  console.log(`done: ${fetched} new matches, ${rows} leaderboard rows`);
  // Price overview of the buyable list, to spot problems in the log.
  const list = (await getPlayers()).filter((p) => !p.inactive);
  const by = (f: (p: (typeof list)[number]) => string) =>
    Object.entries(list.reduce<Record<string, number>>((a, p) => ((a[f(p)] = (a[f(p)] ?? 0) + 1), a), {})).sort().map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`prices: ${list.length} players | ${by((p) => (p.price <= 50 ? '50' : p.price < 100 ? '55-95' : p.price < 150 ? '100-145' : p.price < 200 ? '150-195' : p.price < 250 ? '200-245' : '250-300'))} | top: ${list
    .slice(0, 8)
    .map((p) => `${p.name} ${p.price}`)
    .join(', ')}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
