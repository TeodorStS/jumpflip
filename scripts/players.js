#!/usr/bin/env node
/* ===============================================================
   Inspect the player database from the command line.

   Read-only by default — safe to run while the server is live.

     node scripts/players.js              all players, best score first
     node scripts/players.js --limit 20   top 20 only
     node scripts/players.js --csv        CSV, for a spreadsheet
     node scripts/players.js --csv > players.csv
     node scripts/players.js --stats      summary counts
     node scripts/players.js --find C000  search by number or name

   Honours DB_DIR, matching the server.
   =============================================================== */

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'db');
const DB_PATH = path.join(DB_DIR, 'flappy.sqlite');

if (!fs.existsSync(DB_PATH)) {
  console.error('No database at ' + DB_PATH);
  console.error('It is created the first time the server runs. Try: npm start');
  process.exit(1);
}

// --- Args ---
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i !== -1 ? argv[i + 1] : undefined;
};

const asCsv = has('--csv');
const asStats = has('--stats');
const search = valueOf('--find');
const limit = Number.parseInt(valueOf('--limit'), 10);

// readonly means this can never corrupt live data, even mid-event.
const db = new Database(DB_PATH, { readonly: true });

/* --- Stats ---------------------------------------------------- */

if (asStats) {
  const s = db.prepare(`
    SELECT COUNT(*)        AS players,
           COALESCE(MAX(best_score), 0) AS top_score,
           COALESCE(ROUND(AVG(best_score), 1), 0) AS average,
           COALESCE(SUM(best_score), 0) AS total
      FROM players
  `).get();

  const zero = db.prepare('SELECT COUNT(*) AS n FROM players WHERE best_score = 0').get().n;
  const first = db.prepare('SELECT MIN(created_at) AS t FROM players').get().t;
  const last = db.prepare('SELECT MAX(updated_at) AS t FROM players').get().t;

  // Run history: total attempts, and how hard people tried.
  const r = db.prepare(`
    SELECT COUNT(*) AS runs,
           COALESCE(ROUND(AVG(score), 1), 0) AS avg_score
      FROM runs
  `).get();

  const perPlayer = s.players > 0 ? (r.runs / s.players).toFixed(1) : '0';

  // Busiest hour, for "when should we staff the stand next time".
  const busiest = db.prepare(`
    SELECT strftime('%Y-%m-%d %H:00', played_at) AS hour, COUNT(*) AS n
      FROM runs
     GROUP BY hour
     ORDER BY n DESC
     LIMIT 1
  `).get();

  console.log('');
  console.log('  Players registered : ' + s.players);
  console.log('  Games played       : ' + r.runs);
  console.log('  Games per player   : ' + perPlayer);
  console.log('  Top score          : ' + s.top_score);
  console.log('  Average best score : ' + s.average);
  console.log('  Average game score : ' + r.avg_score);
  console.log('  Never scored       : ' + zero);
  console.log('  First registration : ' + (first || '-'));
  console.log('  Last activity      : ' + (last || '-'));
  if (busiest) {
    console.log('  Busiest hour       : ' + busiest.hour + ' (' + busiest.n + ' games)');
  }
  console.log('');
  process.exit(0);
}

/* --- Rows ----------------------------------------------------- */

let sql = 'SELECT student_number, name, best_score, created_at, updated_at FROM players';
const params = [];

if (search) {
  // Case-insensitive match on either column.
  sql += ' WHERE UPPER(student_number) LIKE ? OR UPPER(name) LIKE ?';
  const term = '%' + search.toUpperCase() + '%';
  params.push(term, term);
}

sql += ' ORDER BY best_score DESC, updated_at ASC';

if (Number.isInteger(limit) && limit > 0) {
  sql += ' LIMIT ?';
  params.push(limit);
}

const rows = db.prepare(sql).all(...params);

/* --- Output --------------------------------------------------- */

if (asCsv) {
  // Quote every field and double internal quotes, so names with commas
  // survive the trip into Excel or Sheets.
  const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  console.log('rank,student_number,name,best_score,created_at,updated_at');
  rows.forEach((r, i) => {
    console.log([i + 1, esc(r.student_number), esc(r.name), r.best_score, esc(r.created_at), esc(r.updated_at)].join(','));
  });
  process.exit(0);
}

if (!rows.length) {
  console.log(search ? 'No players matching "' + search + '".' : 'No players yet.');
  process.exit(0);
}

console.log('');
console.log('  #   Student No.  Name                          Score');
console.log('  ' + '-'.repeat(56));

rows.forEach((r, i) => {
  const rank = String(i + 1).padStart(3);
  const num = r.student_number.padEnd(12);
  // Truncate long names so columns stay aligned in a narrow terminal.
  const name = (r.name.length > 28 ? r.name.slice(0, 27) + '.' : r.name).padEnd(28);
  const score = String(r.best_score).padStart(6);
  console.log('  ' + rank + ' ' + num + ' ' + name + score);
});

console.log('');
console.log('  ' + rows.length + ' player' + (rows.length === 1 ? '' : 's'));
console.log('');
