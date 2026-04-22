# 📺 TV Tracker

A Progressive Web App (PWA) that tracks your TV shows, syncs upcoming episodes to Google Calendar, and links to Stremio — installable on Android.

## Features

- **Search** any TV show via the TVMaze database
- **Track** shows you're currently watching
- **Auto-sync** all upcoming episodes to Google Calendar when you add a show
- **Smart sync** — detects added, changed, or removed episodes and updates your calendar accordingly
- **Stremio integration** — one-tap to open any show in Stremio
- **Installable on Android** as a full PWA (works like a native app)
- **Offline-capable** via service worker caching

---

## Setup

### 1. Fork & Host on GitHub Pages

1. Fork this repository (or push the files to a new GitHub repo)
2. Go to **Settings → Pages**
3. Under **Source**, select **GitHub Actions**
4. Push any commit — the workflow auto-deploys to `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

---

### 2. Set up Google Calendar API

You need a Google Cloud project to enable Calendar sync.

#### Step 1 — Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project → New Project**
3. Name it anything (e.g. "TV Tracker") and click **Create**

#### Step 2 — Enable the Calendar API

1. In your project, go to **APIs & Services → Library**
2. Search for **Google Calendar API** and click **Enable**

#### Step 3 — Create OAuth 2.0 credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. If prompted, configure the **OAuth consent screen** first:
   - User Type: **External**
   - App name: `TV Tracker`
   - Add your email as a test user
   - Scopes: add `https://www.googleapis.com/auth/calendar.events`
4. Back in Credentials → Create OAuth client ID:
   - Application type: **Web application**
   - Name: `TV Tracker`
   - **Authorized JavaScript origins** — add:
     ```
     https://YOUR_USERNAME.github.io
     ```
   - **Authorized redirect URIs** — add:
     ```
     https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/
     ```
   - Click **Create**
5. Copy the **Client ID** (looks like `123456789.apps.googleusercontent.com`)

#### Step 4 — Add your Client ID

Open `config.js` and replace the placeholder:

```js
GOOGLE_CLIENT_ID: '123456789-xxxxxxxxxxxx.apps.googleusercontent.com',
```

Commit and push — GitHub Actions will redeploy automatically.

---

### 3. Install on Android

1. Open the app URL in **Chrome** on your Android device
2. Tap the **⋮ menu → Add to Home screen**
3. Tap **Install**

The app will appear on your home screen and run like a native app.

---

## How it works

### Adding a show
When you tap **+ Track** on a search result:
1. The show is saved locally
2. If you're signed in to Google, all future episodes are immediately fetched and added to your Google Calendar
3. Each calendar event includes: show name, episode code + title, airtime, network, and episode description

### Syncing
Tap the **↻ button** in the header (or it runs automatically on app open) to:
- Fetch the latest episode schedule for every tracked show
- **Create** calendar events for any new future episodes
- **Update** existing calendar events if the airdate, airtime, or title changed
- **Delete** calendar events for episodes that were removed from the schedule

### Removing a show
Tap ✕ on any show in **My Shows** — this removes the show and deletes all its future calendar events.

---

## Configuration options (`config.js`)

| Option | Default | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | (required) | Your Google OAuth client ID |
| `CALENDAR_ID` | `'primary'` | Which calendar to sync to |
| `SYNC_DAYS_AHEAD` | `0` (unlimited) | How many days ahead to sync |
| `AUTO_SYNC` | `true` | Sync automatically on app open |

---

## Local development

Just open `index.html` in a browser — no build step required.

For service worker to work locally, serve from `localhost`:

```bash
npx serve .
# or
python3 -m http.server 8080
```

---

## Data storage

All data is stored in your browser's `localStorage` — nothing is sent to any server other than TVMaze (for show data) and Google Calendar (for calendar events).

---

## Tech stack

- Vanilla JS / HTML / CSS — no build step, no frameworks
- [TVMaze API](https://www.tvmaze.com/api) — free, no key required
- [Google Identity Services](https://developers.google.com/identity/gsi/web) — OAuth 2.0
- [Google Calendar API v3](https://developers.google.com/calendar)
- Service Worker — offline support + PWA installability
