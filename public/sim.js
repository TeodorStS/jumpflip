/* ===============================================================
   CS++ Flappy — game simulation (shared by browser and server)

   The rules of the game — physics, pipes, scoring, collisions — with
   no drawing. The browser runs it to play. The server runs this SAME
   file to replay a finished run from its seed and its list of flaps,
   and works the score out itself. The number the browser reports is
   never trusted, so editing the game in devtools or posting a made-up
   score gets nowhere.

   Deterministic by construction, so a replay always ends exactly where
   the player's game did:
     - fixed timestep (TICK_RATE steps a second), never frame-rate dt
     - pipe gaps come from a hash of (seed, pipe number), never
       Math.random, and never from when a pipe happened to be recycled
     - only + - * / and Math.min/max on doubles, which every JS engine
       computes bit-for-bit the same (IEEE 754); no sin, cos or pow

   Loaded with a <script> tag in the browser (window.FlappySim) and
   with require() in Node.
   =============================================================== */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlappySim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* --- Tuning ---------------------------------------------------- */

  // Virtual playfield. All game logic runs in this coordinate space and is
  // scaled to the real canvas at draw time. Portrait, phone-shaped.
  const VIEW_W = 360;
  const VIEW_H = 640;

  const TICK_RATE = 120;         // simulation steps per second

  // Physics
  const GRAVITY        = 1500;   // downward accel, units/sec^2
  const FLAP_STRENGTH  = 430;    // upward velocity applied on a flap, units/sec
  const MAX_FALL_SPEED = 800;    // terminal velocity so a long drop stays survivable

  // Bird
  const BIRD_X       = 90;       // fixed horizontal position of the bird
  const BIRD_RADIUS  = 16;       // collision radius
  // Starting height, as a fraction of the playfield: low enough that the
  // mascot rests below the start-screen panels.
  const BIRD_START_Y = 0.62;

  // Pipes
  const PIPE_GAP     = 160;      // vertical opening the bird flies through
  const PIPE_WIDTH   = 60;
  const PIPE_SPACING = 210;      // horizontal distance between consecutive pipes
  const PIPE_SPEED   = 150;      // scroll speed, units/sec
  const PIPE_MARGIN  = 70;       // min distance from gap edge to ceiling/ground

  const GROUND_HEIGHT = 90;
  const GROUND_Y = VIEW_H - GROUND_HEIGHT;   // y of the top of the ground

  const FIRST_PIPE_X = VIEW_W + 60;
  const PIPE_COUNT = 3;          // pipes alive at once; enough to fill the screen
  // A pipe is recycled once fully left of the playfield. The canvas uses
  // "cover" scaling, which crops rather than extends, so x < 0 is never
  // visible and this margin is the same on every screen.
  const CULL_X = -20;

  /* --- Randomness ------------------------------------------------ */

  /**
   * Uniform number in [0, 1) for pipe `index` of the game seeded `seed`
   * (a mulberry32 step over both). Integer-only, so every engine agrees.
   */
  function random01(seed, index) {
    let t = (seed + Math.imul(index + 1, 0x9E3779B9) + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** y of the top of the gap for pipe `index`. */
  function gapTop(seed, index) {
    const min = PIPE_MARGIN;
    const max = GROUND_Y - PIPE_GAP - PIPE_MARGIN;
    return min + random01(seed, index) * (max - min);
  }

  /* --- Game ------------------------------------------------------ */

  function addPipe(game, x) {
    const index = game.nextPipe++;
    game.pipes.push({ index: index, x: x, gapY: gapTop(game.seed, index), scored: false });
  }

  /**
   * A new game, bird mid-hop: a run starts with a flap rather than an
   * instant drop.
   */
  function create(seed) {
    const game = {
      seed: seed >>> 0,
      tick: 0,
      y: VIEW_H * BIRD_START_Y,
      velocity: -FLAP_STRENGTH,
      score: 0,
      over: false,
      pipes: [],
      nextPipe: 0
    };
    for (let i = 0; i < PIPE_COUNT; i++) addPipe(game, FIRST_PIPE_X + i * PIPE_SPACING);
    return game;
  }

  // Standard circle/AABB test: clamp the circle centre to the rect, then
  // compare that distance against the radius.
  function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
    const nearestX = Math.max(rx, Math.min(cx, rx + rw));
    const nearestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nearestX;
    const dy = cy - nearestY;
    return dx * dx + dy * dy < r * r;
  }

  function crashed(game) {
    // The top of the playfield is solid, so the bird can't climb out of
    // the level and skip pipes.
    if (game.y - BIRD_RADIUS <= 0 || game.y + BIRD_RADIUS >= GROUND_Y) return true;

    for (const p of game.pipes) {
      if (BIRD_X + BIRD_RADIUS < p.x || BIRD_X - BIRD_RADIUS > p.x + PIPE_WIDTH) continue;
      if (circleHitsRect(BIRD_X, game.y, BIRD_RADIUS, p.x, 0, PIPE_WIDTH, p.gapY)) return true;
      const lowerY = p.gapY + PIPE_GAP;
      if (circleHitsRect(BIRD_X, game.y, BIRD_RADIUS, p.x, lowerY, PIPE_WIDTH, GROUND_Y - lowerY)) return true;
    }
    return false;
  }

  /** Advance one tick. `flap` is whether the player flapped this tick. */
  function step(game, flap) {
    if (game.over) return;

    if (flap) game.velocity = -FLAP_STRENGTH;
    game.velocity = Math.min(game.velocity + GRAVITY / TICK_RATE, MAX_FALL_SPEED);
    game.y += game.velocity / TICK_RATE;

    for (const p of game.pipes) {
      p.x -= PIPE_SPEED / TICK_RATE;
      // Score the moment the pipe's right edge clears the bird.
      if (!p.scored && p.x + PIPE_WIDTH < BIRD_X) {
        p.scored = true;
        game.score++;
      }
    }

    // Recycle pipes that have left the playfield, keeping spacing constant.
    // This is what makes the field endless.
    while (game.pipes[0].x + PIPE_WIDTH < CULL_X) {
      game.pipes.shift();
      addPipe(game, game.pipes[game.pipes.length - 1].x + PIPE_SPACING);
    }

    game.tick++;
    if (crashed(game)) game.over = true;
  }

  /**
   * Play a whole run back: `flapTicks` are the ticks (ascending) on which
   * the player flapped. Stops when the bird crashes or at `maxTicks`.
   * @returns {{ score: number, ticks: number, over: boolean, flapsUsed: number }}
   */
  function replay(seed, flapTicks, maxTicks) {
    const game = create(seed);
    let next = 0;

    while (!game.over && game.tick < maxTicks) {
      const flap = next < flapTicks.length && flapTicks[next] === game.tick;
      if (flap) next++;
      step(game, flap);
    }

    return { score: game.score, ticks: game.tick, over: game.over, flapsUsed: next };
  }

  return {
    TICK_RATE, VIEW_W, VIEW_H,
    GRAVITY, FLAP_STRENGTH, MAX_FALL_SPEED,
    BIRD_X, BIRD_RADIUS, BIRD_START_Y,
    PIPE_GAP, PIPE_WIDTH, PIPE_SPACING, PIPE_SPEED, PIPE_MARGIN,
    GROUND_HEIGHT, GROUND_Y,
    create, step, replay
  };
});
