// Saves everything that cannot be re-created (managers, squads, transfers, leagues, grind income)
// to backup.json. The daily workflow keeps it as a downloadable file for 30 days.
// Matches and points are not included: they are read again from OpenDota.
import { writeFileSync } from 'node:fs';
import { q, now } from '../lib/db';

const TABLES = ['users', 'rosters', 'roster_slots', 'transfers', 'leagues', 'league_members', 'grind_income'];

async function main() {
  // Without it the scripts would quietly use a throwaway local database.
  if (process.env.CI && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Add it under Settings → Secrets and variables → Actions.');
  }
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t] = await q(`SELECT * FROM ${t}`);
  writeFileSync('backup.json', JSON.stringify({ takenAt: new Date(now() * 1000).toISOString(), tables }));
  console.log('backup saved', JSON.stringify(Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]))));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
