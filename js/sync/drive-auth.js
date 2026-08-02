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
   ========================================================================== */

const DriveAuth = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;

  function gisReady() {
    return typeof google !== 'undefined' && google.accounts && google.accounts.oauth2;
  }

  async function getClientId() {
    return getSetting('googleClientId', '');
  }

  async function ensureTokenClient() {
    const clientId = await getClientId();
    if (!clientId) throw new Error('NO_CLIENT_ID');
    if (!gisReady()) throw new Error('GIS_NOT_LOADED');
    if (tokenClient && tokenClient.__clientId === clientId) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: () => {} // overridden per-request in requestToken()
    });
    tokenClient.__clientId = clientId;
    return tokenClient;
  }

  function requestToken({ prompt = '' } = {}) {
    return new Promise((resolve, reject) => {
      ensureTokenClient().then(client => {
        client.callback = (resp) => {
          if (resp.error) { reject(resp); return; }
          accessToken = resp.access_token;
          tokenExpiresAt = Date.now() + (resp.expires_in * 1000) - 60000;
          resolve(accessToken);
        };
        client.error_callback = (err) => reject(err);
        try {
          client.requestAccessToken({ prompt });
        } catch (err) {
          reject(err);
        }
      }).catch(reject);
    });
  }

  // Returns a usable access token, silently refreshing if possible.
  // Throws if interactive consent is required and `interactive` is false.
  async function getValidToken({ interactive = true } = {}) {
    if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
    try {
      return await requestToken({ prompt: '' }); // try silent first
    } catch (err) {
      if (!interactive) throw err;
      return requestToken({ prompt: 'consent' });
    }
  }

  async function connect() {
    const token = await requestToken({ prompt: 'consent' });
    await setSetting('driveConnected', true);
    return token;
  }

  // Same as connect(), but callable directly from a click handler with zero
  // `await` beforehand. Browsers (Safari especially) only allow a sign-in
  // popup to open if it's triggered synchronously within the click's call
  // stack — any `await` first (even just saving a setting) can make the
  // browser silently block the popup, which looks like "nothing happened."
  // `clientId` must be passed in directly (read synchronously from the
  // input field) rather than fetched from settings, for the same reason.
  function connectSync(clientId, { onSuccess, onError }) {
    if (!gisReady()) { onError(new Error('GIS_NOT_LOADED')); return; }
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error) { onError(resp); return; }
          accessToken = resp.access_token;
          tokenExpiresAt = Date.now() + (resp.expires_in * 1000) - 60000;
          tokenClient = client;
          tokenClient.__clientId = clientId;
          setSetting('driveConnected', true).then(() => onSuccess(accessToken));
        },
        error_callback: (err) => onError(err)
      });
      client.requestAccessToken({ prompt: 'consent' }); // must run synchronously here
    } catch (err) {
      onError(err);
    }
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

  return { getValidToken, connect, connectSync, disconnect, isConnected, gisReady, getClientId };
})();
