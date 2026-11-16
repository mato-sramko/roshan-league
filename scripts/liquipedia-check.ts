// Checks which LiquipediaDB data types the API key can read. Prints only status codes and counts.
// GitHub > Actions > "Liquipedia check" > Run workflow.
const key = process.env.LIQUIPEDIA_API_KEY;
const types = ['player', 'team', 'squadplayer', 'tournament', 'match', 'placement', 'transfer', 'teamtemplate', 'image'];
(async () => {
  if (!key) return console.log('LIQUIPEDIA_API_KEY is not set');
  // Optional: LP_QUERY="squadplayer?conditions=..." prints the raw rows of one query instead.
  if (process.env.LP_QUERY) {
    const res = await fetch(`https://api.liquipedia.net/api/v3/${process.env.LP_QUERY}${process.env.LP_QUERY.includes('?') ? '&' : '?'}wiki=dota2`, {
      headers: { Authorization: `Apikey ${key}`, 'User-Agent': 'RoshanLeague (https://roshanleague.com)', 'Accept-Encoding': 'gzip' },
    });
    const j: any = await res.json();
    console.log(`HTTP ${res.status} rows=${j.result?.length ?? 0}`);
    console.log(JSON.stringify(j.error ?? j.result?.slice(0, Number(process.env.LP_ROWS || 3)), null, 1).slice(0, 12000));
    return;
  }
  for (const t of types) {
    const res = await fetch(`https://api.liquipedia.net/api/v3/${t}?wiki=dota2&limit=1`, {
      headers: { Authorization: `Apikey ${key}`, 'User-Agent': 'RoshanLeague (https://roshanleague.com)', 'Accept-Encoding': 'gzip' },
    }).catch((e) => ({ status: 0, text: async () => String(e) }) as any);
    const body = await res.text();
    let info = '';
    try {
      const j = JSON.parse(body);
      info = j.error ? `error: ${JSON.stringify(j.error).slice(0, 160)}` : `${j.result?.length ?? 0} rows, fields: ${Object.keys(j.result?.[0] ?? {}).slice(0, 25).join(',')}`;
    } catch {
      info = body.slice(0, 160);
    }
    console.log(`${t}: HTTP ${res.status} ${info}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
})();
