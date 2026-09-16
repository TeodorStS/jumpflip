#!/usr/bin/env node
/* ===============================================================
   Verify public/mascot.png after dropping in the real artwork.

     node scripts/check-mascot.js

   Checks the file exists, is a real PNG (or JPEG/WebP), reports its
   dimensions and whether it has an alpha channel, and warns if it is
   still the generated placeholder.
   =============================================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TARGET = path.join(PUBLIC_DIR, 'mascot.png');
const PLACEHOLDER = path.join(PUBLIC_DIR, 'mascot-PLACEHOLDER-delete-me.png');

function fail(msg) {
  console.error('\n  FAIL  ' + msg + '\n');
  process.exit(1);
}

function ok(msg) {
  console.log('  ok    ' + msg);
}

console.log('\nChecking ' + TARGET);

if (!fs.existsSync(TARGET)) {
  console.error('\n  FAIL  public/mascot.png does not exist yet.');
  console.error('\n  Save the CS++ mascot image to:');
  console.error('    ' + TARGET);
  if (fs.existsSync(PLACEHOLDER)) {
    console.error('\n  (A generated placeholder is sitting next to it as');
    console.error('   mascot-PLACEHOLDER-delete-me.png — the game will fall back');
    console.error('   to a plain circle until the real file is in place.)');
  }
  console.error('');
  process.exit(1);
}

const buf = fs.readFileSync(TARGET);
ok('file exists (' + buf.length + ' bytes)');

if (buf.length < 200) fail('file is suspiciously small — did the save complete?');

/* --- Format sniffing ------------------------------------------ */

const isPng = buf.length > 8 &&
  buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
const isWebp = buf.slice(0, 4).toString('ascii') === 'RIFF' &&
               buf.slice(8, 12).toString('ascii') === 'WEBP';

if (isPng) {
  ok('format: PNG');
} else if (isJpeg) {
  console.log('  warn  format: JPEG, not PNG.');
  console.log('        It will still load, but JPEG has no transparency, so the');
  console.log('        mascot will fly inside a visible rectangle. Re-save as PNG.');
} else if (isWebp) {
  console.log('  warn  format: WebP named .png. Modern browsers cope, but a real');
  console.log('        PNG is safer for older phones at the stand.');
} else {
  fail('not a recognised image (PNG/JPEG/WebP). Is this actually the picture?');
}

/* --- PNG dimensions and alpha --------------------------------- */

if (isPng) {
  // IHDR is always the first chunk: width/height are big-endian uint32
  // at byte 16, colour type at byte 25.
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colourType = buf[25];

  ok('dimensions: ' + width + ' x ' + height);

  if (width < 64 || height < 64) {
    console.log('  warn  quite small — it may look soft scaled up in game.');
  }

  const ratio = width / height;
  if (ratio < 0.6 || ratio > 1.7) {
    console.log('  warn  aspect ratio ' + ratio.toFixed(2) + ' is far from square.');
    console.log('        The sprite is drawn into a square, so it will look stretched.');
  } else {
    ok('aspect ratio is close enough to square');
  }

  // Colour types 4 and 6 carry an alpha channel.
  if (colourType === 4 || colourType === 6) {
    ok('has an alpha channel (transparent background)');
  } else {
    console.log('  warn  no alpha channel — the mascot will fly inside a solid');
    console.log('        rectangle of background colour. Re-export with transparency.');
  }
}

/* --- Is it still the placeholder? ----------------------------- */

if (fs.existsSync(PLACEHOLDER)) {
  const ph = fs.readFileSync(PLACEHOLDER);
  if (ph.equals(buf)) {
    fail('this is still the generated placeholder, not the real mascot.');
  }
  ok('not the generated placeholder');
  console.log('\n  You can now delete public/mascot-PLACEHOLDER-delete-me.png');
}

console.log('\n  Looks good. Start the server and check it in game:');
console.log('    npm start\n');
