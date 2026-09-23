# CS++ Flappy

Flappy Bird clone with a score leaderboard, built for CS++ Society at TU Dublin.
Players register with their name and student number, play, and their best score
goes on a shared leaderboard.

## Running it

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

Set `PORT` to change the port, and `DB_DIR` to move the database:

```bash
PORT=8080 DB_DIR=/data npm start
```

The dev page (`/dev`) stays switched off until `ADMIN_PASSWORD` is set:

```bash
ADMIN_PASSWORD=pick-something npm start                 # macOS / Linux / Git Bash
$env:ADMIN_PASSWORD="pick-something"; npm start         # Windows PowerShell
```

## Running it with Docker

```bash
docker compose up -d --build
```

Then open <http://localhost:3000>. The scores live in a named Docker volume
(`cspp-flappy-data`), so rebuilds and restarts never lose them — only
`docker compose down -v` deletes the data.

See **[DEPLOYING.md](DEPLOYING.md)** for the full step-by-step guide to
hosting this on a server, including HTTPS, backups and troubleshooting.

## Running it at an event

**Host it on a server with a public IP.** See [deploy/README.md](deploy/README.md)
for the full guide — there is a `setup.sh` that does the whole install.

```
  players' phones                      laptop at the stand
  (mobile data or any wifi)            (browser, shows QR + leaderboard)
         |                                      |
         |            internet                  |
         +----------------+---------------------+
                          |
                     your server
```

The laptop serves nothing; it just opens `/display` from the server. On the
day: open `https://your-domain/display`, press F11, done.

Hosting publicly rather than on a laptop matters because **campus and guest
wifi networks commonly use client isolation**, which blocks phone-to-laptop
connections even when both are on the same network. That failure only shows
up at the venue, with a queue of people waiting.

### Local network instead

If you do run it from a laptop on the venue wifi, open
`http://<laptop-lan-ip>:3000/display` — the QR encodes whatever address the
page was opened at. Test it from a phone **on that same wifi** before the
event, not just from the laptop itself.

## Project layout

```
server.js      Express app, API routes, input validation
db.js          SQLite schema and queries
db/            Database file lives here (mountable as a volume)
Dockerfile     Production container image
docker-compose.yml  How to run it
DEPLOYING.md   Step-by-step hosting guide
deploy/
  setup.sh     Bare-metal install (no Docker)
  cspp-flappy.service  systemd unit
  nginx.conf   Reverse proxy + HTTPS template
  README.md    Deployment guide
scripts/
  players.js   Read-only CLI for inspecting the database
  backup.js    Safe database backup (WAL-aware)
  check-mascot.js  Validate the mascot sprite
  check-scroll.js  Verify background layers scroll smoothly
  check-obstacles.js  Verify obstacle detail does not flicker
public/
  index.html   Start screen (society sign-up + registration), game-over panel
  game.js      Game loop, rendering, API calls
  style.css    Layout and overlay styling
  mascot.png   The CS++ mascot sprite
  bitflip.png  The party-hat mascot for 5 years of CS++ (display screen)
  display.html Stand display screen (QR codes + live leaderboard)
  display.css  Display screen styling, mascot animations
  display.js   Display screen polling, QR wiring, how-many picker
  dev.html     Dev page: every player with student numbers, CSV, monitor
  dev.css      Dev page styling
  dev.js       Dev page polling, search, attempt history, deletion
```

## Society sign-up placement

The **Join CS++ Society** button is the first and most prominent thing on the
start screen, above the name/student-number form, because people are most
likely to join in the moment right before they play. It opens in a new tab so
the game is still waiting when they come back.

It is a **soft gate**: nobody is blocked from playing if they skip it. That is
deliberate — a hard gate cannot verify anyone actually completed sign-up (only
that they tapped a button), and it would annoy existing members who already
joined. The button appears again on the game-over screen, secondary to
Run Again.

## Database

SQLite, at `db/flappy.sqlite`. Two tables:

**`players`** — one row per student, holding their personal best.
This is what the leaderboard reads.

**`runs`** — one row per attempt, including attempts that did not beat a
personal best. `players` alone cannot answer "how many games were played?"
or "when were we busiest?", which are the questions that matter for a
society report.

Both are written inside a single transaction, so a score and its history
entry either both land or neither does. The `runs` table is created
automatically on startup, so an existing database from an earlier version
upgrades itself with no manual migration and no data loss.

## Accessing the database

The SQLite file is at `db/flappy.sqlite`, created automatically the first time
the server runs. `DB_DIR` moves it elsewhere.

### From the command line

```bash
node scripts/players.js              # all players, best score first
node scripts/players.js --limit 20   # top 20
node scripts/players.js --stats      # players, games played, busiest hour
node scripts/players.js --find C000  # search by student number or name
node scripts/players.js --csv > players.csv   # export for a spreadsheet
```

This opens the database read-only, so it is safe to run during an event while
the server is live.

### From the browser

`http://localhost:3000/dev` is the organisers' page, behind a password:

- every player with their student number, best first, with their number of
  attempts, average score and when they last played
- search by name or student number
- **Export CSV** for picking the winners
- **Delete** a player and all their attempts, or click an attempt count to
  see every attempt and delete a single one. The player's best score is
  worked out again from what is left, and deleting their only attempt
  removes them. Each deletion is written to the server log.
- a live monitor, refreshing every 5 seconds: players, attempts, top and
  average score, attempts in the last 10 minutes, time since the last
  attempt, and server uptime

**The password** is `ADMIN_PASSWORD` — set in `docker-compose.yml` on the
server, or in the environment when running locally (see *Running it*). The
browser asks for it once; any username works. With no password set, `/dev`
is switched off rather than left open. Never put this page on the stand
screen.

### With a GUI

Any SQLite client will open `db/flappy.sqlite` — [DB Browser for SQLite](https://sqlitebrowser.org/)
is the usual choice. Prefer read-only mode while the server is running.

### A note on the extra files

Alongside `flappy.sqlite` you'll see `-wal` and `-shm` files. That's SQLite's
write-ahead log, and it means **recent scores may live in the `-wal` file
rather than the main one**. To copy or back up the database, take all three
files together, or stop the server first so the log is folded in. Copying
`flappy.sqlite` alone from a running server can miss the newest scores.

## The stand display screen

A read-only board for a laptop or TV at the event:

```text
http://<machine-ip>:3000/display
```

It shows a QR code to the game, a QR code to society sign-up, the live
leaderboard, and running totals. It refreshes itself every 5 seconds, so it
can be left alone all day.

**Mascots.** The CS++ mascot and the 5-year party duck bob either side of the
title, jump whenever someone takes the lead, and take turns flying across
the top of the screen — kept clear of the QR codes and the leaderboard. All
CSS; switched off for anyone who has asked their system for reduced motion.

**Choosing how many players to show.** The board shows the top 10 by
default. Move the mouse and a picker appears next to the title: **10**,
**20**, or type any number up to 100 and press Enter. It fades out again
when the mouse is still. The choice is remembered by that browser, and
`?top=20` in the address sets it directly. Rows shrink to fit as many as
possible; past a readable size, the list scrolls itself slowly instead.

**Open it at the address players should scan, not `localhost`.** The QR code
encodes whatever address the page itself was opened at, so opening it at
`localhost` produces a QR code no phone can reach. The page detects that and
warns rather than failing silently.

To point the QR somewhere other than the address the screen is browsing — a
short vanity domain in front of the server, say — append `?url=`:

```text
https://your-domain/display?url=https://play.yourdomain.com
```

QR codes are rendered server-side (`GET /api/qr?url=...`) so the screen
needs no QR library and no internet access — venue Wi-Fi often has no route
out, and a QR code that fails to load breaks the whole stand.

If the server becomes unreachable the board keeps showing the last good
scores and turns its status dot red, rather than blanking.

## API

### `POST /api/score`

```json
{ "student_number": "12345678", "name": "Jane Doe", "score": 12 }
```

Creates the player if they're new. For an existing player the stored best score
only moves when the new score beats it — otherwise the row is left alone. The
response always carries the player's current best:

```json
{
  "student_number": "12345678",
  "name": "Jane Doe",
  "score": 12,
  "best_score": 12,
  "is_new_best": true
}
```

Returns `201` for a newly created player, `200` otherwise, and `400` with an
`error` message if validation fails.

### `GET /api/leaderboard?limit=10`

Top N players by best score, descending. `limit` defaults to 10 and is capped
at 100; junk values fall back to the default.

```json
[{ "name": "Jane Doe", "student_number": "12345678", "best_score": 12 }]
```

### `GET /api/stats`

Event totals for the display screen.

```json
{ "players": 42, "runs": 118, "top_score": 31, "avg_run_score": 7.4 }
```

### `GET /api/qr?url=...`

Renders the given URL as an SVG QR code. Only `http` and `https` are
accepted — anything else in a QR code at a public stand is a phishing
vector.

### `GET /api/health`

Returns `{"ok": true}`.

### Dev endpoints

Everything under `/dev` needs the password as HTTP Basic auth (any
username), and returns `503` when no `ADMIN_PASSWORD` is set. Times are
SQLite UTC timestamps.

#### `GET /dev/api/players`

Every player **with student number**, best first, plus the monitor figures.
`server_time` lets the page show "3m ago" without trusting the viewer's clock.

```json
{
  "players": [{
    "student_number": "C00035654", "name": "Jane Doe", "best_score": 12,
    "run_count": 3, "avg_score": 8.3,
    "first_played": "2026-09-23 13:02:11", "last_played": "2026-09-23 14:40:05"
  }],
  "stats": {
    "players": 42, "runs": 118, "top_score": 31, "avg_run_score": 7.4,
    "runs_last_10m": 9, "last_run_at": "2026-09-23 14:40:05"
  },
  "server_time": 1790000000000,
  "uptime_secs": 5400
}
```

#### `GET /dev/api/players/:studentNumber/runs`

That player's attempts, newest first: `{ "runs": [{ "id": 17, "score": 12, "played_at": "…" }] }`.

#### `DELETE /dev/api/players/:studentNumber`

Deletes the player and all their attempts. `404` if there is no such player.

#### `DELETE /dev/api/runs/:id`

Deletes one attempt and recomputes the player's best score (ties still break
by who reached it first). Deleting a player's only attempt removes the
player: `{ "deleted": true, "student_number": "…", "player_removed": true }`.

#### `GET /dev/players.csv`

The full list as a download:
`rank,name,student_number,best_score,attempts,avg_score,first_played_utc,last_played_utc`.
Names that start with `=`, `+`, `-` or `@` are prefixed with `'` so a
spreadsheet cannot run them as formulas.

## Validation

The server rejects anything that isn't a non-empty name, a valid student
number, and a non-negative whole-number score. Strings are trimmed, internal
whitespace is collapsed, and control characters are stripped before storage.
The client-side checks in the registration form mirror these rules for fast
feedback, but the server is the authority.

**Student number format:** one letter followed by 8 digits, e.g. `C00035654`.
Any letter prefix is accepted, since it varies by campus and intake — turning
away a real student at the stand is worse than accepting an unusual prefix.
Numbers are uppercased before validation and storage, so `c00035654` and
`C00035654` are the same player rather than two rows with separate scores.

If you change this rule, update it in both places: `STUDENT_NUMBER_PATTERN`
in `server.js` and the matching constant in `public/game.js`.

## Performance

The game is canvas-only and measures at a steady 60 fps. Two things keep it
there, and both are easy to undo by accident:

- **Obstacle interiors are cached bitmaps**, not redrawn every frame. An
  obstacle's interior never changes, so each distinct (type, bucketed height,
  orientation, seed) is rendered once to an offscreen canvas and then
  blitted. Adding a per-frame drawing call inside a component function puts
  roughly 400 canvas operations back into every frame.
- **Background tiles are pre-rendered once.** Randomising inside a draw call
  both costs time and makes the layer flicker.
- **The canvas is opaque (`alpha: false`) and its backing store is only
  resized when the pixel dimensions actually change.** Assigning
  `canvas.width` blanks the canvas, and mobile browsers fire `resize`
  constantly as the address bar slides in and out — without the guard that is
  a stream of blank frames, which reads as the background flashing while you
  play. This only reproduces on a real phone, not in a desktop browser.

Check both with:

```bash
node scripts/check-obstacles.js   # interior detail is frame-stable
node scripts/check-scroll.js      # parallax layers do not jump
```

Neither needs a browser.

## Scrolling background

Every parallax layer (contact fingers, surface-mount chips, circuit traces)
reads from one shared `groundOffset` counter. That counter MUST wrap at a
common multiple of every layer period, or a layer is caught mid-pattern at
the reset and jumps backwards several times a second — which looks like a
juddering floor.

`GROUND_CYCLE` is therefore derived as the lowest common multiple of
`FINGER_PERIOD`, `CELL_PERIOD` and `TRACE_TILE` rather than hardcoded. If you
add a layer with a new period, add it to that list.

Verify with:

```bash
node scripts/check-scroll.js
```

It parses the real constants out of `public/game.js`, confirms the wrap point
is derived rather than hardcoded, and simulates the scroll to measure the
worst per-frame deviation. Anything above zero means a visible jump.

## Tuning the game

Physics and difficulty constants sit at the top of `public/game.js` —
gravity, flap strength, pipe gap, pipe speed and spacing. Nothing
gameplay-related is hardcoded further down the file.

## Brand palette

The colours are sampled from the mascot artwork itself, so the character, the
game world and the UI are all the same two colours:

| Token | Hex | Where it came from |
|-------|-----|--------------------|
| `--cs-blue` | `#05009d` | the mascot's jumper |
| `--cs-gold` | `#ffc901` | the mascot's own gold |

The rules that keep it readable:

- **The world is branded; the components are not.** Sky, motherboard and UI
  are blue and gold. The obstacles keep the colours real hardware has. An
  earlier version tinted every component blue and the result was bland and
  hard to read — five obstacles that all looked the same. Brand the backdrop,
  not the things the player has to tell apart.
- **Gold is reserved for the society ask.** The Join button is gold; the Run
  button is blue. If gold starts appearing on ordinary controls, the sign-up
  call to action stops standing out.
- **The sky is a lifted blue (`#4a55d6`), not the brand blue.** The deep blue
  is saved for the foreground so obstacles and the mascot separate from the
  background.
- **The mascot gets a soft dark halo** when drawn. Its jumper is exactly the
  brand blue, so against a blue sky it would otherwise merge into it.

To re-derive the palette from different artwork, sample the dominant opaque
colours of `public/mascot.png` and update the tokens at the top of
`public/style.css` plus the `COLOR_*` constants in `public/game.js`.

## Hardware theme

The scene is built out of PC parts rather than pipes and grass:

- **Obstacles** are server racks, RAM sticks, bookshelves, CPUs, GPUs, hard
  drives and power supplies. Racks, RAM and shelves are weighted to appear
  twice as often as the others. Each keeps the colours the real thing has —
  lit-up dark rack, red spreader on green PCB, warm wood and coloured book
  spines, black CPU with gold pins, orange-accented GPU, silver drive, vented
  PSU — so the player can tell them apart at a glance. Each is drawn to fill
  an arbitrary rectangle, and the end facing the gap gets the connector, cap
  or trim, so they read the right way up whether they hang from the ceiling
  or stand on the floor.
- **Detail inside an obstacle is keyed to a seed fixed at creation.** Rack
  LEDs and book spines are hashed from `pipe.seed`, never from the obstacle's
  x position — x changes every frame as it scrolls, so hashing it re-rolls
  every book and LED every frame and the obstacle visibly flickers.
- **Rendered obstacles are cached as bitmaps.** An obstacle's interior never
  changes, so each distinct (type, bucketed height, orientation, seed) is
  drawn once to an offscreen canvas and then blitted. This cut canvas calls
  from ~500 to ~130 per frame.
- **The sky** carries scrolling PCB traces with solder pads, drawn as four
  pre-rendered tiles shuffled by grid position. They scroll at 35% of the
  foreground speed for parallax. Tiles are built once, not per frame —
  randomising inside the draw loop would make them flicker.
- **The ground** is a motherboard in society blue: gold contact fingers along
  the top edge and scrolling surface-mount chips and capacitors.

Collision is untouched by any of this. Obstacles are still the same two
rectangles and the ground is still the `GROUND_Y` line, so the artwork can be
reskinned freely without affecting how the game plays. To add a component
type, write a `drawX()` function and add its name to `PIPE_TYPES`.

## The mascot sprite

The bird is the CS++ mascot, loaded from `public/mascot.png` (a copy of
`chud_flip.png` in the repo root — 124x128 RGBA with a transparent
background).

To swap in different artwork, overwrite `public/mascot.png` and check it:

```bash
node scripts/check-mascot.js
```

That confirms the file is a real image, reports its dimensions, and warns if
it has no transparency or is oddly proportioned. The sprite keeps its own
aspect ratio when drawn, so it does not need to be exactly square.

If the file is missing or fails to load, `drawBird()` falls back to a plain
yellow circle rather than breaking, and logs a warning to the browser
console.

Sizing and rotation are controlled by constants at the top of `public/game.js`:

- `BIRD_RADIUS` — the collision circle. Changing it rescales the art too, so
  the hitbox and the sprite can never drift apart.
- `BIRD_DRAW_SCALE` — how much bigger the sprite is drawn than that circle.
  Above 1 means the art is slightly generous and the hitbox slightly tight,
  which feels fairer to play than the reverse.
- `BIRD_MAX_TILT` / `BIRD_MIN_TILT` — rotation limits, kept gentler than
  classic Flappy Bird because an upright character with a face looks wrong
  nose-diving at 80 degrees.
- `BIRD_START_Y` — resting height on the start screen, set so the mascot sits
  behind the panels rather than poking out between them.

All bird drawing lives in `drawBird()` (section 4) and nowhere else.
