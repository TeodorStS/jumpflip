# jumpflip

A Flappy Bird clone with a leaderboard, built for the CS++ Society at TU Dublin. People scan a QR code at our stand, enter their name and student number, play, and their best score goes on a shared leaderboard. The game also links to society sign-up.

Node, Express and SQLite on the backend, plain canvas on the frontend.

## Run it

```
npm install
npm start
```

Then open http://localhost:3000.

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (default 3000) |
| `DB_DIR` | Where the SQLite file is stored (default `db/`) |
| `ADMIN_PASSWORD` | Enables the `/dev` admin page. Without it, `/dev` is off |

With Docker:

```
docker compose up -d --build
```

Scores are kept in a named volume, so rebuilds don't wipe them.

## Pages

- `/` - the game
- `/display` - stand screen with QR codes and a live leaderboard
- `/dev` - admin page (password protected): all players, search, CSV export, delete

Open `/display` at an address phones can actually reach, not `localhost`, because the QR code encodes whatever URL the page was opened at.

## Database

`db/flappy.sqlite`, with two tables: `players` (one row per student, best score) and `runs` (every attempt). To inspect it:

```
node scripts/players.js --stats
node scripts/players.js --csv > players.csv
```

To back it up, use `node scripts/backup.js`. Copying the `.sqlite` file alone can miss recent scores that are still in the `-wal` file.

## Deploying

See [DEPLOYING.md](DEPLOYING.md). Host it on a public server rather than a laptop, since campus wifi often blocks phone-to-laptop connections.

## Layout

```
server.js   Express app and API
db.js       SQLite schema and queries
public/     Frontend (game, display screen, dev page)
scripts/    Database tools and sanity checks
deploy/     Server setup files
```

Gameplay constants (gravity, pipe gap, speed) are at the top of `public/game.js`.
