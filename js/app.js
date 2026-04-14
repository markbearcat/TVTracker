/**
 * app.js — Main application controller
 * Wires everything together: search, shows, sync, settings
 */

const App = (() => {
  let _searchTimer = null;
  let _syncTimer = null;
  let _currentFilter = 'all';

  // ─── Init ───
  async function init() {
    UI.applyTheme(Storage.getSettings().theme);
    UI.initInstallBanner();
    UI.updateStatusPills();
    UI.renderShows(_currentFilter);
    UI.renderUpcoming();
    UI.updateSettingsUI();
    UI.updateLogBadge();

    bindSearch();
    bindFilterTabs();
    bindSettingsModal();
    bindSyncButton();
    bindModalClose();
    bindLogViewer();

    // Check for existing GCal auth
    const gcalAuth = GCal.getStoredAuthState();
    if (gcalAuth && GCal.isConfigured()) {
      // Will re-auth silently on next sync
    }

    // Schedule auto-sync
    scheduleAutoSync();

    // Run initial sync quietly
    setTimeout(() => silentSync(), 5000);
  }

  // ─── Search ───
  function bindSearch() {
    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');

    input.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      const q = input.value.trim();
      if (!q) { UI.hideSearchResults(); return; }
      UI.showSearchLoading();
      _searchTimer = setTimeout(() => doSearch(q), 400);
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      UI.hideSearchResults();
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#search-section')) UI.hideSearchResults();
    });
  }

  async function doSearch(query) {
    const results = await TVApi.searchShows(query);
    UI.renderSearchResults(results, query);
  }

  // ─── Add Show ───
  async function addShow(show) {
    const result = Storage.addShow(show);

    if (!result.added) {
      UI.toast(`${show.name} is already in your list`, 'info');
      return;
    }

    Storage.addLogEntry('success', 'app', `Added show: "${show.name}"`);
    UI.toast(`Added ${show.name}`, 'success');
    UI.hideSearchResults();
    document.getElementById('search-input').value = '';

    // Fetch upcoming episodes and update details
    fetchAndUpdateShow(show.id);

    UI.renderShows(_currentFilter);
    UI.renderUpcoming();
  }

  async function fetchAndUpdateShow(showId) {
    try {
      const [detail, upcoming] = await Promise.all([
        TVApi.getShowDetails(showId),
        TVApi.getUpcomingEpisodes(showId),
      ]);

      const updates = {
        upcomingEpisodes: upcoming,
        nextEpisodeDate: upcoming.length > 0 ? upcoming[0].airDate : null,
      };

      if (detail) {
        Object.assign(updates, {
          status: detail.status,
          numberOfSeasons: detail.numberOfSeasons,
          networks: detail.networks,
          genres: detail.genres,
          seasons: detail.seasons,
          nextEpisode: detail.nextEpisode,
          lastEpisode: detail.lastEpisode,
          overview: detail.overview,
        });
      }

      Storage.updateShow(showId, updates);
      UI.renderShows(_currentFilter);
      UI.renderUpcoming();

      // Auto-add to calendar if authorized
      if (GCal.isAuthorized() && upcoming.length > 0) {
        const show = Storage.getShow(showId);
        let calCreated = 0;
        for (const ep of upcoming) {
          const r = await GCal.createOrUpdateEvent(show, ep);
          if (r.success) calCreated++;
          else Storage.addLogEntry('error', 'gcal', `Failed to create event for ${show.name} ${ep.code}`, r.error);
        }
        UI.renderUpcoming();
        if (calCreated > 0) {
          Storage.addLogEntry('success', 'gcal', `Created ${calCreated} calendar event(s) for "${show.name}"`);
          UI.toast(`Added ${calCreated} episode(s) to Google Calendar`, 'success');
        }
      }
    } catch (e) {
      console.error('[App] fetchAndUpdateShow:', e);
      Storage.addLogEntry('error', 'api', `Could not refresh show ID ${showId}`, e.message);
    }
  }

  function removeShow(id) {
    const show = Storage.getShow(id);
    if (!show) return;
    if (!confirm(`Remove "${show.name}" from your list?`)) return;
    Storage.removeShow(id);
    UI.renderShows(_currentFilter);
    UI.renderUpcoming();
    UI.toast(`Removed ${show.name}`, 'info');
  }

  // ─── Show Detail ───
  async function openShowDetail(showId) {
    const show = Storage.getShow(showId);
    if (!show) return;
    const detail = await TVApi.getShowDetails(showId);
    UI.openShowModal(show, detail);
  }

  // ─── Stremio Watchlist ───
  async function toggleStremioWatchlist(showId) {
    if (!Stremio.isLoggedIn()) {
      UI.toast('Connect to Stremio in Settings first', 'warning');
      return;
    }

    const show = Storage.getShow(showId);
    if (!show) return;

    if (show.stremioWatchlist) {
      const r = await Stremio.removeFromWatchlist(show);
      if (r.success) {
        UI.toast(`Removed ${show.name} from Stremio`, 'info');
      } else {
        UI.toast(`Stremio error: ${r.error}`, 'error');
      }
    } else {
      const r = await Stremio.addToWatchlist(show);
      if (r.success) {
        UI.toast(`Added ${show.name} to Stremio watchlist`, 'success');
      } else {
        UI.toast(`Stremio error: ${r.error}`, 'error');
      }
    }

    UI.renderShows(_currentFilter);
    UI.updateStatusPills();
  }

  // ─── Sync ───
  function bindSyncButton() {
    document.getElementById('sync-btn').addEventListener('click', () => fullSync());
  }

  async function fullSync() {
    const syncBtn = document.getElementById('sync-btn');
    syncBtn.classList.add('syncing');
    UI.showSyncOverlay('Starting sync...');
    Storage.addLogEntry('info', 'sync', 'Manual sync started');

    try {
      const shows = Storage.getShows();

      // 1. Update all show details
      UI.updateSyncText('Fetching episode data...');
      for (const show of shows) {
        try {
          await fetchAndUpdateShow(show.id);
        } catch (e) {
          Storage.addLogEntry('error', 'api', `Failed to update "${show.name}"`, e.message);
        }
      }

      // 2. Sync Stremio
      if (Stremio.isLoggedIn()) {
        UI.updateSyncText('Syncing Stremio...');
        try {
          await Stremio.syncWatchlistStatus();
          Storage.addLogEntry('success', 'stremio', 'Stremio watchlist status synced');
        } catch (e) {
          Storage.addLogEntry('error', 'stremio', 'Stremio watchlist sync failed', e.message);
        }
      }

      // 3. Full Google Calendar sync
      if (GCal.isAuthorized()) {
        UI.updateSyncText('Syncing Google Calendar...');
        const freshShows = Storage.getShows();
        const result = await GCal.fullSync(freshShows);

        if (result.success) {
          // Handle duplicates
          if (result.duplicates && result.duplicates.length > 0) {
            UI.hideSyncOverlay();
            for (const dup of result.duplicates) {
              const show = freshShows.find(s => dup.key.startsWith(String(s.id) + '_'));
              const msg = `Duplicate calendar events found for ${show ? show.name : dup.key}. What would you like to do?`;
              Storage.addLogEntry('warning', 'gcal', `Duplicate events detected: ${dup.key}`);
              const action = await UI.showDuplicateDialog(msg);
              await GCal.resolveDuplicate(dup.events, action);
              Storage.addLogEntry('info', 'gcal', `Duplicate resolved: ${action} for ${dup.key}`);
            }
            UI.showSyncOverlay('Finishing...');
          }

          const summary = [];
          if (result.created > 0) summary.push(`${result.created} created`);
          if (result.updated > 0) summary.push(`${result.updated} updated`);
          if (result.errors.length > 0) {
            summary.push(`${result.errors.length} errors`);
            result.errors.forEach(err => Storage.addLogEntry('error', 'gcal', err));
          }
          const calMsg = summary.length > 0 ? `Calendar: ${summary.join(', ')}` : 'Calendar up to date';
          Storage.addLogEntry(result.errors.length ? 'warning' : 'success', 'gcal', calMsg);
          if (summary.length > 0) {
            UI.toast(`Calendar sync: ${summary.join(', ')}`, result.errors.length ? 'warning' : 'success');
          } else {
            UI.toast('Calendar is up to date', 'success');
          }
        } else {
          Storage.addLogEntry('error', 'gcal', `Calendar sync failed: ${result.error}`);
          UI.toast(`Calendar sync failed: ${result.error}`, 'error');
        }
      }

      Storage.updateLastSync();
      Storage.addLogEntry('success', 'sync', 'Sync completed successfully');
      UI.renderShows(_currentFilter);
      UI.renderUpcoming();
      UI.updateStatusPills();
      UI.updateSettingsUI();
      UI.updateLogBadge();
      UI.toast('Sync complete', 'success');
    } catch (e) {
      console.error('[App] fullSync:', e);
      Storage.addLogEntry('error', 'sync', `Sync failed: ${e.message}`, e.stack);
      UI.toast(`Sync error: ${e.message}`, 'error');
      UI.updateLogBadge();
    } finally {
      syncBtn.classList.remove('syncing');
      UI.hideSyncOverlay();
    }
  }

  async function silentSync() {
    const shows = Storage.getShows();
    if (shows.length === 0) return;
    Storage.addLogEntry('info', 'sync', 'Auto-sync started');
    let hadError = false;
    for (const show of shows) {
      try {
        await fetchAndUpdateShow(show.id);
      } catch (e) {
        hadError = true;
        Storage.addLogEntry('error', 'api', `Auto-sync: failed to update "${show.name}"`, e.message);
      }
    }
    if (GCal.isAuthorized()) {
      try {
        const fresh = Storage.getShows();
        const result = await GCal.fullSync(fresh);
        if (result.success) {
          if (result.errors.length > 0) {
            result.errors.forEach(err => Storage.addLogEntry('error', 'gcal', err));
            hadError = true;
          }
          if (result.created > 0 || result.updated > 0) {
            Storage.addLogEntry('info', 'gcal', `Auto-sync calendar: ${result.created} created, ${result.updated} updated`);
          }
        } else {
          Storage.addLogEntry('error', 'gcal', `Auto-sync calendar failed: ${result.error}`);
          hadError = true;
        }
      } catch (e) {
        Storage.addLogEntry('error', 'gcal', `Auto-sync calendar exception: ${e.message}`);
        hadError = true;
      }
    }
    Storage.updateLastSync();
    Storage.addLogEntry(hadError ? 'warning' : 'success', 'sync', hadError ? 'Auto-sync completed with errors' : 'Auto-sync completed');
    UI.renderShows(_currentFilter);
    UI.renderUpcoming();
    UI.updateSettingsUI();
    UI.updateLogBadge();
  }

  function scheduleAutoSync() {
    const interval = Storage.getSettings().syncInterval;
    if (_syncTimer) clearInterval(_syncTimer);
    if (interval > 0) {
      _syncTimer = setInterval(() => silentSync(), interval);
    }
  }

  // ─── Filter Tabs ───
  function bindFilterTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _currentFilter = tab.dataset.filter;
        UI.renderShows(_currentFilter);
      });
    });
  }

  // ─── Settings Modal ───
  function bindSettingsModal() {
    const modal = document.getElementById('settings-modal');
    const openBtn = document.getElementById('settings-btn');

    openBtn.addEventListener('click', () => {
      UI.updateSettingsUI();
      modal.classList.remove('hidden');
    });

    modal.querySelector('.modal-backdrop').addEventListener('click', () => modal.classList.add('hidden'));

    // Theme
    document.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.theme;
        Storage.updateSetting('theme', theme);
        UI.applyTheme(theme);
        document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
      });
    });

    // Stremio login
    document.getElementById('stremio-login-btn').addEventListener('click', async () => {
      const email = document.getElementById('stremio-email').value.trim();
      const pass = document.getElementById('stremio-password').value;
      if (!email || !pass) { UI.toast('Enter your Stremio email and password', 'warning'); return; }
      UI.toast('Connecting to Stremio...', 'info');
      const r = await Stremio.login(email, pass);
      if (r.success) {
        UI.toast('Connected to Stremio!', 'success');
        UI.updateSettingsUI();
        UI.updateStatusPills();
      } else {
        UI.toast(`Stremio login failed: ${r.error}`, 'error');
      }
    });

    document.getElementById('stremio-logout-btn').addEventListener('click', () => {
      Stremio.logout();
      UI.updateSettingsUI();
      UI.updateStatusPills();
      UI.toast('Disconnected from Stremio', 'info');
    });

    // GCal connect with confirmation
    document.getElementById('gcal-connect-btn').addEventListener('click', () => {
      const clientId = document.getElementById('gcal-client-id').value.trim();
      const calId = document.getElementById('gcal-calendar-id').value.trim() || 'primary';
      if (!clientId) { UI.toast('Enter your Google Client ID first', 'warning'); return; }
      Storage.updateSetting('gcalClientId', clientId);
      Storage.updateSetting('gcalCalendarId', calId);
      // Show confirmation
      document.getElementById('gcal-connect-row').classList.add('hidden');
      document.getElementById('gcal-confirm-row').classList.remove('hidden');
    });

    document.getElementById('gcal-confirm-yes').addEventListener('click', async () => {
      document.getElementById('gcal-confirm-row').classList.add('hidden');
      UI.toast('Authorizing with Google...', 'info');
      const r = await GCal.authorize();
      if (r.success) {
        UI.toast('Google Calendar connected!', 'success');
        UI.updateSettingsUI();
        UI.updateStatusPills();
        // Trigger a sync for calendar events
        const shows = Storage.getShows();
        if (shows.length > 0) {
          UI.toast('Syncing calendar events...', 'info');
          await GCal.fullSync(shows);
          UI.renderUpcoming();
        }
      } else {
        UI.toast(`Google Calendar failed: ${r.error}`, 'error');
        document.getElementById('gcal-connect-row').classList.remove('hidden');
      }
    });

    document.getElementById('gcal-confirm-no').addEventListener('click', () => {
      document.getElementById('gcal-confirm-row').classList.add('hidden');
      document.getElementById('gcal-connect-row').classList.remove('hidden');
    });

    document.getElementById('gcal-disconnect-btn').addEventListener('click', () => {
      GCal.disconnect();
      UI.updateSettingsUI();
      UI.updateStatusPills();
      UI.toast('Disconnected from Google Calendar', 'info');
    });

    // GCal client id field change shows connect row
    document.getElementById('gcal-client-id').addEventListener('change', () => {
      if (!GCal.isAuthorized()) {
        document.getElementById('gcal-connect-row').classList.remove('hidden');
        document.getElementById('gcal-confirm-row').classList.add('hidden');
      }
    });

    // Sync interval
    document.getElementById('sync-interval').addEventListener('change', (e) => {
      Storage.updateSetting('syncInterval', parseInt(e.target.value));
      scheduleAutoSync();
    });

    // Export
    document.getElementById('export-btn').addEventListener('click', () => {
      const data = Storage.exportBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tivo-tracker-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      UI.toast('Backup exported', 'success');
    });

    // Import
    document.getElementById('import-btn').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          Storage.importBackup(data);
          UI.renderShows(_currentFilter);
          UI.renderUpcoming();
          UI.updateSettingsUI();
          UI.toast('Backup imported successfully', 'success');
        } catch (err) {
          UI.toast('Invalid backup file', 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // Clear data
    document.getElementById('clear-data-btn').addEventListener('click', () => {
      if (!confirm('Clear ALL data? This cannot be undone.')) return;
      Storage.clearAllData();
      Stremio.loadAuth();
      UI.renderShows(_currentFilter);
      UI.renderUpcoming();
      UI.updateSettingsUI();
      UI.updateStatusPills();
      UI.toast('All data cleared', 'info');
    });
  }

  // ─── Log Viewer ───
  function bindLogViewer() {
    const logBtn = document.getElementById('log-btn');
    if (logBtn) {
      logBtn.addEventListener('click', () => {
        UI.openLogModal();
      });
    }
  }

  // ─── Close Modals ───
  function bindModalClose() {
    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.addEventListener('click', () => {
        el.closest('.modal').classList.add('hidden');
      });
    });
  }

  return {
    init,
    addShow,
    removeShow,
    openShowDetail,
    toggleStremioWatchlist,
    fullSync,
  };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => App.init());
