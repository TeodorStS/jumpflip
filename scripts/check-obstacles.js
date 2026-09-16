#!/usr/bin/env node
/* ===============================================================
   Verify obstacle interior detail does not flicker.

     node scripts/check-obstacles.js

   Server racks and bookshelves have randomised interiors (LED states,
   book widths and spine colours). That randomness must be derived from
   a seed fixed when the obstacle is created — NOT from its x position,
   which changes every frame as it scrolls. Hashing a moving value
   re-rolls the detail every frame and the obstacle visibly flickers.

   This is a static check: it reads public/game.js and confirms the
   seeding is structurally correct. No browser needed, so it runs
   anywhere with plain Node.
   =============================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const GAME = path.join(__dirname, '..', 'public', 'game.js');
const src = fs.readFileSync(GAME, 'utf8');

let failures = 0;

function pass(msg) { console.log('  ok    ' + msg); }
function fail(msg, detail) {
  console.log('  FAIL  ' + msg);
  if (detail) console.log('        ' + detail);
  failures++;
}

/** Extract one function's source by brace matching. */
function body(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) return null;
  let depth = 0;
  let i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

console.log('\nChecking obstacle seeding in public/game.js\n');

// 1. Pipes must carry a stable seed created once.
if (/seed:\s*Math\.floor\(Math\.random\(\)\s*\*/.test(src)) {
  pass('makePipe assigns a fixed seed at creation');
} else {
  fail('makePipe does not assign a stable `seed` property',
       'Interior detail needs a value that never changes after creation.');
}

// 2. That seed must reach the functions that use it.
if (/drawComponent\([^)]*\bseed\b[^)]*\)/.test(src) &&
    /case 'rack': drawRack\([^)]*seed\)/.test(src) &&
    /case 'shelf': drawShelf\([^)]*seed\)/.test(src)) {
  pass('seed is threaded through drawComponent to rack and shelf');
} else {
  fail('seed is not passed through to drawRack / drawShelf');
}

// 3. Neither function may hash the scrolling x coordinate.
for (const name of ['drawRack', 'drawShelf']) {
  const fn = body(name);
  if (!fn) { fail(name + ' not found'); continue; }

  // The giveaway pattern: a seed derived from x.
  if (/(Seed|seed)\s*=\s*[^;]*\bMath\.floor\(x\)/.test(fn) ||
      /hash01\([^)]*\bx\b[^)]*\)/.test(fn)) {
    fail(name + ' derives interior detail from the scrolling x position',
         'x changes every frame, so the detail re-rolls every frame (flicker).');
  } else {
    pass(name + ' does not hash the scrolling x position');
  }

  // And it must actually use the passed-in seed.
  if (/\bseed\b/.test(fn)) {
    pass(name + ' uses the stable seed');
  } else {
    fail(name + ' never references the seed parameter');
  }
}

// 4. The obstacle bitmap cache keeps the seed in its key, otherwise two
//    different obstacles would share one cached image.
if (/const key = type \+[^;]*seed/.test(src)) {
  pass('component cache key includes the seed');
} else {
  fail('component cache key does not include the seed',
       'Different obstacles would collide on one cached bitmap.');
}

console.log('');
if (failures) {
  console.log('  ' + failures + ' check(s) failed.\n');
  process.exit(1);
}
console.log('  Obstacle detail is frame-stable.\n');
