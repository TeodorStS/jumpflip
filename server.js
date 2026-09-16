/* ===============================================================
   CS++ Flappy — API server
   Express + better-sqlite3. Serves the static game from ./public
   and exposes the score/leaderboard API.

   Endpoints:
     POST /api/score        { student_number, name, score }
     GET  /api/leaderboard?limit=10
   =============================================================== */

'use strict';

const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const { submitScore, getLeaderboard, getStats, DB_PATH } = require('./db');

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

// Serve the game itself.
app.use(express.static(path.join(__dirname, 'public')));

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

/* Friendly alias for the stand display, so it can be typed from memory
   onto a venue laptop. display.html is also served directly by the static
   middleware above. */
app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

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
   Start
   --------------------------------------------------------------- */

app.listen(PORT, () => {
  console.log(`CS++ Flappy running at http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
});
