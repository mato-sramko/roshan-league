// Runs one read-only OpenDota explorer query and prints the result. For checking data by hand:
// GitHub > Actions > "OpenDota query" > Run workflow.
(async () => {
  const sql = process.argv[2] || process.env.SQL || 'SELECT 1';
  const res = await fetch(`https://api.opendota.com/api/explorer?sql=${encodeURIComponent(sql)}`, { signal: AbortSignal.timeout(120000) });
  const j: any = await res.json();
  if (j.err) console.log('error:', j.err);
  console.log(`${j.rows?.length ?? 0} rows`);
  console.table((j.rows ?? []).slice(0, 200));
})();
