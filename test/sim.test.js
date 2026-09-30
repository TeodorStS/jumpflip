'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('../public/sim');
const { autopilot } = require('./autopilot');

test('a replay reproduces the run exactly, tick for tick', () => {
  for (const seed of [1, 2, 42, 2 ** 32 - 1]) {
    const run = autopilot(seed, Sim.TICK_RATE * 60);
    const replay = Sim.replay(seed, run.flapTicks, Sim.TICK_RATE * 120);

    assert.equal(replay.score, run.score);
    assert.equal(replay.ticks, run.ticks);
    assert.equal(replay.over, run.over);
    assert.equal(replay.flapsUsed, run.flapTicks.length);
  }
});

test('the seed decides the pipes', () => {
  const gaps = (seed) => Sim.create(seed).pipes.map((p) => p.gapY);

  assert.deepEqual(gaps(7), gaps(7));
  assert.notDeepEqual(gaps(7), gaps(8));
});

test('every gap stays inside the playfield margins', () => {
  const game = Sim.create(99);
  // Fly forever with collisions ignored, just to generate lots of pipes.
  for (let i = 0; i < 5000; i++) {
    for (const p of game.pipes) {
      assert.ok(p.gapY >= Sim.PIPE_MARGIN);
      assert.ok(p.gapY + Sim.PIPE_GAP <= Sim.GROUND_Y - Sim.PIPE_MARGIN);
    }
    game.over = false;
    game.y = Sim.VIEW_H / 2;
    Sim.step(game, false);
  }
});

test('without flapping the bird hits the ground within two seconds, scoring 0', () => {
  const run = Sim.replay(5, [], Sim.TICK_RATE * 10);

  assert.equal(run.over, true);
  assert.equal(run.score, 0);
  assert.ok(run.ticks < Sim.TICK_RATE * 2);
});

test('the autopilot scores, so honest runs have points to verify', () => {
  assert.ok(autopilot(1, Sim.TICK_RATE * 60).score > 10);
});
