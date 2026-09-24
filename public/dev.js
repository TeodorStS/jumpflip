/* ===============================================================
   CS++ Flappy — dev page

   Every player with their student number and attempt figures, a CSV
   export (a plain link to /dev/players.csv), a live monitor of the
   event, and deletion of players or single attempts. Polls every few
   seconds, so it can be left open all day.

   The server guards all of this with ADMIN_PASSWORD; by the time this
   script runs, the browser has already been let in.
   =============================================================== */

(function () {
  'use strict';

  const REFRESH_MS = 5000;
  const STALE_AFTER = 2;             // consecutive failures before showing red
  const REQUEST_TIMEOUT_MS = 8000;

  /* --- Elements -------------------------------------------------- */

  const rowsEl = document.getElementById('rows');
  const liveEl = document.getElementById('live');
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const filterEl = document.getElementById('filter');
  const countEl = document.getElementById('count');
  const toastEl = document.getElementById('toast');

  const stat = {
    players: document.getElementById('stat-players'),
    runs: document.getElementById('stat-runs'),
    top: document.getElementById('stat-top'),
    avg: document.getElementById('stat-avg'),
    recent: document.getElementById('stat-recent'),
    last: document.getElementById('stat-last'),
    uptime: document.getElementById('stat-uptime')
  };

  const dialog = document.getElementById('player');
  const dialogName = document.getElementById('player-name');
  const dialogId = document.getElementById('player-id');
  const dialogSummary = document.getElementById('player-summary');
  const runsEl = document.getElementById('runs');
  const dialogDelete = document.getElementById('player-delete');
  const dialogClose = document.getElementById('player-close');

  /* --- State ----------------------------------------------------- */

  let players = [];
  let stats = null;
  let clockOffset = 0;     // server clock minus this laptop's clock, in ms
  let serverStart = 0;     // when the server started, on its own clock
  let receivedAt = 0;      // performance.now() of the last good response
  let failures = 0;
  let problem = '';        // what went wrong with the last request
  let requestSeq = 0;
  let renderedKey = '';    // what the table shows, so identical polls skip the redraw
  let agoCells = [];       // [element, timestamp] pairs re-rendered every second
  let openPlayer = null;   // the player shown in the dialog
  let runsSeq = 0;

  /* --- Time ------------------------------------------------------ */

  /** SQLite's "2026-09-23 14:05:09" (always UTC) as milliseconds, or null. */
  function parseTime(ts) {
    return ts ? Date.parse(ts.replace(' ', 'T') + 'Z') : null;
  }

  /* "Now" on the server's clock, so a laptop whose clock is wrong still
     shows correct "3m ago" figures. */
  function serverNow() {
    return Date.now() + clockOffset;
  }

  /** 45 -> "45s", 75 -> "1m", 7300 -> "2h 1m" — seconds only while they matter */
  function duration(secs) {
    if (!Number.isFinite(secs)) return '–';   // missing data, never "NaNd NaNh"
    secs = Math.max(0, Math.floor(secs));
    if (secs < 60) return secs + 's';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return mins + 'm';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ' + (mins % 60) + 'm';
    return Math.floor(hours / 24) + 'd ' + (hours % 24) + 'h';
  }

  function ago(ms) {
    return ms === null ? '–' : duration((serverNow() - ms) / 1000) + ' ago';
  }

  /** Wall-clock time in this laptop's timezone, with the date if not today. */
  function clockTime(ms) {
    const d = new Date(ms);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return time;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + time;
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  /* --- Helpers --------------------------------------------------- */

  function cell(text, className) {
    const td = document.createElement('td');
    if (className) td.className = className;
    // textContent, never innerHTML: names are typed in by players.
    td.textContent = text;
    return td;
  }

  function button(text, className, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  let toastTimer = 0;

  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.className = 'toast ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3500);
  }

  function request(url, options) {
    // Without a timeout a hung connection would leave the page saying
    // "Live" forever.
    const signal = AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
    return fetch(url, Object.assign({ cache: 'no-store', signal }, options));
  }

  /** The server's error message from a failed response. */
  async function errorFrom(res) {
    const body = await res.json().catch(() => ({}));
    return body.error || 'HTTP ' + res.status;
  }

  function describeStatus(status) {
    if (status === 401) return 'Password needed — reload the page';
    if (status === 503) return 'The dev page is switched off on the server';
    return 'Server error ' + status;
  }

  /* --- Table ----------------------------------------------------- */

  function visiblePlayers() {
    const q = filterEl.value.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) =>
      p.name.toLowerCase().includes(q) || p.student_number.toLowerCase().includes(q));
  }

  function renderPlayers() {
    const list = visiblePlayers();

    // Skip identical redraws, so a student number selected for copying is
    // not wiped out every five seconds.
    const key = players.length + '|' + JSON.stringify(list);
    if (key === renderedKey) return;
    renderedKey = key;

    countEl.textContent = list.length === players.length
      ? plural(players.length, 'player')
      : list.length + ' of ' + players.length;

    agoCells = [];

    if (!list.length) {
      const td = cell(players.length ? 'No matches.' : 'No players yet.', 'empty');
      td.colSpan = 8;
      const tr = document.createElement('tr');
      tr.appendChild(td);
      rowsEl.replaceChildren(tr);
      return;
    }

    const rows = document.createDocumentFragment();

    list.forEach((p) => {
      const tr = document.createElement('tr');
      if (p.rank <= 3) tr.className = 'top' + p.rank;

      const attempts = document.createElement('td');
      attempts.className = 'num';
      const attemptsBtn = button(p.run_count, 'link-btn', () => openDialog(p.student_number));
      attemptsBtn.title = 'Show every attempt';
      attempts.appendChild(attemptsBtn);

      const lastPlayed = parseTime(p.last_played);
      const when = cell(ago(lastPlayed), 'col-when');
      if (lastPlayed !== null) {
        when.title = clockTime(lastPlayed);
        agoCells.push([when, lastPlayed]);
      }

      const actions = document.createElement('td');
      actions.className = 'col-actions';
      const del = button('Delete', 'btn-danger', () => confirmDeletePlayer(p));
      del.setAttribute('aria-label', 'Delete ' + p.name);
      actions.appendChild(del);

      tr.append(
        cell(p.rank, 'col-rank'),
        cell(p.name, 'col-name'),
        cell(p.student_number, 'col-id'),
        cell(p.best_score, 'num score'),
        attempts,
        cell(p.avg_score, 'num col-avg'),
        when,
        actions
      );
      rows.appendChild(tr);
    });

    rowsEl.replaceChildren(rows);
  }

  function renderStats() {
    stat.players.textContent = stats.players;
    stat.runs.textContent = stats.runs;
    stat.top.textContent = stats.top_score;
    stat.avg.textContent = stats.avg_run_score;
    stat.recent.textContent = stats.runs_last_10m;
  }

  /* Runs every second, so the times tick between polls. */
  function renderClock() {
    const stale = failures >= STALE_AFTER;

    liveEl.className = 'live' + (stale ? ' bad' : stats ? ' ok' : '');
    statusEl.classList.toggle('bad', stale);

    if (!stats) {
      statusText.textContent = stale ? problem : 'Connecting…';
      return;
    }

    const since = duration((performance.now() - receivedAt) / 1000);
    statusText.textContent = stale
      ? problem + ' — last update ' + since + ' ago'
      : 'Live — updated ' + since + ' ago';

    stat.last.textContent = ago(parseTime(stats.last_run_at));
    // Dropping back to seconds means the server restarted.
    stat.uptime.textContent = stale ? '–' : duration((serverNow() - serverStart) / 1000);

    agoCells.forEach(([el, ms]) => { el.textContent = ago(ms); });
  }

  /* --- Polling --------------------------------------------------- */

  async function refresh() {
    // Deleting triggers an extra refresh alongside the timed ones; only
    // the newest may draw, or a slow reply could bring back a deleted row.
    const seq = ++requestSeq;

    try {
      const res = await request('/dev/api/players');
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { problem: describeStatus(res.status) });

      const data = await res.json();
      if (seq !== requestSeq) return;

      clockOffset = data.server_time - Date.now();
      serverStart = data.server_time - data.uptime_secs * 1000;
      receivedAt = performance.now();
      failures = 0;

      players = data.players;
      players.forEach((p, i) => { p.rank = i + 1; });
      stats = data.stats;

      renderStats();
      renderPlayers();
      syncDialog();
    } catch (err) {
      if (seq !== requestSeq) return;
      failures++;
      problem = err.problem || 'Cannot reach the server';
      console.error('Dev page refresh failed:', err);
      // The last good table stays on screen; the status line says it is old.
    } finally {
      if (seq === requestSeq) renderClock();
    }
  }

  /* --- Player dialog --------------------------------------------- */

  function openDialog(studentNumber) {
    const player = players.find((p) => p.student_number === studentNumber);
    if (!player) return;

    openPlayer = player;
    renderDialogHead();
    runsEl.replaceChildren(plainItem('Loading…'));
    dialog.showModal();
    loadRuns();
  }

  function renderDialogHead() {
    const p = openPlayer;
    const first = parseTime(p.first_played);

    dialogName.textContent = p.name;
    dialogId.textContent = p.student_number + ' · rank ' + p.rank;
    dialogSummary.textContent =
      'Best ' + p.best_score + ' · ' + plural(p.run_count, 'attempt') + ' · average ' + p.avg_score +
      (first !== null ? ' · first played ' + clockTime(first) : '');
  }

  function plainItem(text) {
    const li = document.createElement('li');
    li.className = 'plain';
    li.textContent = text;
    return li;
  }

  async function loadRuns() {
    const player = openPlayer;
    const seq = ++runsSeq;

    try {
      const res = await request('/dev/api/players/' + encodeURIComponent(player.student_number) + '/runs');
      if (!res.ok) throw new Error(await errorFrom(res));

      const { runs } = await res.json();
      if (seq === runsSeq) renderRuns(runs, player);
    } catch (err) {
      if (seq === runsSeq) runsEl.replaceChildren(plainItem('Could not load attempts: ' + err.message));
    }
  }

  function renderRuns(runs, player) {
    if (!runs.length) {
      runsEl.replaceChildren(plainItem('No attempts recorded.'));
      return;
    }

    // The attempt their best score came from: the earliest with the top score.
    const top = Math.max(...runs.map((r) => r.score));
    const bestId = Math.min(...runs.filter((r) => r.score === top).map((r) => r.id));

    const items = runs.map((run) => {
      const li = document.createElement('li');
      if (run.id === bestId) li.classList.add('best');

      const score = document.createElement('span');
      score.className = 'run-score';
      score.textContent = run.score;

      const played = parseTime(run.played_at);
      const when = document.createElement('span');
      when.className = 'run-when';
      when.textContent = clockTime(played) + ' · ' + ago(played);

      li.append(score, when);

      if (run.id === bestId) {
        const tag = document.createElement('span');
        tag.className = 'best-tag';
        tag.textContent = 'BEST';
        li.append(tag);
      }

      const del = button('Delete', 'btn-danger', () => confirmDeleteRun(run, player, del));
      del.setAttribute('aria-label', 'Delete the attempt scoring ' + run.score);
      li.append(del);

      return li;
    });

    runsEl.replaceChildren(...items);
  }

  /* Keep an open dialog in step with new data: a player who plays again
     gets the new attempt listed; one deleted elsewhere closes it. */
  function syncDialog() {
    if (!dialog.open || !openPlayer) return;

    const now = players.find((p) => p.student_number === openPlayer.student_number);

    if (!now) {
      dialog.close();
      return;
    }

    const changed = now.run_count !== openPlayer.run_count ||
      now.best_score !== openPlayer.best_score || now.rank !== openPlayer.rank;

    openPlayer = now;
    if (changed) {
      renderDialogHead();
      loadRuns();
    }
  }

  dialogClose.addEventListener('click', () => dialog.close());
  dialogDelete.addEventListener('click', () => { if (openPlayer) confirmDeletePlayer(openPlayer); });

  // A click on the dimmed backdrop lands on the <dialog> element itself.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  dialog.addEventListener('close', () => {
    openPlayer = null;
    runsSeq++;   // ignore any attempt list still on its way
  });

  /* --- Deleting -------------------------------------------------- */

  async function confirmDeletePlayer(player) {
    const sure = window.confirm(
      'Delete ' + player.name + ' (' + player.student_number + ')?\n\n' +
      'Their ' + plural(player.run_count, 'attempt') + ' will be deleted too. ' +
      'This cannot be undone.'
    );
    if (!sure) return;

    try {
      const res = await request('/dev/api/players/' + encodeURIComponent(player.student_number),
                                { method: 'DELETE' });
      if (!res.ok) throw new Error(await errorFrom(res));

      if (dialog.open) dialog.close();
      toast('Deleted ' + player.name, 'ok');
    } catch (err) {
      toast('Delete failed: ' + err.message, 'err');
    }

    refresh();
  }

  async function confirmDeleteRun(run, player, btn) {
    const onlyAttempt = player.run_count === 1;
    const sure = window.confirm(
      'Delete the attempt scoring ' + run.score + ' from ' + clockTime(parseTime(run.played_at)) + '?\n\n' +
      (onlyAttempt
        ? 'It is ' + player.name + "'s only attempt, so they will be removed from the leaderboard. "
        : 'Their best score is worked out again from the attempts that are left. ') +
      'This cannot be undone.'
    );
    if (!sure) return;

    btn.disabled = true;

    try {
      const res = await request('/dev/api/runs/' + run.id, { method: 'DELETE' });
      if (!res.ok) throw new Error(await errorFrom(res));

      const result = await res.json();
      if (result.player_removed) {
        dialog.close();
        toast(player.name + ' removed — that was their only attempt', 'ok');
      } else {
        toast('Attempt deleted', 'ok');
      }
    } catch (err) {
      btn.disabled = false;
      toast('Delete failed: ' + err.message, 'err');
    }

    // The dialog's list and summary follow via syncDialog().
    refresh();
  }

  /* --- Wiring ---------------------------------------------------- */

  filterEl.addEventListener('input', renderPlayers);

  refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(renderClock, 1000);

  // A laptop that slept shows hours-old numbers until the next poll.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
})();
