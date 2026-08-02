# LifeHub

A personal, installable PWA for tracking expenses, notes/tasks, and daily medication —
with your data stored on-device (IndexedDB) and optionally backed up/synced to your own
Google Drive. No backend server, no build step, no framework: plain HTML/CSS/JS.

Everything in this folder is the whole app. Move the folder, zip it, back it up — that's
your entire project.

## What's inside

```
index.html              the app shell (loads everything else)
manifest.webmanifest    PWA metadata (name, icons, colors)
service-worker.js       makes the app load with zero network after first install
css/styles.css          the whole design system (light + dark)
js/db.js                IndexedDB schema (Dexie) + all data logic — expenses, notes,
                         medications, seed data, CSV/JSON export
js/app.js               router + shared UI helpers (toasts, bottom sheets, theme,
                         medication reminder check, periodic Drive sync)
js/views/*.js           one file per screen: dashboard, expenses, notes, medications, settings
js/sync/drive-auth.js   Google sign-in (OAuth) — client-side only
js/sync/drive-sync.js   uploads/downloads a single JSON snapshot to your Drive
js/vendor/dexie.min.js  vendored IndexedDB helper library (MIT licensed), so it works
                         offline even on first load after install
icons/                  app icons (generated)
```

## 1. Try it on your PC first

Because of `service-worker.js`, the app needs to be served over `http://` or `https://`
— opening `index.html` directly by double-clicking (`file://`) will mostly work but the
offline install features won't. Easiest local test, from inside this folder:

```
python -m http.server 8080
```

Then open `http://localhost:8080` in Chrome. Open DevTools → Application tab to confirm
the manifest is valid, the service worker registers, and IndexedDB has your data.

## 2. Deploy to GitHub Pages (so your iPhone can install it over HTTPS)

You already have **GitHub Desktop** installed, which is the easiest path (no command
line needed):

1. Open GitHub Desktop → **File → Add Local Repository** → pick this `LifeHub` folder.
   It will offer to initialize a git repository here — accept.
2. **Publish repository** (top bar). Give it a name like `lifehub`. You can make it
   private or public — GitHub Pages works either way (private repos need a free GitHub
   Pro/Team plan for Pages on some account types; if that's a problem, make it public —
   there's nothing sensitive in the code itself, your actual data never leaves your
   device/Drive).
3. On GitHub.com, open the repo → **Settings → Pages** → under "Build and deployment",
   set **Source: Deploy from a branch**, branch **main**, folder **/(root)** → Save.
4. After a minute, your app is live at `https://<your-username>.github.io/lifehub/`.

Whenever you (or I) change a file, in GitHub Desktop: review the changes → write a
commit message → **Commit to main** → **Push origin**. Pages redeploys automatically
in about a minute. **Also bump `CACHE_VERSION` in `service-worker.js`** whenever you
change any cached file — that's what forces installed devices to pick up the update.

## 3. Set up Google Drive sync (optional, one-time)

The app only ever requests the narrow **`drive.file`** permission — it can see only
files it creates itself (a `LifeHub` folder + one `lifehub-data.json` file inside it),
never your whole Drive.

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new
   project (top-left project picker → New Project). Call it `LifeHub` or anything.
2. **APIs & Services → Library** → search "Google Drive API" → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (Internal requires a Google Workspace org).
   - Fill in app name (`LifeHub`), your email as support/developer contact.
   - Scopes: skip (the app requests `drive.file` at runtime; you don't need to add it here).
   - **Test users**: add your own Google account email. This keeps the app in
     "testing" mode, which is fine forever for personal use — no Google review needed.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized JavaScript origins**: add your GitHub Pages origin, e.g.
     `https://<your-username>.github.io` (no trailing slash, no path).
     Also add `http://localhost:8080` if you want Drive sync to work in local testing.
   - Create → copy the **Client ID** (looks like `xxxxx.apps.googleusercontent.com`).
5. In LifeHub, go to **Settings → Google Drive sync**, paste the Client ID, tap
   **Connect Google Drive**, sign in, and accept the consent screen (it will say
   "unverified app" — that's expected and fine for a personal test-user app; click
   Advanced → Go to LifeHub (unsafe) to proceed).

From then on, use **Sync now** in Settings, or just let it auto-sync (on open, on
tab switch back, and every 5 minutes while open). If you ever use LifeHub from a
second device and both have unsynced changes, you'll get a one-tap prompt asking
which version to keep.

## 4. Install on your iPhone

1. Open your GitHub Pages URL in **Safari** (must be Safari, not Chrome, for iOS
   install to work).
2. Tap the **Share** icon → **Add to Home Screen** → Add.
3. Launch LifeHub from the home screen icon (not from Safari) — this runs it in
   standalone app mode with no browser chrome, and is what lets it work offline.

## About medication reminders

Real "buzz me at 5:15am even if the app is closed" push notifications aren't
realistically possible from a plain home-screen web app on iPhone — iOS Safari has no
API for scheduling a future local alert, and true push requires a always-on backend
server, which this project deliberately doesn't have (keeps it free and maintenance-free
forever). So:

- **Use your iPhone's own Alarm/Reminders app** for the actual audible alert at
  5:00–5:30am (Thyroxine), after your first meal (Selenium), and at lunch (Omega-3 + B12).
- **Open LifeHub in response** to check things off on the Medications tab — this is
  what builds your streak and history.
- As a bonus, while LifeHub is open in the foreground, it checks every minute and will
  show a toast (and a system notification, if you tap "Enable in-app reminder banner"
  on the Medications page) for any fixed-time medication that's overdue and still
  unchecked. This only fires while the app happens to be open — it's a nice-to-have,
  not a substitute for the phone alarm.

If you later want real push notifications, that needs a small always-on piece (e.g. a
free Cloudflare Worker on a cron trigger sending Web Push) — a bigger addition, doable
later, deliberately left out of this first build.

## Your medications & categories are pre-loaded

First launch seeds:
- **Medications**: Thyroxine (Euthyrox) at 5:15am fixed, Selenium after first meal,
  Omega-3 and B12 at lunch. Edit times/notes any time on the Medications tab.
- **Expense categories**: Groceries, Eating Out, Transport, Bills & Utilities,
  Housing/Rent, Health & Medicine, Shopping, Subscriptions, Entertainment, Education,
  Family & Gifts, Other — each editable, with an optional monthly budget that shows a
  progress bar and flags overspending on the Expenses → Summary tab.

## Backups

Independent of Google Drive, **Settings → Backup → Export backup** downloads a plain
JSON file of everything — keep a copy somewhere safe occasionally. **Restore backup**
loads one back in (this replaces all local data, so it'll ask you to confirm).

## A note on this build

- Tested for JavaScript syntax errors on every file (all clean).
- The visual verification (opening it in a real browser, confirming views render and
  writes persist to IndexedDB) needs to happen where a real browser is available —
  do the local-server check in step 1 above, then the on-device check in step 4.
