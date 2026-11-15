// Reads new matches from OpenDota, pays grind income, updates prices and leaderboards.
// Runs in GitHub Actions every 30 minutes (.github/workflows/sync.yml) and writes straight to the database,
// so the website host does no work for it.
//   DATABASE_URL=... npx tsx scripts/sync.ts
import { syncOnce } from '../lib/opendota';
import { refreshStandings } from '../lib/game';

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
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
