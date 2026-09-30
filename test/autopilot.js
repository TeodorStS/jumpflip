'use strict';

/* A simple bot that plays the real simulation: flap whenever the bird is
   falling below the next gap. It makes honest runs for the tests to
   submit, the same way a real player's browser would. */

const Sim = require('../public/sim');

/**
 * Play seed `seed`, flapping for up to `maxTicks`, then stop and let the
 * bird crash — a finished run, like every run a browser submits.
 * @returns {{ score: number, ticks: number, over: boolean, flapTicks: number[] }}
 */
function autopilot(seed, maxTicks = Sim.TICK_RATE * 60 * 5) {
  const game = Sim.create(seed);
  const flapTicks = [];

  while (!game.over) {
    const next = game.pipes.find((p) => p.x + Sim.PIPE_WIDTH > Sim.BIRD_X - Sim.BIRD_RADIUS);
    const flap = game.tick < maxTicks &&
      game.y > next.gapY + Sim.PIPE_GAP * 0.7 && game.velocity > 0;
    if (flap) flapTicks.push(game.tick);
    Sim.step(game, flap);
  }

  return { score: game.score, ticks: game.tick, over: game.over, flapTicks };
}

/** Flap ticks as the browser sends them: gaps between flaps. */
function toDeltas(flapTicks) {
  return flapTicks.map((t, i) => (i === 0 ? t : t - flapTicks[i - 1]));
}

module.exports = { autopilot, toDeltas };
