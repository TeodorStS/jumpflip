/* ===============================================================
   CS++ Flappy — stand display screen

   Read-only board for a laptop or TV at the event:
     - QR code to the game, derived from the address this page was
       opened at, so there is nothing to configure
     - QR code to society sign-up
     - live top-N leaderboard with event totals

   Polls the API rather than holding a socket open: the data changes
   every few seconds at most, and a plain fetch survives Wi-Fi drops
   without needing reconnection logic.
   =============================================================== */

(function () {
  'use strict';

  /* --- Tunables -------------------------------------------------- */

  const REFRESH_MS = 5000;     // how often to poll
  const TOP_N = 10;            // rows to show
  const STALE_AFTER = 3;       // consecutive failures before flagging stale

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

  /* --- QR codes -------------------------------------------------- */

  /* The game URL is whatever origin this page was served from, minus the
     page itself. Open the display at the machine's LAN IP and the QR code
     is automatically right — no config to forget or leave stale. */
  const gameUrl = window.location.origin + '/';

  qrGame.src = '/api/qr?url=' + encodeURIComponent(gameUrl);
  qrJoin.src = '/api/qr?url=' + encodeURIComponent(SOCIETY_URL);

  // Strip the scheme for display; the QR carries the real thing.
  gameUrlEl.textContent = gameUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

  /* A QR code pointing at localhost is unreachable from any phone, which
     is a silent failure at a stand — the code scans fine and then the page
     never loads. Warn loudly instead. */
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    warningEl.classList.remove('hidden');
  }

  /* --- Rendering ------------------------------------------------- */

  // Remembers the last rendered scores so new or improved entries can be
  // highlighted rather than silently replaced.
  let previous = new Map();

  function renderLeaderboard(entries) {
    listEl.textContent = '';

    if (!entries.length) {
      const li = document.createElement('li');
      li.className = 'status';
      li.textContent = 'No scores yet — be the first!';
      listEl.appendChild(li);
      previous = new Map();
      return;
    }

    const next = new Map();

    entries.forEach(function (entry, index) {
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
      listEl.appendChild(li);
    });

    previous = next;
  }

  function setStatus(message) {
    listEl.textContent = '';
    const li = document.createElement('li');
    li.className = 'status';
    li.textContent = message;
    listEl.appendChild(li);
  }

  function renderStats(stats) {
    statPlayers.textContent = stats.players;
    statRuns.textContent = stats.runs;
    statTop.textContent = stats.top_score;
  }

  /* --- Polling --------------------------------------------------- */

  let failures = 0;
  let firstLoad = true;

  async function refresh() {
    try {
      // Both in flight together: two sequential round trips would let the
      // board and the totals disagree for a moment.
      const [boardRes, statsRes] = await Promise.all([
        fetch('/api/leaderboard?limit=' + TOP_N, { cache: 'no-store' }),
        fetch('/api/stats', { cache: 'no-store' })
      ]);

      if (!boardRes.ok || !statsRes.ok) throw new Error('bad response');

      const [board, stats] = await Promise.all([boardRes.json(), statsRes.json()]);

      renderLeaderboard(board);
      renderStats(stats);

      failures = 0;
      firstLoad = false;
      liveEl.classList.remove('stale');
    } catch (err) {
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
