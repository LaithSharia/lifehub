/* ==========================================================================
   drive-sync.js — whole-database JSON snapshot sync to a dedicated
   "LifeHub" folder in the user's own Google Drive (drive.file scope only).

   Model: full-snapshot, last-write-wins, with a manual conflict prompt if
   the Drive copy changed on another device since our last successful sync.
   Deliberately simple — this is single-user data at a scale that never
   justifies record-level merge logic.
   ========================================================================== */

const DriveSync = (() => {
  const FOLDER_NAME = 'LifeHub';
  const FILE_NAME = 'lifehub-data.json';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

  async function isConnected() {
    return DriveAuth.isConnected();
  }

  async function authHeader(interactive = true) {
    const token = await DriveAuth.getValidToken({ interactive });
    return { Authorization: `Bearer ${token}` };
  }

  async function findByName(name, mimeType, parentId) {
    const headers = await authHeader();
    let q = `name='${name.replace(/'/g, "\\'")}' and trashed=false`;
    if (mimeType) q += ` and mimeType='${mimeType}'`;
    if (parentId) q += ` and '${parentId}' in parents`;
    const url = `${API}?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&spaces=drive`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Drive search failed: ${res.status}`);
    const json = await res.json();
    return json.files && json.files[0];
  }

  async function ensureFolder() {
    let folderId = await getSetting('driveFolderId', null);
    if (folderId) {
      const headers = await authHeader();
      const check = await fetch(`${API}/${folderId}?fields=id,trashed`, { headers });
      if (check.ok) {
        const info = await check.json();
        if (!info.trashed) return folderId;
      }
    }
    const existing = await findByName(FOLDER_NAME, 'application/vnd.google-apps.folder');
    if (existing) {
      await setSetting('driveFolderId', existing.id);
      return existing.id;
    }
    const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
    const res = await fetch(API, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    if (!res.ok) throw new Error(`Could not create Drive folder: ${res.status}`);
    const created = await res.json();
    await setSetting('driveFolderId', created.id);
    return created.id;
  }

  async function ensureFileId(folderId) {
    let fileId = await getSetting('driveFileId', null);
    if (fileId) {
      const headers = await authHeader();
      const check = await fetch(`${API}/${fileId}?fields=id,trashed`, { headers });
      if (check.ok) {
        const info = await check.json();
        if (!info.trashed) return fileId;
      }
    }
    const existing = await findByName(FILE_NAME, 'application/json', folderId);
    if (existing) {
      await setSetting('driveFileId', existing.id);
      return existing.id;
    }
    return null; // doesn't exist yet — will be created on first upload
  }

  async function downloadSnapshot(fileId) {
    const headers = await authHeader();
    const res = await fetch(`${API}/${fileId}?alt=media`, { headers });
    if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
    return res.json();
  }

  async function uploadSnapshot(fileId, folderId, snapshot) {
    const headers = await authHeader();
    const body = JSON.stringify(snapshot);
    if (fileId) {
      const res = await fetch(`${UPLOAD_API}/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body
      });
      if (!res.ok) throw new Error(`Drive upload failed: ${res.status}`);
      return fileId;
    }
    // Multipart create (metadata + content in one request)
    const boundary = 'lifehub-boundary-' + Date.now();
    const metadata = { name: FILE_NAME, parents: [folderId], mimeType: 'application/json' };
    const multipartBody =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n` +
      `--${boundary}--`;
    const res = await fetch(`${UPLOAD_API}?uploadType=multipart`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody
    });
    if (!res.ok) throw new Error(`Drive create failed: ${res.status}`);
    const created = await res.json();
    await setSetting('driveFileId', created.id);
    return created.id;
  }

  // Returns { status: 'synced' } | { status: 'conflict', driveSnapshot } | { status: 'error', error }
  async function syncNow({ silent = false, resolution = null } = {}) {
    if (!(await isConnected())) return { status: 'not-connected' };
    setSyncIcon('syncing');
    try {
      const folderId = await ensureFolder();
      let fileId = await ensureFileId(folderId);
      const lastSyncedAt = await getSetting('lastSyncedAt', null);

      let driveSnapshot = null;
      if (fileId) {
        driveSnapshot = await downloadSnapshot(fileId);
      }

      const driveIsNewer = driveSnapshot && (!lastSyncedAt || driveSnapshot.exportedAt > lastSyncedAt);

      if (driveIsNewer && !resolution) {
        setSyncIcon('idle');
        return { status: 'conflict', driveSnapshot, fileId, folderId };
      }

      if (resolution === 'use-drive' && driveSnapshot) {
        await importSnapshot(driveSnapshot, { mode: 'replace' });
        await setSetting('lastSyncedAt', driveSnapshot.exportedAt);
        setSyncIcon('ok');
        return { status: 'synced', direction: 'pulled' };
      }

      // 'keep-mine', or no conflict (drive not newer / doesn't exist) -> push local
      const localSnapshot = await exportSnapshot();
      fileId = await uploadSnapshot(fileId, folderId, localSnapshot);
      await setSetting('lastSyncedAt', localSnapshot.exportedAt);
      setSyncIcon('ok');
      return { status: 'synced', direction: 'pushed' };
    } catch (err) {
      console.warn('Drive sync failed', err);
      setSyncIcon('error');
      // Surfacing the real reason directly in the toast, since checking a
      // browser console isn't practical on a phone.
      const reason = err?.message || err?.error || (typeof err === 'string' ? err : 'unknown error');
      if (!silent) showToast(`Sync failed: ${reason}`, 5000);
      return { status: 'error', error: err };
    }
  }

  return { syncNow, isConnected };
})();
