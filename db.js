/* ===============================================================
   CS++ Flappy — database layer
   SQLite via better-sqlite3 (synchronous; no callbacks/promises).

   The database file lives in ./db so the whole folder can be mounted
   as a volume later without touching application code.
   =============================================================== */

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Allow the location to be overridden at deploy time (e.g. a mounted volume).
const DB_DIR = process.env.DB_DIR || path.join(__dirname, 'db');
const DB_PATH = path.join(DB_DIR, 'flappy.sqlite');

// Create the directory if it isn't there — on a fresh clone or an empty
// volume mount it won't be, and SQLite won't create it for us.
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// WAL gives much better concurrent read performance, which matters when a
// room full of people are hitting the leaderboard at once.
db.pragma('journal_mode = WAL');

/* ---------------------------------------------------------------
   Schema
   --------------------------------------------------------------- */

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    student_number TEXT PRIMARY KEY,
    name           TEXT    NOT NULL,
    best_score     INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

// Leaderboard reads are "ORDER BY best_score DESC LIMIT n" — this index lets
// SQLite walk the top N directly instead of sorting the whole table.
db.exec(`CREATE INDEX IF NOT EXISTS idx_players_best_score ON players (best_score DESC);`);

/* One row per attempt, not per player.

   `players` only remembers a personal best, which cannot answer "how many
   games were played?" or "when were we busiest?" — the questions that
   actually matter for a society report. This table keeps the full history.

   ON DELETE CASCADE means removing a player takes their runs with them, so
   a deletion cannot leave orphaned rows behind. */
db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    student_number TEXT    NOT NULL REFERENCES players(student_number) ON DELETE CASCADE,
    score          INTEGER NOT NULL,
    played_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

// Per-player history lookups, and time-ordered reporting.
db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_student ON runs (student_number);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_played_at ON runs (played_at);`);

// Foreign keys are OFF by default in SQLite and must be enabled per
// connection, otherwise the REFERENCES clause above is decorative.
db.pragma('foreign_keys = ON');

/* ---------------------------------------------------------------
   Prepared statements
   Prepared once at startup and reused; better-sqlite3 caches the
   compiled plan, and parameter binding keeps this injection-safe.
   --------------------------------------------------------------- */

const selectPlayer = db.prepare(`
  SELECT student_number, name, best_score FROM players WHERE student_number = ?
`);

const insertPlayer = db.prepare(`
  INSERT INTO players (student_number, name, best_score)
  VALUES (@student_number, @name, @score)
`);

// The WHERE clause is the core rule: a player's row only moves when they
// actually beat their own record. Doing the comparison in SQL rather than in
// JS keeps read-then-write atomic, so two near-simultaneous submissions from
// the same student can't clobber each other.
const updateIfBetter = db.prepare(`
  UPDATE players
     SET best_score = @score,
         name       = @name,
         updated_at = CURRENT_TIMESTAMP
   WHERE student_number = @student_number
     AND @score > best_score
`);

const selectTop = db.prepare(`
  SELECT name, student_number, best_score
    FROM players
   ORDER BY best_score DESC, updated_at ASC
   LIMIT ?
`);

const insertRun = db.prepare(`
  INSERT INTO runs (student_number, score) VALUES (@student_number, @score)
`);

/* Event totals for the display page and the society report.

   Written as one query rather than several so the numbers are all read
   from the same point in time — separate queries could be interleaved
   with a submission and disagree with each other. */
const selectStats = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM players)                     AS players,
    (SELECT COUNT(*) FROM runs)                        AS runs,
    (SELECT COALESCE(MAX(best_score), 0) FROM players) AS top_score,
    (SELECT COALESCE(ROUND(AVG(score), 1), 0) FROM runs) AS avg_run_score
`);

/* ---------------------------------------------------------------
   Public API
   --------------------------------------------------------------- */

/**
 * Record a score for a player, creating them if they're new.
 *
 * Insert-or-update-if-better, wrapped in a transaction so the whole
 * thing is atomic. Returns the player's best score after the
 * submission, plus whether this run set a new personal record.
 *
 * @returns {{ best_score: number, is_new_best: boolean, is_new_player: boolean }}
 */
const submitScore = db.transaction(({ student_number, name, score }) => {
  const existing = selectPlayer.get(student_number);

  if (!existing) {
    insertPlayer.run({ student_number, name, score });
    // Inside the same transaction: the player row and their first run either
    // both land or neither does. The insert must come first, since runs has
    // a foreign key pointing at players.
    insertRun.run({ student_number, score });
    return { best_score: score, is_new_best: true, is_new_player: true };
  }

  // No-ops when score <= best_score, which is the "otherwise do nothing" case.
  const result = updateIfBetter.run({ student_number, name, score });
  const improved = result.changes > 0;

  // Every attempt is logged, including ones that did not beat the best —
  // that is the whole point of this table.
  insertRun.run({ student_number, score });

  return {
    best_score: improved ? score : existing.best_score,
    is_new_best: improved,
    is_new_player: false
  };
});

/**
 * Top N players by best score. Ties break by who got there first.
 * @param {number} limit
 */
function getLeaderboard(limit) {
  return selectTop.all(limit);
}

/**
 * Event totals: registered players, total attempts, top score, average run.
 * @returns {{ players: number, runs: number, top_score: number, avg_run_score: number }}
 */
function getStats() {
  return selectStats.get();
}

/* ---------------------------------------------------------------
   Dev page queries

   These return every student number or delete records, so they are
   kept apart from the public functions above and used only by the
   password-protected /dev routes.
   --------------------------------------------------------------- */

// Same order as the public leaderboard, so rank 1 here is rank 1 there.
const selectAllPlayers = db.prepare(`
  SELECT p.student_number,
         p.name,
         p.best_score,
         COUNT(r.id)                         AS run_count,
         COALESCE(ROUND(AVG(r.score), 1), 0) AS avg_score,
         MIN(r.played_at)                    AS first_played,
         MAX(r.played_at)                    AS last_played
    FROM players p
    LEFT JOIN runs r ON r.student_number = p.student_number
   GROUP BY p.student_number
   ORDER BY p.best_score DESC, p.updated_at ASC
`);

// Everything the dev page's monitor shows, read at one point in time.
const selectDevStats = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM players)                       AS players,
    (SELECT COUNT(*) FROM runs)                          AS runs,
    (SELECT COALESCE(MAX(best_score), 0) FROM players)   AS top_score,
    (SELECT COALESCE(ROUND(AVG(score), 1), 0) FROM runs) AS avg_run_score,
    (SELECT COUNT(*) FROM runs
      WHERE played_at >= datetime('now', '-10 minutes')) AS runs_last_10m,
    (SELECT MAX(played_at) FROM runs)                    AS last_run_at
`);

const selectPlayerRuns = db.prepare(`
  SELECT id, score, played_at
    FROM runs
   WHERE student_number = ?
   ORDER BY played_at DESC, id DESC
`);

const deletePlayerStmt = db.prepare('DELETE FROM players WHERE student_number = ?');
const deleteRunStmt = db.prepare('DELETE FROM runs WHERE id = ?');
const selectRunOwner = db.prepare('SELECT student_number FROM runs WHERE id = ?');
const countPlayerRuns = db.prepare('SELECT COUNT(*) AS n FROM runs WHERE student_number = ?');

// After an attempt is deleted the stored best may be the deleted score, so
// recompute it from what remains. updated_at goes back to when that best
// was first reached, because leaderboard ties are broken by it.
const recalcBest = db.prepare(`
  UPDATE players
     SET best_score = (SELECT MAX(score) FROM runs WHERE student_number = @sn),
         updated_at = (SELECT MIN(played_at) FROM runs
                        WHERE student_number = @sn
                          AND score = (SELECT MAX(score) FROM runs WHERE student_number = @sn))
   WHERE student_number = @sn
`);

/**
 * Every player with their student number and attempt figures, best first.
 */
function getAllPlayers() {
  return selectAllPlayers.all();
}

/**
 * Totals, recent activity and the time of the last attempt.
 * @returns {{ players: number, runs: number, top_score: number, avg_run_score: number,
 *             runs_last_10m: number, last_run_at: string|null }}
 */
function getDevStats() {
  return selectDevStats.get();
}

/**
 * One player's attempts, newest first.
 */
function getPlayerRuns(studentNumber) {
  return selectPlayerRuns.all(studentNumber);
}

/**
 * Delete a player and, through ON DELETE CASCADE, all of their attempts.
 * @returns {boolean} whether there was such a player
 */
function deletePlayer(studentNumber) {
  return deletePlayerStmt.run(studentNumber).changes > 0;
}

/**
 * Delete one attempt and recompute that player's best score.
 *
 * Deleting a player's only attempt removes the player too — otherwise
 * they would stay on the leaderboard with a score of 0 they never got.
 * One transaction, so the best score can never disagree with the attempts.
 *
 * @returns {{ deleted: boolean, student_number?: string, player_removed?: boolean }}
 */
const deleteRun = db.transaction((runId) => {
  const run = selectRunOwner.get(runId);
  if (!run) return { deleted: false };

  deleteRunStmt.run(runId);

  if (countPlayerRuns.get(run.student_number).n === 0) {
    deletePlayerStmt.run(run.student_number);
    return { deleted: true, student_number: run.student_number, player_removed: true };
  }

  recalcBest.run({ sn: run.student_number });
  return { deleted: true, student_number: run.student_number, player_removed: false };
});

module.exports = {
  db,
  submitScore,
  getLeaderboard,
  getStats,
  DB_PATH,
  // Dev page only — every caller must be behind the password
  getAllPlayers,
  getDevStats,
  getPlayerRuns,
  deletePlayer,
  deleteRun
};
