/**
 * stremio.js — Stremio integration
 * Uses Stremio API to manage watchlist
 */

const Stremio = (() => {
  const API = 'https://api.strem.io/api';

  let _auth = null;

  function loadAuth() {
    _auth = Storage.getStremioAuth();
    return _auth;
  }

  function isLoggedIn() {
    return !!_auth && !!_auth.authKey;
  }

  function getUser() {
    return _auth ? { email: _auth.email, fullName: _auth.fullName } : null;
  }

  async function login(email, password) {
    try {
      const res = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'Auth', email, password }),
      });
      const data = await res.json();

      if (data.error) throw new Error(data.error);
      if (!data.result || !data.result.authKey) throw new Error('Login failed — no authKey returned');

      _auth = {
        authKey: data.result.authKey,
        email: data.result.email || email,
        fullName: data.result.fullName || '',
        userId: data.result._id,
      };
      Storage.saveStremioAuth(_auth);
      return { success: true, user: getUser() };
    } catch (e) {
      console.error('[Stremio] login:', e);
      return { success: false, error: e.message };
    }
  }

  function logout() {
    _auth = null;
    Storage.clearStremioAuth();
  }

  async function getLibrary() {
    if (!isLoggedIn()) return [];
    try {
      const res = await fetch(`${API}/datastoreGet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'LibraryItem',
          authKey: _auth.authKey,
          all: true,
          ids: [],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.result || [];
    } catch (e) {
      console.error('[Stremio] getLibrary:', e);
      return [];
    }
  }

  async function addToWatchlist(show) {
    if (!isLoggedIn()) return { success: false, error: 'Not logged in to Stremio' };
    try {
      // Stremio uses IMDB IDs preferably; we use tmdb: prefix as fallback
      const imdbId = show.imdbId || `tmdb:${show.id}`;
      const libItem = {
        _id: imdbId,
        name: show.name,
        poster: show.poster || '',
        type: 'series',
        _ctime: new Date().toISOString(),
        _mtime: new Date().toISOString(),
        state: {
          watched: false,
          watchedEpisodes: [],
        },
        removed: false,
        temp: false,
      };

      const res = await fetch(`${API}/datastorePut`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'LibraryItem',
          authKey: _auth.authKey,
          changes: [libItem],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Update local record
      Storage.updateShow(show.id, { stremioWatchlist: true, stremioId: imdbId });
      return { success: true };
    } catch (e) {
      console.error('[Stremio] addToWatchlist:', e);
      return { success: false, error: e.message };
    }
  }

  async function removeFromWatchlist(show) {
    if (!isLoggedIn()) return { success: false, error: 'Not logged in to Stremio' };
    try {
      const imdbId = show.stremioId || show.imdbId || `tmdb:${show.id}`;
      const res = await fetch(`${API}/datastorePut`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'LibraryItem',
          authKey: _auth.authKey,
          changes: [{
            _id: imdbId,
            removed: true,
            _mtime: new Date().toISOString(),
          }],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      Storage.updateShow(show.id, { stremioWatchlist: false });
      return { success: true };
    } catch (e) {
      console.error('[Stremio] removeFromWatchlist:', e);
      return { success: false, error: e.message };
    }
  }

  async function syncWatchlistStatus() {
    if (!isLoggedIn()) return;
    const library = await getLibrary();
    const libIds = new Set(library.filter(i => !i.removed).map(i => i._id));

    const shows = Storage.getShows();
    shows.forEach(show => {
      const stremioId = show.stremioId || show.imdbId || `tmdb:${show.id}`;
      const inLib = libIds.has(stremioId);
      if (show.stremioWatchlist !== inLib) {
        Storage.updateShow(show.id, { stremioWatchlist: inLib });
      }
    });
  }

  // Init
  loadAuth();

  return {
    loadAuth,
    isLoggedIn,
    getUser,
    login,
    logout,
    getLibrary,
    addToWatchlist,
    removeFromWatchlist,
    syncWatchlistStatus,
  };
})();
