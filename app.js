// ─────────────────────────────────────────────────────────────────────────────
//  TV TRACKER — Main Application
// ─────────────────────────────────────────────────────────────────────────────

// ── Settings (persisted in localStorage) ─────────────────────────────────────

const Settings = {
  _key: 'tvtracker_settings',

  _defaults() {
    return { googleClientId: '', calendarId: 'primary', syncDaysAhead: 0, autoSync: true };
  },

  get() {
    try { return { ...this._defaults(), ...JSON.parse(localStorage.getItem(this._key) || '{}') }; }
    catch { return this._defaults(); }
  },

  set(patch) {
    const updated = { ...this.get(), ...patch };
    localStorage.setItem(this._key, JSON.stringify(updated));
    return updated;
  },

  clientId()      { return this.get().googleClientId || ''; },
  calendarId()    { return this.get().calendarId || 'primary'; },
  syncDaysAhead() { return this.get().syncDaysAhead || 0; },
  autoSync()      { return this.get().autoSync !== false; },
};

// ── State ────────────────────────────────────────────────────────────────────

const State = {
  _key: 'tvtracker_v2',

  get() {
    try { return JSON.parse(localStorage.getItem(this._key)) || this._default(); }
    catch { return this._default(); }
  },

  _default() { return { shows: [], episodes: {}, syncLog: [], lastSync: null }; },
  save(state) { localStorage.setItem(this._key, JSON.stringify(state)); },
  getShows()         { return this.get().shows; },
  getEpisodes(id)    { return (this.get().episodes[id] || []); },

  addShow(show) {
    const s = this.get();
    if (!s.shows.find(x => x.id === show.id)) {
      s.shows.push({ ...show, addedAt: Date.now() });
      this.save(s);
    }
  },

  removeShow(showId) {
    const s = this.get();
    s.shows = s.shows.filter(x => x.id !== showId);
    delete s.episodes[showId];
    this.save(s);
  },

  setEpisodes(showId, episodes) {
    const s = this.get();
    s.episodes[showId] = episodes;
    this.save(s);
  },

  addLog(entry) {
    const s = this.get();
    s.syncLog = [entry, ...(s.syncLog || [])].slice(0, 100);
    s.lastSync = Date.now();
    this.save(s);
  },

  getLogs() { return (this.get().syncLog || []).slice(0, 20); },

  exportBackup() {
    const data = {
      _version: 2,
      _exported: new Date().toISOString(),
      _app: 'TV Tracker',
      state: this.get(),
      settings: { ...Settings.get(), googleClientId: '' }, // never export the secret
    };
    return JSON.stringify(data, null, 2);
  },

  importBackup(json) {
    const data = JSON.parse(json);
    if (!data._version || !data.state) throw new Error('Invalid backup file');
    this.save(data.state);
    if (data.settings) {
      const existing = Settings.get();
      Settings.set({ ...data.settings, googleClientId: existing.googleClientId });
    }
  }
};

// ── TVMaze API ────────────────────────────────────────────────────────────────

const TVMaze = {
  BASE: 'https://api.tvmaze.com',

  async search(q) {
    const r = await fetch(`${this.BASE}/search/shows?q=${encodeURIComponent(q)}`);
    return (await r.json()).map(x => x.show);
  },

  async getShow(id) {
    const r = await fetch(`${this.BASE}/shows/${id}?embed[]=nextepisode&embed[]=previousepisode`);
    return r.json();
  },

  async getEpisodes(id) {
    const r = await fetch(`${this.BASE}/shows/${id}/episodes?specials=0`);
    return r.json();
  }
};

// ── Google Auth ───────────────────────────────────────────────────────────────

const Auth = {
  _token: null,
  _expiry: 0,
  _client: null,
  _onResolve: null,
  _onReject: null,

  isConnected() { return !!(this._token && Date.now() < this._expiry - 60000); },

  async ensureToken() {
    if (this.isConnected()) return this._token;
    return new Promise((res, rej) => {
      this._onResolve = res;
      this._onReject = rej;
      if (!this._client) { rej('No Google client. Add your Client ID in Settings.'); return; }
      this._client.requestAccessToken({ prompt: '' });
    });
  },

  _initClient() {
    const id = Settings.clientId();
    if (!window.google || !id) return;
    try {
      this._client = google.accounts.oauth2.initTokenClient({
        client_id: id,
        scope: 'https://www.googleapis.com/auth/calendar.events',
        callback: resp => {
          if (resp.error) { this._onReject?.(resp.error); return; }
          this._token  = resp.access_token;
          this._expiry = Date.now() + resp.expires_in * 1000;
          this._onResolve?.(this._token);
          this._onResolve = this._onReject = null;
          UI.updateAuthButton();
        }
      });
    } catch (e) { console.error('GSI init failed:', e); }
  },

  init()   { this._initClient(); },

  reinit() {
    this._token = null; this._expiry = 0; this._client = null;
    this._initClient();
    UI.updateAuthButton();
  },

  signIn() {
    if (!Settings.clientId()) {
      toast('Enter your Google Client ID in Settings first', 'warning');
      UI.switchTab('settings'); return;
    }
    if (!this._client) this._initClient();
    this.ensureToken()
      .then(() => { toast('Signed in to Google ✓', 'success'); UI.updateAuthButton(); })
      .catch(e  => toast(String(e), 'error'));
  },

  signOut() {
    if (this._token) { try { google.accounts.oauth2.revoke(this._token); } catch (_) {} }
    this._token = null; this._expiry = 0;
    UI.updateAuthButton();
    toast('Signed out of Google');
  }
};

// ── Google Calendar API ───────────────────────────────────────────────────────

const GCal = {
  BASE: 'https://www.googleapis.com/calendar/v3',

  async _req(method, path, body) {
    const token = await Auth.ensureToken();
    const r = await fetch(`${this.BASE}${path}`, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 204) return null;
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'Calendar API error');
    return d;
  },

  _buildEvent(show, ep) {
    const runtime = ep.runtime || show.averageRuntime || 60;
    let start, end;

    if (ep.airstamp) {
      start = { dateTime: ep.airstamp };
      end   = { dateTime: new Date(new Date(ep.airstamp).getTime() + runtime * 60000).toISOString() };
    } else if (ep.airdate) {
      const time = ep.airtime || '20:00';
      const tz   = show.network?.country?.timezone || 'America/New_York';
      const [h, m] = time.split(':').map(Number);
      const em = m + runtime;
      start = { dateTime: `${ep.airdate}T${time}:00`, timeZone: tz };
      end   = { dateTime: `${ep.airdate}T${String(h + Math.floor(em/60)).padStart(2,'0')}:${String(em%60).padStart(2,'0')}:00`, timeZone: tz };
    } else { return null; }

    const epCode = `S${String(ep.season).padStart(2,'0')}E${String(ep.number).padStart(2,'0')}`;
    const network = show.network?.name || show.webChannel?.name || '';
    return {
      summary: `📺 ${show.name} ${epCode}${ep.name ? ': ' + ep.name : ''}`,
      description: [
        show.name,
        `${epCode}${ep.name ? ': ' + ep.name : ''}`,
        network ? `Network: ${network}` : '',
        ep.summary ? '\n' + ep.summary.replace(/<[^>]*>/g,'') : '',
        `\nhttps://www.tvmaze.com/episodes/${ep.id}`
      ].filter(Boolean).join('\n'),
      start, end,
      colorId: '3',
      source: { title: 'TV Tracker', url: `https://www.tvmaze.com/episodes/${ep.id}` },
      extendedProperties: {
        private: { tvtracker: 'true', showId: String(show.id), episodeId: String(ep.id) }
      }
    };
  },

  async createEvent(show, ep) {
    const ev = this._buildEvent(show, ep);
    if (!ev) return null;
    const r = await this._req('POST', `/calendars/${encodeURIComponent(Settings.calendarId())}/events`, ev);
    return r?.id || null;
  },

  async updateEvent(calId, show, ep) {
    const ev = this._buildEvent(show, ep);
    if (!ev) return null;
    const r = await this._req('PUT', `/calendars/${encodeURIComponent(Settings.calendarId())}/events/${calId}`, ev);
    return r?.id || null;
  },

  async deleteEvent(calId) {
    try { await this._req('DELETE', `/calendars/${encodeURIComponent(Settings.calendarId())}/events/${calId}`); }
    catch (_) {}
  }
};

// ── Sync ──────────────────────────────────────────────────────────────────────

const Sync = {
  running: false,

  async syncShow(show) {
    const today = new Date().toISOString().split('T')[0];
    let fresh;
    try { fresh = await TVMaze.getEpisodes(show.id); }
    catch (e) { console.error(e); return { created:0, updated:0, deleted:0, errors:1 }; }

    const stored    = State.getEpisodes(show.id);
    const storedMap = Object.fromEntries(stored.map(e => [e.id, e]));
    let showData = show;
    try { showData = await TVMaze.getShow(show.id); } catch (_) {}

    let created=0, updated=0, deleted=0, errors=0;
    const freshMap = {};

    for (const ep of fresh) {
      freshMap[ep.id] = ep;
      if (!ep.airdate || ep.airdate < today) continue;

      const prev  = storedMap[ep.id];
      const calId = prev?.calendarEventId;
      const changed = prev && (
        prev.airstamp !== ep.airstamp || prev.airdate !== ep.airdate ||
        prev.airtime  !== ep.airtime  || prev.name    !== ep.name
      );

      try {
        if (!calId)        { ep.calendarEventId = await GCal.createEvent(showData, ep); created++; }
        else if (changed)  { await GCal.updateEvent(calId, showData, ep); ep.calendarEventId = calId; updated++; }
        else               { ep.calendarEventId = calId; }
      } catch (e) { console.error(e); ep.calendarEventId = calId || null; errors++; }
    }

    for (const prev of stored) {
      if (!freshMap[prev.id] && prev.calendarEventId && prev.airdate >= today) {
        try { await GCal.deleteEvent(prev.calendarEventId); deleted++; } catch (_) {}
      }
    }

    State.setEpisodes(show.id, fresh.map(ep => ({
      id: ep.id, name: ep.name, season: ep.season, number: ep.number,
      airdate: ep.airdate, airtime: ep.airtime, airstamp: ep.airstamp,
      runtime: ep.runtime, calendarEventId: ep.calendarEventId || null
    })));

    return { created, updated, deleted, errors };
  },

  async syncAll() {
    if (this.running) return;
    this.running = true;
    UI.setSyncing(true);

    const shows = State.getShows();
    if (!shows.length) {
      this.running = false; UI.setSyncing(false); toast('No shows to sync'); return;
    }

    try { await Auth.ensureToken(); }
    catch (e) { this.running = false; UI.setSyncing(false); toast('Sign in to Google to sync', 'error'); return; }

    let tc=0, tu=0, td=0, te=0;
    for (const show of shows) {
      UI.setStatus(`Syncing ${show.name}…`);
      const r = await this.syncShow(show);
      tc+=r.created; tu+=r.updated; td+=r.deleted; te+=r.errors;
    }

    State.addLog({ time: Date.now(), shows: shows.length, created:tc, updated:tu, deleted:td, errors:te });
    this.running = false; UI.setSyncing(false); UI.setStatus('');
    UI.renderAll();
    toast(`Sync done — +${tc} new · ${tu} updated · ${td} removed`, te > 0 ? 'warning' : 'success');
  }
};

// ── Toast ─────────────────────────────────────────────────────────────────────

function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('visible'));
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, 3500);
}

// ── UI ────────────────────────────────────────────────────────────────────────

const UI = {
  _searchResults: [],

  init() {
    this.renderAll();
    this.bindNav();
    this.bindSearch();
    this.bindSettings();
    Auth.init();
    this.updateAuthButton();
    this.populateSettingsForm();
    if (Settings.autoSync() && Auth.isConnected()) setTimeout(() => Sync.syncAll(), 1500);
  },

  switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b  => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  },

  bindNav() {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => this.switchTab(btn.dataset.tab)));
    document.getElementById('sync-btn').addEventListener('click', () => { if (!Sync.running) Sync.syncAll(); });
    document.getElementById('auth-btn').addEventListener('click', () => Auth.isConnected() ? Auth.signOut() : Auth.signIn());
  },

  bindSearch() {
    const input = document.getElementById('search-input');
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      const q = input.value.trim();
      if (!q) { this._searchResults = []; this.renderSearch(); return; }
      t = setTimeout(() => this.doSearch(q), 400);
    });
  },

  bindSettings() {
    document.getElementById('save-settings-btn').addEventListener('click', () => {
      const clientId = document.getElementById('input-client-id').value.trim();
      const calId    = document.getElementById('input-calendar-id').value.trim() || 'primary';
      const autoSync = document.getElementById('input-auto-sync').checked;
      Settings.set({ googleClientId: clientId, calendarId: calId, autoSync });
      Auth.reinit();
      toast('Settings saved', 'success');
      this.populateSettingsForm();
      this.updateAuthButton();
    });

    document.getElementById('toggle-client-id').addEventListener('click', () => {
      const inp = document.getElementById('input-client-id');
      const btn = document.getElementById('toggle-client-id');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      btn.textContent = inp.type === 'password' ? 'Show' : 'Hide';
    });

    document.getElementById('backup-btn').addEventListener('click', () => {
      const blob = new Blob([State.exportBackup()], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `tv-tracker-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Backup downloaded', 'success');
    });

    document.getElementById('restore-btn').addEventListener('click', () => {
      document.getElementById('restore-file').click();
    });

    document.getElementById('restore-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        State.importBackup(await file.text());
        this.renderAll();
        this.populateSettingsForm();
        toast('Backup restored ✓', 'success');
      } catch (err) {
        toast('Restore failed: ' + err.message, 'error');
      }
      e.target.value = '';
    });
  },

  populateSettingsForm() {
    const s = Settings.get();
    document.getElementById('input-client-id').value    = s.googleClientId || '';
    document.getElementById('input-calendar-id').value  = s.calendarId || 'primary';
    document.getElementById('input-auto-sync').checked  = s.autoSync !== false;
    document.getElementById('setup-notice').classList.toggle('hidden', !!s.googleClientId);
    this.updateStorageSize();
  },

  async doSearch(q) {
    document.getElementById('search-spinner').classList.remove('hidden');
    try   { this._searchResults = await TVMaze.search(q); }
    catch { this._searchResults = []; }
    document.getElementById('search-spinner').classList.add('hidden');
    this.renderSearch();
  },

  renderAll() {
    this.renderSearch();
    this.renderShows();
    this.renderUpcoming();
    this.renderLog();
    this.updateStorageSize();
  },

  renderSearch() {
    const el = document.getElementById('search-results');
    const trackedIds = new Set(State.getShows().map(s => s.id));

    if (!this._searchResults.length) {
      el.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div><p>Search for a TV show above</p></div>`;
      return;
    }

    el.innerHTML = this._searchResults.map(show => {
      const tracked = trackedIds.has(show.id);
      const img  = show.image?.medium ? `<img src="${show.image.medium}" alt="" class="show-thumb" loading="lazy">` : `<div class="show-thumb no-img">📺</div>`;
      const sCls = show.status === 'Running' ? 'badge-green' : 'badge-gray';
      const sLbl = show.status === 'Running' ? 'Airing' : (show.status || '?');
      const net  = show.network?.name || show.webChannel?.name || '';
      const genres = (show.genres||[]).slice(0,2).map(g=>`<span class="badge badge-purple">${g}</span>`).join('');
      return `<div class="show-card">
        ${img}
        <div class="show-info">
          <div class="show-name">${show.name}</div>
          <div class="show-meta"><span class="badge ${sCls}">${sLbl}</span>${net?`<span class="badge badge-gray">${net}</span>`:''}${genres}</div>
          ${show.premiered?`<div class="show-year">${show.premiered.slice(0,4)}</div>`:''}
        </div>
        <button class="add-btn ${tracked?'tracked':''}" data-show='${JSON.stringify(show).replace(/'/g,"&apos;")}'>
          ${tracked ? '✓ Tracking' : '+ Track'}
        </button>
      </div>`;
    }).join('');

    el.querySelectorAll('.add-btn:not(.tracked)').forEach(btn => {
      btn.addEventListener('click', async () => {
        const show = JSON.parse(btn.dataset.show.replace(/&apos;/g, "'"));
        btn.textContent = 'Adding…'; btn.disabled = true;
        State.addShow(show);
        btn.className = 'add-btn tracked'; btn.textContent = '✓ Tracking';
        toast(`Added ${show.name}`);
        this.renderShows();

        if (Auth.isConnected()) {
          toast(`Syncing ${show.name} to calendar…`);
          try {
            const r = await Sync.syncShow(show);
            toast(`${show.name}: +${r.created} episodes synced`, 'success');
            this.renderAll();
          } catch (e) { toast('Calendar sync failed: ' + e.message, 'error'); }
        } else if (!Settings.clientId()) {
          toast('Add your Google Client ID in Settings to sync to Calendar', 'info');
        } else {
          toast('Tap "Sign in" to sync episodes to Calendar', 'info');
        }
      });
    });
  },

  renderShows() {
    const el = document.getElementById('shows-list');
    const shows = State.getShows();
    if (!shows.length) {
      el.innerHTML = `<div class="empty"><div class="empty-icon">📺</div><p>No shows tracked yet</p><p class="empty-sub">Search for a show to get started</p></div>`;
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    el.innerHTML = shows.map(show => {
      const eps    = State.getEpisodes(show.id);
      const future = eps.filter(e => e.airdate >= today).sort((a,b) => a.airdate.localeCompare(b.airdate));
      const synced = future.filter(e => e.calendarEventId).length;
      const img  = show.image?.medium ? `<img src="${show.image.medium}" alt="" class="show-thumb" loading="lazy">` : `<div class="show-thumb no-img">📺</div>`;
      const imdb = show.externals?.imdb;
      const next = future[0];
      return `<div class="show-card show-card--tracked">
        ${img}
        <div class="show-info">
          <div class="show-name">${show.name}</div>
          <div class="show-meta">
            <span class="badge ${show.status==='Running'?'badge-green':'badge-gray'}">${show.status==='Running'?'Airing':(show.status||'')}</span>
            ${eps.length?`<span class="badge badge-purple">${eps.length} eps</span>`:''}
            ${future.length?`<span class="badge badge-blue">${synced}/${future.length} synced</span>`:''}
          </div>
          ${next
            ? `<div class="next-ep">Next: S${String(next.season).padStart(2,'0')}E${String(next.number).padStart(2,'0')} — ${next.airdate}</div>`
            : `<div class="next-ep muted">No upcoming episodes</div>`}
        </div>
        <div class="show-actions">
          ${imdb?`<a href="https://web.strem.io/#/detail/series/${imdb}" target="_blank" class="icon-btn stremio-btn" title="Open in Stremio">▶</a>`:''}
          <button class="icon-btn remove-btn" data-show-id="${show.id}" title="Remove">✕</button>
        </div>
      </div>`;
    }).join('');

    el.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id   = Number(btn.dataset.showId);
        const show = shows.find(s => s.id === id);
        if (!confirm(`Remove ${show?.name}? Future calendar events will be deleted.`)) return;
        if (Auth.isConnected()) {
          const today2 = new Date().toISOString().split('T')[0];
          for (const ep of State.getEpisodes(id)) {
            if (ep.calendarEventId && ep.airdate >= today2)
              try { await GCal.deleteEvent(ep.calendarEventId); } catch (_) {}
          }
        }
        State.removeShow(id);
        this.renderAll();
        toast(`Removed ${show?.name}`);
      });
    });
  },

  renderUpcoming() {
    const el    = document.getElementById('upcoming-list');
    const shows = State.getShows();
    const today = new Date().toISOString().split('T')[0];
    const days  = Settings.syncDaysAhead();
    const cut   = days > 0 ? new Date(Date.now() + days*86400000).toISOString().split('T')[0] : '9999-99-99';

    const items = [];
    for (const show of shows)
      for (const ep of State.getEpisodes(show.id))
        if (ep.airdate && ep.airdate >= today && ep.airdate <= cut)
          items.push({ show, ep });
    items.sort((a,b) => (a.ep.airstamp||a.ep.airdate).localeCompare(b.ep.airstamp||b.ep.airdate));

    if (!items.length) {
      el.innerHTML = `<div class="empty"><div class="empty-icon">📅</div><p>No upcoming episodes</p><p class="empty-sub">Add shows and sync to see what's coming</p></div>`;
      return;
    }

    const grouped = {};
    for (const item of items) {
      const d = item.ep.airdate || 'TBA';
      (grouped[d] = grouped[d] || []).push(item);
    }
    const tom = new Date(Date.now()+86400000).toISOString().split('T')[0];

    el.innerHTML = Object.entries(grouped).map(([date, list]) => {
      const lbl = date===today ? 'Today' : date===tom ? 'Tomorrow'
        : new Date(date+'T12:00:00').toLocaleDateString('en-AU',{weekday:'long',month:'short',day:'numeric'});
      return `<div class="date-group">
        <div class="date-label">${lbl}</div>
        ${list.map(({show,ep}) => {
          const code = `S${String(ep.season).padStart(2,'0')}E${String(ep.number).padStart(2,'0')}`;
          const img  = show.image?.medium ? `<img src="${show.image.medium}" alt="" class="ep-thumb" loading="lazy">` : `<div class="ep-thumb no-img">📺</div>`;
          return `<div class="ep-card">${img}
            <div class="ep-info">
              <div class="ep-show">${show.name}</div>
              <div class="ep-title">${code}${ep.name?': '+ep.name:''}</div>
              ${ep.airtime?`<div class="ep-time">${ep.airtime}</div>`:''}
            </div>
            <div class="ep-status">
              ${ep.calendarEventId?'<span class="badge badge-green" title="Synced">📅</span>':'<span class="badge badge-gray">–</span>'}
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
  },

  renderLog() {
    const el = document.getElementById('sync-log');
    const logs = State.getLogs();
    if (!logs.length) { el.innerHTML = '<div class="log-empty">No sync history yet</div>'; return; }
    el.innerHTML = logs.map(l =>
      `<div class="log-entry">
        <span class="log-time">${new Date(l.time).toLocaleString('en-AU')}</span>
        <span>${l.shows} shows · +${l.created} added · ${l.updated} updated · ${l.deleted} removed${l.errors?` · ${l.errors} errors`:''}</span>
      </div>`
    ).join('');
  },

  updateStorageSize() {
    const el = document.getElementById('storage-size');
    if (!el) return;
    try {
      const bytes = ['tvtracker_v2','tvtracker_settings'].reduce((n,k) => n+(localStorage.getItem(k)||'').length, 0);
      el.textContent = `${(bytes/1024).toFixed(1)} KB stored locally`;
    } catch (_) {}
  },

  updateAuthButton() {
    const btn = document.getElementById('auth-btn');
    if (!btn) return;
    btn.textContent = Auth.isConnected() ? 'Google ✓' : 'Sign in';
    btn.classList.toggle('signed-in', Auth.isConnected());
  },

  setSyncing(val) {
    const btn = document.getElementById('sync-btn');
    btn.classList.toggle('spinning', val);
    btn.disabled = val;
  },

  setStatus(msg) {
    const el = document.getElementById('status-msg');
    el.textContent = msg;
    el.classList.toggle('hidden', !msg);
  }
};

// ── Boot ──────────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);

  const initGSI = () => { Auth.init(); UI.updateAuthButton(); };
  if (window.google) { initGSI(); }
  else {
    window.addEventListener('gsi-loaded', initGSI);
    const poll = setInterval(() => { if (window.google) { clearInterval(poll); initGSI(); } }, 200);
    setTimeout(() => clearInterval(poll), 5000);
  }

  UI.init();
});
