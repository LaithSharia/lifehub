/* ==========================================================================
   app.js — router, shared UI helpers (toast, bottom sheet), theme, boot.
   Each view module (js/views/*.js) exposes `render(container)`.
   ========================================================================== */

// Views is declared in db.js (loaded earlier) and populated by view files:
// Views.dashboard, Views.expenses, Views.notes, Views.medications, Views.settings

const routes = {
  '/': { title: 'LifeHub', view: () => Views.dashboard },
  '/expenses': { title: 'Expenses', view: () => Views.expenses },
  '/notes': { title: 'Notes', view: () => Views.notes },
  '/meds': { title: 'Medications', view: () => Views.medications },
  '/settings': { title: 'Settings', view: () => Views.settings }
};

const appEl = document.getElementById('app');
const titleEl = document.getElementById('view-title');

async function router() {
  const hash = location.hash.slice(1) || '/';
  const path = hash.split('?')[0];
  const route = routes[path] || routes['/'];
  titleEl.textContent = route.title;

  document.querySelectorAll('.tab-bar__item').forEach(a => {
    a.classList.toggle('is-active', a.dataset.route === path);
  });

  const view = route.view();
  appEl.scrollTop = 0;
  hideFab();
  if (view && typeof view.render === 'function') {
    await view.render(appEl);
  } else {
    appEl.innerHTML = `<div class="empty-state"><div class="empty-state__icon">🚧</div><div class="empty-state__title">Coming soon</div></div>`;
  }
}

/* ---------------------------------------------------------------------- */
/* Floating action button — shared across views that need a "+ add"      */
/* ---------------------------------------------------------------------- */

function showFab(label, onClick) {
  let fab = document.querySelector('.fab');
  if (!fab) {
    fab = document.createElement('button');
    fab.className = 'fab';
    document.body.appendChild(fab);
  }
  fab.textContent = label;
  fab.style.display = 'flex';
  fab.onclick = onClick;
}

function hideFab() {
  const fab = document.querySelector('.fab');
  if (fab) fab.style.display = 'none';
}

window.addEventListener('hashchange', router);

/* ---------------------------------------------------------------------- */
/* Toast                                                                   */
/* ---------------------------------------------------------------------- */

function showToast(message, ms = 2200) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ---------------------------------------------------------------------- */
/* Bottom sheet (used for add/edit forms)                                 */
/* ---------------------------------------------------------------------- */

let sheetBackdropEl = null;

function openSheet(innerHTML, { onMount } = {}) {
  closeSheet();
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet"><div class="sheet__handle"></div>${innerHTML}</div>`;
  document.body.appendChild(backdrop);
  sheetBackdropEl = backdrop;
  requestAnimationFrame(() => backdrop.classList.add('is-open'));

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeSheet();
  });

  if (onMount) onMount(backdrop.querySelector('.sheet'));
  return backdrop;
}

function closeSheet() {
  if (!sheetBackdropEl) return;
  const el = sheetBackdropEl;
  sheetBackdropEl = null;
  el.classList.remove('is-open');
  setTimeout(() => el.remove(), 250);
}

/* ---------------------------------------------------------------------- */
/* Small formatting helpers shared across views                           */
/* ---------------------------------------------------------------------- */

function fmtMoney(amount, currency) {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'ILS', maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency || ''}`;
  }
}

function fmtDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtMonthYear(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

/* ---------------------------------------------------------------------- */
/* Theme                                                                   */
/* ---------------------------------------------------------------------- */

async function applyTheme() {
  const theme = await getSetting('theme', 'system');
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

/* ---------------------------------------------------------------------- */
/* Sync status icon (top right)                                           */
/* ---------------------------------------------------------------------- */

function setSyncIcon(state) {
  // state: 'idle' | 'syncing' | 'ok' | 'error' | 'signed-out'
  const btn = document.getElementById('sync-status-btn');
  btn.classList.remove('spinning', 'is-error', 'is-ok');
  if (state === 'syncing') btn.classList.add('spinning');
  if (state === 'error') btn.classList.add('is-error');
  if (state === 'ok') btn.classList.add('is-ok');
}

document.getElementById('sync-status-btn').addEventListener('click', () => {
  location.hash = '#/settings';
});

/* ---------------------------------------------------------------------- */
/* Boot                                                                    */
/* ---------------------------------------------------------------------- */

(async function boot() {
  await db.open();
  await ensureSeedData();

  // Load the saved Client ID into memory now — before router() renders
  // anything clickable — so that later re-authorization (e.g. the Sync now
  // button, after the in-memory token has expired) never needs to `await` a
  // settings read between the click and opening Google's sign-in popup.
  // This has to happen before the UI becomes interactive, not just before
  // any specific button exists, since a fast tap right after reload could
  // otherwise race this read.
  if (window.DriveAuth) await DriveAuth.primeClientId();

  await applyTheme();
  await router();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(err => console.warn('SW registration failed', err));
  }

  // Try a silent Drive sync on load if previously connected (non-blocking).
  // This can only ever succeed if the in-memory token is still valid (no
  // popup is attempted here — see drive-auth.js) since there's no click to
  // anchor a popup to at boot time.
  if (window.DriveSync && await DriveSync.isConnected()) {
    DriveSync.syncNow({ silent: true }).catch(() => {});
  }

  // Re-sync when the app regains focus/visibility (e.g. reopened from Home Screen)
  // and periodically while it stays open. Best-effort only — see README for why
  // this can't be a true background push on iOS without a server.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && window.DriveSync) {
      DriveSync.syncNow({ silent: true }).catch(() => {});
    }
  });
  setInterval(() => {
    if (window.DriveSync) DriveSync.syncNow({ silent: true }).catch(() => {});
  }, 5 * 60 * 1000);

  // Lightweight in-app medicine reminder: while the app is open, nudge once
  // per medication per day if its fixed scheduled time has passed and it's
  // still marked pending. This is a convenience only, not a substitute for
  // your phone's actual alarm.
  const remindedToday = new Set();
  async function checkMedReminders() {
    const status = await getTodayMedStatus();
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    for (const { med, log } of status) {
      if (med.scheduleType !== 'fixed-time' || !med.scheduleTime) continue;
      const key = `${med.id}-${todayISO()}`;
      if (remindedToday.has(key)) continue;
      if ((log?.status || 'pending') !== 'pending') continue;
      if (hhmm < med.scheduleTime) continue;
      remindedToday.add(key);
      const msg = `${med.icon || '💊'} Time for ${med.name}`;
      showToast(msg);
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('LifeHub', { body: msg }); } catch {}
      }
    }
  }
  checkMedReminders();
  setInterval(checkMedReminders, 60 * 1000);
})();
