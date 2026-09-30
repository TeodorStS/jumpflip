'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../public/sim');
const { createTicketStore, decodeFlaps, verifyRun, CLOCK_SLACK_MS } = require('../runs');
const { autopilot, toDeltas } = require('./autopilot');

/** A ticket store on a clock the test moves by hand. */
function fakeClockStore(options) {
  let now = 1_000_000;
  const store = createTicketStore({ now: () => now, ...options });
  return { store, advance: (ms) => { now += ms; }, now: () => now };
}

/** Real-time duration of a run, in ms. */
const msFor = (ticks) => ticks / Sim.TICK_RATE * 1000;

/* --- Tickets --------------------------------------------------- */

test('a ticket can be used once', () => {
  const { store } = fakeClockStore();
  const { game_id, seed } = store.issue();

  assert.equal(store.take(game_id).seed, seed);
  assert.equal(store.take(game_id), null);
});

test('unknown and expired tickets are refused', () => {
  const { store, advance } = fakeClockStore({ ttlMs: 1000 });
  const { game_id } = store.issue();

  assert.equal(store.take('not-a-real-id'), null);
  assert.equal(store.take(undefined), null);

  advance(1001);
  assert.equal(store.take(game_id), null);
});

test('open tickets are capped, oldest dropped first', () => {
  const { store } = fakeClockStore({ max: 3 });
  const first = store.issue();
  for (let i = 0; i < 5; i++) store.issue();

  assert.ok(store.size <= 3);
  assert.equal(store.take(first.game_id), null);
});

/* --- Flap decoding --------------------------------------------- */

test('flaps decode from gaps into ticks', () => {
  assert.deepEqual(decodeFlaps([3, 40, 38]), { ok: true, ticks: [3, 43, 81] });
  assert.deepEqual(decodeFlaps([]), { ok: true, ticks: [] });
  assert.deepEqual(decodeFlaps([0]), { ok: true, ticks: [0] });
});

test('malformed flaps are rejected', () => {
  for (const bad of [null, 'nope', { 0: 1 }, [-1], [1.5], ['3'], [3, 0], [3, -2], [1e12]]) {
    assert.equal(decodeFlaps(bad).ok, false, JSON.stringify(bad));
  }
});

/* --- Verifying runs -------------------------------------------- */

test('an honest run is accepted with the replayed score', () => {
  const { store, advance, now } = fakeClockStore();
  const ticket = store.issue();
  const run = autopilot(ticket.seed, Sim.TICK_RATE * 60);

  advance(msFor(run.ticks) + 500);   // the time it took to play
  const verdict = verifyRun(store.take(ticket.game_id), run.flapTicks, now());

  assert.deepEqual(verdict, { ok: true, score: run.score, ticks: run.ticks });
});

test('a run submitted faster than it could have been played is rejected', () => {
  const { store, advance, now } = fakeClockStore();
  const ticket = store.issue();
  const run = autopilot(ticket.seed, Sim.TICK_RATE * 60);
  assert.ok(run.ticks > Sim.TICK_RATE * 10, 'needs a run long enough to matter');

  // A bot computed the whole run in five seconds.
  advance(5000);
  const verdict = verifyRun(store.take(ticket.game_id), run.flapTicks, now());

  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /longer than the time/);
});

test('the clock slack is small next to a real run', () => {
  assert.ok(CLOCK_SLACK_MS <= 5000);
});

test('flaps after the crash are rejected', () => {
  const { store, advance, now } = fakeClockStore();
  const ticket = store.issue();
  const run = autopilot(ticket.seed, Sim.TICK_RATE * 60);

  advance(msFor(run.ticks) + 60000);
  const padded = run.flapTicks.concat([run.ticks + 10, run.ticks + 50]);
  const verdict = verifyRun(store.take(ticket.game_id), padded, now());

  assert.equal(verdict.ok, false);
});

test('flaps for a different seed do not carry their score', () => {
  const { store, advance, now } = fakeClockStore();
  const ticket = store.issue();
  // A good run, but for pipes this ticket doesn't have.
  const other = autopilot(ticket.seed + 1, Sim.TICK_RATE * 60);

  advance(msFor(other.ticks) + 60000);
  const verdict = verifyRun(store.take(ticket.game_id), other.flapTicks, now());

  assert.ok(!verdict.ok || verdict.score < other.score);
});

test('the browser-claimed score plays no part in the verdict', () => {
  const { store, advance, now } = fakeClockStore();
  const ticket = store.issue();
  advance(3000);

  // No flaps at all: the bird falls and scores 0, whatever is claimed.
  const verdict = verifyRun(store.take(ticket.game_id), [], now());
  assert.deepEqual({ ok: verdict.ok, score: verdict.score }, { ok: true, score: 0 });
});

test('the flaps sent over the wire round-trip', () => {
  const run = autopilot(11, Sim.TICK_RATE * 30);
  assert.deepEqual(decodeFlaps(toDeltas(run.flapTicks)).ticks, run.flapTicks);
});
