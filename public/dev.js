/* ===============================================================
   CS++ Flappy — dev page

   Every player with their student number, a CSV export for picking
   the winners (a plain link to /dev/players.csv), and a live monitor
   of the event. Polls every few seconds, so it can be left open.
   =============================================================== */

(function () {
  'use strict';

  const REFRESH_MS = 5000;
  const STALE_AFTER = 2;       // consecutive failures before showing red

  const rowsEl = document.getElementById('rows');
  const liveEl = document.getElementById('live');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');

  const statPlayers = document.getElementById('stat-players');
  const statRuns = document.getElementById('stat-runs');
  const statTop = document.getElementById('stat-top');
  const statLast = document.getElementById('stat-last');
  const statUptime = document.getElementById('stat-uptime');

  let latest = null;           // last good response
  let receivedAt = 0;          // performance.now() when it arrived
  let renderedPlayers = '';    // JSON of the rows on screen
  let failures = 0;
  let inFlight = false;

  /* --- Helpers --------------------------------------------------- */

  /** 75 -> "1m 15s", 7300 -> "2h 1m" */
  function duration(secs) {
    secs = Math.max(0, Math.floor(secs));
    if (secs < 60) return secs + 's';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return mins + 'm ' + (secs % 60) + 's';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ' + (mins % 60) + 'm';
    return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
  }

  function cell(text, className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    // textContent, never innerHTML: names are typed in by players.
    td.textContent = text;
    return td;
  }

  /* --- Rendering ------------------------------------------------- */

  function renderPlayers(players) {
    // Skip the redraw when nothing changed, so a student number being
    // selected for copying is not wiped out every five seconds.
    const json = JSON.stringify(players);
    if (json === renderedPlayers) return;
    renderedPlayers = json;

    if (!players.length) {
      const td = cell('No players yet.', 'empty');
      td.colSpan = 5;
      const tr = document.createElement('tr');
      tr.appendChild(td);
      rowsEl.replaceChildren(tr);
      return;
    }

    const rows = document.createDocumentFragment();

    players.forEach((p, i) => {
      const tr = document.createElement('tr');
      if (i < 3) tr.className = 'top' + (i + 1);

      tr.append(
        cell(i + 1, 'col-rank'),
        cell(p.name, 'col-name'),
        cell(p.student_number, 'col-id'),
        cell(p.best_score, 'num score'),
        cell(p.run_count, 'num')
      );
      rows.appendChild(tr);
    });

    rowsEl.replaceChildren(rows);
  }

  /* Runs every second so the times tick between polls. They come from
     the server and are advanced by the time since they arrived, so a
     laptop with its clock set wrong still shows the truth. */
  function renderClock() {
    const stale = failures >= STALE_AFTER;

    liveEl.className = 'live ' + (latest && !stale ? 'ok' : stale ? 'bad' : '');
    statusEl.classList.toggle('bad', stale);

    if (!latest) {
      statusText.textContent = stale ? 'Cannot reach the server' : 'Connecting…';
      return;
    }

    const since = (performance.now() - receivedAt) / 1000;

    statusText.textContent = stale
      ? 'Cannot reach the server — last update ' + duration(since) + ' ago'
      : 'Live — updated ' + duration(since) + ' ago';

    statLast.textContent = latest.last_game_secs_ago === null
      ? '–'
      : duration(latest.last_game_secs_ago + since) + ' ago';

    // Uptime resetting to seconds means the server restarted.
    statUptime.textContent = stale ? '–' : duration(latest.uptime_secs + since);
  }

  /* --- Polling --------------------------------------------------- */

  async function refresh() {
    if (inFlight) return;
    inFlight = true;

    try {
      const res = await fetch('/dev/api/players', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const data = await res.json();

      latest = data;
      receivedAt = performance.now();
      failures = 0;

      renderPlayers(data.players);
      statPlayers.textContent = data.stats.players;
      statRuns.textContent = data.stats.runs;
      statTop.textContent = data.stats.top_score;
    } catch (err) {
      failures++;
      console.error('Dev page refresh failed:', err);
      // The last good table stays on screen; the status line says it is old.
    } finally {
      inFlight = false;
      renderClock();
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(renderClock, 1000);

  // A laptop that slept shows hours-old numbers until the next poll.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
})();
