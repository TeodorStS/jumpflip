'use strict';

/* End-to-end tests against the real server, on a throwaway database.
   Each attack here is one that worked before runs were verified. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Sim = require('../public/sim');
const { autopilot, toDeltas } = require('./autopilot');

// Before requiring the server: it opens the database and reads the
// password as it loads.
process.env.DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flappy-test-'));
process.env.ADMIN_PASSWORD = 'test-password-long-enough';

const app = require('../server');
const PLAYER = { student_number: 'C00000001', name: 'Test Player' };

let server;
let base;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => server.close());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, body) {
  const res = await fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function newTicket() {
  const res = await post('/api/game');
  assert.equal(res.status, 201);
  return res.body;
}

async function bestScore(name) {
  const res = await fetch(base + '/api/leaderboard?limit=100');
  const row = (await res.json()).find((p) => p.name === name);
  return row ? row.best_score : null;
}

/* --- The attacks from the event -------------------------------- */

test('posting a bare score, as at the event, is refused', async () => {
  const res = await post('/api/score', { ...PLAYER, score: 99999 });

  assert.equal(res.status, 400);
  assert.equal(await bestScore(PLAYER.name), null);
});

test('claiming a score the run did not earn records what it did earn', async () => {
  const ticket = await newTicket();
  await sleep(2000);   // time for a no-flap run: the bird drops in about a second

  const res = await post('/api/score', {
    ...PLAYER, game_id: ticket.game_id, flaps: [], score: 500
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.score, 0);
  assert.equal(await bestScore(PLAYER.name), 0);
});

test('a ticket cannot be submitted twice', async () => {
  const ticket = await newTicket();
  await sleep(2000);
  const run = { ...PLAYER, game_id: ticket.game_id, flaps: [] };

  assert.equal((await post('/api/score', run)).status, 200);
  assert.equal((await post('/api/score', run)).status, 409);
});

test('a made-up game id is refused', async () => {
  const res = await post('/api/score', { ...PLAYER, game_id: 'made-up', flaps: [] });
  assert.equal(res.status, 409);
});

test('a perfect run computed by a bot and sent at once is refused', async () => {
  const ticket = await newTicket();
  const run = autopilot(ticket.seed, Sim.TICK_RATE * 60);
  assert.ok(run.score > 5);

  const res = await post('/api/score', {
    student_number: 'C00000002', name: 'Speedy Bot',
    game_id: ticket.game_id, flaps: toDeltas(run.flapTicks), score: run.score
  });

  assert.equal(res.status, 422);
  assert.equal(await bestScore('Speedy Bot'), null);
});

test('garbage flaps are refused', async () => {
  const ticket = await newTicket();
  const res = await post('/api/score', { ...PLAYER, game_id: ticket.game_id, flaps: [5, 0, 0] });
  assert.equal(res.status, 400);
});

test('the public leaderboard never shows student numbers', async () => {
  const rows = await (await fetch(base + '/api/leaderboard?limit=100')).json();
  assert.ok(rows.length > 0);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['best_score', 'name']);
});

test('each ticket has its own seed', async () => {
  const seeds = new Set();
  for (let i = 0; i < 5; i++) seeds.add((await newTicket()).seed);
  assert.equal(seeds.size, 5);
});

/* --- The dev page ---------------------------------------------- */

test('the dev password cannot be brute-forced', async () => {
  const auth = (password) => ({ Authorization: 'Basic ' + Buffer.from('admin:' + password).toString('base64') });

  assert.equal((await fetch(base + '/dev/api/players', { headers: auth('test-password-long-enough') })).status, 200);

  for (let i = 0; i < 10; i++) {
    assert.equal((await fetch(base + '/dev/api/players', { headers: auth('guess' + i) })).status, 401);
  }

  // Locked out now, even with the right password.
  assert.equal((await fetch(base + '/dev/api/players', { headers: auth('test-password-long-enough') })).status, 429);
});

/* --- Floods (last: it uses up this IP's allowance) ------------- */

test('a flood of ticket requests is cut off', async () => {
  const statuses = [];
  for (let i = 0; i < 320; i++) statuses.push((await post('/api/game')).status);

  assert.ok(statuses.includes(429));
});
