/* ===============================================================
   CS++ Flappy — stand display screen

   Read-only board for a laptop or TV at the event:
     - QR code to the game, derived from the address this page was
       opened at, so there is nothing to configure
     - QR code to society sign-up
     - live top-N leaderboard with event totals; N is picked on the
       screen (10, 20, or any number up to 100)

   Polls the API rather than holding a socket open: the data changes
   every few seconds at most, and a plain fetch survives Wi-Fi drops
   without needing reconnection logic.
   =============================================================== */

(function () {
  'use strict';

  /* --- Tunables -------------------------------------------------- */

  const REFRESH_MS = 5000;     // how often to poll
  const STALE_AFTER = 3;       // consecutive failures before flagging stale

  const DEFAULT_TOP = 10;      // rows to show when nothing was chosen
  const MAX_TOP = 100;         // the API's cap
  const MIN_SIZED_ROWS = 10;   // see sizeRows()
  const STORAGE_KEY = 'cspp-display-top';

  const IDLE_MS = 3000;        // picker fades after the mouse is still this long

  const SCROLL_PX_PER_SEC = 28;
  const SCROLL_PAUSE_MS = 4000;    // at the top and at the bottom
  const MANUAL_HOLD_MS = 10000;    // after someone scrolls by hand

  const SOCIETY_URL = 'https://societies.tudublin.ie/societies/cscitycampus';

  /* --- Elements -------------------------------------------------- */

  const qrGame = document.getElementById('qr-game');
  const qrJoin = document.getElementById('qr-join');
  const gameUrlEl = document.getElementById('game-url');
  const listEl = document.getElementById('leaderboard');
  const liveEl = document.getElementById('live');
  const warningEl = document.getElementById('warning');

  const statPlayers = document.getElementById('stat-players');
  const statRuns = document.getElementById('stat-runs');
  const statTop = document.getElementById('stat-top');

  const topCountEl = document.getElementById('top-count');
  const topPicker = document.getElementById('top-picker');
  const topButtons = Array.from(topPicker.querySelectorAll('button[data-top]'));
  const topInput = document.getElementById('top-input');

  const params = new URLSearchParams(window.location.search);

  /* --- QR codes -------------------------------------------------- */

  /* The game URL defaults to whatever origin this page was served from, so
     opening the display straight from the server always produces a correct
     QR code with nothing to configure.

     An explicit override is supported for the case where the address you
     want players to scan differs from the one this screen is browsing —
     a short domain in front of the server, say:

       ?url=https://flappy.example.com

     Only http(s) is accepted; the server rejects anything else anyway. */
  const override = params.get('url');
  let gameUrl = window.location.origin + '/';

  if (override) {
    try {
      const parsed = new URL(override);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        gameUrl = parsed.href;
      } else {
        console.warn('Ignoring ?url= override: only http and https are allowed.');
      }
    } catch {
      console.warn('Ignoring ?url= override: not a valid absolute URL.');
    }
  }

  qrGame.src = '/api/qr?url=' + encodeURIComponent(gameUrl);
  qrJoin.src = '/api/qr?url=' + encodeURIComponent(SOCIETY_URL);

  // Strip the scheme for display; the QR carries the real thing.
  gameUrlEl.textContent = gameUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

  /* A QR code pointing at localhost is unreachable from any phone, which
     is a silent failure at a stand — the code scans fine and then the page
     never loads. Warn loudly instead.

     Checked against the URL actually being encoded, not the page's own
     address, so an explicit override of a real public URL is not flagged. */
  const encodedHost = new URL(gameUrl).hostname;
  if (encodedHost === 'localhost' || encodedHost === '127.0.0.1' || encodedHost === '::1') {
    warningEl.classList.remove('hidden');
  }

  /* --- How many players to show ---------------------------------- */

  /** A whole number from 1 to MAX_TOP, or null if the value is not one. */
  function parseTop(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n < 1) return null;
    return Math.min(n, MAX_TOP);
  }

  function readStoredTop() {
    try {
      return parseTop(localStorage.getItem(STORAGE_KEY));
    } catch {
      return null;   // storage blocked (private window, kiosk mode)
    }
  }

  // ?top=20 in the address wins, so a bookmark always opens the same way;
  // then whatever this browser last showed; then the default.
  let topN = parseTop(params.get('top')) || readStoredTop() || DEFAULT_TOP;

  function renderTopPicker() {
    topCountEl.textContent = topN;

    let isPreset = false;
    topButtons.forEach(function (btn) {
      const on = Number(btn.dataset.top) === topN;
      btn.setAttribute('aria-pressed', String(on));
      if (on) isPreset = true;
    });

    // A typed number that is not one of the buttons stays in the box
    topInput.value = isPreset ? '' : topN;
    topInput.classList.toggle('active', !isPreset);
  }

  function setTop(n) {
    const changed = n !== topN;
    topN = n;
    renderTopPicker();
    if (!changed) return;

    try {
      localStorage.setItem(STORAGE_KEY, String(n));
    } catch {
      // Not remembered across visits; the address below still is.
    }

    // Keep the address in step so a reload shows the same thing.
    const url = new URL(window.location.href);
    url.searchParams.set('top', n);
    history.replaceState(null, '', url);

    restartScroll();   // show the new list from the top
    refresh();
  }

  function applyTyped() {
    const n = parseTop(topInput.value);
    if (n) setTop(n);
    else renderTopPicker();   // empty or junk: put the box back as it was
  }

  topButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setTop(Number(btn.dataset.top));
    });
  });

  topPicker.addEventListener('submit', function (e) {
    e.preventDefault();
    applyTyped();
    topInput.blur();   // lets the picker fade out again
  });

  topInput.addEventListener('change', applyTyped);

  renderTopPicker();

  /* --- Picker visibility ----------------------------------------- */

  /* The picker only shows while the mouse is moving (or while it has
     focus), so the public screen is not cluttered with controls. */
  let idleTimer = 0;

  function wake() {
    document.body.classList.add('awake');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      document.body.classList.remove('awake');
    }, IDLE_MS);
  }

  ['mousemove', 'pointerdown', 'keydown', 'touchstart'].forEach(function (type) {
    document.addEventListener(type, wake, { passive: true });
  });

  wake();   // show it briefly on load, so it is clear it exists

  /* --- Rendering ------------------------------------------------- */

  // Remembers the last rendered scores so new or improved entries can be
  // highlighted rather than silently replaced.
  let previous = new Map();

  /* Rows are sized for at least MIN_SIZED_ROWS, so three players look like
     the top of a list rather than three giant bars — but never for more
     rows than are actually there, so a top 100 with twelve players still
     fills the board. */
  function sizeRows(count) {
    const rows = Math.max(Math.min(topN, MIN_SIZED_ROWS), count);
    listEl.style.setProperty('--rows', rows);
  }

  /** Swap the list contents without losing the auto-scroll position. */
  function replaceRows(items) {
    const keep = listEl.scrollTop;
    listEl.replaceChildren(...items);
    listEl.scrollTop = keep;
  }

  function renderLeaderboard(entries) {
    if (!entries.length) {
      setStatus('No scores yet — be the first!');
      previous = new Map();
      return;
    }

    const next = new Map();

    const items = entries.map(function (entry, index) {
      const li = document.createElement('li');

      if (index === 0) li.classList.add('top1');
      else if (index === 1) li.classList.add('top2');
      else if (index === 2) li.classList.add('top3');

      // Flash rows that are new or have improved since the last poll.
      const before = previous.get(entry.student_number);
      if (before === undefined || before !== entry.best_score) {
        li.classList.add('changed');
      }
      next.set(entry.student_number, entry.best_score);

      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = '[' + index + ']';

      // textContent, never innerHTML: names are player-supplied and this
      // screen is public, so markup in a name must never be parsed.
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = entry.name;

      const score = document.createElement('span');
      score.className = 'pscore';
      score.textContent = entry.best_score;

      li.append(rank, name, score);
      return li;
    });

    sizeRows(entries.length);
    replaceRows(items);
    previous = next;
  }

  function setStatus(message) {
    const li = document.createElement('li');
    li.className = 'status';
    li.textContent = message;
    replaceRows([li]);
  }

  function renderStats(stats) {
    statPlayers.textContent = stats.players;
    statRuns.textContent = stats.runs;
    statTop.textContent = stats.top_score;
  }

  /* --- Auto-scroll ----------------------------------------------- */

  /* When more rows are asked for than fit at a readable size, the list
     scrolls itself: a pause at the top, a slow glide down, a pause at the
     bottom, a quick glide back up. Nobody scrolls a screen at a stand.

     The position is tracked here rather than read back from scrollTop,
     which some browsers round to whole pixels — at this speed that would
     stall the glide entirely. */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let scrollPos = 0;
  let scrollPhase = 'top';     // top (pause) -> down -> bottom (pause) -> up
  let phaseStart = performance.now();
  let lastFrame = performance.now();
  let manualUntil = 0;

  function holdForHand() {
    manualUntil = performance.now() + MANUAL_HOLD_MS;
  }

  function restartScroll() {
    scrollPos = 0;
    scrollPhase = 'top';
    phaseStart = performance.now();
    listEl.scrollTop = 0;
  }

  listEl.addEventListener('wheel', holdForHand, { passive: true });
  listEl.addEventListener('touchstart', holdForHand, { passive: true });

  function scrollFrame(now) {
    // Capped, so a tab that was hidden for minutes does not jump.
    const step = Math.min(now - lastFrame, 100) / 1000 * SCROLL_PX_PER_SEC;
    lastFrame = now;

    const max = listEl.scrollHeight - listEl.clientHeight;
    const overflowing = max > 1;
    listEl.classList.toggle('scrolling', overflowing);

    if (!overflowing) {
      scrollPos = 0;
      scrollPhase = 'top';
      phaseStart = now;
    } else if (reduceMotion.matches || now < manualUntil) {
      // Leave the list wherever a person put it.
      scrollPos = listEl.scrollTop;
      phaseStart = now;
    } else {
      if (scrollPhase === 'down') {
        scrollPos = Math.min(scrollPos + step, max);
        if (scrollPos >= max) { scrollPhase = 'bottom'; phaseStart = now; }
      } else if (scrollPhase === 'up') {
        scrollPos = Math.max(scrollPos - step * 8, 0);
        if (scrollPos <= 0) { scrollPhase = 'top'; phaseStart = now; }
      } else if (now - phaseStart >= SCROLL_PAUSE_MS) {
        scrollPhase = scrollPhase === 'top' ? 'down' : 'up';
      }

      scrollPos = Math.min(scrollPos, max);   // the list may have shrunk
      listEl.scrollTop = scrollPos;
    }

    listEl.classList.toggle('at-top', scrollPos <= 1);
    listEl.classList.toggle('at-bottom', scrollPos >= max - 1);

    requestAnimationFrame(scrollFrame);
  }

  requestAnimationFrame(scrollFrame);

  /* --- Polling --------------------------------------------------- */

  let failures = 0;
  let firstLoad = true;
  let requestSeq = 0;

  async function refresh() {
    // Picking a new number mid-poll starts another request; only the
    // newest one may draw, or a slow reply could put the old count back.
    const seq = ++requestSeq;

    try {
      // Both in flight together: two sequential round trips would let the
      // board and the totals disagree for a moment.
      const [boardRes, statsRes] = await Promise.all([
        fetch('/api/leaderboard?limit=' + topN, { cache: 'no-store' }),
        fetch('/api/stats', { cache: 'no-store' })
      ]);

      if (!boardRes.ok || !statsRes.ok) throw new Error('bad response');

      const [board, stats] = await Promise.all([boardRes.json(), statsRes.json()]);

      if (seq !== requestSeq) return;

      renderLeaderboard(board);
      renderStats(stats);

      failures = 0;
      firstLoad = false;
      liveEl.classList.remove('stale');
      liveEl.title = 'Updating automatically';
    } catch (err) {
      if (seq !== requestSeq) return;

      failures++;
      console.error('Display refresh failed:', err);

      // Keep showing the last good board rather than blanking the screen —
      // a stale leaderboard is far more useful at a stand than an error.
      if (failures >= STALE_AFTER) {
        liveEl.classList.add('stale');
        liveEl.title = 'Not updating — check the server';
        if (firstLoad) setStatus('Cannot reach the server.');
      }
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);

  /* --- Resilience ------------------------------------------------ */

  // A screen left running for hours can be suspended by the OS; refresh
  // immediately on wake so it is never showing hours-old scores.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });
})();
