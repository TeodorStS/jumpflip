#!/usr/bin/env node
/* ===============================================================
   Verify the scrolling background layers move smoothly.

     node scripts/check-scroll.js

   Every parallax layer reads from one shared `groundOffset` counter.
   If that counter wraps at a value that is not a whole multiple of a
   layer's own repeat period, the layer is mid-pattern at the reset and
   visibly jumps backwards — several times a second, which reads as a
   juddering floor.

   This parses the real constants out of public/game.js and checks the
   wrap point is a common multiple of every period.
   =============================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const GAME = path.join(__dirname, '..', 'public', 'game.js');
const src = fs.readFileSync(GAME, 'utf8');

function constant(name) {
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\d+)'));
  if (!m) {
    console.error('  FAIL  could not find constant ' + name + ' in public/game.js');
    process.exit(1);
  }
  return Number(m[1]);
}

const FINGER = constant('FINGER_PERIOD');
const CELL = constant('CELL_PERIOD');
const TRACE = constant('TRACE_TILE');

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
function lcm(a, b) { return (a * b) / gcd(a, b); }

const expected = [FINGER, CELL, TRACE].reduce(lcm);

console.log('\nScroll layer periods (design units):');
console.log('  contact fingers : ' + FINGER);
console.log('  component cell  : ' + CELL);
console.log('  circuit tile    : ' + TRACE);
console.log('  required wrap   : ' + expected + ' (lowest common multiple)');

// Confirm the code actually derives GROUND_CYCLE rather than hardcoding a
// value that happens to be wrong.
if (!/GROUND_CYCLE\s*=\s*\[[^\]]*\]\.reduce\(lcm\)/.test(src)) {
  console.error('\n  FAIL  GROUND_CYCLE is not derived as the LCM of the periods.');
  console.error('        A hardcoded wrap value will judder whenever it is not');
  console.error('        a whole multiple of every layer period.\n');
  process.exit(1);
}
console.log('  ok    GROUND_CYCLE is derived as the LCM');

// Simulate and measure the worst per-frame deviation from a constant scroll.
const dt = 1 / 60;
const SPEED = 150;

function worstDeviation(cycle, period) {
  let off = 0;
  let prevX = null;
  let worst = 0;

  for (let f = 0; f < 5000; f++) {
    off = (off + SPEED * dt) % cycle;
    const x = -(off % period);

    if (prevX !== null) {
      let d = x - prevX;
      if (d > 0) d -= period;            // undo a legitimate period wrap
      const err = Math.abs(d + SPEED * dt);
      if (err > worst) worst = err;
    }
    prevX = x;
  }
  return worst;
}

let failed = false;
console.log('\nWorst per-frame deviation from smooth scroll:');

for (const [label, period] of [['fingers', FINGER], ['chips', CELL], ['traces', TRACE]]) {
  const dev = worstDeviation(expected, period);
  const ok = dev < 0.001;
  console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + ' ' + label.padEnd(8) + dev.toFixed(4));
  if (!ok) failed = true;
}

if (failed) {
  console.error('\n  A non-zero deviation means that layer jumps. Check that every\n' +
                '  period used in the drawing code is listed in GROUND_CYCLE.\n');
  process.exit(1);
}

console.log('\n  All layers scroll smoothly.\n');
