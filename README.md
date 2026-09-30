# JumpFlip

A Flappy Bird-style browser game made for the students of TU Dublin by the **CS++ Society**. Students played it at society events for a chance to win a reward, and signed up to the society along the way.

## Hosting

JumpFlip was hosted on the CS++ Society's own server at TU Dublin, so students could open it straight from their phones on campus.

## How it worked

1. Students scanned a QR code at the CS++ stand.
2. They entered their name and student number and played.
3. Their best score went onto a live leaderboard shown at the stand.
4. The top scorers were rewarded by the society.

## Tech

Node.js, Express, SQLite, and plain JavaScript on an HTML canvas. It runs as a single Docker container.

## Run it locally

```
npm install
npm start
```

Open <http://localhost:3000>. Or with Docker:

```
docker compose up -d --build
```

Optional environment variables: `PORT` (default `3000`), `DB_DIR` (where the database is stored), and `ADMIN_PASSWORD` (turns on the organiser page at `/dev`).

## Project layout

```
server.js    Express app and API routes
db.js        SQLite schema and queries
public/      The game, stand display and organiser page
scripts/     CLI tools for inspecting and backing up the database
```

## Data

The app stores each player's name, student number and scores, used only for the event leaderboard. The organiser page that shows student numbers is password-protected.

## License

MIT

All bird drawing lives in `drawBird()` (section 4) and nowhere else.
