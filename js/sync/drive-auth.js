/* ==========================================================================
   drive-auth.js — client-side Google OAuth via Google Identity Services (GIS).
   No backend server involved. Requires:
     1. Google's GIS script loaded (see <script> tag in index.html) — needs
        internet the moment you connect/sync; the rest of the app works fine
        offline regardless.
     2. A Google Cloud OAuth Client ID pasted into Settings (see README.md
        for the click-by-click setup in Google Cloud Console).
   Scope used: drive.file — the app can only see/edit files *it* creates
   (a "LifeHub" folder + one JSON file inside it), never your whole Drive.

   IMPORTANT constraint this whole file is built around: Safari only allows
   Google's sign-in popup to open if `requestAccessToken()` is called
   *synchronously* within a click's call stack — a single `await` first
   (even just reading a setting from IndexedDB) is enough for it to be
   silently blocked, surfacing as "Failed to open popup window." So every
   path that might need to show that popup avoids `await`ing anything
   beforehand, which is why the Client ID is cached in memory via
   primeClientId() rather than looked up fresh each time.
   ========================================================================== */

const DriveAuth = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let cachedClientId = '';

  function gisReady() {
    return typeof google !== 'undefined' && google.accounts && google.accounts.oauth2;
  }

  async function getClientId() {
    return getSetting('googleClientId', '');
  }

  // Call once at app boot (well before any click happens) so later re-auth
  // attempts never need to `await` a settings read first.
  async function primeClientId() {
    cachedClientId = await getClientId();
  }

  function hasValidToken() {
    return !!(accessToken && Date.now() < tokenExpiresAt);
  }

  function buildTokenClient(clientId, onToken, onError) {
    return google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) { onError(resp); return; }
        accessToken = resp.access_token;
        const expiresInSec = Number(resp.expires_in) || 3600;
        tokenExpiresAt = Date.now() + expiresInSec * 1000 - 60000;
        onToken(accessToken);
      },
      error_callback: (err) => onError(err)
    });
  }

  // First-time connection. Must be called synchronously from a click
  // handler (nothing async before it). `clientId` comes in as a plain
  // string read directly from the input field, not fetched from settings.
  function connectSync(clientId, { onSuccess, onError }) {
    if (!gisReady()) { onError(new Error('GIS_NOT_LOADED')); return; }
    cachedClientId = clientId;
    try {
      tokenClient = buildTokenClient(
        clientId,
        (token) => setSetting('driveConnected', true).then(() => onSuccess(token)),
        onError
      );
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (err) {
      onError(err);
    }
  }

  // Re-authorizing when the in-memory token has expired (e.g. you reopened
  // the app after the ~1 hour token lifetime). Also must be called
  // synchronously from a click handler — that's the whole reason
  // `cachedClientId` exists instead of an `await getClientId()` here.
  function ensureTokenSync({ onReady, onError }) {
    if (hasValidToken()) { onReady(accessToken); return; }
    if (!gisReady()) { onError(new Error('GIS_NOT_LOADED')); return; }
    if (!cachedClientId) { onError(new Error('NO_CLIENT_ID')); return; }
    try {
      tokenClient = buildTokenClient(cachedClientId, onReady, onError);
      tokenClient.requestAccessToken({ prompt: '' });
    } catch (err) {
      onError(err);
    }
  }

  // Used only for background/periodic auto-sync, where there's no click to
  // anchor a popup to. Deliberately does NOT attempt to open one — it just
  // fails (caught upstream, silently) if the token has expired since the
  // app was last actively used. Tapping "Sync now" is what refreshes it.
  async function getValidToken() {
    if (hasValidToken()) return accessToken;
    throw new Error('Sign-in expired — tap Sync now to reconnect');
  }

  async function disconnect() {
    if (accessToken && gisReady()) {
      try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch {}
    }
    accessToken = null;
    tokenExpiresAt = 0;
    await setSetting('driveConnected', false);
  }

  async function isConnected() {
    return !!(await getSetting('driveConnected', false));
  }

  return {
    getValidToken, connectSync, ensureTokenSync, hasValidToken,
    disconnect, isConnected, gisReady, primeClientId
  };
})();
