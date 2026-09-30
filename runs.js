/* ===============================================================
   CS++ Flappy — run verification (the anti-cheat)

   The browser never tells the server a score. It tells it what the
   player DID — which ticks they flapped on — and the server replays
   that through the same simulation the browser ran (public/sim.js)
   and scores the run itself.

     1. Before a run the browser asks for a ticket: a random game id
        and seed. The seed decides every pipe, so a layout can't be
        picked, and each ticket can be used for one submission only.
     2. After the run it sends the ticket and its flaps. The server
        replays them from the seed. The replayed score is the one
        recorded; whatever score the browser claims is only compared,
        to flag tampering in the logs.
     3. A run can't have lasted longer than the time since its ticket
        was issued. The browser's clock can only run the game slower
        than real time, so a replay that is longer than that was
        computed rather than played — a bot rushing out a perfect run.

   What this cannot stop is a bot that plays live, in real time, with
   no faster-than-real-time help. That takes real effort per run, and
   the dev page can delete anything that gets through.
   =============================================================== */

'use strict';

const crypto = require('crypto');
const Sim = require('./public/sim');

const TICKET_TTL_MS = 2 * 60 * 60 * 1000;   // a run must be submitted within 2h
const MAX_OPEN_TICKETS = 50000;             // bounded memory, even under a flood
const MAX_RUN_TICKS = Sim.TICK_RATE * 60 * 60;   // one hour of play
const MAX_FLAPS = 30000;
const CLOCK_SLACK_MS = 2000;                // network and timer jitter

/**
 * Issued tickets, in memory. A restart forgets them, so a run in
 * progress during a deploy can't be saved — acceptable for a game.
 *
 * `now` is injectable so tests can move the clock.
 */
function createTicketStore({ now = Date.now, ttlMs = TICKET_TTL_MS, max = MAX_OPEN_TICKETS } = {}) {
  const tickets = new Map();   // game_id -> { seed, issuedAt }; insertion order = age

  function prune() {
    const cutoff = now() - ttlMs;
    for (const [id, t] of tickets) {
      if (t.issuedAt >= cutoff && tickets.size < max) break;   // the rest are newer
      tickets.delete(id);
    }
  }

  return {
    /** A new ticket: { game_id, seed }. */
    issue() {
      prune();
      const ticket = { game_id: crypto.randomUUID(), seed: crypto.randomInt(0, 2 ** 32) };
      tickets.set(ticket.game_id, { seed: ticket.seed, issuedAt: now() });
      return ticket;
    },

    /** Use up a ticket. Returns { seed, issuedAt }, or null if unknown, used or expired. */
    take(gameId) {
      const t = typeof gameId === 'string' ? tickets.get(gameId) : undefined;
      if (!t) return null;
      tickets.delete(gameId);
      return now() - t.issuedAt > ttlMs ? null : t;
    },

    get size() { return tickets.size; },
    now
  };
}

/**
 * Flaps arrive as gaps between flap ticks, which keeps long runs small:
 * [3, 40, 38] means ticks 3, 43, 81.
 * @returns {{ ok: true, ticks: number[] } | { ok: false, error: string }}
 */
function decodeFlaps(deltas) {
  if (!Array.isArray(deltas)) return { ok: false, error: 'flaps must be an array.' };
  if (deltas.length > MAX_FLAPS) return { ok: false, error: 'Too many flaps.' };

  const ticks = new Array(deltas.length);
  let tick = 0;

  for (let i = 0; i < deltas.length; i++) {
    const d = deltas[i];
    // At most one flap per tick, so every gap after the first is at least 1.
    if (!Number.isInteger(d) || d < (i === 0 ? 0 : 1)) {
      return { ok: false, error: 'flaps must be increasing whole numbers.' };
    }
    tick += d;
    if (tick > MAX_RUN_TICKS) return { ok: false, error: 'Run is too long.' };
    ticks[i] = tick;
  }

  return { ok: true, ticks };
}

/**
 * Replay a run and decide whether to accept it.
 *
 * @param {{ seed: number, issuedAt: number }} ticket  from store.take()
 * @param {number[]} flapTicks  decoded flap ticks
 * @param {number} submittedAt  ms timestamp of the submission
 * @returns {{ ok: true, score: number, ticks: number }
 *          | { ok: false, error: string }}
 */
function verifyRun(ticket, flapTicks, submittedAt) {
  // The run can't have lasted longer than the time since the ticket was
  // issued, so never simulate more than that. This also bounds the CPU a
  // single request can cost.
  const elapsedMs = submittedAt - ticket.issuedAt + CLOCK_SLACK_MS;
  const allowedTicks = Math.min(MAX_RUN_TICKS, Math.floor(elapsedMs / 1000 * Sim.TICK_RATE));

  const run = Sim.replay(ticket.seed, flapTicks, allowedTicks);

  if (!run.over) {
    // Still flying when the clock ran out: either the flaps go on longer
    // than real time allows (computed, not played), or the run never ended.
    return { ok: false, error: 'This run is longer than the time it was played for.' };
  }
  if (run.flapsUsed !== flapTicks.length) {
    // An honest client stops recording when the bird crashes.
    return { ok: false, error: 'This run does not match its replay.' };
  }

  return { ok: true, score: run.score, ticks: run.ticks };
}

module.exports = {
  createTicketStore,
  decodeFlaps,
  verifyRun,
  MAX_RUN_TICKS,
  CLOCK_SLACK_MS
};
