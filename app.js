// ═══════════════════════════════════════════════════════════════════
//  TV TRACKER — Main Application
// ═══════════════════════════════════════════════════════════════════

// ── Settings ──────────────────────────────────────────────────────

const Settings = {
  _key: 'tvtracker_settings',
  _def() { return { googleClientId:'', calendarId:'primary', syncDaysAhead:0, autoSync:true }; },
  get() { try { return {...this._def(),...JSON.parse(localStorage.getItem(this._key)||'{}')}; } catch { return this._def(); } },
  set(p) { const u={...this.get(),...p}; localStorage.setItem(this._key,JSON.stringify(u)); return u; },
  clientId()   { return this.get().googleClientId||''; },
  calendarId() { return this.get().calendarId||'primary'; },
  autoSync()   { return this.get().autoSync!==false; },
};

// ── State ──────────────────────────────────────────────────────────

const State = {
  _key: 'tvtracker_v2',
  get() { try { return JSON.parse(localStorage.getItem(this._key))||this._def(); } catch { return this._def(); } },
  _def() { return { shows:[], episodes:{}, syncLog:[], lastSync:null, stremioShows:{} }; },
  save(s) { localStorage.setItem(this._key,JSON.stringify(s)); },
  getShows()      { return this.get().shows; },
  getEpisodes(id) { return this.get().episodes[id]||[]; },

  addShow(show) {
    const s=this.get();
    if (!s.shows.find(x=>x.id===show.id)) { s.shows.push({...show,addedAt:Date.now()}); this.save(s); }
  },
  removeShow(id) { const s=this.get(); s.shows=s.shows.filter(x=>x.id!==id); delete s.episodes[id]; this.save(s); },
  setEpisodes(id,eps) { const s=this.get(); s.episodes[id]=eps; this.save(s); },

  setStremio(imdbId, data) { const s=this.get(); s.stremioShows=s.stremioShows||{}; s.stremioShows[imdbId]=data; this.save(s); },
  getStremio(imdbId) { return (this.get().stremioShows||{})[imdbId]||null; },

  addLog(entry) { const s=this.get(); s.syncLog=[entry,...(s.syncLog||[])].slice(0,100); s.lastSync=Date.now(); this.save(s); },
  getLogs() { return (this.get().syncLog||[]).slice(0,20); },

  exportBackup() {
    return JSON.stringify({ _version:2, _exported:new Date().toISOString(), _app:'TV Tracker',
      state:this.get(), settings:{...Settings.get(),googleClientId:''} }, null, 2);
  },
  importBackup(json) {
    const d=JSON.parse(json);
    if (!d._version||!d.state) throw new Error('Invalid backup file');
    this.save(d.state);
    if (d.settings) Settings.set({...d.settings,googleClientId:Settings.clientId()});
  }
};

// ── TVMaze ─────────────────────────────────────────────────────────

const TVMaze = {
  BASE: 'https://api.tvmaze.com',
  async search(q) { const r=await fetch(`${this.BASE}/search/shows?q=${encodeURIComponent(q)}`); return (await r.json()).map(x=>x.show); },
  async getShow(id) { const r=await fetch(`${this.BASE}/shows/${id}?embed[]=nextepisode`); return r.json(); },
  async getEpisodes(id) { const r=await fetch(`${this.BASE}/shows/${id}/episodes?specials=0`); return r.json(); }
};

// ── Google Auth ────────────────────────────────────────────────────
// Uses silent token refresh so the connection stays permanent.
// On first sign-in the user sees the Google consent popup once.
// After that, tokens are refreshed silently in the background
// every 45 min (tokens expire after 60 min) and on every app open.

const GAuth = {
  _token: null,
  _expiry: 0,
  _client: null,
  _res: null,
  _rej: null,
  _refreshTimer: null,
  _PERSIST_KEY: 'tvtracker_google_connected',

  isConnected() { return !!(this._token && Date.now() < this._expiry - 60000); },

  // Remember that user has signed in — survives app restarts
  _markConnected()    { localStorage.setItem(this._PERSIST_KEY, '1'); },
  _clearConnected()   { localStorage.removeItem(this._PERSIST_KEY); },
  wasConnected()      { return !!localStorage.getItem(this._PERSIST_KEY); },

  // Request a token. prompt='' means fully silent if Google session exists.
  // prompt='consent' forces the account picker (used on first sign-in only).
  _requestToken(prompt = '') {
    return new Promise((res, rej) => {
      this._res = res;
      this._rej = rej;
      if (!this._client) { rej('No Google client — add your Client ID in Settings.'); return; }
      this._client.requestAccessToken({ prompt });
    });
  },

  async ensureToken() {
    if (this.isConnected()) return this._token;
    // Try silent refresh first — no popup
    return this._requestToken('');
  },

  _onTokenResponse(resp) {
    if (resp.error) {
      // Silent refresh failed (session expired or revoked)
      const wasPersisted = this.wasConnected();
      this._rej?.(resp.error);
      this._res = this._rej = null;
      if (wasPersisted && resp.error !== 'popup_closed_by_user') {
        // Session gone — clear persisted state, prompt fresh sign-in
        this._clearConnected();
        this._token = null;
        this._expiry = 0;
        UI.updateAuthBtn();
        this._scheduleRefresh(0); // cancel timer
      }
      return;
    }
    this._token = resp.access_token;
    this._expiry = Date.now() + resp.expires_in * 1000;
    this._markConnected();
    this._res?.(this._token);
    this._res = this._rej = null;
    UI.updateAuthBtn();
    // Schedule next silent refresh at 45 min (before 60-min expiry)
    this._scheduleRefresh(45 * 60 * 1000);
  },

  _scheduleRefresh(delayMs) {
    clearTimeout(this._refreshTimer);
    if (delayMs <= 0) return;
    this._refreshTimer = setTimeout(async () => {
      if (!this._client) return;
      try { await this._requestToken(''); }
      catch(e) { console.warn('Silent token refresh failed:', e); }
    }, delayMs);
  },

  _init() {
    const id = Settings.clientId();
    if (!window.google || !id) return;
    try {
      this._client = google.accounts.oauth2.initTokenClient({
        client_id: id,
        scope: 'https://www.googleapis.com/auth/calendar.events',
        callback: resp => this._onTokenResponse(resp)
      });
    } catch(e) { console.error('GSI init:', e); return; }

    // If the user was previously connected, silently restore the token now.
    // No popup — works as long as their Google session is active in Chrome.
    if (this.wasConnected()) {
      this._requestToken('').catch(() => {
        // Silent restore failed quietly — button stays "Sign in"
      });
    }
  },

  init() { this._init(); },

  reinit() {
    clearTimeout(this._refreshTimer);
    this._token = null; this._expiry = 0; this._client = null;
    this._init();
    UI.updateAuthBtn();
  },

  signIn() {
    if (!Settings.clientId()) {
      toast('Add your Google Client ID in Settings first', 'warning');
      UI.switchTab('settings');
      return;
    }
    if (!this._client) this._init();
    // First attempt: silent. If that fails (no session), show picker.
    this._requestToken('')
      .then(() => { toast('Signed in to Google ✓', 'success'); UI.updateAuthBtn(); })
      .catch(() => {
        // Silent failed — show full consent picker
        this._requestToken('select_account')
          .then(() => { toast('Signed in to Google ✓', 'success'); UI.updateAuthBtn(); })
          .catch(e => toast(String(e), 'error'));
      });
  },

  signOut() {
    clearTimeout(this._refreshTimer);
    if (this._token) try { google.accounts.oauth2.revoke(this._token); } catch(_) {}
    this._token = null; this._expiry = 0;
    this._clearConnected();
    UI.updateAuthBtn();
    toast('Signed out of Google');
  }
};

// ── Google Calendar ────────────────────────────────────────────────

const GCal = {
  BASE:'https://www.googleapis.com/calendar/v3',

  async _req(method, path, body) {
    const token=await GAuth.ensureToken();
    const r=await fetch(`${this.BASE}${path}`,{
      method,
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body:body?JSON.stringify(body):undefined
    });
    if (r.status===204) return null;
    const d=await r.json();
    if (d.error) throw new Error(d.error.message||'Calendar API error');
    return d;
  },

  _calId() { return encodeURIComponent(Settings.calendarId()); },

  _buildEvent(show, ep) {
    const runtime=ep.runtime||show.averageRuntime||60;
    let start, end;
    if (ep.airstamp) {
      start={dateTime:ep.airstamp};
      end={dateTime:new Date(new Date(ep.airstamp).getTime()+runtime*60000).toISOString()};
    } else if (ep.airdate) {
      const time=ep.airtime||'20:00', tz=show.network?.country?.timezone||'America/New_York';
      const [h,m]=time.split(':').map(Number), em=m+runtime;
      start={dateTime:`${ep.airdate}T${time}:00`,timeZone:tz};
      end={dateTime:`${ep.airdate}T${String(h+Math.floor(em/60)).padStart(2,'0')}:${String(em%60).padStart(2,'0')}:00`,timeZone:tz};
    } else { return null; }
    const ec=`S${String(ep.season).padStart(2,'0')}E${String(ep.number).padStart(2,'0')}`;
    const net=show.network?.name||show.webChannel?.name||'';
    return {
      summary:`📺 ${show.name} ${ec}${ep.name?': '+ep.name:''}`,
      description:[show.name,`${ec}${ep.name?': '+ep.name:''}`,net?`Network: ${net}`:'',
        ep.summary?'\n'+ep.summary.replace(/<[^>]*>/g,''):'',`\nhttps://www.tvmaze.com/episodes/${ep.id}`
      ].filter(Boolean).join('\n'),
      start, end, colorId:'3',
      source:{title:'TV Tracker',url:`https://www.tvmaze.com/episodes/${ep.id}`},
      extendedProperties:{private:{tvtracker:'true',showId:String(show.id),episodeId:String(ep.id)}}
    };
  },

  async fetchShowEvents(showId) {
    // Fetch all calendar events created by TV Tracker for a given showId
    const params=new URLSearchParams({
      privateExtendedProperty:`tvtracker=true`,
      privateExtendedProperty2:`showId=${showId}`,
      maxResults:'250', singleEvents:'true',
      fields:'items(id,extendedProperties,summary,start)'
    });
    // Build query string manually to allow duplicate keys
    const qs=`privateExtendedProperty=tvtracker%3Dtrue&privateExtendedProperty=showId%3D${showId}&maxResults=250&singleEvents=true&fields=items(id,extendedProperties,summary,start)`;
    try {
      const r=await this._req('GET',`/calendars/${this._calId()}/events?${qs}`);
      return r?.items||[];
    } catch(e) { console.warn('fetchShowEvents:',e); return []; }
  },

  async eventExists(calEventId) {
    try { await this._req('GET',`/calendars/${this._calId()}/events/${calEventId}`); return true; }
    catch(e) { return e.message!=='Not Found' && !e.message.includes('404') ? true : false; }
  },

  async createEvent(show,ep) {
    const ev=this._buildEvent(show,ep); if (!ev) return null;
    const r=await this._req('POST',`/calendars/${this._calId()}/events`,ev);
    return r?.id||null;
  },

  async updateEvent(calId,show,ep) {
    const ev=this._buildEvent(show,ep); if (!ev) return null;
    const r=await this._req('PUT',`/calendars/${this._calId()}/events/${calId}`,ev);
    return r?.id||null;
  },

  async deleteEvent(calId) {
    try { await this._req('DELETE',`/calendars/${this._calId()}/events/${calId}`); } catch(_){}
  }
};

// ── Stremio ────────────────────────────────────────────────────────

const TVStremio = {
  BASE:'https://api.strem.io/api',
  _authKey: null,

  init() { this._authKey=localStorage.getItem('tvtracker_stremio_key')||null; },

  isConnected() { return !!this._authKey; },

  async login(email, password) {
    const r=await fetch(`${this.BASE}/login`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,password,facebook:false})
    });
    const d=await r.json();
    if (d.result?.authKey) {
      this._authKey=d.result.authKey;
      localStorage.setItem('tvtracker_stremio_key',this._authKey);
      return d.result;
    }
    throw new Error(d.error||'Login failed — check your credentials');
  },

  logout() {
    this._authKey=null;
    localStorage.removeItem('tvtracker_stremio_key');
    UI.updateStremioBtn();
    toast('Signed out of Stremio');
  },

  async addToLibrary(show) {
    if (!this._authKey) throw new Error('Not signed in to Stremio');
    const imdbId=show.externals?.imdb;
    if (!imdbId) throw new Error('No IMDB ID for this show — cannot add to Stremio');
    const now=new Date().toISOString();
    const item={
      _id:imdbId, name:show.name, type:'series',
      poster:show.image?.medium||show.image?.original||'',
      _ctime:now, _mtime:now, removed:false, temp:false,
      behaviorHints:{defaultVideoId:null},
      state:{lastWatched:null,timeWatched:0,timesWatched:0,flaggedWatched:0,duration:0,video_id:'',watched:[],noNotif:false}
    };
    const r=await fetch(`${this.BASE}/libraryUpdate`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({authKey:this._authKey,changes:[item]})
    });
    const d=await r.json();
    if (d.error) throw new Error(d.error);
    State.setStremio(imdbId,{added:true,name:show.name,addedAt:Date.now()});
    return true;
  },

  async getLibrary() {
    if (!this._authKey) return [];
    try {
      const r=await fetch(`${this.BASE}/library?authKey=${this._authKey}&type=series`);
      const d=await r.json();
      return d.result||[];
    } catch { return []; }
  },

  // Sync local tracked shows → Stremio library
  async syncLibrary() {
    if (!this._authKey) return { added:0, errors:0 };
    const shows=State.getShows();
    let added=0, errors=0;
    for (const show of shows) {
      const imdbId=show.externals?.imdb;
      if (!imdbId) continue;
      const already=State.getStremio(imdbId);
      if (already?.added) continue;
      try { await this.addToLibrary(show); added++; } catch(e) { console.warn('Stremio sync:',e); errors++; }
    }
    return {added,errors};
  }
};

// ── Sync Engine ────────────────────────────────────────────────────

const Sync = {
  running:false,
  _pendingDuplicates:[], // [{show, episodeId, epLabel, events:[...]}]

  async syncShow(show, opts={}) {
    const today=new Date().toISOString().split('T')[0];
    let fresh;
    try { fresh=await TVMaze.getEpisodes(show.id); }
    catch(e) { return {created:0,updated:0,deleted:0,repopulated:0,errors:1,duplicates:[]}; }

    const stored=State.getEpisodes(show.id);
    const storedMap=Object.fromEntries(stored.map(e=>[e.id,e]));
    let showData=show;
    try { showData=await TVMaze.getShow(show.id); } catch(_){}

    // Fetch all existing calendar events for this show in one query
    let calEvents=[];
    try { calEvents=await GCal.fetchShowEvents(show.id); } catch(_){}

    // Map episodeId → [calendarEventId, ...]
    const calMap={};
    for (const ev of calEvents) {
      const epId=ev.extendedProperties?.private?.episodeId;
      if (!epId) continue;
      if (!calMap[epId]) calMap[epId]=[];
      calMap[epId].push(ev.id);
    }

    let created=0, updated=0, deleted=0, repopulated=0, errors=0;
    const duplicates=[];
    const freshMap={};

    for (const ep of fresh) {
      freshMap[ep.id]=ep;
      if (!ep.airdate||ep.airdate<today) continue;

      const stored_ep=storedMap[ep.id];
      const liveCalIds=calMap[String(ep.id)]||[];

      // Detect duplicates
      if (liveCalIds.length>1) {
        const ec=`S${String(ep.season).padStart(2,'0')}E${String(ep.number).padStart(2,'0')}`;
        duplicates.push({ showId:show.id, showName:show.name, episodeId:ep.id, epLabel:ec+(ep.name?': '+ep.name:''), events:liveCalIds });
      }

      const storedCalId=stored_ep?.calendarEventId;
      const changed=stored_ep&&(stored_ep.airstamp!==ep.airstamp||stored_ep.airdate!==ep.airdate||stored_ep.airtime!==ep.airtime||stored_ep.name!==ep.name);

      try {
        if (liveCalIds.length===0) {
          // No event exists in calendar — create (includes repopulating missing ones)
          const wasStored=!!storedCalId;
          ep.calendarEventId=await GCal.createEvent(showData,ep);
          if (wasStored) repopulated++; else created++;
        } else if (changed) {
          // Event exists but episode data changed — update the first one
          await GCal.updateEvent(liveCalIds[0],showData,ep);
          ep.calendarEventId=liveCalIds[0];
          updated++;
        } else {
          ep.calendarEventId=liveCalIds[0]||(storedCalId||null);
        }
      } catch(e) { console.error(e); ep.calendarEventId=storedCalId||null; errors++; }
    }

    // Remove calendar events for episodes dropped from TVMaze
    for (const prev of stored) {
      if (!freshMap[prev.id]&&prev.calendarEventId&&prev.airdate>=today) {
        try { await GCal.deleteEvent(prev.calendarEventId); deleted++; } catch(_){}
      }
    }

    State.setEpisodes(show.id, fresh.map(ep=>({
      id:ep.id, name:ep.name, season:ep.season, number:ep.number,
      airdate:ep.airdate, airtime:ep.airtime, airstamp:ep.airstamp,
      runtime:ep.runtime, calendarEventId:ep.calendarEventId||null
    })));

    return {created,updated,deleted,repopulated,errors,duplicates};
  },

  async syncAll() {
    if (this.running) return;
    this.running=true; UI.setSyncing(true);
    this._pendingDuplicates=[];

    const shows=State.getShows();
    if (!shows.length) { this.running=false; UI.setSyncing(false); toast('No shows to sync'); return; }

    try { await GAuth.ensureToken(); }
    catch(e) { this.running=false; UI.setSyncing(false); toast('Sign in to Google to sync','error'); return; }

    let tc=0,tu=0,td=0,tr=0,te=0;
    for (const show of shows) {
      UI.setStatus(`Syncing ${show.name}…`);
      const r=await this.syncShow(show);
      tc+=r.created; tu+=r.updated; td+=r.deleted; tr+=r.repopulated; te+=r.errors;
      this._pendingDuplicates.push(...r.duplicates);
    }

    State.addLog({time:Date.now(),shows:shows.length,created:tc,updated:tu,deleted:td,repopulated:tr,errors:te});
    this.running=false; UI.setSyncing(false); UI.setStatus('');
    UI.renderAll();

    const parts=[`+${tc} new`,tu>0?`${tu} updated`:'',td>0?`${td} removed`:'',tr>0?`${tr} repopulated`:''].filter(Boolean).join(' · ');
    toast(`Sync done — ${parts||'no changes'}`, te>0?'warning':'success');

    if (this._pendingDuplicates.length>0) {
      setTimeout(()=>UI.showDuplicatesModal(this._pendingDuplicates), 600);
    }
  }
};

// ── PWA Install ────────────────────────────────────────────────────

const Install = {
  _prompt: null,
  _installed: false,

  init() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this._prompt=e;
      UI.showInstallBanner(true);
    });
    window.addEventListener('appinstalled', () => {
      this._installed=true;
      this._prompt=null;
      UI.showInstallBanner(false);
      toast('TV Tracker installed ✓','success');
    });
    // Check if already running standalone
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      this._installed=true;
    }
  },

  async trigger() {
    if (!this._prompt) {
      toast('Open this page in Chrome and use "Add to Home Screen"','info');
      return;
    }
    this._prompt.prompt();
    const {outcome}=await this._prompt.userChoice;
    if (outcome==='accepted') toast('Installing TV Tracker…','success');
    this._prompt=null;
    UI.showInstallBanner(false);
  },

  canInstall() { return !!this._prompt; },
  isInstalled() { return this._installed; }
};

// ── Toast ──────────────────────────────────────────────────────────

function toast(msg, type='info') {
  const c=document.getElementById('toast-container');
  const t=document.createElement('div');
  t.className=`toast toast-${type}`; t.textContent=msg;
  c.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('visible'));
  setTimeout(()=>{ t.classList.remove('visible'); setTimeout(()=>t.remove(),300); },3800);
}

// ── Modal helper ───────────────────────────────────────────────────

function showModal(html) {
  const existing=document.getElementById('modal-overlay');
  if (existing) existing.remove();
  const overlay=document.createElement('div');
  overlay.id='modal-overlay';
  overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal-box">${html}</div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) overlay.remove(); });
  return overlay;
}

function closeModal() { document.getElementById('modal-overlay')?.remove(); }

// ── UI ─────────────────────────────────────────────────────────────

const UI = {
  _searchResults:[],

  init() {
    this.renderAll();
    this.bindNav();
    this.bindSearch();
    this.bindSettings();
    GAuth.init();
    TVStremio.init();
    this.updateAuthBtn();
    this.updateStremioBtn();
    this.populateSettingsForm();
    Install.init();
    if (Settings.autoSync()&&GAuth.isConnected()) setTimeout(()=>Sync.syncAll(),1500);
  },

  switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    document.querySelectorAll('.tab-pane').forEach(p=>p.classList.toggle('active',p.id===`tab-${tab}`));
  },

  bindNav() {
    document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>this.switchTab(b.dataset.tab)));
    document.getElementById('sync-btn').addEventListener('click',()=>{ if(!Sync.running) Sync.syncAll(); });
    document.getElementById('auth-btn').addEventListener('click',()=>GAuth.isConnected()?GAuth.signOut():GAuth.signIn());
    document.getElementById('stremio-header-btn').addEventListener('click',()=>{
      if (TVStremio.isConnected()) this.showStremioSignOutConfirm();
      else this.showStremioLogin();
    });
  },

  bindSearch() {
    const inp=document.getElementById('search-input');
    let t;
    inp.addEventListener('input',()=>{
      clearTimeout(t);
      const q=inp.value.trim();
      if (!q) { this._searchResults=[]; this.renderSearch(); return; }
      t=setTimeout(()=>this.doSearch(q),400);
    });
  },

  bindSettings() {
    document.getElementById('save-settings-btn').addEventListener('click',()=>{
      Settings.set({
        googleClientId:document.getElementById('input-client-id').value.trim(),
        calendarId:document.getElementById('input-calendar-id').value.trim()||'primary',
        autoSync:document.getElementById('input-auto-sync').checked
      });
      GAuth.reinit();
      toast('Settings saved','success');
      this.populateSettingsForm();
      this.updateAuthBtn();
    });

    document.getElementById('toggle-client-id').addEventListener('click',()=>{
      const inp=document.getElementById('input-client-id'),btn=document.getElementById('toggle-client-id');
      inp.type=inp.type==='password'?'text':'password';
      btn.textContent=inp.type==='password'?'Show':'Hide';
    });

    document.getElementById('backup-btn').addEventListener('click',()=>{
      const blob=new Blob([State.exportBackup()],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url; a.download=`tv-tracker-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      toast('Backup downloaded','success');
    });

    document.getElementById('restore-btn').addEventListener('click',()=>document.getElementById('restore-file').click());
    document.getElementById('restore-file').addEventListener('change',async e=>{
      const file=e.target.files[0]; if (!file) return;
      try { State.importBackup(await file.text()); this.renderAll(); this.populateSettingsForm(); toast('Backup restored ✓','success'); }
      catch(err) { toast('Restore failed: '+err.message,'error'); }
      e.target.value='';
    });

    document.getElementById('install-btn').addEventListener('click',()=>Install.trigger());
  },

  populateSettingsForm() {
    const s=Settings.get();
    document.getElementById('input-client-id').value=s.googleClientId||'';
    document.getElementById('input-calendar-id').value=s.calendarId||'primary';
    document.getElementById('input-auto-sync').checked=s.autoSync!==false;
    document.getElementById('setup-notice').classList.toggle('hidden',!!s.googleClientId);
    this.updateStorageSize();
    this.updateStremioBtn();
  },

  async doSearch(q) {
    document.getElementById('search-spinner').classList.remove('hidden');
    try { this._searchResults=await TVMaze.search(q); } catch { this._searchResults=[]; }
    document.getElementById('search-spinner').classList.add('hidden');
    this.renderSearch();
  },

  renderAll() { this.renderSearch(); this.renderShows(); this.renderUpcoming(); this.renderLog(); this.updateStorageSize(); },

  renderSearch() {
    const el=document.getElementById('search-results');
    const trackedIds=new Set(State.getShows().map(s=>s.id));
    if (!this._searchResults.length) {
      el.innerHTML=`<div class="empty"><div class="empty-icon">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="17" cy="17" r="11" stroke="currentColor" stroke-width="2.5"/><line x1="25" y1="25" x2="35" y2="35" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      </div><p>Search for a TV show above</p></div>`;
      return;
    }
    el.innerHTML=this._searchResults.map(show=>{
      const tracked=trackedIds.has(show.id);
      const img=show.image?.medium?`<img src="${show.image.medium}" alt="" class="show-thumb" loading="lazy">`:`<div class="show-thumb no-img"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="3" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><line x1="7" y1="17" x2="10" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="15" y1="17" x2="12" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="5.5" y1="17" x2="16.5" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>`;
      const sCls=show.status==='Running'?'badge-green':'badge-gray';
      const sLbl=show.status==='Running'?'Airing':(show.status||'?');
      const net=show.network?.name||show.webChannel?.name||'';
      const genres=(show.genres||[]).slice(0,2).map(g=>`<span class="badge badge-mono">${g}</span>`).join('');
      return `<div class="show-card">
        ${img}
        <div class="show-info">
          <div class="show-name">${show.name}</div>
          <div class="show-meta"><span class="badge ${sCls}">${sLbl}</span>${net?`<span class="badge badge-mono">${net}</span>`:''}${genres}</div>
          ${show.premiered?`<div class="show-year">${show.premiered.slice(0,4)}</div>`:''}
        </div>
        <button class="add-btn ${tracked?'tracked':''}" data-show='${JSON.stringify(show).replace(/'/g,"&apos;")}'>
          ${tracked?'✓ Tracking':'+ Track'}
        </button>
      </div>`;
    }).join('');

    el.querySelectorAll('.add-btn:not(.tracked)').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        const show=JSON.parse(btn.dataset.show.replace(/&apos;/g,"'"));
        btn.textContent='Adding…'; btn.disabled=true;
        State.addShow(show);
        btn.className='add-btn tracked'; btn.textContent='✓ Tracking';
        toast(`Added ${show.name}`);
        this.renderShows();
        if (GAuth.isConnected()) {
          toast(`Syncing ${show.name} to calendar…`);
          let syncResult = null;
          try { syncResult=await Sync.syncShow(show); toast(`${show.name}: +${syncResult.created} episodes synced`,'success'); this.renderAll(); }
          catch(e) { toast('Calendar sync failed: '+e.message,'error'); }
          if (syncResult?.duplicates?.length) UI.showDuplicatesModal(syncResult.duplicates);
        }
      });
    });
  },

  renderShows() {
    const el=document.getElementById('shows-list');
    const shows=State.getShows();
    if (!shows.length) {
      el.innerHTML=`<div class="empty"><div class="empty-icon">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="4" y="6" width="32" height="20" rx="3" stroke="currentColor" stroke-width="2.5"/><rect x="9" y="10" width="22" height="12" rx="1.5" fill="currentColor" opacity="0.15"/><line x1="13" y1="30" x2="18" y2="26" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="27" y1="30" x2="22" y2="26" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="10" y1="30" x2="30" y2="30" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </div><p>No shows tracked yet</p><p class="empty-sub">Search for a show to get started</p></div>`;
      return;
    }
    const today=new Date().toISOString().split('T')[0];
    el.innerHTML=shows.map(show=>{
      const eps=State.getEpisodes(show.id);
      const future=eps.filter(e=>e.airdate>=today).sort((a,b)=>a.airdate.localeCompare(b.airdate));
      const synced=future.filter(e=>e.calendarEventId).length;
      const img=show.image?.medium?`<img src="${show.image.medium}" alt="" class="show-thumb" loading="lazy">`:`<div class="show-thumb no-img"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="3" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><line x1="7" y1="17" x2="10" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="15" y1="17" x2="12" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="5.5" y1="17" x2="16.5" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>`;
      const imdbId=show.externals?.imdb;
      const next=future[0];
      const inStremio=imdbId&&State.getStremio(imdbId)?.added;
      return `<div class="show-card show-card--tracked">
        ${img}
        <div class="show-info">
          <div class="show-name">${show.name}</div>
          <div class="show-meta">
            <span class="badge ${show.status==='Running'?'badge-green':'badge-gray'}">${show.status==='Running'?'Airing':(show.status||'')}</span>
            ${eps.length?`<span class="badge badge-mono">${eps.length} eps</span>`:''}
            ${future.length?`<span class="badge badge-info">${synced}/${future.length} synced</span>`:''}
            ${inStremio?`<span class="badge badge-stremio">Stremio</span>`:''}
          </div>
          ${next?`<div class="next-ep">Next: S${String(next.season).padStart(2,'0')}E${String(next.number).padStart(2,'0')} — ${next.airdate}</div>`:`<div class="next-ep muted">No upcoming episodes</div>`}
        </div>
        <div class="show-actions">
          ${imdbId?`<button class="icon-btn watchlist-btn ${inStremio?'watchlist-added':''}" data-show-id="${show.id}" data-imdb="${imdbId}" title="${inStremio?'In Stremio watchlist':'Add to Stremio watchlist'}">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">${inStremio?'<polyline points="2,7 5.5,10.5 12,3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>':'<line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>
          </button>`:''}
          <button class="icon-btn remove-btn" data-show-id="${show.id}" title="Remove">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>`;
    }).join('');

    el.querySelectorAll('.watchlist-btn:not(.watchlist-added)').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        const showId=Number(btn.dataset.showId);
        const show=shows.find(s=>s.id===showId);
        if (!TVStremio.isConnected()) { this.showStremioLogin(()=>this._doAddToWatchlist(show,btn)); return; }
        await this._doAddToWatchlist(show,btn);
      });
    });

    el.querySelectorAll('.remove-btn').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        const id=Number(btn.dataset.showId);
        const show=shows.find(s=>s.id===id);
        if (!confirm(`Remove ${show?.name}? Future calendar events will also be deleted.`)) return;
        if (GAuth.isConnected()) {
          const today2=new Date().toISOString().split('T')[0];
          for (const ep of State.getEpisodes(id))
            if (ep.calendarEventId&&ep.airdate>=today2)
              try { await GCal.deleteEvent(ep.calendarEventId); } catch(_){}
        }
        State.removeShow(id);
        this.renderAll();
        toast(`Removed ${show?.name}`);
      });
    });
  },

  async _doAddToWatchlist(show, btn) {
    if (btn) { btn.disabled=true; }
    try {
      await TVStremio.addToLibrary(show);
      toast(`${show.name} added to Stremio watchlist ✓`,'success');
      this.renderShows();
    } catch(e) {
      toast(e.message,'error');
      if (btn) btn.disabled=false;
    }
  },

  renderUpcoming() {
    const el=document.getElementById('upcoming-list');
    const shows=State.getShows();
    const today=new Date().toISOString().split('T')[0];
    const cut=Settings.get().syncDaysAhead>0?new Date(Date.now()+Settings.get().syncDaysAhead*86400000).toISOString().split('T')[0]:'9999-99-99';
    const items=[];
    for (const show of shows)
      for (const ep of State.getEpisodes(show.id))
        if (ep.airdate&&ep.airdate>=today&&ep.airdate<=cut) items.push({show,ep});
    items.sort((a,b)=>(a.ep.airstamp||a.ep.airdate).localeCompare(b.ep.airstamp||b.ep.airdate));
    if (!items.length) {
      el.innerHTML=`<div class="empty"><div class="empty-icon">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="4" y="7" width="32" height="28" rx="4" stroke="currentColor" stroke-width="2.5"/><line x1="4" y1="16" x2="36" y2="16" stroke="currentColor" stroke-width="2"/><line x1="13" y1="3" x2="13" y2="11" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><line x1="27" y1="3" x2="27" y2="11" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><polygon points="16,22 16,31 26,26.5" fill="currentColor" opacity="0.5"/></svg>
      </div><p>No upcoming episodes</p><p class="empty-sub">Add shows and sync to see what's coming</p></div>`;
      return;
    }
    const grouped={};
    for (const item of items) { const d=item.ep.airdate||'TBA'; (grouped[d]=grouped[d]||[]).push(item); }
    const tom=new Date(Date.now()+86400000).toISOString().split('T')[0];
    el.innerHTML=Object.entries(grouped).map(([date,list])=>{
      const lbl=date===today?'Today':date===tom?'Tomorrow':new Date(date+'T12:00:00').toLocaleDateString('en-AU',{weekday:'long',month:'short',day:'numeric'});
      return `<div class="date-group"><div class="date-label">${lbl}</div>${list.map(({show,ep})=>{
        const ec=`S${String(ep.season).padStart(2,'0')}E${String(ep.number).padStart(2,'0')}`;
        const img=show.image?.medium?`<img src="${show.image.medium}" alt="" class="ep-thumb" loading="lazy">`:`<div class="ep-thumb no-img"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5"/></svg></div>`;
        return `<div class="ep-card">${img}<div class="ep-info"><div class="ep-show">${show.name}</div><div class="ep-title">${ec}${ep.name?': '+ep.name:''}</div>${ep.airtime?`<div class="ep-time">${ep.airtime}</div>`:''}</div><div class="ep-status">${ep.calendarEventId?'<span class="badge badge-green" title="Synced to calendar"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="1.5,5 4,7.5 8.5,2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>':'<span class="badge badge-gray">–</span>'}</div></div>`;
      }).join('')}</div>`;
    }).join('');
  },

  renderLog() {
    const el=document.getElementById('sync-log');
    const logs=State.getLogs();
    if (!logs.length) { el.innerHTML='<div class="log-empty">No sync history yet</div>'; return; }
    el.innerHTML=logs.map(l=>`<div class="log-entry"><span class="log-time">${new Date(l.time).toLocaleString('en-AU')}</span><span>${l.shows} shows · +${l.created} new · ${l.updated} updated · ${l.deleted} removed${l.repopulated?` · ${l.repopulated} repopulated`:''}${l.errors?` · ${l.errors} errors`:''}</span></div>`).join('');
  },

  updateStorageSize() {
    const el=document.getElementById('storage-size'); if (!el) return;
    try {
      const b=['tvtracker_v2','tvtracker_settings','tvtracker_stremio_key'].reduce((n,k)=>n+(localStorage.getItem(k)||'').length,0);
      el.textContent=`${(b/1024).toFixed(1)} KB stored locally`;
    } catch(_){}
  },

  updateAuthBtn() {
    const btn=document.getElementById('auth-btn'); if (!btn) return;
    btn.textContent=GAuth.isConnected()?'Google ✓':'Sign in';
    btn.classList.toggle('signed-in',GAuth.isConnected());
  },

  updateStremioBtn() {
    const btn=document.getElementById('stremio-header-btn'); if (!btn) return;
    const connected=TVStremio.isConnected();
    btn.classList.toggle('signed-in',connected);
    btn.title=connected?'Stremio connected — click to sign out':'Sign in to Stremio';
    btn.querySelector('.stremio-dot').style.opacity=connected?'1':'0';
  },

  setSyncing(v) {
    const btn=document.getElementById('sync-btn');
    btn.classList.toggle('spinning',v); btn.disabled=v;
  },

  setStatus(msg) {
    const el=document.getElementById('status-msg');
    el.textContent=msg; el.classList.toggle('hidden',!msg);
  },

  showInstallBanner(show) {
    const el=document.getElementById('install-banner');
    if (el) el.classList.toggle('hidden',!show);
  },

  // ── Modals ───────────────────────────────────────────────────────

  showStremioLogin(onSuccess) {
    const overlay=showModal(`
      <div class="modal-header">
        <div class="modal-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="var(--accent)" opacity="0.15"/><polygon points="9,7 9,17 18,12" fill="var(--accent)"/></svg>
        </div>
        <h2 class="modal-title">Sign in to Stremio</h2>
        <p class="modal-sub">Add shows directly to your Stremio watchlist</p>
      </div>
      <div class="modal-body">
        <label class="field-label">Email</label>
        <input type="email" id="stremio-email" placeholder="you@example.com" autocomplete="email">
        <label class="field-label" style="margin-top:12px">Password</label>
        <div class="field-row">
          <input type="password" id="stremio-pass" placeholder="••••••••" autocomplete="current-password">
          <button id="toggle-stremio-pass" class="inline-btn">Show</button>
        </div>
        <p id="stremio-error" class="modal-error hidden"></p>
        <button id="stremio-login-btn" class="btn-primary" style="margin-top:16px">Sign In</button>
        <p class="modal-footer-note">No account? <a href="https://www.stremio.com" target="_blank">Create one at stremio.com ↗</a></p>
      </div>
    `);

    document.getElementById('toggle-stremio-pass').addEventListener('click',()=>{
      const p=document.getElementById('stremio-pass'),b=document.getElementById('toggle-stremio-pass');
      p.type=p.type==='password'?'text':'password'; b.textContent=p.type==='password'?'Show':'Hide';
    });

    const loginBtn=document.getElementById('stremio-login-btn');
    loginBtn.addEventListener('click',async()=>{
      const email=document.getElementById('stremio-email').value.trim();
      const pass=document.getElementById('stremio-pass').value;
      const errEl=document.getElementById('stremio-error');
      if (!email||!pass) { errEl.textContent='Enter your email and password'; errEl.classList.remove('hidden'); return; }
      loginBtn.textContent='Signing in…'; loginBtn.disabled=true;
      try {
        await TVStremio.login(email,pass);
        closeModal();
        toast('Signed in to Stremio ✓','success');
        this.updateStremioBtn();
        this.renderShows();
        if (onSuccess) onSuccess();
      } catch(e) {
        errEl.textContent=e.message; errEl.classList.remove('hidden');
        loginBtn.textContent='Sign In'; loginBtn.disabled=false;
      }
    });

    // Allow pressing Enter
    ['stremio-email','stremio-pass'].forEach(id=>{
      document.getElementById(id).addEventListener('keydown',e=>{ if(e.key==='Enter') loginBtn.click(); });
    });
  },

  showStremioSignOutConfirm() {
    const overlay=showModal(`
      <div class="modal-header">
        <h2 class="modal-title">Stremio</h2>
        <p class="modal-sub">You are currently signed in to Stremio.</p>
      </div>
      <div class="modal-body">
        <div class="modal-actions">
          <button id="stremio-sync-btn" class="btn-primary">Sync all shows to Stremio</button>
          <button id="stremio-signout-btn" class="btn-outline" style="width:100%;justify-content:center">Sign out of Stremio</button>
          <button id="modal-cancel-btn" class="btn-ghost">Cancel</button>
        </div>
      </div>
    `);

    document.getElementById('stremio-sync-btn').addEventListener('click',async()=>{
      document.getElementById('stremio-sync-btn').textContent='Syncing…';
      document.getElementById('stremio-sync-btn').disabled=true;
      const r=await TVStremio.syncLibrary();
      closeModal();
      this.renderShows();
      toast(`Synced to Stremio: ${r.added} added${r.errors?`, ${r.errors} errors`:''}`, r.errors?'warning':'success');
    });

    document.getElementById('stremio-signout-btn').addEventListener('click',()=>{ TVStremio.logout(); closeModal(); this.renderShows(); });
    document.getElementById('modal-cancel-btn').addEventListener('click',closeModal);
  },

  showDuplicatesModal(duplicates) {
    if (!duplicates.length) return;
    const rows=duplicates.map((d,i)=>`
      <div class="dup-row">
        <div class="dup-info">
          <div class="dup-show">${d.showName}</div>
          <div class="dup-ep">${d.epLabel}</div>
          <div class="dup-count">${d.events.length} duplicate events</div>
        </div>
        <div class="dup-actions">
          <button class="btn-outline dup-keep-newest" data-i="${i}">Keep newest</button>
          <button class="btn-outline dup-keep-oldest" data-i="${i}">Keep oldest</button>
          <button class="btn-outline btn-danger dup-delete-all" data-i="${i}">Delete all</button>
        </div>
      </div>`).join('');

    showModal(`
      <div class="modal-header">
        <h2 class="modal-title">Duplicate calendar events</h2>
        <p class="modal-sub">TV Tracker found ${duplicates.length} episode${duplicates.length>1?'s':''} with multiple calendar entries. How should each be handled?</p>
      </div>
      <div class="modal-body">
        <div class="dup-list">${rows}</div>
        <div class="modal-actions" style="margin-top:16px">
          <button id="dup-fix-all-btn" class="btn-primary">Keep newest for all</button>
          <button id="dup-dismiss-btn" class="btn-ghost">Dismiss</button>
        </div>
      </div>
    `);

    const resolve=async(idx, strategy)=>{
      const d=duplicates[idx];
      // strategy: 'newest' = keep last, 'oldest' = keep first, 'all' = delete all
      const keep=strategy==='newest'?d.events[d.events.length-1]:strategy==='oldest'?d.events[0]:null;
      for (const evId of d.events) {
        if (evId!==keep) {
          try { await GCal.deleteEvent(evId); } catch(_){}
        }
      }
      // Update stored calendarEventId
      const s=State.get();
      const eps=s.episodes[d.showId]||[];
      const ep=eps.find(e=>e.id===d.episodeId);
      if (ep) { ep.calendarEventId=keep||null; State.save(s); }
    };

    document.querySelectorAll('.dup-keep-newest').forEach(btn=>{
      btn.addEventListener('click',async()=>{ btn.textContent='Done'; btn.disabled=true; await resolve(Number(btn.dataset.i),'newest'); });
    });
    document.querySelectorAll('.dup-keep-oldest').forEach(btn=>{
      btn.addEventListener('click',async()=>{ btn.textContent='Done'; btn.disabled=true; await resolve(Number(btn.dataset.i),'oldest'); });
    });
    document.querySelectorAll('.dup-delete-all').forEach(btn=>{
      btn.addEventListener('click',async()=>{ btn.textContent='Done'; btn.disabled=true; await resolve(Number(btn.dataset.i),'all'); });
    });

    document.getElementById('dup-fix-all-btn').addEventListener('click',async()=>{
      document.getElementById('dup-fix-all-btn').textContent='Fixing…';
      document.getElementById('dup-fix-all-btn').disabled=true;
      for (let i=0;i<duplicates.length;i++) await resolve(i,'newest');
      closeModal();
      toast(`Fixed ${duplicates.length} duplicate${duplicates.length>1?'s':''}`, 'success');
      this.renderAll();
    });
    document.getElementById('dup-dismiss-btn').addEventListener('click',closeModal);
  }
};

// ── Boot ───────────────────────────────────────────────────────────

window.addEventListener('load',()=>{
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);

  const initGSI=()=>{ GAuth.init(); UI.updateAuthBtn(); };
  if (window.google) { initGSI(); }
  else {
    window.addEventListener('gsi-loaded',initGSI);
    const poll=setInterval(()=>{ if(window.google){clearInterval(poll);initGSI();} },200);
    setTimeout(()=>clearInterval(poll),5000);
  }

  UI.init();
});
