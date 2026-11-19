# Roshan League

Season-long Dota 2 fantasy. Five pros, 1,000 coins, one season from TI to TI.

Fan project, not affiliated with Valve. Match data comes from [OpenDota](https://www.opendota.com).
Source code under the MIT licence (see `LICENSE`).

## What is in here

| Where | What |
|---|---|
| `season.config.ts` | The whole season: budget, team shape, point values, tournament calendar. Edit numbers here. |
| `lib/game.ts` | Rules: saving a team, transfers and penalties, prices, standings. |
| `lib/opendota.ts` | Reads finished matches from the OpenDota API and scores them. |
| `lib/auth.ts` | Sign in with Steam. |
| `scripts/sync.ts`, `scripts/backup.ts` | Match sync and backup, run by GitHub Actions (`.github/workflows`). |
| `app/` | The pages: home, My team, Leaderboard, Leagues, Rules. |

## Try it on your computer

```
npm install
ALLOW_DEV_LOGIN=1 npm run dev
```

Open http://localhost:3000. With `ALLOW_DEV_LOGIN=1` you can:

- sign in without Steam on the My team page,
- open http://localhost:3000/api/dev/seed to fill the site with made-up teams, matches and managers.

Without `DATABASE_URL` the data lives in the `.data/` folder. Delete the folder to start over.
Add `FAKE_NOW=2026-11-24` in front of the command to see the site on another date (for example during a tournament).

## Put it online

1. **Code** – this folder lives in a GitHub repository.
2. **Database** – a free Postgres database at neon.tech. Copy its *pooled* connection string.
3. **Hosting** – import the repository at netlify.com and add one environment variable:
   `DATABASE_URL` = the connection string. Do **not** set `ALLOW_DEV_LOGIN`.
4. **Domain** – add the domain in Netlify and point its DNS there.
5. **Sync and backups** – in the GitHub repository, Settings → Secrets and variables → Actions, add the same
   `DATABASE_URL` as a secret. `.github/workflows/sync.yml` then runs every 30 minutes and `backup.yml` once a day
   (download a backup from the run's page, under Artifacts; kept 30 days). The repository is public, so the
   backup is encrypted with the `DATABASE_URL` value as the key. To open it:
   `BACKUP_KEY='<connection string>' openssl enc -d -aes-256-cbc -pbkdf2 -in backup.json.enc -out backup.json -pass env:BACKUP_KEY`. Both run on GitHub, so Netlify only
   serves pages. Run either by hand from the Actions tab.
6. **Saving Netlify credits** – every production deploy costs 15 of the free plan's 300 monthly credits.
   `netlify.toml` skips the deploy when a commit changes only `scripts/`, `.github/` or this readme.

## Each tournament

League ids fill themselves in: up to three weeks before a tournament starts, the sync looks for a new
OpenDota league matching the event's `find` text and stores its id. To override, set `leagueId` by hand
(the number in the tournament's OpenDota address, for example `opendota.com/leagues/20208`).

What still needs a person: tournament dates in `season.config.ts` when an organiser announces or moves them,
and `ROLE_OVERRIDES` if Valve lists a player in the wrong role. A tournament without a league id still locks
squads on its dates but scores nothing.

## Keeping the timers running

GitHub switches off scheduled workflows in a public repository after 60 days without activity.
`.github/workflows/keepalive.yml` commits the date to `.github/keepalive` once a month to prevent that.
If a sync ever stops anyway, open the Actions tab: GitHub shows an "Enable workflow" button there.

## Reliable sync timing

GitHub often runs scheduled workflows late (hours apart when it is busy). A free cron-job.org job therefore starts
the sync every 15 minutes: `POST https://api.github.com/repos/roshanleague/roshanleague/actions/workflows/sync.yml/dispatches`
with body `{"ref":"main"}` and the headers `Accept: application/vnd.github+json`, `Content-Type: application/json` and
`Authorization: Bearer <token>` (a fine-grained token with Actions: write on this repository only; renew it before it expires).
The schedule in `sync.yml` stays as a backup.

## Keeping an eye on it

`/api/health` answers 200 while the match data is fresh and 503 when the last good sync is over 45 minutes old.
A second cron-job.org job checks it every 30 minutes and sends an e-mail after two failures in a row.

## Rules in short

Two modes, each with its own squad and leaderboard:

- **Casual:** 1,150 coins for the season. Each window between tournaments: 2 free transfers, every further one costs 20 points.
- **Grind:** 650 coins at the start (plus 50 per tournament already started, for late starters). After every
  tournament, income by finishing position: top 10% 120, top 25% 100, top 50% 75, the rest 50. Selling returns the
  purchase price. Unlimited trades between tournaments.

Both:

- Squad: 2 cores, 1 mid, 2 supports, plus an optional bench of up to one of each; at most 2 from one pro team, bench included.
- A bench player scores only in a tournament where fewer starters of that role play than the squad needs.
- Teams and positions: from Liquipedia's active rosters every 6 hours when the `LIQUIPEDIA_API_KEY` secret is set
  (stand-ins ignored); otherwise from OpenDota. Roles follow the Liquipedia position (1 and 3 core, 2 mid, 4 and 5 support).
- Prices: 50 to 300, fixed for the whole season, from the previous season (TI to TI): rank inside the role by
  average points per match in all top-tier matches, pulled toward the role average for players with few matches.
  Players with fewer than 3 such matches get their price once, after 3 matches this season; until then they cost
  their priced teammates' average.
- Squads lock when a tournament starts and unlock at 06:00 UTC the day after it ends.
- A player with no tracked match for 90 days is free to replace and cannot be signed.
- A player scores for you only in matches that start after you signed them. The International counts three times.

## Known limits

- Roles come from Valve's fantasy roles (refreshed daily); players Valve does not list get a role guessed from match data. Fix wrong ones in `ROLE_OVERRIDES`.
- Leaderboards are worked out by the sync and stored, so pages only read them; a manager's own rows update as soon as they save a squad.
- No notifications yet.
- Flood protection is basic: 20 squad saves a minute, 5 new leagues an hour and 20 sign-ins a minute per address.
- Restoring a backup is a manual job: there is no restore button.
