/**
 * ui.js — UI rendering and DOM management
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
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, duration);
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

    if (Stremio.isLoggedIn()) {
      stremioEl.classList.add('connected');
    } else {
      stremioEl.classList.remove('connected');
    }

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
    if (show.stremioWatchlist) badges.push('<span class="badge badge-stremio">STREMIO</span>');
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
        <button class="card-btn watchlist-btn ${show.stremioWatchlist ? 'active' : ''}" title="${show.stremioWatchlist ? 'Remove from Stremio Watchlist' : 'Add to Stremio Watchlist'}">
          ${show.stremioWatchlist ? '★ LIST' : '☆ LIST'}
        </button>
        <button class="card-btn danger remove-btn" title="Remove show">REMOVE</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-btn')) return;
      App.openShowDetail(show.id);
    });

    card.querySelector('.watchlist-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      App.toggleStremioWatchlist(show.id);
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
    const inStremio = showData.stremioWatchlist;
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
            <button class="btn-primary watchlist-action-btn" data-id="${showData.id}">
              ${inStremio ? '★ In Stremio Watchlist' : '☆ Add to Stremio Watchlist'}
            </button>
            <button class="btn-secondary remove-action-btn" data-id="${showData.id}">REMOVE SHOW</button>
          </div>
        </div>
      </div>
      ${detail.nextEpisode ? `
        <div class="episodes-section">
          <h3>NEXT EPISODE</h3>
          <div class="episode-item">
            <div class="ep-code">${detail.nextEpisode.code}</div>
            <div class="ep-info">
              <div class="ep-name">${escapeHtml(detail.nextEpisode.name || 'TBA')}</div>
              <div class="ep-date">${detail.nextEpisode.airDate || 'Date TBA'}</div>
            </div>
          </div>
        </div>
      ` : ''}
      ${showData.upcomingEpisodes && showData.upcomingEpisodes.length > 0 ? `
        <div class="episodes-section">
          <h3>UPCOMING EPISODES</h3>
          ${showData.upcomingEpisodes.map(ep => {
            const calKey = GCal.episodeKey(showData.id, ep.code);
            const hasCal = !!Storage.getCalEvent(calKey);
            return `<div class="episode-item">
              <div class="ep-code">${ep.code}</div>
              <div class="ep-info">
                <div class="ep-name">${escapeHtml(ep.name || 'TBA')}</div>
                <div class="ep-date">${ep.airDate || 'Date TBA'}</div>
                ${hasCal ? '<div class="ep-cal">📅 In Google Calendar</div>' : ''}
              </div>
            </div>`;
          }).join('')}
        </div>
      ` : ''}
    `;

    body.querySelector('.watchlist-action-btn').addEventListener('click', async () => {
      await App.toggleStremioWatchlist(showData.id);
      modal.querySelector('.modal-close').click();
    });

    body.querySelector('.remove-action-btn').addEventListener('click', () => {
      App.removeShow(showData.id);
      modal.querySelector('.modal-close').click();
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
    if (settings.gcalClientId) {
      document.getElementById('gcal-client-id').value = settings.gcalClientId;
    }
    if (settings.gcalCalendarId) {
      document.getElementById('gcal-calendar-id').value = settings.gcalCalendarId;
    }

    // Sync interval
    document.getElementById('sync-interval').value = String(settings.syncInterval);

    // Last sync
    const lastSync = settings.lastSync;
    if (lastSync) {
      document.getElementById('last-sync-time').textContent = new Date(lastSync).toLocaleString();
    }

    // Stremio status
    if (Stremio.isLoggedIn()) {
      const user = Stremio.getUser();
      document.getElementById('stremio-email').closest('.settings-row').classList.add('hidden');
      document.getElementById('stremio-password').closest('.settings-row').classList.add('hidden');
      document.getElementById('stremio-login-btn').closest('.settings-row').classList.add('hidden');
      document.getElementById('stremio-logged-in').classList.remove('hidden');
      document.getElementById('stremio-user-display').textContent = user.email || 'Connected';
    } else {
      document.getElementById('stremio-email').closest('.settings-row').classList.remove('hidden');
      document.getElementById('stremio-password').closest('.settings-row').classList.remove('hidden');
      document.getElementById('stremio-login-btn').closest('.settings-row').classList.remove('hidden');
      document.getElementById('stremio-logged-in').classList.add('hidden');
    }

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

  // ─── Install Banner ───
  let _deferredInstall = null;

  function initInstallBanner() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      _deferredInstall = e;
      showInstallBanner();
    });
  }

  function showInstallBanner() {
    if (document.getElementById('install-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'install-banner';
    banner.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
      <span>Install TiVo Tracker as an app</span>
      <button id="install-btn" class="btn-primary btn-sm">INSTALL</button>
      <button id="install-dismiss" class="btn-secondary btn-sm">✕</button>
    `;
    document.getElementById('main-content').prepend(banner);

    document.getElementById('install-btn').addEventListener('click', async () => {
      if (_deferredInstall) {
        _deferredInstall.prompt();
        const { outcome } = await _deferredInstall.userChoice;
        if (outcome === 'accepted') banner.remove();
        _deferredInstall = null;
      }
    });

    document.getElementById('install-dismiss').addEventListener('click', () => banner.remove());
  }

  // ─── Helpers ───
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
    escapeHtml,
  };
})();
