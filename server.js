/* ===============================================================
   CS++ Flappy — API server
   Express + better-sqlite3. Serves the static game from ./public
   and exposes the score/leaderboard API.

   Endpoints:
     POST /api/score        { student_number, name, score }
     GET  /api/leaderboard?limit=10
     GET  /dev              every player with student numbers, monitor,
                            deletion — behind ADMIN_PASSWORD
     GET  /dev/players.csv  the same list as a download
   =============================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const {
  submitScore, getLeaderboard, getStats, DB_PATH,
  getAllPlayers, getDevStats, getPlayerRuns, deletePlayer, deleteRun
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------------------------------------------------------------
   Validation limits
   --------------------------------------------------------------- */

const MAX_NAME_LENGTH = 60;

// TU Dublin student numbers are one letter followed by 8 digits, e.g.
// C00035654. The prefix letter varies by campus/intake, so any letter is
// accepted rather than a fixed set — rejecting a real student at the stand
// is far worse than accepting an odd-looking prefix.
const STUDENT_NUMBER_PATTERN = /^[A-Z]\d{8}$/;
const MAX_SCORE = 100000;        // sanity ceiling; nobody is passing 100k pipes
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const MAX_QR_LENGTH = 512;   // generous for a LAN URL, bounded for safety

/* ---------------------------------------------------------------
   Middleware
   --------------------------------------------------------------- */

// Cap the body size — these payloads are tiny, so anything larger is junk.
app.use(express.json({ limit: '4kb' }));

/* ---------------------------------------------------------------
   Pages, with cache-busting

   Behind nginx (deploy/nginx.conf) browsers keep .js and .css for an
   hour, but always re-check the HTML. After a deploy that pairs the new
   page with the old script and stylesheet, and the page breaks — rows
   missing, buttons dead. So every page is sent with its .css/.js links
   tagged ?v=<hash of the file>: a changed file gets a new address the
   browser has never cached, and an unchanged one keeps its cache.

   Registered before the static middleware, which would otherwise send
   the raw files.
   --------------------------------------------------------------- */

const PUBLIC_DIR = path.join(__dirname, 'public');
const assetVersions = new Map();   // file -> { mtimeMs, version }

/** Short content hash of a file in public/, recomputed when it changes. */
function assetVersion(file) {
  const full = path.join(PUBLIC_DIR, file);
  const { mtimeMs } = fs.statSync(full);
  const cached = assetVersions.get(file);
  if (cached && cached.mtimeMs === mtimeMs) return cached.version;

  const version = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex').slice(0, 10);
  assetVersions.set(file, { mtimeMs, version });
  return version;
}

/** Send an HTML page from public/ with its own .css/.js links versioned. */
function sendPage(res, file) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8').replace(
    /(href|src)="(\/?)([\w.-]+\.(?:css|js))"/g,
    (link, attr, slash, name) => {
      try {
        return `${attr}="${slash}${name}?v=${assetVersion(name)}"`;
      } catch {
        return link;   // not a file of ours; leave it alone
      }
    }
  );

  // Always re-check the page itself. /dev sets its stricter no-store first.
  if (!res.get('Cache-Control')) res.set('Cache-Control', 'no-cache');
  return res.type('html').send(html);
}

app.get(['/', '/index.html'], (req, res) => sendPage(res, 'index.html'));

/* /display is the friendly alias for the stand screen, short enough to
   type from memory onto a venue laptop. */
app.get(['/display', '/display.html'], (req, res) => sendPage(res, 'display.html'));

// The dev page lives at /dev, behind the password.
app.get('/dev.html', (req, res) => res.redirect('/dev'));

// Everything else in public/: scripts, stylesheets, images.
app.use(express.static(PUBLIC_DIR));

/* ---------------------------------------------------------------
   Input sanitization helpers
   Everything from the client is treated as hostile: coerced to the
   expected type, trimmed, length-capped, then validated.
   --------------------------------------------------------------- */

/** Trim a value if it's a string; anything else becomes empty. */
function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Collapse internal whitespace runs and strip control characters.
 * Keeps one student pasting "John    Smith\n" from looking different
 * to another typing "John Smith" on the leaderboard.
 */
function normalizeName(value) {
  return cleanString(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Validate the POST /api/score body.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
function validateScorePayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  // --- Student number: required, letter + 8 digits ---
  // Uppercased before validation and storage so "c00035654" and "C00035654"
  // resolve to the same player rather than creating two rows with separate
  // best scores (student_number is the primary key).
  const studentNumber = cleanString(body.student_number).toUpperCase();

  if (!studentNumber) {
    return { ok: false, error: 'Student number is required.' };
  }
  if (!STUDENT_NUMBER_PATTERN.test(studentNumber)) {
    return { ok: false, error: 'Student number must be a letter followed by 8 digits, e.g. C00035654.' };
  }

  // --- Name: required ---
  const name = normalizeName(body.name);

  if (!name) {
    return { ok: false, error: 'Name is required.' };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Name must be at most ${MAX_NAME_LENGTH} characters.` };
  }

  // --- Score: required, non-negative integer ---
  // Reject the type outright rather than coercing: "12abc" or true silently
  // becoming a number would let junk into the leaderboard.
  const { score } = body;

  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return { ok: false, error: 'Score must be a number.' };
  }
  if (!Number.isInteger(score)) {
    return { ok: false, error: 'Score must be a whole number.' };
  }
  if (score < 0) {
    return { ok: false, error: 'Score must not be negative.' };
  }
  if (score > MAX_SCORE) {
    return { ok: false, error: `Score must be at most ${MAX_SCORE}.` };
  }

  return { ok: true, value: { student_number: studentNumber, name, score } };
}

/* ---------------------------------------------------------------
   Routes
   --------------------------------------------------------------- */

/**
 * POST /api/score
 * Records a run. Creates the player if new; otherwise updates their best
 * score only when this run beat it. Always returns their current best.
 */
app.post('/api/score', (req, res) => {
  const validation = validateScorePayload(req.body);

  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const result = submitScore(validation.value);

    // One line per game, so `docker compose logs -f` doubles as a live feed.
    console.log('[game] ' + validation.value.name + ' scored ' + validation.value.score +
      (result.is_new_best ? ' (new best)' : ''));

    return res.status(result.is_new_player ? 201 : 200).json({
      student_number: validation.value.student_number,
      name: validation.value.name,
      score: validation.value.score,
      best_score: result.best_score,
      is_new_best: result.is_new_best
    });
  } catch (err) {
    console.error('POST /api/score failed:', err);
    return res.status(500).json({ error: 'Could not save score.' });
  }
});

/**
 * GET /api/leaderboard?limit=10
 * Top N players by best score, descending.
 */
app.get('/api/leaderboard', (req, res) => {
  // Parse the limit defensively: a missing, junk, or out-of-range value
  // falls back to the default rather than erroring.
  const raw = Number.parseInt(req.query.limit, 10);
  const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    return res.json(getLeaderboard(limit));
  } catch (err) {
    console.error('GET /api/leaderboard failed:', err);
    return res.status(500).json({ error: 'Could not load leaderboard.' });
  }
});

/**
 * GET /api/qr?url=...
 * Renders a QR code as SVG.
 *
 * Generated server-side so the display page needs no QR library and no
 * internet access — venue Wi-Fi often has no route out, and a QR code that
 * fails to load is the one thing that breaks the whole stand.
 */
app.get('/api/qr', (req, res) => {
  const target = cleanString(req.query.url);

  if (!target) {
    return res.status(400).json({ error: 'A url query parameter is required.' });
  }
  if (target.length > MAX_QR_LENGTH) {
    return res.status(400).json({ error: `url must be at most ${MAX_QR_LENGTH} characters.` });
  }

  // Only encode http(s). Anything else in a QR code at a public stand is a
  // phishing vector, and nothing here legitimately needs another scheme.
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).json({ error: 'url must be a valid absolute URL.' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only http and https URLs can be encoded.' });
  }

  QRCode.toString(target, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2
  }, (err, svg) => {
    if (err) {
      console.error('GET /api/qr failed:', err);
      return res.status(500).json({ error: 'Could not generate QR code.' });
    }
    res.type('image/svg+xml');
    // Same URL always yields the same image; let the display screen cache it.
    res.set('Cache-Control', 'public, max-age=3600');
    return res.send(svg);
  });
});

/**
 * GET /api/stats
 * Event totals for the display screen: registered players, total attempts,
 * top score and average score per attempt.
 */
app.get('/api/stats', (req, res) => {
  try {
    return res.json(getStats());
  } catch (err) {
    console.error('GET /api/stats failed:', err);
    return res.status(500).json({ error: 'Could not load stats.' });
  }
});

/** Health check — handy when this is behind a reverse proxy or in a container. */
app.get('/api/health', (req, res) => res.json({ ok: true }));

/* ---------------------------------------------------------------
   Dev page (/dev)

   Every player with their student number and attempt figures, a CSV
   export for working out the winners, a live monitor of the event,
   and deletion of players or single attempts.

   Password-protected with ADMIN_PASSWORD, which is set in
   docker-compose.yml on the server. Without one, /dev is switched off
   rather than left open. Never put this page on the stand screen —
   /display is the public one.
   --------------------------------------------------------------- */

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MIN_PASSWORD_LENGTH = 12;

if (!ADMIN_PASSWORD) {
  console.warn('[dev] ADMIN_PASSWORD is not set, so /dev is switched off.');
} else if (ADMIN_PASSWORD.length < MIN_PASSWORD_LENGTH) {
  console.warn(`[dev] ADMIN_PASSWORD is under ${MIN_PASSWORD_LENGTH} characters. ` +
    'It guards every student number — use a longer one.');
}

/** Constant-time compare, so response timing cannot reveal how close a guess was. */
function safeEqual(a, b) {
  // Hashing first gives equal-length buffers, which timingSafeEqual requires.
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * HTTP Basic auth: no login page, sessions or cookies, and every browser
 * asks for it natively and remembers it. Only the password is checked;
 * any username works. It travels with every request, which is why the
 * server should be on HTTPS (DEPLOYING.md step 6).
 */
function requirePassword(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).type('text/plain').send(
      'The dev page is switched off.\n\n' +
      'Set ADMIN_PASSWORD in docker-compose.yml, then run: docker compose up -d\n'
    );
  }

  const [scheme, encoded] = (req.headers.authorization || '').split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const password = decoded.slice(decoded.indexOf(':') + 1);   // "username:password"

    if (safeEqual(password, ADMIN_PASSWORD)) return next();
    console.warn('[dev] wrong password from ' + req.ip);
  }

  res.set('WWW-Authenticate', 'Basic realm="CS++ Flappy dev", charset="UTF-8"');
  return res.status(401).type('text/plain').send('Password required.\n');
}

app.use('/dev', requirePassword);

// Keep student numbers out of browser and proxy caches, and out of
// search engines.
app.use('/dev', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

app.get('/dev', (req, res) => sendPage(res, 'dev.html'));

/**
 * GET /dev/api/players
 * Every player with their student number and attempt figures, plus the
 * monitor's totals. server_time lets the page work out "3m ago" without
 * trusting the clock of the laptop viewing it.
 */
app.get('/dev/api/players', (req, res) => {
  try {
    return res.json({
      players: getAllPlayers(),
      stats: getDevStats(),
      server_time: Date.now(),
      uptime_secs: Math.floor(process.uptime())
    });
  } catch (err) {
    console.error('GET /dev/api/players failed:', err);
    return res.status(500).json({ error: 'Could not load players.' });
  }
});

/** The :studentNumber route parameter, validated, or null. */
function studentNumberParam(req) {
  const value = cleanString(req.params.studentNumber).toUpperCase();
  return STUDENT_NUMBER_PATTERN.test(value) ? value : null;
}

/**
 * GET /dev/api/players/:studentNumber/runs
 * One player's attempts, newest first.
 */
app.get('/dev/api/players/:studentNumber/runs', (req, res) => {
  const studentNumber = studentNumberParam(req);
  if (!studentNumber) return res.status(400).json({ error: 'Invalid student number.' });

  try {
    return res.json({ runs: getPlayerRuns(studentNumber) });
  } catch (err) {
    console.error('GET /dev/api/players/:id/runs failed:', err);
    return res.status(500).json({ error: 'Could not load attempts.' });
  }
});

/**
 * DELETE /dev/api/players/:studentNumber
 * Removes a player and all of their attempts.
 */
app.delete('/dev/api/players/:studentNumber', (req, res) => {
  const studentNumber = studentNumberParam(req);
  if (!studentNumber) return res.status(400).json({ error: 'Invalid student number.' });

  try {
    if (!deletePlayer(studentNumber)) return res.status(404).json({ error: 'No such player.' });

    // Deletions cannot be undone, so leave a trail in the logs.
    console.warn('[dev] deleted player ' + studentNumber);
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /dev/api/players/:id failed:', err);
    return res.status(500).json({ error: 'Could not delete player.' });
  }
});

/**
 * DELETE /dev/api/runs/:id
 * Removes one attempt and recomputes that player's best score. Their
 * only attempt takes the player with it.
 */
app.delete('/dev/api/runs/:id', (req, res) => {
  const id = /^\d+$/.test(req.params.id) ? Number(req.params.id) : 0;
  if (id < 1) return res.status(400).json({ error: 'Invalid attempt id.' });

  try {
    const result = deleteRun(id);
    if (!result.deleted) return res.status(404).json({ error: 'No such attempt.' });

    console.warn('[dev] deleted attempt ' + id + ' of ' + result.student_number +
      (result.player_removed ? ', their last, so the player was removed too' : ''));
    return res.json(result);
  } catch (err) {
    console.error('DELETE /dev/api/runs/:id failed:', err);
    return res.status(500).json({ error: 'Could not delete attempt.' });
  }
});

/**
 * Quote a value for CSV. Also defuses spreadsheet formulas: a player
 * named "=HYPERLINK(...)" would otherwise run as a formula when the
 * export is opened in Excel or Sheets.
 */
function csvField(value) {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

/**
 * GET /dev/players.csv
 * Every player, best first, as a spreadsheet download.
 */
app.get('/dev/players.csv', (req, res) => {
  try {
    const lines = [
      'rank,name,student_number,best_score,attempts,avg_score,first_played_utc,last_played_utc'
    ];

    getAllPlayers().forEach((p, i) => {
      lines.push([
        i + 1, csvField(p.name), p.student_number, p.best_score,
        p.run_count, p.avg_score, p.first_played || '', p.last_played || ''
      ].join(','));
    });

    const date = new Date().toISOString().slice(0, 10);
    res.attachment(`cspp-flappy-players-${date}.csv`);
    // The byte-order mark makes Excel read the file as UTF-8, so names
    // with fadas (Seán, Ní Bhriain) come through intact.
    const bom = String.fromCharCode(0xFEFF);
    return res.send(bom + lines.join('\r\n') + '\r\n');
  } catch (err) {
    console.error('GET /dev/players.csv failed:', err);
    return res.status(500).type('text/plain').send('Could not export players.\n');
  }
});

/* ---------------------------------------------------------------
   Start
   --------------------------------------------------------------- */

app.listen(PORT, () => {
  console.log(`CS++ Flappy running at http://localhost:${PORT}`);
  console.log('Stand screen: /display   Dev page: /dev');
  console.log(`Database: ${DB_PATH}`);
});
