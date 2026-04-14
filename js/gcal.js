/**
 * gcal.js — Google Calendar integration via OAuth2 + REST API
 * Updated for persistent login and refresh survival.
 */

const GCal = (() => {
  const SCOPES = 'https://www.googleapis.com/auth/calendar.events';
  const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

  let _tokenClient = null;
  let _accessToken = null;
  let _tokenExpiry = 0;

  // Initialize: Check for a saved token immediately on load
  function initPersistence() {
    const saved = Storage.getGCalAuth();
    if (saved && saved.accessToken && Date.now() < saved.expiry) {
      _accessToken = saved.accessToken;
      _tokenExpiry = saved.expiry;
      console.log("[GCal] Restored session from storage.");
    }
  }

  function getSettings() {
    return Storage.getSettings();
  }

  function isConfigured() {
    const s = getSettings();
    return !!(s.gcalClientId && s.gcalClientId.length > 10);
  }

  function isAuthorized() {
    // Session is valid if we have a token that hasn't expired yet
    return !!_accessToken && Date.now() < _tokenExpiry;
  }

  function loadGoogleIdentity() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.accounts) return resolve();
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
      document.head.appendChild(script);
    });
  }

  async function authorize() {
    if (!isConfigured()) return { success: false, error: 'Google Client ID not set' };

    try {
      await loadGoogleIdentity();
      const { gcalClientId } = getSettings();

      return new Promise((resolve) => {
        _tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: gcalClientId,
          scope: SCOPES,
          callback: (response) => {
            if (response.error) {
              resolve({ success: false, error: response.error });
              return;
            }
            
            // Save token and expiry globally
            _accessToken = response.access_token;
            _tokenExpiry = Date.now() + (response.expires_in * 1000) - 60000;
            
            // Persist to LocalStorage to survive refresh
            Storage.saveGCalAuth({ 
              authorized: true, 
              accessToken: _accessToken, 
              expiry: _tokenExpiry 
            });
            
            UI.updateStatusPills();
            resolve({ success: true });
          },
        });
        
        // Use prompt: 'consent' to ensure we get a fresh token if needed
        _tokenClient.requestAccessToken({ prompt: 'consent' });
      });
    } catch (e) {
      console.error('[GCal] authorize:', e);
      return { success: false, error: e.message };
    }
  }

  async function refreshIfNeeded() {
    if (isAuthorized()) return true;
    
    // Check if we have a valid token in storage before trying a network hit
    initPersistence();
    if (isAuthorized()) return true;

    if (!isConfigured()) return false;
    
    try {
      await loadGoogleIdentity();
      const { gcalClientId } = getSettings();
      
      // Try a silent refresh (no popup) if the user has already consented
      return new Promise((resolve) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: gcalClientId,
          scope: SCOPES,
          callback: (response) => {
            if (response.error) { resolve(false); return; }
            _accessToken = response.access_token;
            _tokenExpiry = Date.now() + (response.expires_in * 1000) - 60000;
            
            Storage.saveGCalAuth({ 
              authorized: true, 
              accessToken: _accessToken, 
              expiry: _tokenExpiry 
            });
            resolve(true);
          },
        });
        client.requestAccessToken({ prompt: '' });
      });
    } catch { return false; }
  }

  function disconnect() {
    _accessToken = null;
    _tokenExpiry = 0;
    _tokenClient = null;
    Storage.clearGCalAuth(); // Wipes from LocalStorage
    if (window.google && window.google.accounts) {
      try { google.accounts.oauth2.revoke(_accessToken, () => {}); } catch {}
    }
    UI.updateStatusPills();
  }

  function calendarId() {
    return getSettings().gcalCalendarId || 'primary';
  }

  async function apiCall(method, path, body = null) {
    if (!isAuthorized()) {
      const ok = await refreshIfNeeded();
      if (!ok) throw new Error('Not authorized');
    }
    
    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${_accessToken}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    
    const res = await fetch(`${CALENDAR_API}${path}`, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ... [Remainder of helper functions (buildEventBody, fullSync, etc.) remain the same as your source] ...

  function buildEventBody(show, episode) {
    const title = `📺 ${show.name} — ${episode.code} "${episode.name}"`;
    const date = episode.airDate;
    return {
      summary: title,
      description: `${episode.overview || ''}\n\nAdded by TiVo Tracker`,
      start: { date },
      end: { date },
      extendedProperties: {
        private: {
          tivoTracker: 'true',
          showId: String(show.id),
          episodeId: String(episode.id || episode.code),
          episodeCode: episode.code,
        },
      },
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 60 }],
      },
    };
  }

  function episodeKey(showId, code) {
    return `${showId}_${code}`;
  }

  async function createOrUpdateEvent(show, episode) {
    const key = episodeKey(show.id, episode.code);
    const existingEventId = Storage.getCalEvent(key);

    try {
      if (existingEventId) {
        try {
          const updated = await apiCall('PUT', `/calendars/${encodeURIComponent(calendarId())}/events/${existingEventId}`, buildEventBody(show, episode));
          return { success: true, eventId: updated.id, action: 'updated' };
        } catch {
          Storage.removeCalEvent(key);
        }
      }

      const created = await apiCall('POST', `/calendars/${encodeURIComponent(calendarId())}/events`, buildEventBody(show, episode));
      Storage.setCalEvent(key, created.id);
      return { success: true, eventId: created.id, action: 'created' };
    } catch (e) {
      console.error('[GCal] createOrUpdateEvent:', e);
      return { success: false, error: e.message };
    }
  }

  async function deleteEvent(showId, episodeCode) {
    const key = episodeKey(showId, episodeCode);
    const eventId = Storage.getCalEvent(key);
    if (!eventId) return { success: true };
    try {
      await apiCall('DELETE', `/calendars/${encodeURIComponent(calendarId())}/events/${eventId}`);
      Storage.removeCalEvent(key);
      return { success: true };
    } catch (e) {
      console.error('[GCal] deleteEvent:', e);
      return { success: false, error: e.message };
    }
  }

  async function fullSync(shows) {
    if (!isAuthorized()) {
      const ok = await refreshIfNeeded();
      if (!ok) return { success: false, error: 'Not authorized with Google Calendar' };
    }

    const results = { created: 0, updated: 0, deleted: 0, errors: [], duplicates: [] };

    try {
      const existingEvents = await fetchAllTivoEvents();
      const existingByKey = {};
      const duplicatesByKey = {};

      existingEvents.forEach(ev => {
        const props = ev.extendedProperties?.private || {};
        if (!props.tivoTracker) return;
        const key = `${props.showId}_${props.episodeCode}`;
        if (existingByKey[key]) {
          if (!duplicatesByKey[key]) duplicatesByKey[key] = [existingByKey[key]];
          duplicatesByKey[key].push(ev);
        } else {
          existingByKey[key] = ev;
        }
      });

      results.duplicates = Object.entries(duplicatesByKey).map(([key, evs]) => ({
        key,
        events: evs,
      }));

      for (const show of shows) {
        try {
          const upcoming = await TVApi.getUpcomingEpisodes(show.id);
          for (const ep of upcoming) {
            if (!ep.airDate) continue;
            const key = episodeKey(show.id, ep.code);
            const localEventId = Storage.getCalEvent(key);
            const calEvent = existingByKey[key];

            if (!calEvent && !localEventId) {
              const r = await createOrUpdateEvent(show, ep);
              if (r.success) results.created++;
              else results.errors.push(`${show.name} ${ep.code}: ${r.error}`);
            } else if (calEvent && !localEventId) {
              Storage.setCalEvent(key, calEvent.id);
            } else if (localEventId && !calEvent) {
              Storage.removeCalEvent(key);
              const r = await createOrUpdateEvent(show, ep);
              if (r.success) { results.created++; }
              else results.errors.push(`${show.name} ${ep.code}: ${r.error}`);
            } else {
              const expectedTitle = `📺 ${show.name} — ${ep.code} "${ep.name}"`;
              if (calEvent.summary !== expectedTitle || calEvent.start?.date !== ep.airDate) {
                const r = await createOrUpdateEvent(show, ep);
                if (r.success) results.updated++;
                else results.errors.push(`${show.name} ${ep.code}: ${r.error}`);
              }
            }
          }
        } catch (e) {
          results.errors.push(`${show.name}: ${e.message}`);
        }
      }
    } catch (e) {
      console.error('[GCal] fullSync:', e);
      return { success: false, error: e.message };
    }

    return { success: true, ...results };
  }

  async function fetchAllTivoEvents() {
    const events = [];
    let pageToken = null;
    do {
      const params = new URLSearchParams({
        privateExtendedProperty: 'tivoTracker=true',
        maxResults: '250',
        singleEvents: 'true',
      });
      if (pageToken) params.set('pageToken', pageToken);
      try {
        const data = await apiCall('GET', `/calendars/${encodeURIComponent(calendarId())}/events?${params}`);
        if (data.items) events.push(...data.items);
        pageToken = data.nextPageToken || null;
      } catch { break; }
    } while (pageToken);
    return events;
  }

  async function resolveDuplicate(events, action) {
    if (action === 'skip') return;
    if (action === 'replace') {
      const [keep, ...remove] = events;
      for (const ev of remove) {
        await apiCall('DELETE', `/calendars/${encodeURIComponent(calendarId())}/events/${ev.id}`);
      }
    }
  }

  // Perform persistence check on load
  initPersistence();

  return {
    isConfigured,
    isAuthorized,
    authorize,
    refreshIfNeeded,
    disconnect,
    createOrUpdateEvent,
    deleteEvent,
    fullSync,
    fetchAllTivoEvents,
    resolveDuplicate,
    episodeKey,
  };
})();
