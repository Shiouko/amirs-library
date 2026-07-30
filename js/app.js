/* ==========================================================================
   AMIR'S LIBRARY — Application (vanilla JS, no frameworks)
   --------------------------------------------------------------------------
   Responsibilities:
     1. Fetch data/library.json (single source of truth)
     2. Hash router: #/ (library) and #/entry/<id> (detail)
     3. Library view: stats strip, live search, type tabs, status chips,
        sort, card grid with staggered entry animations
     4. Detail view: all panels, animated progress bar, timeline, links
     5. Ink-splash transition on card navigation
     6. Esc key returns from detail; footer year
   Maintained by an AI agent — keep structure clear and comments honest.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------- Constants & config ---------------- */
  const DATA_URL = 'data/library.json';
  const SEARCH_DEBOUNCE_MS = 150;   // live search debounce
  const STAGGER_STEP_MS = 60;       // card entry stagger step
  const STAGGER_CAP = 12;           // max stagger steps before instant
  const FILTER_STAGGER_MS = 30;     // faster stagger on re-filter
  const SPLASH_MS = 520;            // ink-splash duration (CSS: 0.5s)
  const COUNTUP_MS = 300;           // stats count-up duration
  const SYNOPSIS_CLAMP_LEN = 300;   // chars before "Read more" toggle

  const TYPE_META = {
    anime:  { label: 'ANIME',  glyph: 'ア' },
    manga:  { label: 'MANGA',  glyph: '漫' },
    manhwa: { label: 'MANHWA', glyph: '만' },
    manhua: { label: 'MANHUA', glyph: '漫' }
  };

  const STATUS_META = {
    reading:   { label: 'READING' },
    completed: { label: 'COMPLETED' },
    plan:      { label: 'PLAN TO READ' },
    paused:    { label: 'PAUSED' },
    dropped:   { label: 'DROPPED' }
  };

  const TYPE_ORDER = ['all', 'anime', 'manga', 'manhwa', 'manhua'];
  const STATUS_ORDER = ['all', 'reading', 'completed', 'plan', 'paused', 'dropped'];

  /* ---------------- State ---------------- */
  const state = {
    data: null,            // parsed library.json { meta, entries }
    entries: [],           // convenience alias for state.data.entries
    search: '',            // current search text (lowercased)
    type: 'all',           // active type tab
    status: 'all',         // active status chip
    sort: 'updated',       // active sort key
    route: null            // { name: 'library' } | { name: 'entry', id }
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- DOM refs ---------------- */
  const $view = document.getElementById('view');
  const $splash = document.querySelector('.splash');
  const $lastUpdated = document.getElementById('last-updated');
  const $totalStamp = document.getElementById('total-stamp');
  const $footerYear = document.getElementById('footer-year');

  /* ---------------- Small utilities ---------------- */

  /** Escape HTML for safe interpolation. */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Format ISO date (YYYY-MM-DD) as "Jul 30, 2026". */
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /** Format ISO datetime for the masthead "LAST UPDATED" strip. */
  function fmtUpdated(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /** Progress ratio 0..1 for an entry (null when total unknown). */
  function progressRatio(e) {
    if (!e.progressTotal) return null;
    return Math.min(1, (e.progressCurrent || 0) / e.progressTotal);
  }

  /** "Ch. 120 / 210" or "Ch. 120 · Ongoing" style line. */
  function progressText(e) {
    const label = e.progressLabel || 'Ch.';
    const cur = e.progressCurrent || 0;
    if (!e.progressTotal) return `${label} ${cur} · Ongoing`;
    return `${label} ${cur} / ${e.progressTotal}`;
  }

  /** Score display, e.g. "8.5" (strip trailing .0). */
  function fmtScore(s) {
    if (s == null) return null;
    return Number.isInteger(s) ? String(s) : String(s);
  }

  /* ---------------- Data loading ---------------- */

  async function loadData() {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: ${res.status}`);
    const json = await res.json();
    state.data = json;
    state.entries = Array.isArray(json.entries) ? json.entries : [];
  }

  /* ---------------- Masthead ---------------- */

  function renderMasthead() {
    $lastUpdated.textContent = fmtUpdated(state.data.meta.lastUpdated);
    const n = state.entries.length;
    $totalStamp.textContent = `${n} ${n === 1 ? 'TITLE' : 'TITLES'}`;
  }

  /* ---------------- Stats strip (count-up numbers) ---------------- */

  function computeStats() {
    const entries = state.entries;
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    let thisMonth = 0;
    let prevProgress = 0;
    for (const e of entries) {
      // Sum of units logged this month = latest progress minus progress
      // at the last history entry before this month (approximation of delta).
      const monthEntries = (e.history || []).filter(h => h.date && h.date.startsWith(ym));
      if (monthEntries.length) {
        const before = (e.history || []).filter(h => h.date && h.date < ym + '-01');
        const base = before.length ? before[before.length - 1].progress : 0;
        const latest = monthEntries[monthEntries.length - 1].progress;
        thisMonth += Math.max(0, latest - base);
      }
    }

    const scores = entries.map(e => e.score).filter(s => s != null);
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    return {
      total: entries.length,
      reading: entries.filter(e => e.status === 'reading').length,
      completed: entries.filter(e => e.status === 'completed').length,
      queued: entries.filter(e => e.status === 'plan').length,
      thisMonth,
      avg
    };
  }

  /** Animate a number from 0 to target over COUNTUP_MS. */
  function countUp(el, target, decimals) {
    const suffix = el.querySelector('.stat-suffix');
    const setText = (v) => {
      el.childNodes[0].nodeValue = decimals ? v.toFixed(decimals) : String(v);
    };
    if (reducedMotion || target === 0) {
      setText(target);
      return;
    }
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / COUNTUP_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setText(decimals ? +(target * eased).toFixed(decimals) : Math.round(target * eased));
      if (t < 1) requestAnimationFrame(tick);
      else setText(decimals ? target : target);
    }
    requestAnimationFrame(tick);
  }

  function renderStats() {
    const s = computeStats();
    const avgText = s.avg == null ? '—' : s.avg.toFixed(1);

    const statDefs = [
      { key: 'total',     label: 'Total',     value: s.total,     cls: '' },
      { key: 'reading',   label: 'Reading',   value: s.reading,   cls: 'stat--reading' },
      { key: 'completed', label: 'Completed', value: s.completed, cls: 'stat--completed' },
      { key: 'queued',    label: 'Queued',    value: s.queued,    cls: 'stat--queued' },
      { key: 'month',     label: 'This Month', value: s.thisMonth, cls: '', sub: 'ch/ep logged' },
      { key: 'avg',       label: 'Avg Score', value: null,        cls: '', text: avgText }
    ];

    const html = statDefs.map(def => `
      <div class="stat ${def.cls}">
        <div class="stat-num" data-stat="${def.key}">${def.text != null ? esc(def.text) : '0'}${def.sub ? `<span class="stat-suffix">${esc(def.sub)}</span>` : ''}</div>
        <div class="stat-label">${esc(def.label)}</div>
      </div>`).join('');

    return `<div class="stats-strip">${html}</div><div class="speedlines" aria-hidden="true"></div>`;
  }

  function animateStats(container) {
    const s = computeStats();
    const map = { total: s.total, reading: s.reading, completed: s.completed, queued: s.queued, month: s.thisMonth };
    container.querySelectorAll('.stat-num[data-stat]').forEach(el => {
      const key = el.dataset.stat;
      if (key in map) countUp(el, map[key], 0);
    });
  }

  /* ---------------- Filter bar ---------------- */

  function typeCounts() {
    const counts = { all: state.entries.length };
    for (const t of ['anime', 'manga', 'manhwa', 'manhua']) {
      counts[t] = state.entries.filter(e => e.type === t).length;
    }
    return counts;
  }

  function renderFilterBar() {
    const counts = typeCounts();
    const tabs = TYPE_ORDER.map(t => {
      const active = state.type === t ? ' is-active' : '';
      const label = t === 'all' ? 'ALL' : TYPE_META[t].label;
      return `<button class="type-tab${active}" data-type="${t}" type="button">${label}<span class="tab-count">${counts[t]}</span></button>`;
    }).join('');

    const chips = STATUS_ORDER.map(s => {
      const active = state.status === s ? ' is-active' : '';
      const label = s === 'all' ? 'All' : STATUS_META[s].label;
      return `<button class="chip${active}" data-status="${s}" type="button">${label}</button>`;
    }).join('');

    return `
      <div class="filter-bar">
        <div class="filter-row">
          <div class="search-wrap">
            <span class="search-mark" aria-hidden="true">検</span>
            <input id="search" type="search" placeholder="Search titles..." value="${esc(state.search)}" autocomplete="off" aria-label="Search titles">
          </div>
          <div class="type-tabs" role="tablist" aria-label="Filter by type">${tabs}</div>
        </div>
        <div class="filter-row">
          <div class="status-chips" role="group" aria-label="Filter by status">${chips}</div>
          <div class="sort-wrap">
            <label class="sort-label" for="sort">Sort</label>
            <select id="sort">
              <option value="updated"${state.sort === 'updated' ? ' selected' : ''}>Recently updated</option>
              <option value="title"${state.sort === 'title' ? ' selected' : ''}>Title A–Z</option>
              <option value="score"${state.sort === 'score' ? ' selected' : ''}>Score</option>
              <option value="progress"${state.sort === 'progress' ? ' selected' : ''}>Progress</option>
            </select>
          </div>
        </div>
      </div>
      <p class="result-line" id="result-line"></p>`;
  }

  /* ---------------- Filtering & sorting ---------------- */

  function getFilteredEntries() {
    let list = state.entries.slice();

    if (state.type !== 'all') list = list.filter(e => e.type === state.type);
    if (state.status !== 'all') list = list.filter(e => e.status === state.status);
    if (state.search) {
      const q = state.search;
      list = list.filter(e => {
        const hay = [e.title, ...(e.altTitles || []), ...(e.authors || [])]
          .join(' ').toLowerCase();
        return hay.includes(q);
      });
    }

    switch (state.sort) {
      case 'title':
        list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
        break;
      case 'score':
        list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
        break;
      case 'progress':
        list.sort((a, b) => (progressRatio(b) ?? -1) - (progressRatio(a) ?? -1));
        break;
      case 'updated':
      default:
        list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        break;
    }
    return list;
  }

  /* ---------------- Card rendering ---------------- */

  function coverHTML(e, extraClass) {
    const tm = TYPE_META[e.type] || TYPE_META.manga;
    const badge = `<span class="type-badge type-badge--${esc(e.type)}"><span class="badge-glyph">${tm.glyph}</span>${tm.label}</span>`;
    const ribbon = e.status === 'completed' ? `<span class="ribbon">DONE</span>` : '';
    const score = fmtScore(e.score);
    const scoreStamp = score != null ? `<span class="score-stamp">★ ${esc(score)}</span>` : '';

    // Status underline for reading/paused/dropped
    const underlineStatuses = ['reading', 'paused', 'dropped'];
    const underline = underlineStatuses.includes(e.status)
      ? `<span class="status-underline status-underline--${e.status}"></span>` : '';

    const img = e.coverUrl
      ? `<img class="cover-img" src="${esc(e.coverUrl)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cover-fallback',textContent:'${tm.glyph}'}))">`
      : `<div class="cover-fallback">${tm.glyph}</div>`;

    return `<div class="cover-frame${extraClass ? ' ' + extraClass : ''}">${img}${badge}${ribbon}${scoreStamp}${underline}</div>`;
  }

  function cardHTML(e, index, staggerMs) {
    const ratio = progressRatio(e);
    const pct = ratio == null ? 0 : Math.round(ratio * 100);
    const fillCls = e.status === 'completed' ? ' progress-fill--done' : '';
    const droppedCls = e.status === 'dropped' ? ' card--dropped' : '';

    let progressArea;
    if (e.status === 'plan') {
      progressArea = `
        <div class="progress-area--plan">
          <span class="plan-flag">Up next on the shelf</span>
        </div>`;
    } else {
      progressArea = `
        <p class="progress-line">${esc(progressText(e))}</p>
        <div class="progress-track"><div class="progress-fill${fillCls}" style="width:${pct}%"></div></div>`;
    }

    const delay = Math.min(index, STAGGER_CAP) * staggerMs;
    const style = (!reducedMotion && delay > 0) ? ` style="animation-delay:${delay}ms"` : '';

    return `
      <a class="card pop-in${droppedCls}" href="#/entry/${encodeURIComponent(e.id)}"${style} data-id="${esc(e.id)}">
        ${coverHTML(e)}
        <div class="card-body">
          <h3 class="card-title">${esc(e.title)}</h3>
          ${progressArea}
        </div>
      </a>`;
  }

  function emptyStateHTML(reason) {
    const totalEmpty = state.entries.length === 0;
    let title, hint;
    if (totalEmpty) {
      title = 'The shelf is empty';
      hint = 'No titles yet — tell Liora what you\'re reading and the shelf will fill itself.';
    } else if (reason === 'search') {
      title = 'Nothing here yet';
      hint = `No titles match “${esc(state.search)}”. Try a different search.`;
    } else {
      title = 'Nothing here yet';
      hint = 'No titles match the current filters. Try clearing them.';
    }
    return `
      <div class="empty-panel">
        <span class="empty-kanji-side empty-kanji-side--l" aria-hidden="true">空っぽの棚</span>
        <span class="empty-kanji-side empty-kanji-side--r" aria-hidden="true">次の一冊を</span>
        <div class="empty-inner">
          <p class="empty-glyph">空</p>
          <h2 class="empty-title">${title}</h2>
          <p class="empty-hint">${hint}</p>
        </div>
      </div>`;
  }

  /* ---------------- Library view ---------------- */

  function renderLibrary() {
    const filtered = getFilteredEntries();
    const total = state.entries.length;
    const emptyReason = state.search ? 'search' : 'filters';

    const grid = filtered.length
      ? `<div class="card-grid">${filtered.map((e, i) => cardHTML(e, i, state.search || state.type !== 'all' || state.status !== 'all' ? FILTER_STAGGER_MS : STAGGER_STEP_MS)).join('')}</div>`
      : emptyStateHTML(emptyReason);

    $view.innerHTML = renderStats() + renderFilterBar() + grid;

    // Result line
    const $result = document.getElementById('result-line');
    if (total === 0) {
      $result.textContent = '';
    } else if (filtered.length === total) {
      $result.innerHTML = `Showing <strong>${total}</strong> ${total === 1 ? 'title' : 'titles'}`;
    } else {
      $result.innerHTML = `Showing <strong>${filtered.length}</strong> of ${total} ${total === 1 ? 'title' : 'titles'}`;
    }

    animateStats($view);
    bindFilterEvents();
  }

  function bindFilterEvents() {
    const $search = document.getElementById('search');
    let debounce = null;
    $search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.search = $search.value.trim().toLowerCase();
        renderLibrary();
        // Restore focus after re-render (input is replaced)
        const el = document.getElementById('search');
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      }, SEARCH_DEBOUNCE_MS);
    });

    $view.querySelectorAll('.type-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.type = btn.dataset.type;
        renderLibrary();
      });
    });

    $view.querySelectorAll('.chip').forEach(btn => {
      btn.addEventListener('click', () => {
        state.status = btn.dataset.status;
        renderLibrary();
      });
    });

    document.getElementById('sort').addEventListener('change', (ev) => {
      state.sort = ev.target.value;
      renderLibrary();
    });
  }

  /* ---------------- Detail view ---------------- */

  function detailHTML(e) {
    const tm = TYPE_META[e.type] || TYPE_META.manga;
    const sm = STATUS_META[e.status] || { label: e.status };
    const ratio = progressRatio(e);
    const pct = ratio == null ? null : Math.round(ratio * 100);
    const score = fmtScore(e.score);

    // Cover (reuses badge)
    const cover = `
      <div class="detail-cover-wrap">
        <div class="detail-cover">
          ${e.coverUrl
            ? `<img src="${esc(e.coverUrl)}" alt="${esc(e.title)} cover" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cover-fallback',textContent:'${tm.glyph}'}))">`
            : `<div class="cover-fallback">${tm.glyph}</div>`}
          <span class="type-badge type-badge--${esc(e.type)}"><span class="badge-glyph">${tm.glyph}</span>${tm.label}</span>
        </div>
      </div>`;

    // Title block
    const alt = (e.altTitles && e.altTitles.length)
      ? `<p class="detail-alt">${e.altTitles.map(t => `<span class="alt-jp">${esc(t)}</span>`).join(' · ')}</p>` : '';
    const bylineParts = [];
    if (e.authors && e.authors.length) bylineParts.push(`<strong>${esc(e.authors.join(', '))}</strong>`);
    if (e.year) bylineParts.push(String(e.year));
    if (e.format) bylineParts.push(esc(e.format));
    const byline = bylineParts.length ? `<p class="detail-byline">${bylineParts.join(' · ')}</p>` : '';

    // Status + score row
    const scoreHTML = score != null
      ? `<span class="score-stamp detail-score">★ ${esc(score)}</span>`
      : `<span class="rate-later">Rate later</span>`;

    // Progress panel
    const label = e.progressLabel || 'Ch.';
    const cur = e.progressCurrent || 0;
    let progressBig, trackHTML, metaHTML;
    if (e.status === 'plan') {
      progressBig = `<span class="prog-ongoing">QUEUED — NOT STARTED</span>`;
      trackHTML = '';
      metaHTML = `<span>Waiting on the shelf</span>`;
    } else if (e.progressTotal) {
      progressBig = `${label} ${cur}<span class="prog-slash">/</span>${e.progressTotal}`;
      trackHTML = `<div class="progress-track progress-track--big"><div class="progress-fill${e.status === 'completed' ? ' progress-fill--done' : ''}" data-target="${pct}"></div></div>`;
      metaHTML = `<span class="progress-pct">${pct}%</span><span>${e.status === 'completed' ? 'Series complete' : `${e.progressTotal - cur} to go`}</span>`;
    } else {
      progressBig = `${label} ${cur}<span class="prog-slash">—</span><span class="prog-ongoing">SERIES ONGOING</span>`;
      trackHTML = '';
      metaHTML = `<span>Keeping up with releases</span>`;
    }

    const dates = [];
    if (e.startedAt) dates.push(`Started <strong>${fmtDate(e.startedAt)}</strong>`);
    if (e.completedAt) dates.push(`Completed <strong>${fmtDate(e.completedAt)}</strong>`);
    const dateLine = dates.length ? `<p class="date-line">${dates.join(' · ')}</p>` : '';

    const progressPanel = `
      <section class="panel">
        <span class="caption-strip panel-tab">Progress</span>
        <div class="progress-big">${progressBig}</div>
        ${trackHTML}
        <div class="progress-meta">${metaHTML}</div>
        ${dateLine}
      </section>`;

    // Synopsis panel (clamp toggle if long)
    const syn = e.synopsis || '';
    const needsClamp = syn.length > SYNOPSIS_CLAMP_LEN;
    const synopsisPanel = syn ? `
      <section class="panel">
        <span class="caption-strip panel-tab">Synopsis</span>
        <p class="synopsis-text${needsClamp ? ' is-clamped' : ''}" id="synopsis">${esc(syn)}</p>
        ${needsClamp ? `<button class="clamp-toggle" id="clamp-toggle" type="button">Read more</button>` : ''}
      </section>` : '';

    // Genres
    const genresPanel = (e.genres && e.genres.length) ? `
      <section class="panel">
        <span class="caption-strip panel-tab">Genres</span>
        <div class="genre-row">${e.genres.map(g => `<span class="genre-tag">${esc(g)}</span>`).join('')}</div>
      </section>` : '';

    // History timeline (newest first)
    const history = (e.history || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    const timelineBody = history.length
      ? `<ul class="timeline">${history.map(h => `
          <li>
            <span class="tl-date">${fmtDate(h.date)}</span>
            <p class="tl-text">reached ${esc(e.progressLabel || 'Ch.')} ${esc(h.progress)}</p>
            ${h.note ? `<p class="tl-note">${esc(h.note)}</p>` : ''}
          </li>`).join('')}</ul>`
      : `<p class="timeline-empty">No progress logged yet.</p>`;
    const historyPanel = `
      <section class="panel">
        <span class="caption-strip panel-tab">Progress Log</span>
        ${timelineBody}
      </section>`;

    // Notes (only if present)
    const notesPanel = e.notes ? `
      <section class="panel">
        <span class="caption-strip panel-tab">Notes</span>
        <p class="notes-text">${esc(e.notes)}</p>
      </section>` : '';

    // External links
    const links = [];
    if (e.anilistId != null) {
      const kind = e.type === 'anime' ? 'anime' : 'manga';
      links.push(`<a class="ghost-btn" href="https://anilist.co/${kind}/${e.anilistId}" target="_blank" rel="noopener">View on AniList ↗</a>`);
    }
    if (e.malId != null) {
      const kind = e.type === 'anime' ? 'anime' : 'manga';
      links.push(`<a class="ghost-btn" href="https://myanimelist.net/${kind}/${e.malId}" target="_blank" rel="noopener">View on MAL ↗</a>`);
    }
    if (e.mangadexId != null) {
      links.push(`<a class="ghost-btn" href="https://mangadex.org/title/${e.mangadexId}" target="_blank" rel="noopener">View on MangaDex ↗</a>`);
    }
    const linksPanel = links.length ? `<div class="links-row">${links.join('')}</div>` : '';

    const footMeta = `
      <p class="detail-foot-meta">Added ${fmtDate(e.addedAt)} · Last updated ${fmtDate(e.updatedAt)}</p>`;

    return `
      <div class="detail view-enter">
        <div class="back-row">
          <a class="ghost-btn" href="#/" id="back-btn">← Back to shelf</a>
        </div>
        <div class="detail-grid">
          ${cover}
          <div>
            <div class="detail-title-block">
              <h2 class="detail-title">${esc(e.title)}</h2>
              ${alt}
              ${byline}
            </div>
            <div class="status-score-row">
              <span class="status-strip status-strip--${esc(e.status)}">${sm.label}</span>
              ${scoreHTML}
            </div>
            <div class="detail-panels">
              ${progressPanel}
              ${synopsisPanel}
              ${genresPanel}
              ${historyPanel}
              ${notesPanel}
            </div>
            <div style="margin-top:1.4rem">${linksPanel}</div>
            ${footMeta}
          </div>
        </div>
      </div>`;
  }

  function renderDetail(id) {
    const e = state.entries.find(x => x.id === id);
    if (!e) {
      $view.innerHTML = `
        <div class="empty-panel">
          <div class="empty-inner">
            <p class="empty-glyph">空</p>
            <h2 class="empty-title">Entry not found</h2>
            <p class="empty-hint">No title with id <code>${esc(id)}</code> on this shelf. <a href="#/">Back to the shelf</a>.</p>
          </div>
        </div>`;
      return;
    }
    $view.innerHTML = detailHTML(e);

    // Animate progress fill bar from 0 to target (600ms via CSS transition)
    const fill = $view.querySelector('.progress-track--big .progress-fill');
    if (fill) {
      const target = fill.dataset.target;
      if (reducedMotion) {
        fill.style.width = target + '%';
      } else {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => { fill.style.width = target + '%'; });
        });
      }
    }

    // Synopsis clamp toggle
    const toggle = document.getElementById('clamp-toggle');
    if (toggle) {
      const syn = document.getElementById('synopsis');
      toggle.addEventListener('click', () => {
        const clamped = syn.classList.toggle('is-clamped');
        toggle.textContent = clamped ? 'Read more' : 'Show less';
      });
    }
  }

  /* ---------------- Ink-splash transition ---------------- */

  function playSplash(x, y) {
    if (reducedMotion || !$splash) return;
    $splash.style.setProperty('--sx', x + 'px');
    $splash.style.setProperty('--sy', y + 'px');
    $splash.classList.remove('is-active');
    // Force reflow so the animation restarts
    void $splash.offsetWidth;
    $splash.classList.add('is-active');
    setTimeout(() => $splash.classList.remove('is-active'), SPLASH_MS);
  }

  /* ---------------- Router ---------------- */

  function parseHash() {
    const hash = location.hash || '#/';
    const m = hash.match(/^#\/entry\/(.+)$/);
    if (m) return { name: 'entry', id: decodeURIComponent(m[1]) };
    return { name: 'library' };
  }

  function render() {
    state.route = parseHash();
    if (state.route.name === 'entry') {
      renderDetail(state.route.id);
      window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
    } else {
      renderLibrary();
    }
  }

  /* ---------------- Boot ---------------- */

  async function init() {
    // Footer year
    $footerYear.textContent = String(new Date().getFullYear());

    try {
      await loadData();
    } catch (err) {
      console.error(err);
      $view.innerHTML = `
        <div class="empty-panel">
          <div class="empty-inner">
            <p class="empty-glyph">空</p>
            <h2 class="empty-title">Could not load the shelf</h2>
            <p class="empty-hint">Failed to fetch <code>data/library.json</code>. If you opened the file directly, serve it over HTTP instead (e.g. <code>python3 -m http.server</code>).</p>
          </div>
        </div>`;
      return;
    }

    renderMasthead();

    // Card click → splash from click origin, then navigate
    document.addEventListener('click', (ev) => {
      const card = ev.target.closest('a.card');
      if (card) {
        ev.preventDefault();
        playSplash(ev.clientX, ev.clientY);
        const href = card.getAttribute('href');
        setTimeout(() => { location.hash = href.slice(1); }, reducedMotion ? 0 : 180);
      }
    });

    // Esc returns from detail view
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && state.route && state.route.name === 'entry') {
        location.hash = '#/';
      }
    });

    window.addEventListener('hashchange', render);
    render();
  }

  init();
})();
