/* ===============================================================
   CS++ Flappy — TU Dublin
   Vanilla canvas Flappy Bird clone. No frameworks, no build step.

   Layout of this file:
     1. TUNING CONSTANTS   <- balance the game here
     2. Canvas setup / resize
     3. Game state
     4. BIRD RENDERING     <- swap this for the mascot sprite
     5. Pipes
     6. Update / collision
     7. Draw
     8. Loop, input, UI wiring
   =============================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------
     1. TUNING CONSTANTS
     All physics/difficulty knobs live here. Everything is expressed
     in "design units" against a fixed virtual playfield (see below),
     so the feel is identical on a phone and on a desktop monitor
     regardless of the actual pixel size of the canvas.
     --------------------------------------------------------------- */

  // Virtual playfield. All game logic runs in this coordinate space and
  // is scaled to the real canvas at draw time. Portrait, phone-shaped.
  const VIEW_W = 360;
  const VIEW_H = 640;

  // --- Physics ---
  const GRAVITY        = 1500;   // downward accel, units/sec^2
  const FLAP_STRENGTH  = 430;    // upward velocity applied on a flap, units/sec
  const MAX_FALL_SPEED = 800;    // terminal velocity so a long drop stays survivable

  // --- Bird ---
  const BIRD_X          = 90;    // fixed horizontal position of the bird
  const BIRD_RADIUS     = 16;    // collision radius
  // Drawn noticeably larger than the collision circle: the mascot has a lot
  // of internal detail (face, headphones, CS++ jumper) that is lost at a
  // small size, and a generous sprite over a tight hitbox plays fairer than
  // the reverse. Raise BIRD_RADIUS instead if you want the game harder.
  const BIRD_DRAW_SCALE = 1.9;   // sprite size relative to the collision circle
  // Starting height, as a fraction of the playfield. Low enough that the
  // mascot rests below the start-screen panels instead of poking out
  // between them, while still leaving room to fall when play begins.
  const BIRD_START_Y    = 0.62;
  // Tilt limits are deliberately gentler than classic Flappy Bird: the
  // mascot is an upright character with a face, so a steep nose-dive reads
  // as "upside down" rather than "falling".
  const BIRD_MAX_TILT  = 0.6;    // radians, nose-down limit
  const BIRD_MIN_TILT  = -0.35;  // radians, nose-up limit

  // --- Pipes ---
  const PIPE_GAP       = 160;    // vertical opening the bird flies through
  const PIPE_WIDTH     = 60;
  const PIPE_SPACING   = 210;    // horizontal distance between consecutive pipes
  const PIPE_SPEED     = 150;    // scroll speed, units/sec
  const PIPE_MARGIN    = 70;     // min distance from gap edge to ceiling/ground

  // --- World ---
  const GROUND_HEIGHT  = 90;     // height of the ground strip at the bottom
  const GROUND_SCROLL  = PIPE_SPEED; // keep ground and pipes visually in sync

  /* Repeating periods of the scrolling background layers, in design units.
     Every layer reads from the same `groundOffset` accumulator, so that
     accumulator must wrap at a common multiple of all of them — otherwise
     a layer is mid-pattern when the counter resets and visibly jumps
     backwards. Keep these in sync with the drawing code that uses them. */
  const FINGER_PERIOD  = 14;     // gold contact fingers on the board edge
  const CELL_PERIOD    = 96;     // surface-mount component cell
  const TRACE_TILE     = 180;    // circuit-trace tile in the sky

  /** Greatest common divisor, for deriving the wrap period below. */
  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
  /** Lowest common multiple. */
  function lcm(a, b) { return (a * b) / gcd(a, b); }

  // Wrap point for groundOffset: large enough that every layer completes a
  // whole number of periods, so the reset is invisible.
  const GROUND_CYCLE = [FINGER_PERIOD, CELL_PERIOD, TRACE_TILE].reduce(lcm);

  /* --- Colours ---
     The WORLD is branded: sky and motherboard come from the CS++ mascot
     (jumper #05009d, gold #ffc901), so the bird belongs to the scene.

     The COMPONENTS are not. Real hardware isn't all one colour, and
     tinting every part blue made the obstacles indistinguishable. They
     keep their own materials and the brand carries through the backdrop
     and the gold accents instead.

     The sky is a lighter blue than the brand blue itself — obstacles and
     the mascot both need to stand out against it, so the deep blue is
     saved for the foreground. */
  const COLOR_SKY       = '#4a55d6';  // lifted brand blue
  const COLOR_SKY_DEEP  = '#2b2fa8';  // vignette toward the top
  const COLOR_BIRD      = '#ffc901';  // fallback circle, mascot gold
  const COLOR_BIRD_DK   = '#c99d00';

  // Circuit traces etched into the sky (background layer)
  const COLOR_TRACE     = 'rgba(255, 255, 255, .14)';
  const COLOR_TRACE_LIT = 'rgba(255, 201, 1, .34)';

  // Motherboard ground — deep brand blue PCB instead of the usual green
  const COLOR_BOARD     = '#05009d';
  const COLOR_BOARD_DK  = '#03006b';

  // Shared hardware tones
  const COLOR_METAL     = '#d4d8de';
  const COLOR_METAL_DK  = '#878e99';
  const COLOR_GOLD      = '#ffc901';
  const COLOR_CHIP      = '#14161f';

  /* Per-component colours.

     Real parts are NOT all one colour, and forcing them to the brand blue
     made every obstacle look identical at a glance. Each component keeps
     the colour it actually has — green PCB, black CPU, dark GPU shroud,
     silver drive — and the brand shows up in the gold accents and the
     world around them instead. Variety here is also playable information:
     the player can tell obstacles apart. */

  // RAM: classic green PCB with a red heat spreader
  const COLOR_RAM_PCB   = '#1f7a4d';
  const COLOR_RAM_TRIM  = '#c8442f';

  // CPU: near-black substrate, gold pins, steel lid
  const COLOR_CPU_BODY  = '#20222b';
  const COLOR_CPU_TRIM  = '#3b4050';

  // GPU: dark shroud with a hot accent, like an aftermarket cooler
  const COLOR_GPU_BODY  = '#26282f';
  const COLOR_GPU_TRIM  = '#ff6b2c';

  // HDD: brushed aluminium
  const COLOR_HDD_BODY  = '#a8aeb8';
  const COLOR_HDD_TRIM  = '#c3c9d2';

  // PSU: a fourth silhouette so obstacles repeat less often
  const COLOR_PSU_BODY  = '#4a4f57';
  const COLOR_PSU_TRIM  = '#2e3238';

  // Server rack: dark cabinet full of lit-up 1U units
  const COLOR_RACK_BODY = '#1b1e26';
  const COLOR_RACK_UNIT = '#333844';
  const COLOR_RACK_LED  = '#3ddc84';   // status green
  const COLOR_RACK_LED2 = '#ff9f1c';   // amber, for a bit of variety

  // Bookshelf: warm wood against all the cold metal
  const COLOR_SHELF_WOOD = '#8a5a33';
  const COLOR_SHELF_DK   = '#6b4526';
  // Book spines, cycled per book
  const BOOK_COLORS = ['#c8442f', '#2f6fb5', '#d8a13a', '#3f8f5b', '#8b4f9f', '#d96a8a'];

  /* ---------------------------------------------------------------
     2. Canvas setup
     We render at device-pixel resolution for crispness, then apply a
     single transform so all drawing code can speak in design units.
     --------------------------------------------------------------- */

  const canvas = document.getElementById('game');

  /* alpha: false is a real fix, not a micro-optimisation.

     With the default alpha channel the browser composites the canvas
     against the page every frame. On phones — iOS Safari especially —
     that per-frame compositing shows up as background flicker. The game
     paints every pixel of the canvas anyway, so the alpha channel buys
     nothing and costs stability. */
  const ctx = canvas.getContext('2d', { alpha: false });

  let scale = 1;      // design units -> CSS pixels
  let offsetX = 0;    // centring offset, CSS pixels
  let offsetY = 0;

  // Last applied backing-store size, so a resize that changes nothing can
  // be skipped entirely.
  let backingW = 0;
  let backingH = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);

    /* Assigning canvas.width/height BLANKS the canvas to transparent, so
       doing it when nothing actually changed costs a visibly blank frame.

       Mobile browsers fire `resize` constantly as the address bar slides
       in and out — on a phone that is a stream of blank frames, i.e. the
       background flashing while you play. Only touch the backing store
       when the pixel dimensions genuinely differ. */
    if (w !== backingW || h !== backingH) {
      canvas.width = w;
      canvas.height = h;
      backingW = w;
      backingH = h;
    }

    // Fit the virtual playfield inside the canvas, preserving aspect ratio.
    // "cover" rather than "contain" so tall phones have no empty bars —
    // the extra height just shows more sky and ground.
    scale = Math.max(rect.width / VIEW_W, rect.height / VIEW_H);
    offsetX = (rect.width  - VIEW_W * scale) / 2;
    offsetY = (rect.height - VIEW_H * scale) / 2;

    // The transform is reset by a backing-store change and must be
    // reapplied; harmless to set again when the size was unchanged.
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  /* ---------------------------------------------------------------
     3. Game state
     --------------------------------------------------------------- */

  const STATE = { READY: 'ready', PLAYING: 'playing', OVER: 'over' };

  const GROUND_Y = VIEW_H - GROUND_HEIGHT; // y of the top of the ground

  let state = STATE.READY;
  let score = 0;
  let groundOffset = 0;   // for the scrolling ground texture
  let lastTime = 0;

  const bird = {
    y: VIEW_H * 0.42,
    velocity: 0,
    tilt: 0
  };

  let pipes = [];

  function resetGame() {
    score = 0;
    bird.y = VIEW_H * BIRD_START_Y;
    bird.velocity = 0;
    bird.tilt = 0;
    groundOffset = 0;
    pipes = [];

    // Seed enough pipes to fill the screen to the right of the bird.
    let x = VIEW_W + 60;
    const end = x + PIPE_SPACING * 3;
    while (x < end) {
      pipes.push(makePipe(x));
      x += PIPE_SPACING;
    }
  }

  /* ---------------------------------------------------------------
     4. BIRD RENDERING  <<-- SWAP TARGET
     ---------------------------------------------------------------
     Everything about how the bird LOOKS is contained in drawBird()
     below. Nothing else in this file draws the bird, and collision
     uses BIRD_RADIUS rather than anything visual — so replacing the
     placeholder with the CS++ mascot sprite is a self-contained change.

     The mascot sprite is loaded below. If the file is missing or fails
     to load, drawBird() falls back to the original placeholder circle,
     so the game still runs rather than showing an invisible bird.

     To use a different image: drop it in public/ and change MASCOT_SRC.
     Collision follows BIRD_RADIUS, so resizing the sprite via
     BIRD_DRAW_SCALE below never desyncs the hitbox from the art.
     --------------------------------------------------------------- */

  const MASCOT_SRC = 'mascot.png';

  const birdSprite = new Image();
  let spriteReady = false;

  birdSprite.addEventListener('load', function () { spriteReady = true; });
  birdSprite.addEventListener('error', function () {
    // Non-fatal: keep the placeholder rather than breaking the game.
    console.warn('Mascot sprite "' + MASCOT_SRC + '" not found — using placeholder.');
  });
  birdSprite.src = MASCOT_SRC;

  function drawBird() {
    ctx.save();
    ctx.translate(BIRD_X, bird.y);
    ctx.rotate(bird.tilt);

    if (spriteReady) {
      // The mascot is drawn larger than the collision circle: the artwork
      // has transparent padding and rounded edges, so a sprite matched
      // exactly to BIRD_RADIUS looks smaller than it collides. Slightly
      // generous art over a slightly tight hitbox also feels fairer to
      // the player than the reverse.
      // Preserve the image's own aspect ratio rather than forcing a square,
      // so a sprite that isn't exactly 1:1 (the mascot is 124x128) doesn't
      // come out subtly stretched.
      const size = BIRD_RADIUS * 2 * BIRD_DRAW_SCALE;
      const ratio = birdSprite.naturalWidth / birdSprite.naturalHeight || 1;
      const w = ratio >= 1 ? size : size * ratio;
      const h = ratio >= 1 ? size / ratio : size;

      // Soft dark halo behind the sprite. The mascot's jumper is the same
      // blue as the sky now that everything is on-brand, so without this it
      // can visually merge into the background mid-flight.
      ctx.shadowColor = 'rgba(3, 0, 40, .55)';
      ctx.shadowBlur = 10;
      ctx.drawImage(birdSprite, -w / 2, -h / 2, w, h);
    } else {
      // ---- Fallback placeholder art ----
      // Yellow circle with a darker outline and a small eye, centred on
      // (0, 0) so the rotation above works correctly.
      ctx.beginPath();
      ctx.arc(0, 0, BIRD_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = COLOR_BIRD;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLOR_BIRD_DK;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(BIRD_RADIUS * 0.35, -BIRD_RADIUS * 0.3, BIRD_RADIUS * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = '#0b0a2e';
      ctx.fill();
    }

    ctx.restore();
  }

  /* ---------------------------------------------------------------
     5. Pipes
     --------------------------------------------------------------- */

  /* Obstacle types. Each pipe is a piece of PC hardware rather than a
     green pipe, but the COLLISION shape is unchanged — still the same two
     rectangles — so the artwork can be reskinned freely without touching
     the physics in section 6. */
  /* Obstacle mix. Listed entries are weighted by repetition: racks, RAM and
     shelves are the three the society asked to feature, so they appear twice
     as often as the supporting parts. */
  const PIPE_TYPES = [
    'rack', 'rack',
    'ram', 'ram',
    'shelf', 'shelf',
    'cpu', 'gpu', 'hdd', 'psu'
  ];

  // A pipe is defined by its left edge x and the y of the TOP of the gap.
  function makePipe(x) {
    const minGapY = PIPE_MARGIN;
    const maxGapY = GROUND_Y - PIPE_GAP - PIPE_MARGIN;
    const gapY = minGapY + Math.random() * (maxGapY - minGapY);

    return {
      x: x,
      gapY: gapY,
      type: PIPE_TYPES[Math.floor(Math.random() * PIPE_TYPES.length)],
      // Fixed at creation and never changed. Interior detail (rack LEDs,
      // book spines) is hashed from THIS, not from the pipe's x — x moves
      // every frame, so hashing it re-rolls the detail every frame and the
      // obstacle visibly flickers.
      seed: Math.floor(Math.random() * 100000),
      scored: false   // set once the bird passes it, so each pipe counts once
    };
  }

  /* --- Obstacle rendering ---------------------------------------
     Each component is drawn to fill an arbitrary rectangle, so the same
     routine works for the tall upper section and the short lower one.
     `fromTop` says which end points at the gap, so connectors and heat
     sinks face the right way.
     --------------------------------------------------------------- */

  function drawPipe(p) {
    const upperH = p.gapY;
    const lowerY = p.gapY + PIPE_GAP;
    const lowerH = GROUND_Y - lowerY;

    drawComponent(p.type, p.x, 0, PIPE_WIDTH, upperH, true, p.seed);
    drawComponent(p.type, p.x, lowerY, PIPE_WIDTH, lowerH, false, p.seed);
  }

  /* --- Offscreen obstacle cache ---------------------------------

     An obstacle's interior never changes once created: same type, same
     seed, same height, and it only ever moves horizontally. Redrawing all
     that detail every frame cost ~400 fillRect calls per frame and ran at
     5 fps on a throttled phone.

     So each distinct (type, height, orientation, seed) is rendered ONCE
     into an offscreen canvas and then blitted with a single drawImage.
     Heights are bucketed so near-identical obstacles share one bitmap
     instead of each allocating its own.
     --------------------------------------------------------------- */

  const componentCache = new Map();
  const CACHE_BUCKET = 8;    // height rounding, design units
  const CACHE_LIMIT = 120;   // hard cap so the map cannot grow forever

  function renderComponent(type, w, h, fromTop, seed) {
    const c = document.createElement('canvas');
    // Render at device resolution so the blit stays crisp on retina screens.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = Math.max(1, Math.ceil(w * dpr));
    c.height = Math.max(1, Math.ceil(h * dpr));

    const g = c.getContext('2d');
    g.scale(dpr, dpr);

    // The component functions take their target context explicitly, so the
    // offscreen render needs no global state swapping.
    switch (type) {
      case 'ram': drawRam(g, 0, 0, w, h, fromTop); break;
      case 'cpu': drawCpu(g, 0, 0, w, h, fromTop); break;
      case 'gpu': drawGpu(g, 0, 0, w, h, fromTop); break;
      case 'psu': drawPsu(g, 0, 0, w, h, fromTop); break;
      case 'rack': drawRack(g, 0, 0, w, h, fromTop, seed); break;
      case 'shelf': drawShelf(g, 0, 0, w, h, fromTop, seed); break;
      default: drawHdd(g, 0, 0, w, h, fromTop); break;
    }

    return c;
  }

  function drawComponent(type, x, y, w, h, fromTop, seed) {
    if (h <= 0) return;

    // Bucket the height so a pipe scrolling past doesn't generate a new
    // bitmap for every sub-pixel variation. Gap heights are fixed per pipe,
    // so in practice this is a small, stable set.
    const bucketH = Math.max(CACHE_BUCKET, Math.ceil(h / CACHE_BUCKET) * CACHE_BUCKET);
    const key = type + '|' + bucketH + '|' + (fromTop ? 't' : 'b') + '|' + (seed || 0);

    let bitmap = componentCache.get(key);
    if (!bitmap) {
      if (componentCache.size >= CACHE_LIMIT) componentCache.clear();
      bitmap = renderComponent(type, w, bucketH, fromTop, seed);
      componentCache.set(key, bitmap);
    }

    ctx.save();

    // Clip to the real obstacle bounds: the cached bitmap is drawn at the
    // bucketed height, which may be slightly taller than this section, and
    // detail must never spill past the collision rectangle and mislead the
    // player about where the gap is.
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    // Anchor the bitmap at the gap end, so the rounding slack falls at the
    // far edge (offscreen or against the ground) rather than at the gap.
    const drawY = fromTop ? y + h - bucketH : y;
    ctx.drawImage(bitmap, x, drawY, w, bucketH);

    ctx.restore();
  }

  /** RAM stick: green PCB, red heat spreader, gold contact edge. */
  function drawRam(g, x, y, w, h, fromTop) {
    g.fillStyle = COLOR_RAM_PCB;
    g.fillRect(x, y, w, h);

    // Red heat spreader down the middle — the strongest cue separating RAM
    // from the other components at speed. Leaves green PCB visible either
    // side so it still reads as a circuit board.
    const spreadY = fromTop ? y : y + 12;
    const spreadH = h - 12;
    if (spreadH > 0) {
      g.fillStyle = COLOR_RAM_TRIM;
      g.fillRect(x + w * 0.14, spreadY, w * 0.72, spreadH);

      // Darker fin notches along it
      g.fillStyle = 'rgba(0, 0, 0, .25)';
      for (let fy = spreadY + 10; fy < spreadY + spreadH - 6; fy += 15) {
        g.fillRect(x + w * 0.14, fy, w * 0.72, 4);
      }

      // Highlight along one edge so it reads as raised metal
      g.fillStyle = 'rgba(255, 255, 255, .22)';
      g.fillRect(x + w * 0.14, spreadY, 3, spreadH);
    }

    // Gold contact fingers along the edge that faces the gap
    const edgeY = fromTop ? y + h - 9 : y;
    g.fillStyle = COLOR_GOLD;
    g.fillRect(x, edgeY, w, 9);
    g.fillStyle = COLOR_RAM_PCB;
    for (let fx = x + 3; fx < x + w - 2; fx += 6) {
      g.fillRect(fx, edgeY, 2, 9);
    }
  }

  /** CPU: black substrate, gold pin grid, steel lid at the gap end. */
  function drawCpu(g, x, y, w, h, fromTop) {
    g.fillStyle = COLOR_CPU_BODY;
    g.fillRect(x, y, w, h);

    // Socket surround, lighter than the substrate, so the black isn't flat
    g.fillStyle = COLOR_CPU_TRIM;
    g.fillRect(x + 4, y, w - 8, h);
    g.fillStyle = COLOR_CPU_BODY;
    g.fillRect(x + 9, y, w - 18, h);

    // Gold pin grid
    g.fillStyle = COLOR_GOLD;
    for (let py = y + 12; py < y + h - 30; py += 11) {
      for (let px = x + 14; px < x + w - 12; px += 11) {
        g.fillRect(px, py, 4, 4);
      }
    }

    // Steel heat spreader capping the gap end
    const lidH = 28;
    const lidY = fromTop ? y + h - lidH : y;
    g.fillStyle = COLOR_METAL;
    g.fillRect(x - 4, lidY, w + 8, lidH);
    g.fillStyle = COLOR_METAL_DK;
    g.fillRect(x - 4, fromTop ? lidY : lidY + lidH - 5, w + 8, 5);

    // Engraved rectangle on the lid
    g.strokeStyle = COLOR_METAL_DK;
    g.lineWidth = 2;
    g.strokeRect(x + w * 0.2, lidY + 7, w * 0.6, lidH - 15);

    // Pin-1 corner triangle, the way real chips are keyed
    g.fillStyle = COLOR_GOLD;
    g.beginPath();
    const ty = fromTop ? y + 6 : y + h - 6;
    const dir = fromTop ? 1 : -1;
    g.moveTo(x + 13, ty);
    g.lineTo(x + 22, ty);
    g.lineTo(x + 13, ty + 9 * dir);
    g.closePath();
    g.fill();
  }

  /** GPU: dark shroud with a fan and a bright PCIe bracket at the gap end. */
  function drawGpu(g, x, y, w, h, fromTop) {
    g.fillStyle = COLOR_GPU_BODY;
    g.fillRect(x, y, w, h);

    // Orange accent stripe down one side, like an aftermarket cooler
    g.fillStyle = COLOR_GPU_TRIM;
    g.fillRect(x + 4, y, 5, h);

    // Heatsink fins across the shroud
    g.fillStyle = 'rgba(255, 255, 255, .10)';
    for (let ry = y + 8; ry < y + h - 8; ry += 9) {
      g.fillRect(x + 13, ry, w - 20, 3);
    }

    // Two fans stacked along the card, so a tall section doesn't read empty
    const fanR = Math.min(w * 0.3, 17);
    if (fanR > 6 && h > 70) {
      const centres = [];
      centres.push(fromTop ? y + h - fanR - 26 : y + fanR + 26);
      // Second fan further along, only when there is room for it
      if (h > 150) centres.push(fromTop ? y + h - fanR - 26 - fanR * 2.5 : y + fanR + 26 + fanR * 2.5);

      for (const fanY of centres) {
        const fanX = x + w / 2 + 3;

        g.fillStyle = COLOR_CHIP;
        g.beginPath();
        g.arc(fanX, fanY, fanR, 0, Math.PI * 2);
        g.fill();

        // Blades — a static swirl, cheap to draw and readable at speed
        g.strokeStyle = COLOR_GPU_TRIM;
        g.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          g.beginPath();
          g.moveTo(fanX, fanY);
          g.lineTo(fanX + Math.cos(a) * fanR * 0.85, fanY + Math.sin(a) * fanR * 0.85);
          g.stroke();
        }

        // Hub
        g.fillStyle = COLOR_METAL_DK;
        g.beginPath();
        g.arc(fanX, fanY, fanR * 0.3, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Bracket at the gap end
    const brH = 14;
    const brY = fromTop ? y + h - brH : y;
    g.fillStyle = COLOR_METAL;
    g.fillRect(x - 4, brY, w + 8, brH);
    g.fillStyle = COLOR_METAL_DK;
    for (let vx = x - 1; vx < x + w + 2; vx += 7) {
      g.fillRect(vx, brY + 3, 3, brH - 6);
    }
  }

  /** HDD: brushed metal case, screw holes, and a platter hint. */
  function drawHdd(g, x, y, w, h, fromTop) {
    g.fillStyle = COLOR_HDD_BODY;
    g.fillRect(x, y, w, h);

    // Brushed-metal streaks
    g.strokeStyle = COLOR_HDD_TRIM;
    g.lineWidth = 1;
    for (let sy = y + 6; sy < y + h - 4; sy += 7) {
      g.beginPath();
      g.moveTo(x + 4, sy);
      g.lineTo(x + w - 4, sy);
      g.stroke();
    }

    // Screws in the corners
    g.fillStyle = COLOR_METAL_DK;
    const s = 3.5;
    [[x + 8, y + 9], [x + w - 8, y + 9], [x + 8, y + h - 9], [x + w - 8, y + h - 9]]
      .forEach(([sx, sy]) => {
        g.beginPath();
        g.arc(sx, sy, s, 0, Math.PI * 2);
        g.fill();
      });

    // Platter circle, only when there is room for it to read
    const pr = Math.min(w * 0.3, h * 0.2);
    if (pr > 8) {
      const py = fromTop ? y + h - pr - 24 : y + pr + 24;
      g.strokeStyle = COLOR_METAL_DK;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x + w / 2, py, pr, 0, Math.PI * 2);
      g.stroke();
    }

    // SATA connector block at the gap end
    const cH = 12;
    const cY = fromTop ? y + h - cH : y;
    g.fillStyle = COLOR_CHIP;
    g.fillRect(x - 3, cY, w + 6, cH);
    g.fillStyle = COLOR_GOLD;
    g.fillRect(x + 6, cY + 4, w * 0.35, 4);
  }

  /** PSU: grey steel box with a honeycomb grille and a fan. */
  function drawPsu(g, x, y, w, h, fromTop) {
    g.fillStyle = COLOR_PSU_BODY;
    g.fillRect(x, y, w, h);

    // Vent grille — rows of slots down the body
    g.fillStyle = COLOR_PSU_TRIM;
    for (let vy = y + 10; vy < y + h - 12; vy += 10) {
      for (let vx = x + 8; vx < x + w - 8; vx += 9) {
        g.fillRect(vx, vy, 6, 5);
      }
    }

    // Big intake fan toward the gap
    const fr = Math.min(w * 0.34, 20);
    if (fr > 7 && h > 66) {
      const fy = fromTop ? y + h - fr - 26 : y + fr + 26;
      const fx = x + w / 2;

      g.fillStyle = COLOR_CHIP;
      g.beginPath();
      g.arc(fx, fy, fr, 0, Math.PI * 2);
      g.fill();

      g.strokeStyle = COLOR_METAL_DK;
      g.lineWidth = 2;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        g.beginPath();
        g.moveTo(fx, fy);
        g.lineTo(fx + Math.cos(a) * fr * 0.85, fy + Math.sin(a) * fr * 0.85);
        g.stroke();
      }
    }

    // 80 PLUS style gold label
    if (h > 90) {
      g.fillStyle = COLOR_GOLD;
      const ly = fromTop ? y + 16 : y + h - 30;
      g.fillRect(x + w * 0.2, ly, w * 0.6, 14);
    }

    // Steel lip at the gap end
    const lipH = 10;
    const lipY = fromTop ? y + h - lipH : y;
    g.fillStyle = COLOR_METAL_DK;
    g.fillRect(x - 3, lipY, w + 6, lipH);
  }

  /* Cheap deterministic hash -> 0..1. Detail inside an obstacle is keyed off
     its world position so it stays identical every frame; Math.random() here
     would make LEDs and book spines flicker as the obstacle scrolls. */
  function hash01(n) {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  }

  /** Server rack: dark cabinet of 1U units with blinking-looking status LEDs. */
  function drawRack(g, x, y, w, h, fromTop, seed) {
    g.fillStyle = COLOR_RACK_BODY;
    g.fillRect(x, y, w, h);

    // Cabinet rails down both sides
    g.fillStyle = COLOR_RACK_UNIT;
    g.fillRect(x + 2, y, 4, h);
    g.fillRect(x + w - 6, y, 4, h);

    // Stacked 1U servers. Each unit's detail is keyed to its own index so
    // the rack looks populated but never changes between frames.
    const unitH = 22;
    const gap = 4;
    let i = 0;

    for (let uy = y + 6; uy < y + h - unitH; uy += unitH + gap, i++) {
      const unitSeed = seed + i * 31;

      // Unit face
      g.fillStyle = COLOR_RACK_UNIT;
      g.fillRect(x + 8, uy, w - 16, unitH);

      // Darker vent band
      g.fillStyle = COLOR_RACK_BODY;
      g.fillRect(x + 12, uy + 5, w * 0.42, unitH - 10);

      // Drive-bay slots
      g.fillStyle = 'rgba(255, 255, 255, .08)';
      for (let sy = uy + 5; sy < uy + unitH - 6; sy += 5) {
        g.fillRect(x + 12, sy, w * 0.42, 2);
      }

      // Status LEDs — mostly green, occasionally amber
      const lit = hash01(unitSeed);
      g.fillStyle = lit > 0.78 ? COLOR_RACK_LED2 : COLOR_RACK_LED;
      g.fillRect(x + w - 22, uy + 6, 5, 5);
      g.fillStyle = hash01(unitSeed + 7) > 0.5 ? COLOR_RACK_LED : COLOR_RACK_UNIT;
      g.fillRect(x + w - 22, uy + 13, 5, 5);
    }

    // Vented cap at the gap end
    const capH = 12;
    const capY = fromTop ? y + h - capH : y;
    g.fillStyle = COLOR_METAL_DK;
    g.fillRect(x - 3, capY, w + 6, capH);
    g.fillStyle = COLOR_RACK_BODY;
    for (let vx = x; vx < x + w; vx += 6) {
      g.fillRect(vx, capY + 3, 3, capH - 6);
    }
  }

  /** Bookshelf: wooden case of leaning books — warm relief from the metal. */
  function drawShelf(g, x, y, w, h, fromTop, seed) {
    // Case
    g.fillStyle = COLOR_SHELF_WOOD;
    g.fillRect(x, y, w, h);

    // Back panel, darker so the books read against it
    g.fillStyle = COLOR_SHELF_DK;
    g.fillRect(x + 5, y, w - 10, h);

    /* Shelves, and the books standing on each.

       Rows are laid out from the GAP END inwards, not from y. The upper and
       lower sections are two halves of one bookcase, and anchoring both to
       the edge the player actually looks at keeps their shelf boards aligned
       with each other instead of drifting apart as the gap height varies. */
    const shelfH = 46;
    let row = 0;

    // Walk inwards from the gap: downwards for the ceiling section, upwards
    // for the floor section.
    const startY = fromTop ? y + h - shelfH : y;

    for (let i = 0; i < Math.ceil(h / shelfH) + 1; i++, row++) {
      const sy = fromTop ? startY - i * shelfH : startY + i * shelfH;
      if (sy + shelfH < y || sy > y + h) continue;

      const boardY = Math.min(sy + shelfH - 6, y + h - 6);

      // Books standing on this shelf
      let bx = x + 8;
      let bi = 0;
      while (bx < x + w - 12) {
        const bookSeed = seed + row * 17 + bi * 5;
        const bw = 5 + Math.floor(hash01(bookSeed) * 5);       // 5..9 wide
        const bh = 22 + Math.floor(hash01(bookSeed + 3) * 10); // varying height
        const top = boardY - bh;

        if (top > y && boardY <= y + h) {
          g.fillStyle = BOOK_COLORS[Math.floor(hash01(bookSeed + 11) * BOOK_COLORS.length)];
          g.fillRect(bx, top, bw, bh);

          // Title band on the spine
          g.fillStyle = 'rgba(255, 255, 255, .35)';
          g.fillRect(bx + 1, top + 6, bw - 2, 2);
          g.fillRect(bx + 1, top + bh - 9, bw - 2, 2);
        }

        bx += bw + 1;
        bi++;
      }

      // The shelf board itself, drawn over the book bases
      if (boardY <= y + h - 4) {
        g.fillStyle = COLOR_SHELF_WOOD;
        g.fillRect(x + 3, boardY, w - 6, 5);
        g.fillStyle = 'rgba(0, 0, 0, .25)';
        g.fillRect(x + 3, boardY + 5, w - 6, 2);
      }
    }

    // Trim at the gap end, so the case reads as a solid piece of furniture
    const trimH = 10;
    const trimY = fromTop ? y + h - trimH : y;
    g.fillStyle = COLOR_SHELF_WOOD;
    g.fillRect(x - 4, trimY, w + 8, trimH);
    g.fillStyle = 'rgba(0, 0, 0, .22)';
    g.fillRect(x - 4, fromTop ? trimY : trimY + trimH - 3, w + 8, 3);
  }

  /* ---------------------------------------------------------------
     6. Update & collision
     --------------------------------------------------------------- */

  function flap() {
    if (state !== STATE.PLAYING) return;
    bird.velocity = -FLAP_STRENGTH;
  }

  function update(dt) {
    // The ground keeps scrolling on the menus for a bit of life, but
    // physics and pipes only run while playing.
    // Accumulate distance travelled and wrap at the LOWEST COMMON MULTIPLE
    // of every period that reads from it (14 fingers, 96 chip cell, 180
    // trace tile). Wrapping at an arbitrary value would leave each layer
    // mid-period at the wrap, jerking it backwards several times a second.
    groundOffset = (groundOffset + GROUND_SCROLL * dt) % GROUND_CYCLE;

    if (state !== STATE.PLAYING) return;

    // --- Bird physics ---
    bird.velocity = Math.min(bird.velocity + GRAVITY * dt, MAX_FALL_SPEED);
    bird.y += bird.velocity * dt;

    // Tilt maps vertical speed to rotation: nose up when rising, down when falling.
    const targetTilt = bird.velocity < 0
      ? BIRD_MIN_TILT
      : Math.min(BIRD_MAX_TILT, bird.velocity / MAX_FALL_SPEED * BIRD_MAX_TILT);
    bird.tilt += (targetTilt - bird.tilt) * Math.min(1, dt * 10);

    // --- Pipes: scroll and score ---
    for (const p of pipes) {
      p.x -= PIPE_SPEED * dt;

      // Score the moment the pipe's right edge clears the bird.
      if (!p.scored && p.x + PIPE_WIDTH < BIRD_X) {
        p.scored = true;
        score++;
      }
    }

    // Recycle: drop pipes that have left the screen and append a new one at
    // the end, keeping spacing constant. This is what makes the field endless.
    while (pipes.length && pipes[0].x + PIPE_WIDTH < -cullMargin()) {
      pipes.shift();
      const last = pipes[pipes.length - 1];
      pipes.push(makePipe(last.x + PIPE_SPACING));
    }

    // --- Collisions ---
    if (hitsGroundOrCeiling() || hitsAnyPipe()) {
      endGame();
    }
  }

  // How far off-screen-left a pipe must be before it is recycled. With the
  // "cover" scaling a wide screen can reveal area left of x=0, so allow a
  // margin rather than culling something still visible.
  function cullMargin() {
    return Math.max(0, -offsetX / scale) + 20;
  }

  function hitsGroundOrCeiling() {
    // The top of the playfield is solid so the bird can't climb out of the
    // level and skip pipes.
    if (bird.y - BIRD_RADIUS <= 0) return true;
    if (bird.y + BIRD_RADIUS >= GROUND_Y) return true;
    return false;
  }

  function hitsAnyPipe() {
    for (const p of pipes) {
      // Cheap horizontal reject first.
      if (BIRD_X + BIRD_RADIUS < p.x || BIRD_X - BIRD_RADIUS > p.x + PIPE_WIDTH) continue;

      // Circle-vs-rect against the upper and lower pipe bodies.
      if (circleHitsRect(BIRD_X, bird.y, BIRD_RADIUS, p.x, 0, PIPE_WIDTH, p.gapY)) return true;

      const lowerY = p.gapY + PIPE_GAP;
      if (circleHitsRect(BIRD_X, bird.y, BIRD_RADIUS, p.x, lowerY, PIPE_WIDTH, GROUND_Y - lowerY)) return true;
    }
    return false;
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

  /* ---------------------------------------------------------------
     7. Draw
     --------------------------------------------------------------- */

  function draw() {
    // Clear generously: with "cover" scaling the visible area can extend
    // beyond the virtual playfield on either axis.
    const bleedX = Math.max(0, -offsetX / scale);
    const bleedY = Math.max(0, -offsetY / scale);

    // Vertical gradient: deeper blue at the top, lighter toward the board.
    // Built per-frame but cheap, and it keeps the scene from reading flat.
    const sky = ctx.createLinearGradient(0, -bleedY, 0, GROUND_Y);
    sky.addColorStop(0, COLOR_SKY_DEEP);
    sky.addColorStop(1, COLOR_SKY);
    ctx.fillStyle = sky;
    ctx.fillRect(-bleedX, -bleedY, VIEW_W + bleedX * 2, VIEW_H + bleedY * 2);

    drawCircuitBackground(bleedX, bleedY);

    for (const p of pipes) drawPipe(p);

    drawGround(bleedX, bleedY);
    drawBird();

    // Live score, only while actually playing (the overlays handle the rest).
    if (state === STATE.PLAYING) drawScore();
  }

  /* Circuit traces etched into the sky.

     The pattern is generated once into an offscreen tile and then repeated,
     rather than re-randomised per frame — random values inside draw() would
     make the traces flicker. It scrolls at a fraction of the pipe speed for
     a parallax feel, so it reads as distant background and never competes
     with the obstacles the player has to judge. */

  const TRACE_VARIANTS = 4; // distinct tiles, shuffled to hide the grid
  let traceTiles = null;    // lazily built offscreen canvases

  function buildTraceTile() {
    const c = document.createElement('canvas');
    c.width = TRACE_TILE;
    c.height = TRACE_TILE;
    const g = c.getContext('2d');

    g.lineWidth = 2;
    g.lineCap = 'square';

    // A handful of right-angled traces with a pad at the end, the way real
    // PCB routing looks.
    for (let i = 0; i < 7; i++) {
      const sx = Math.random() * TRACE_TILE;
      const sy = Math.random() * TRACE_TILE;
      const len1 = 20 + Math.random() * 50;
      const len2 = 20 + Math.random() * 50;
      const horizontalFirst = Math.random() < 0.5;
      const lit = Math.random() < 0.25;

      g.strokeStyle = lit ? COLOR_TRACE_LIT : COLOR_TRACE;
      g.fillStyle = lit ? COLOR_TRACE_LIT : COLOR_TRACE;

      g.beginPath();
      g.moveTo(sx, sy);
      if (horizontalFirst) {
        g.lineTo(sx + len1, sy);
        g.lineTo(sx + len1, sy + len2);
      } else {
        g.lineTo(sx, sy + len1);
        g.lineTo(sx + len2, sy + len1);
      }
      g.stroke();

      // Solder pad at the end of the run
      const px = horizontalFirst ? sx + len1 : sx + len2;
      const py = horizontalFirst ? sy + len2 : sy + len1;
      g.beginPath();
      g.arc(px, py, 3.5, 0, Math.PI * 2);
      g.fill();
    }

    return c;
  }

  function drawCircuitBackground(bleedX, bleedY) {
    if (!traceTiles) {
      traceTiles = [];
      for (let i = 0; i < TRACE_VARIANTS; i++) traceTiles.push(buildTraceTile());
    }

    // Parallax: slower than the foreground so depth reads correctly.
    const shift = (groundOffset * 0.35) % TRACE_TILE;

    const left = -bleedX - TRACE_TILE;
    const right = VIEW_W + bleedX;
    const top = -bleedY - TRACE_TILE;
    const bottom = VIEW_H + bleedY;

    // Pick a variant from the grid coordinates rather than at random, so a
    // given cell always shows the same tile and the pattern doesn't churn
    // between frames. The *3 on the row keeps columns from lining up.
    let row = 0;
    for (let ty = top; ty < bottom; ty += TRACE_TILE, row++) {
      let col = 0;
      for (let tx = left; tx < right; tx += TRACE_TILE, col++) {
        const tile = traceTiles[(col + row * 3) % TRACE_VARIANTS];
        ctx.drawImage(tile, tx - shift, ty, TRACE_TILE, TRACE_TILE);
      }
    }
  }

  /* The ground is a motherboard: green PCB, a gold contact strip along the
     top edge, and scrolling surface-mount detail. The collision line is
     still GROUND_Y — all of this is decoration below it. */
  function drawGround(bleedX, bleedY) {
    const w = VIEW_W + bleedX * 2;
    const left = -bleedX;

    // Board substrate
    ctx.fillStyle = COLOR_BOARD;
    ctx.fillRect(left, GROUND_Y, w, VIEW_H - GROUND_Y + bleedY);

    // Gold contact fingers along the top edge — the surface the bird lands on
    ctx.fillStyle = COLOR_GOLD;
    ctx.fillRect(left, GROUND_Y, w, 7);
    ctx.fillStyle = COLOR_BOARD_DK;
    for (let x = left - (groundOffset % FINGER_PERIOD); x < VIEW_W + bleedX; x += FINGER_PERIOD) {
      ctx.fillRect(x, GROUND_Y, 4, 7);
    }

    // Scrolling SMD components. Everything is keyed off a repeating 96-unit
    // cell so the layout is stable as it scrolls rather than reshuffling.
    const CELL = CELL_PERIOD;
    const start = left - (groundOffset % CELL) - CELL;

    for (let x = start; x < VIEW_W + bleedX + CELL; x += CELL) {
      // Chip package
      ctx.fillStyle = COLOR_CHIP;
      ctx.fillRect(x + 10, GROUND_Y + 20, 34, 22);
      // Its legs
      ctx.fillStyle = COLOR_METAL_DK;
      for (let lx = x + 13; lx < x + 43; lx += 7) {
        ctx.fillRect(lx, GROUND_Y + 42, 3, 4);
      }

      // A pair of small capacitors
      ctx.fillStyle = COLOR_METAL;
      ctx.fillRect(x + 56, GROUND_Y + 22, 10, 16);
      ctx.fillRect(x + 70, GROUND_Y + 26, 8, 12);

      // Trace running between them
      ctx.strokeStyle = COLOR_BOARD_DK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 10, GROUND_Y + 54);
      ctx.lineTo(x + 78, GROUND_Y + 54);
      ctx.stroke();
    }
  }

  /* The score sits on a small dark plate rather than floating free: the
     circuit traces behind it are busy enough that outlined text alone is
     hard to read at a glance mid-flight. */
  function drawScore() {
    const text = String(score);
    const y = 52;

    ctx.save();
    ctx.font = 'bold 44px ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // Plate sized to the text so long scores stay enclosed
    const w = Math.max(64, ctx.measureText(text).width + 34);
    const h = 58;
    const x = VIEW_W / 2 - w / 2;

    ctx.fillStyle = 'rgba(3, 0, 58, .78)';
    ctx.beginPath();
    // roundRect is unsupported on Safari below 16.4; fall back to a plain
    // rect there rather than throwing and killing the render loop.
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y - 6, w, h, 10);
    } else {
      ctx.rect(x, y - 6, w, h);
    }
    ctx.fill();

    // Gold hairline, tying it to the hardware palette
    ctx.strokeStyle = 'rgba(255, 201, 1, .55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.fillText(text, VIEW_W / 2, y + 3);
    ctx.restore();
  }

  /* ---------------------------------------------------------------
     8. Loop, input, UI wiring
     --------------------------------------------------------------- */

  function frame(now) {
    // Delta time in seconds, clamped so a backgrounded tab doesn't
    // teleport the bird through a pipe when it comes back.
    const dt = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;

    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // --- UI elements ---
  const registerScreen = document.getElementById('register-screen');
  const registerForm   = document.getElementById('register-form');
  const inputName      = document.getElementById('input-name');
  const inputStudent   = document.getElementById('input-student');
  const registerError  = document.getElementById('register-error');

  const gameoverScreen = document.getElementById('gameover-screen');
  const finalScoreEl   = document.getElementById('final-score');
  const bestLineEl     = document.getElementById('best-line');
  const leaderboardEl  = document.getElementById('leaderboard-list');
  const replayBtn      = document.getElementById('replay-btn');

  /* ---------------------------------------------------------------
     Player session
     Held in memory only — no storage, so closing the tab clears it.
     This is what lets a replay skip the registration form.
     --------------------------------------------------------------- */

  const player = { name: '', student_number: '' };

  // TU Dublin student number: one letter followed by 8 digits (e.g. C00035654).
  // Mirrors the server's rule in server.js — keep the two in sync.
  const STUDENT_NUMBER_PATTERN = /^[A-Z]\d{8}$/;

  /* ---------------------------------------------------------------
     Registration
     Client-side validation mirrors the server's rules, but the server
     is the real gate — this just gives instant feedback.
     --------------------------------------------------------------- */

  function showRegisterError(message, field) {
    registerError.textContent = message;
    inputName.classList.toggle('invalid', field === 'name');
    inputStudent.classList.toggle('invalid', field === 'student');
    if (field === 'name') inputName.focus();
    if (field === 'student') inputStudent.focus();
  }

  registerForm.addEventListener('submit', function (e) {
    e.preventDefault();

    const name = inputName.value.trim().replace(/\s+/g, ' ');
    // Uppercased to match the server, so a lowercase entry maps to the same
    // player record rather than a duplicate one.
    const studentNumber = inputStudent.value.trim().toUpperCase();

    if (!name) {
      return showRegisterError('Please enter your name.', 'name');
    }
    if (!studentNumber) {
      return showRegisterError('Please enter your student number.', 'student');
    }
    if (!STUDENT_NUMBER_PATTERN.test(studentNumber)) {
      return showRegisterError('Use your student number, e.g. C00035654.', 'student');
    }

    player.name = name;
    player.student_number = studentNumber;

    showRegisterError('', null);

    // Drop focus so the mobile keyboard closes before play starts.
    if (document.activeElement) document.activeElement.blur();

    startGame();
  });

  /* ---------------------------------------------------------------
     Score submission & leaderboard
     --------------------------------------------------------------- */

  /** Submit the finished run. Returns the server's response, or null on failure. */
  async function submitScore(finalScore) {
    const response = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_number: player.student_number,
        name: player.name,
        score: finalScore
      })
    });

    if (!response.ok) throw new Error('Score submission failed: ' + response.status);
    return response.json();
  }

  /** Fetch the top N players. */
  async function fetchLeaderboard(limit) {
    const response = await fetch('/api/leaderboard?limit=' + encodeURIComponent(limit));
    if (!response.ok) throw new Error('Leaderboard fetch failed: ' + response.status);
    return response.json();
  }

  /**
   * Render the leaderboard rows.
   * Uses textContent rather than innerHTML so a name like "<script>" is
   * displayed literally instead of being parsed as markup.
   */
  function renderLeaderboard(entries) {
    leaderboardEl.textContent = '';

    if (!entries.length) {
      const li = document.createElement('li');
      li.className = 'leaderboard-status';
      li.textContent = '// empty — be the first';
      leaderboardEl.appendChild(li);
      return;
    }

    entries.forEach(function (entry, index) {
      const li = document.createElement('li');

      // Highlight the current player's own row so they can spot themselves.
      if (entry.student_number === player.student_number) li.classList.add('is-you');

      // Zero-based, like an array index — a small in-joke that also keeps
      // the column narrow.
      const rank = document.createElement('span');
      rank.className = 'leaderboard-rank';
      rank.textContent = '[' + index + ']';

      const name = document.createElement('span');
      name.className = 'leaderboard-name';
      name.textContent = entry.name;

      const scoreEl = document.createElement('span');
      scoreEl.className = 'leaderboard-score';
      scoreEl.textContent = entry.best_score;

      li.append(rank, name, scoreEl);
      leaderboardEl.appendChild(li);
    });
  }

  function setLeaderboardStatus(message) {
    leaderboardEl.textContent = '';
    const li = document.createElement('li');
    li.className = 'leaderboard-status';
    li.textContent = message;
    leaderboardEl.appendChild(li);
  }

  /**
   * Post the run, then show the personal best and leaderboard.
   * Network failures degrade gracefully: the final score is already on
   * screen and Play Again keeps working regardless.
   */
  async function reportScore(finalScore) {
    bestLineEl.textContent = '> saving…';
    bestLineEl.classList.remove('is-new-best');
    setLeaderboardStatus('Loading…');

    try {
      const result = await submitScore(finalScore);

      // Celebrating a "personal best" of 0 reads as sarcasm, so a first
      // run of 0 just shows the plain best line instead.
      if (result.is_new_best && result.best_score > 0) {
        bestLineEl.textContent = '★ new personal best!';
        bestLineEl.classList.add('is-new-best');
      } else {
        bestLineEl.textContent = 'best = ' + result.best_score;
      }
    } catch (err) {
      console.error(err);
      bestLineEl.textContent = '!! could not save score (offline?)';
    }

    // Load the leaderboard even if the submission failed — it still has
    // something useful to show.
    try {
      renderLeaderboard(await fetchLeaderboard(10));
    } catch (err) {
      console.error(err);
      setLeaderboardStatus('!! could not load leaderboard');
    }
  }

  /* ---------------------------------------------------------------
     Game start / end
     --------------------------------------------------------------- */

  function startGame() {
    resetGame();
    state = STATE.PLAYING;
    registerScreen.classList.add('hidden');
    gameoverScreen.classList.add('hidden');
    flap(); // an initial hop instead of an instant drop
  }

  function endGame() {
    state = STATE.OVER;
    finalScoreEl.textContent = String(score);
    gameoverScreen.classList.remove('hidden');

    // Fire-and-forget: the overlay is already visible, and the best score
    // and leaderboard fill in as the requests resolve.
    reportScore(score);
  }

  replayBtn.addEventListener('click', startGame);

  // --- Input: tap / click / spacebar ---
  // Pointer events cover mouse and touch in one path. We listen on the canvas
  // only, so taps on the overlay buttons aren't also swallowed as flaps.
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    flap();
  });

  window.addEventListener('keydown', function (e) {
    if (e.code !== 'Space' && e.code !== 'ArrowUp') return;

    // Never hijack the spacebar while the player is typing their details.
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    e.preventDefault();

    if (state === STATE.PLAYING) {
      flap();
    } else if (state === STATE.OVER) {
      // Space doubles as restart so desktop players never need the mouse.
      // Only valid once registered, which reaching OVER guarantees.
      startGame();
    }
    // In READY state we do nothing: the player must register first.
  });

  // --- Boot ---
  resize();
  resetGame();
  inputName.focus();
  requestAnimationFrame(function (t) {
    lastTime = t;
    requestAnimationFrame(frame);
  });
})();
