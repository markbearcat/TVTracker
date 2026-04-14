// ─────────────────────────────────────────────────────────────────────────────
//  TV TRACKER — Main Application
// ─────────────────────────────────────────────────────────────────────────────

// ── Settings (persisted in localStorage) ─────────────────────────────────────

const Settings = {
  _key: 'tvtracker_settings',

  _defaults() {
    return { 
      googleClientId: (typeof CONFIG_DEFAULTS !== 'undefined') ? CONFIG_DEFAULTS.GOOGLE_CLIENT_ID : '', 
      calendarId: 'primary', 
      syncDaysAhead: 0, 
      autoSync: true 
    };
  },

get() {
  try {
    const stored = JSON.parse(localStorage.getItem(this._key) || '{}');
    return { ...this._defaults(), ...stored };
  } catch {
    return this._defaults();
  }
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
},,

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
