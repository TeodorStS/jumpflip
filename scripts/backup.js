#!/usr/bin/env node
/* ===============================================================
   Safely back up the score database.

     npm run backup                      -> <DB_DIR>/backup.sqlite
     npm run backup -- /path/to/out.db   -> a path you choose

   Uses SQLite's online backup API rather than copying the file.

   That distinction matters: the database runs in WAL mode, so recent
   writes live in a separate `-wal` sidecar until a checkpoint folds
   them in. On a live server the main file measured 4 KB while the WAL
   held 78 KB — copying `flappy.sqlite` alone would have lost almost
   every score. The backup API reads a consistent snapshot of both, and
   is safe to run while the server is serving.
   =============================================================== */

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, '..', 'db');
const SOURCE = path.join(DB_DIR, 'flappy.sqlite');

// Optional destination argument, otherwise a timestamped default.
const target = process.argv[2] || path.join(DB_DIR, 'backup.sqlite');

if (!fs.existsSync(SOURCE)) {
  console.error('\n  No database at ' + SOURCE);
  console.error('  Nothing to back up — has the server run yet?\n');
  process.exit(1);
}

const db = new Database(SOURCE, { readonly: true });

db.backup(target)
  .then(() => {
    const size = fs.statSync(target).size;
    const kb = (size / 1024).toFixed(1);

    // Report the row counts too, so an empty or truncated backup is
    // obvious rather than silently "successful".
    const check = new Database(target, { readonly: true });
    const players = check.prepare('SELECT COUNT(*) AS n FROM players').get().n;
    const runs = check.prepare('SELECT COUNT(*) AS n FROM runs').get().n;
    check.close();

    console.log('\n  Backup written: ' + target);
    console.log('  Size    : ' + kb + ' KB');
    console.log('  Players : ' + players);
    console.log('  Runs    : ' + runs + '\n');

    db.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n  Backup FAILED: ' + err.message + '\n');
    db.close();
    process.exit(1);
  });
