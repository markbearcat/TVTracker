/**
 * ui.js — UI rendering and DOM management
 * Updated to use Stremio Deep Linking and responsive mobile fixes.
 */

const UI = (() => {

  // ─── Toast ───
  function toast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icon = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' }[type] || '';
    el.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(el);
    setTimeout(() => { 
      el.style.opacity = '0'; 
      el.style.transition = 'opacity 0.3s'; 
      setTimeout(() => el.remove(), 300); 
    }, duration);
  }

  // ─── Sync overlay ───
  function showSyncOverlay(text = 'Syncing...') {
    document.getElementById('sync-status-text').textContent = text;
    document.getElementById('sync-overlay').classList.remove('hidden');
  }

  function updateSyncText(text) {
    document.getElementById('sync-status-text').textContent = text;
  }

  function hideSyncOverlay() {
    document.getElementById('sync-overlay').classList.add('hidden');
  }

  // ─── Status Pills ───
  function updateStatusPills() {
    const stremioEl = document.getElementById('stremio-status');
    const gcalEl = document.getElementById('gcal-status');

    // Deep link mode: We consider Stremio "connected" if the app is ready
    stremioEl.classList.add('connected');

    if (GCal.isAuthorized()) {
      gcalEl.classList.add('connected');
    } else {
      gcalEl.classList.remove('connected');
    }
  }

  // ─── Shows Grid ───
  function renderShows(filter = 'all') {
    const grid = document.getElementById('shows-grid');
    const countEl = document.getElementById('show-count');
    let shows = Storage.getShows();

    if (filter === 'airing') shows = shows.filter(s => s.status === 'Returning Series');
    else if (filter === 'upcoming') shows = shows.filter(s => s.status === 'In Production' || s.nextEpisodeDate);
    else if (filter === 'ended') shows = shows.filter(s => s.status === 'Ended' || s.status === 'Canceled');

    countEl.textContent = Storage.getShows().length;

    if (shows.length === 0) {
      grid.innerHTML = `<div class="empty-state">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="8" y="14" width="48" height="36" rx="3"/><line x1="8" y1="50" x2="0" y2="58"/><line x1="56" y1="50" x2="64" y2="58"/><line x1="20" y1="58" x2="44" y2="58"/><rect x="20" y="24" width="24" height="16" rx="1"/></svg>
        <p>${filter === 'all' ? 'Search for shows to add them to your list' : 'No shows in this category'}</p>
      </div>`;
      return;
    }

    grid.innerHTML = '';
    shows.forEach(show => {
      const card = createShowCard(show);
      grid.appendChild(card);
    });
  }

  function createShowCard(show) {
    const card = document.createElement('div');
    card.className = 'show-card';
    card.dataset.id = show.id;

    const poster = show.poster
      ? `<img class="show-card-poster" src="${show.poster}" alt="${show.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';

    const placeholder = `<div class="show-card-poster-placeholder" ${show.poster ? 'style="display:none"' : ''}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.4"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>
    </div>`;

    const badges = [];
    const calEvents = Storage.getCalEvents();
    const hasCalEvents = Object.keys(calEvents).some(k => k.startsWith(`${show.id}_`));
    if (hasCalEvents) badges.push('<span class="badge badge-cal">CAL</span>');
    if (show.status === 'Returning Series') badges.push('<span class="badge badge-airing">AIRING</span>');
    else if (show.status === 'Ended') badges.push('<span class="badge badge-ended">ENDED</span>');

    const statusText = show.status || 'Unknown';
    const year = show.firstAired ? show.firstAired.slice(0, 4) : '';

    card.innerHTML = `
      ${poster}
      ${placeholder}
      <div class="show-card-body">
        <div class="show-card-title">${escapeHtml(show.name)}</div>
        <div class="show-card-meta">${year}${year && statusText ? ' · ' : ''}${statusText}</div>
        <div class="show-card-badges">${badges.join('')}</div>
      </div>
      <div class="show-card-actions">
        <button class="card-btn watchlist-btn" title="Open in Stremio">
          OPEN STREMIO
        </button>
        <button class="card-btn danger remove-btn" title="Remove show">REMOVE</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-btn')) return;
      App.openShowDetail(show.id);
    });

    // Handle the Deep Link directly
    card.querySelector('.watchlist-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      Stremio.openInStremio(show);
    });

    card.querySelector('.remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      App.removeShow(show.id);
    });

    return card;
  }

  // ─── Upcoming ───
  function renderUpcoming() {
    const list = document.getElementById('upcoming-list');
    const shows = Storage.getShows();
    const allUpcoming = [];

    shows.forEach(show => {
      if (show.upcomingEpisodes) {
        show.upcomingEpisodes.forEach(ep => {
          allUpcoming.push({ show, ep });
        });
      }
    });

    allUpcoming.sort((a, b) => new Date(a.ep.airDate) - new Date(b.ep.airDate));

    if (allUpcoming.length === 0) {
      list.innerHTML = '<p class="empty-text">No upcoming episodes tracked yet.</p>';
      return;
    }

    list.innerHTML = '';
    allUpcoming.forEach(({ show, ep }) => {
      const item = createUpcomingItem(show, ep);
      list.appendChild(item);
    });
  }

  function createUpcomingItem(show, ep) {
    const item = document.createElement('div');
    item.className = 'upcoming-item';

    const d = new Date(ep.airDate);
    const day = d.toLocaleDateString('en-AU', { day: '2-digit' });
    const month = d.toLocaleDateString('en-AU', { month: 'short' }).toUpperCase();

    const calKey = GCal.episodeKey(show.id, ep.code);
    const hasCal = !!Storage.getCalEvent(calKey);

    item.innerHTML = `
      <div>
        <div class="upcoming-date">${day}</div>
        <div class="upcoming-date-label">${month}</div>
      </div>
      <div class="upcoming-info">
        <div class="upcoming-show">${escapeHtml(show.name)}</div>
        <div class="upcoming-episode">${ep.code}${ep.name ? ' — ' + escapeHtml(ep.name) : ''}</div>
      </div>
      <div class="upcoming-cal-status ${hasCal ? 'synced' : ''}">
        ${hasCal ? '📅 SYNCED' : '📅 —'}
      </div>
    `;
    return item;
  }

  // ─── Search Results ───
  function renderSearchResults(results, query) {
    const dropdown = document.getElementById('search-results');
    if (!results || results.length === 0) {
      dropdown.innerHTML = `<div class="search-empty">No results for "${escapeHtml(query)}"</div>`;
      dropdown.classList.remove('hidden');
      return;
    }

    const myShows = Storage.getShows();
    const myIds = new Set(myShows.map(s => s.id));

    dropdown.innerHTML = '';
    results.forEach(show => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      const alreadyAdded = myIds.has(show.id);
      const year = show.firstAired ? show.firstAired.slice(0, 4) : '';

      item.innerHTML = `
        ${show.poster
          ? `<img class="search-result-poster" src="${show.poster}" alt="${show.name}" loading="lazy">`
          : `<div class="search-result-poster" style="background:var(--bg-card)"></div>`
        }
        <div class="search-result-info">
          <div class="search-result-title">${escapeHtml(show.name)}</div>
          <div class="search-result-meta">${year}${year && show.status ? ' · ' : ''}${show.status || ''}</div>
        </div>
        <button class="search-result-add ${alreadyAdded ? 'added' : ''}" data-id="${show.id}">
          ${alreadyAdded ? 'ADDED' : '+ ADD'}
        </button>
      `;

      item.querySelector('.search-result-add').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!alreadyAdded) App.addShow(show);
      });

      dropdown.appendChild(item);
    });
    dropdown.classList.remove('hidden');
  }

  function showSearchLoading() {
    const dropdown = document.getElementById('search-results');
    dropdown.innerHTML = '<div class="search-loading">Searching...</div>';
    dropdown.classList.remove('hidden');
  }

  function hideSearchResults() {
    document.getElementById('search-results').classList.add('hidden');
  }

  // ─── Show Detail Modal ───
  async function openShowModal(showData, fullDetail) {
    const modal = document.getElementById('show-modal');
    const title = document.getElementById('show-modal-title');
    const body = document.getElementById('show-modal-body');

    title.textContent = showData.name.toUpperCase();

    const detail = fullDetail || showData;
    const year = detail.firstAired ? detail.firstAired.slice(0, 4) : '';
    const networks = detail.networks ? detail.networks.join(', ') : '';
    const genres = detail.genres ? detail.genres.join(', ') : '';

    body.innerHTML = `
      <div class="show-detail">
        ${detail.poster
          ? `<img class="show-detail-poster" src="${detail.poster}" alt="${detail.name}">`
          : ''
        }
        <div class="show-detail-info">
          <div class="show-detail-title">${escapeHtml(detail.name)}</div>
          <div class="show-detail-meta">
            ${[year, detail.status, networks, genres].filter(Boolean).join(' · ')}
            ${detail.numberOfSeasons ? `· ${detail.numberOfSeasons} season${detail.numberOfSeasons !== 1 ? 's' : ''}` : ''}
          </div>
          <div class="show-detail-overview">${escapeHtml(detail.overview || 'No description available.')}</div>
          <div class="show-detail-actions">
            <button class="btn-primary watchlist-action-btn">
              VIEW ON STREMIO
            </button>
            <button class="btn-secondary remove-action-btn" data-id="${showData.id}">REMOVE SHOW</button>
          </div>
        </div>
      </div>
      `;

    // Updated Action Listener
    body.querySelector('.watchlist-action-btn').addEventListener('click', () => {
      Stremio.openInStremio(showData);
      modal.classList.add('hidden');
    });

    body.querySelector('.remove-action-btn').addEventListener('click', () => {
      App.removeShow(showData.id);
      modal.classList.add('hidden');
    });

    modal.classList.remove('hidden');
  }

  // ─── Duplicate Modal ───
  function showDuplicateDialog(message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('duplicate-modal');
      document.getElementById('duplicate-message').textContent = message;
      modal.classList.remove('hidden');

      const cleanup = (action) => {
        modal.classList.add('hidden');
        resolve(action);
      };

      document.getElementById('dup-keep-both').onclick = () => cleanup('keep_both');
      document.getElementById('dup-replace').onclick = () => cleanup('replace');
      document.getElementById('dup-skip').onclick = () => cleanup('skip');
    });
  }

  // ─── Settings ───
  function updateSettingsUI() {
    const settings = Storage.getSettings();

    // Theme
    document.querySelectorAll('.seg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === settings.theme);
    });

    // GCal fields
    if (settings.gcalClientId) document.getElementById('gcal-client-id').value = settings.gcalClientId;
    if (settings.gcalCalendarId) document.getElementById('gcal-calendar-id').value = settings.gcalCalendarId;

    // Sync interval
    document.getElementById('sync-interval').value = String(settings.syncInterval);

    // Last sync
    if (settings.lastSync) {
      document.getElementById('last-sync-time').textContent = new Date(settings.lastSync).toLocaleString();
    }

    // Updated Stremio status for deep-link mode
    document.getElementById('stremio-email').closest('.settings-row').style.display = 'none';
    document.getElementById('stremio-password').closest('.settings-row').style.display = 'none';
    document.getElementById('stremio-login-btn').closest('.settings-row').style.display = 'none';
    document.getElementById('stremio-logged-in').classList.remove('hidden');
    document.getElementById('stremio-user-display').textContent = 'App Hand-off Active';

    // GCal status
    if (GCal.isAuthorized()) {
      document.getElementById('gcal-connect-row').classList.add('hidden');
      document.getElementById('gcal-connected-row').classList.remove('hidden');
      document.getElementById('gcal-confirm-row').classList.add('hidden');
    } else {
      document.getElementById('gcal-connect-row').classList.remove('hidden');
      document.getElementById('gcal-connected-row').classList.add('hidden');
    }
  }

  function applyTheme(theme) {
    document.body.className = `theme-${theme}`;
  }

  // ─── Log Modal ───
  const LOG_LEVEL_META = {
    error:   { icon: '✕', label: 'ERROR',   cls: 'log-error' },
    warning: { icon: '⚠', label: 'WARN',    cls: 'log-warning' },
    success: { icon: '✓', label: 'OK',      cls: 'log-success' },
    info:    { icon: 'ℹ', label: 'INFO',    cls: 'log-info' },
  };

  const SOURCE_LABELS = {
    sync: 'SYNC', stremio: 'STREMIO', gcal: 'GCAL', api: 'API', app: 'APP',
  };

  let _logFilter = 'all';

  function openLogModal() {
    const modal = document.getElementById('log-modal');
    modal.classList.remove('hidden');
    renderLogEntries();

    modal.querySelectorAll('.log-filter-btn').forEach(btn => {
      btn.onclick = () => {
        modal.querySelectorAll('.log-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _logFilter = btn.dataset.level;
        renderLogEntries();
      };
    });

    document.getElementById('log-clear-btn').onclick = () => {
      if (!confirm('Clear all log entries?')) return;
      Storage.clearLog();
      renderLogEntries();
      updateLogBadge();
      toast('Log cleared', 'info');
    };
  }

  function renderLogEntries() {
    const container = document.getElementById('log-entries-container');
    const statsBar = document.getElementById('log-stats-bar');
    const stats = Storage.getLogStats();
    let entries = Storage.getLogEntries();

    statsBar.innerHTML = `
      <span class="log-stat log-stat-total">${stats.total} entries</span>
      <span class="log-stat log-stat-error">${stats.errors} errors</span>
      <span class="log-stat log-stat-warn">${stats.warnings} warnings</span>
    `;

    if (_logFilter !== 'all') {
      entries = entries.filter(e => e.level === _logFilter);
    }

    if (entries.length === 0) {
      container.innerHTML = `<div class="log-empty"><p>No log entries found.</p></div>`;
      return;
    }

    container.innerHTML = '';
    entries.forEach(entry => {
      const meta = LOG_LEVEL_META[entry.level] || LOG_LEVEL_META.info;
      const el = document.createElement('div');
      el.className = `log-entry ${meta.cls}`;
      el.innerHTML = `
        <div class="log-entry-left">
          <span class="log-level-icon">${meta.icon}</span>
          <div class="log-entry-content">
            <div class="log-entry-message">${escapeHtml(entry.message)}</div>
          </div>
        </div>
        <div class="log-entry-right"><span class="log-time">${new Date(entry.ts).toLocaleTimeString()}</span></div>
      `;
      container.appendChild(el);
    });
  }

  function updateLogBadge() {
    const badge = document.getElementById('log-error-badge');
    if (!badge) return;
    const stats = Storage.getLogStats();
    if (stats.errors > 0) {
      badge.textContent = stats.errors > 9 ? '9+' : stats.errors;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function initInstallBanner() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      // Add logic to show install button here
    });
  }

  // ─── Helpers ───
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    toast,
    showSyncOverlay, updateSyncText, hideSyncOverlay,
    updateStatusPills,
    renderShows, createShowCard,
    renderUpcoming,
    renderSearchResults, showSearchLoading, hideSearchResults,
    openShowModal,
    showDuplicateDialog,
    updateSettingsUI,
    applyTheme,
    initInstallBanner,
    openLogModal,
    updateLogBadge,
    escapeHtml,
  };
})();
