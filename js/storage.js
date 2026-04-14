/**
 * storage.js — Local storage manager for TiVo Tracker
 * All app data stored locally on device.
 */

const Storage = (() => {
  const KEYS = {
    SHOWS: 'tivo_shows',
    SETTINGS: 'tivo_settings',
    SYNC_LOG: 'tivo_sync_log',
    STREMIO: 'tivo_stremio',
    GCAL: 'tivo_gcal',
    CAL_EVENTS: 'tivo_cal_events',
  };

  const DEFAULT_SETTINGS = {
    theme: 'auto',
    syncInterval: 3600000,
    gcalClientId: '',
    gcalCalendarId: 'primary',
    lastSync: null,
  };

  // ─── Shows ───
  function getShows() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.SHOWS) || '[]');
    } catch { return []; }
  }

  function saveShows(shows) {
    localStorage.setItem(KEYS.SHOWS, JSON.stringify(shows));
  }

  function addShow(show) {
    const shows = getShows();
    const exists = shows.find(s => s.id === show.id);
    if (exists) return { added: false, existing: exists };
    shows.push({ ...show, addedAt: Date.now(), stremioWatchlist: false, calendarEvents: [] });
    saveShows(shows);
    return { added: true };
  }

  function updateShow(id, updates) {
    const shows = getShows();
    const idx = shows.findIndex(s => s.id === id);
    if (idx === -1) return false;
    shows[idx] = { ...shows[idx], ...updates };
    saveShows(shows);
    return true;
  }

  function removeShow(id) {
    const shows = getShows().filter(s => s.id !== id);
    saveShows(shows);
  }

  function getShow(id) {
    return getShows().find(s => s.id === id) || null;
  }

  // ─── Settings ───
  function getSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(KEYS.SETTINGS) || '{}');
      return { ...DEFAULT_SETTINGS, ...stored };
    } catch { return { ...DEFAULT_SETTINGS }; }
  }

  function saveSettings(settings) {
    localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  }

  function updateSetting(key, value) {
    const settings = getSettings();
    settings[key] = value;
    saveSettings(settings);
  }

  // ─── Stremio Auth ───
  function getStremioAuth() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.STREMIO) || 'null');
    } catch { return null; }
  }

  function saveStremioAuth(auth) {
    localStorage.setItem(KEYS.STREMIO, JSON.stringify(auth));
  }

  function clearStremioAuth() {
    localStorage.removeItem(KEYS.STREMIO);
  }

  // ─── Google Calendar ───
  function getGCalAuth() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.GCAL) || 'null');
    } catch { return null; }
  }

  function saveGCalAuth(auth) {
    localStorage.setItem(KEYS.GCAL, JSON.stringify(auth));
  }

  function clearGCalAuth() {
    localStorage.removeItem(KEYS.GCAL);
  }

  // ─── Calendar Events ───
  function getCalEvents() {
    try {
      return JSON.parse(localStorage.getItem(KEYS.CAL_EVENTS) || '{}');
    } catch { return {}; }
  }

  function saveCalEvents(events) {
    localStorage.setItem(KEYS.CAL_EVENTS, JSON.stringify(events));
  }

  function setCalEvent(episodeKey, eventId) {
    const events = getCalEvents();
    events[episodeKey] = eventId;
    saveCalEvents(events);
  }

  function getCalEvent(episodeKey) {
    return getCalEvents()[episodeKey] || null;
  }

  function removeCalEvent(episodeKey) {
    const events = getCalEvents();
    delete events[episodeKey];
    saveCalEvents(events);
  }

  // ─── Sync Log ───
  function updateLastSync() {
    const ts = Date.now();
    updateSetting('lastSync', ts);
    return ts;
  }

  function getLastSync() {
    return getSettings().lastSync;
  }

  // ─── Backup / Restore ───
  function exportBackup() {
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      shows: getShows(),
      settings: getSettings(),
      calEvents: getCalEvents(),
    };
  }

  function importBackup(data) {
    if (!data || !data.version) throw new Error('Invalid backup file');
    if (data.shows) saveShows(data.shows);
    if (data.calEvents) saveCalEvents(data.calEvents);
    if (data.settings) {
      // Don't override auth-related settings from backup
      const current = getSettings();
      const merged = { ...data.settings, gcalClientId: current.gcalClientId };
      saveSettings(merged);
    }
  }

  function clearAllData() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  }

  return {
    getShows, saveShows, addShow, updateShow, removeShow, getShow,
    getSettings, saveSettings, updateSetting,
    getStremioAuth, saveStremioAuth, clearStremioAuth,
    getGCalAuth, saveGCalAuth, clearGCalAuth,
    getCalEvents, saveCalEvents, setCalEvent, getCalEvent, removeCalEvent,
    updateLastSync, getLastSync,
    exportBackup, importBackup, clearAllData,
    KEYS,
  };
})();
