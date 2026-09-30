#!/usr/bin/env node
/* ===============================================================
   Re-check every score in the database.

     npm run verify
     docker compose exec flappy npm run verify     (on the server)

   Every run saved since runs were verified keeps its replay: seed,
   length and flaps. This replays each one through public/sim.js and
   confirms it still produces the score on record.

   It also lists players whose BEST score has no verified run behind
   it — scores saved before verification existed, which is where any
   scripted scores from past events will be. Nothing is changed:
   delete what shouldn't be there from the dev page.

   Read-only, so safe to run while the server is live. Honours DB_DIR.
   =============================================================== */

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const Sim = require('../public/sim');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'db');
const DB_PATH = path.join(DB_DIR, 'flappy.sqlite');

if (!fs.existsSync(DB_PATH)) {
  console.error('No database at ' + DB_PATH);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

const hasReplays = db.prepare('PRAGMA table_info(runs)').all().some((c) => c.name === 'flaps');
if (!hasReplays) {
  console.log('This database predates verified runs — start the new server once to upgrade it.');
  process.exit(0);
}

/* --- 1. Replay every verified run ------------------------------ */

const runs = db.prepare(`
  SELECT id, student_number, score, seed, ticks, flaps
    FROM runs
   WHERE seed IS NOT NULL
`).all();

let mismatches = 0;

for (const run of runs) {
  let tick = 0;
  const flapTicks = run.flaps ? run.flaps.split(',').map((d) => (tick += Number(d))) : [];
  const replay = Sim.replay(run.seed, flapTicks, run.ticks);

  if (!replay.over || replay.score !== run.score || replay.ticks !== run.ticks) {
    mismatches++;
    console.log(`  MISMATCH  run ${run.id} (${run.student_number}): stored ${run.score}, replay ${replay.score}`);
  }
}

const unverified = db.prepare('SELECT COUNT(*) AS n FROM runs WHERE seed IS NULL').get().n;

console.log(`\nVerified runs:   ${runs.length - mismatches} of ${runs.length} replay to their score`);
console.log(`Older runs:      ${unverified} saved before verification (no replay to check)`);

/* --- 2. Best scores with nothing verified behind them ----------- */

const unbacked = db.prepare(`
  SELECT p.student_number, p.name, p.best_score,
         COALESCE(MAX(r.score), -1) AS best_verified
    FROM players p
    LEFT JOIN runs r ON r.student_number = p.student_number AND r.seed IS NOT NULL
   GROUP BY p.student_number
  HAVING p.best_score > COALESCE(MAX(r.score), -1)
   ORDER BY p.best_score DESC
`).all();

if (unbacked.length) {
  console.log(`\nBest scores not backed by a verified run (${unbacked.length}):`);
  for (const p of unbacked) {
    const verified = p.best_verified < 0 ? 'none' : p.best_verified;
    console.log(`  ${String(p.best_score).padStart(7)}  ${p.student_number}  ${p.name}  (best verified: ${verified})`);
  }
  console.log('\nReview these on the dev page (/dev) and delete any that are not real.');
} else {
  console.log('\nEvery best score is backed by a verified run.');
}

process.exit(mismatches ? 1 : 0);
