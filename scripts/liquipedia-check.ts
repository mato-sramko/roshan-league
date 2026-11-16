// Checks which LiquipediaDB data types the API key can read. Prints only status codes and counts.
// GitHub > Actions > "Liquipedia check" > Run workflow.
const key = process.env.LIQUIPEDIA_API_KEY;
const types = ['player', 'team', 'squadplayer', 'tournament', 'match', 'placement', 'transfer', 'teamtemplate', 'image'];
(async () => {
  if (!key) return console.log('LIQUIPEDIA_API_KEY is not set');
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
