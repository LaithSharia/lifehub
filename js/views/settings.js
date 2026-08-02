/* ==========================================================================
   settings.js — theme, currency, Google Drive connection & sync,
   local JSON backup/restore, reset.
   ========================================================================== */

Views.settings = (() => {
  async function render(container) {
    const [theme, currency, clientId, connected, lastSyncedAt] = await Promise.all([
      getSetting('theme', 'system'),
      getSetting('currency', 'ILS'),
      getSetting('googleClientId', ''),
      DriveAuth.isConnected(),
      getSetting('lastSyncedAt', null)
    ]);

    container.innerHTML = `
      <div class="section-title">Appearance</div>
      <div class="card">
        <div class="field">
          <label>Theme</label>
          <div class="segmented" id="theme-picker">
            <button data-theme="system" class="${theme === 'system' ? 'is-active' : ''}">System</button>
            <button data-theme="light" class="${theme === 'light' ? 'is-active' : ''}">Light</button>
            <button data-theme="dark" class="${theme === 'dark' ? 'is-active' : ''}">Dark</button>
          </div>
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>Currency code</label>
          <input type="text" id="currency-input" maxlength="4" value="${escapeHtml(currency)}" placeholder="ILS, USD, EUR...">
        </div>
      </div>

      <div class="section-title">Google Drive sync</div>
      <div class="card">
        ${!connected ? `
          <div class="field">
            <label>Google OAuth Client ID</label>
            <input type="text" id="client-id-input" placeholder="xxxx.apps.googleusercontent.com" value="${escapeHtml(clientId)}"
              autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false">
            <div class="text-sm text-dim mt-8">One-time setup — see README.md for the exact Google Cloud Console steps.</div>
          </div>
          <button class="btn btn-primary btn-block" id="drive-connect">Connect Google Drive</button>
        ` : `
          <div class="card-row">
            <div>
              <div class="list-item__title">Connected</div>
              <div class="list-item__sub">${lastSyncedAt ? 'Last synced ' + new Date(lastSyncedAt).toLocaleString() : 'Never synced yet'}</div>
            </div>
            <span class="badge badge-good">●</span>
          </div>
          <div class="flex gap-8 mt-8">
            <button class="btn btn-primary" id="drive-sync-now" style="flex:1;">Sync now</button>
            <button class="btn btn-danger" id="drive-disconnect" style="flex:1;">Disconnect</button>
          </div>
        `}
      </div>

      <div class="section-title">Backup</div>
      <div class="card">
        <div class="text-sm text-dim">A local JSON backup, independent from Drive sync — good before trying something risky.</div>
        <div class="flex gap-8 mt-16">
          <button class="btn" id="backup-export" style="flex:1;">Export backup</button>
          <button class="btn" id="backup-import" style="flex:1;">Restore backup</button>
        </div>
        <input type="file" id="backup-file-input" accept="application/json" style="display:none;">
      </div>

      <div class="section-title">Danger zone</div>
      <div class="card">
        <button class="btn btn-danger btn-block" id="reset-data">Erase all local data</button>
      </div>

      <div class="text-center text-sm text-dim mt-16">LifeHub · your data stays on this device and, if connected, in your own Google Drive.</div>
    `;

    container.querySelector('#theme-picker').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-theme]');
      if (!btn) return;
      await setSetting('theme', btn.dataset.theme);
      await applyTheme();
      render(container);
    });

    container.querySelector('#currency-input').addEventListener('change', async (e) => {
      await setSetting('currency', e.target.value.trim().toUpperCase() || 'ILS');
      showToast('Currency updated');
    });

    const clientIdInput = container.querySelector('#client-id-input');
    if (clientIdInput) {
      clientIdInput.addEventListener('change', async (e) => {
        await setSetting('googleClientId', e.target.value.replace(/\s+/g, ''));
      });
    }

    const connectBtn = container.querySelector('#drive-connect');
    if (connectBtn) {
      // Not async, and no `await` before requestAccessToken fires inside
      // DriveAuth.connectSync — Safari silently blocks the sign-in popup if
      // it isn't opened synchronously in direct response to this click.
      connectBtn.addEventListener('click', () => {
        // Strip ALL whitespace, not just leading/trailing — a stray space
        // anywhere (from autocorrect, or a line break from copy-pasting)
        // is enough to make Google reject the request as malformed.
        const id = container.querySelector('#client-id-input').value.replace(/\s+/g, '');
        if (!id) { showToast('Paste your Google Client ID first'); return; }
        if (!DriveAuth.gisReady()) { showToast('Still loading Google sign-in — try again in a moment'); return; }
        DriveAuth.connectSync(id, {
          onSuccess: async () => {
            await setSetting('googleClientId', id);
            showToast('Connected! Syncing…');
            const result = await DriveSync.syncNow();
            await handleSyncResult(result, container);
            render(container);
          },
          onError: (err) => {
            console.warn(err);
            showToast('Could not connect — check the Client ID');
          }
        });
      });
    }

    const syncBtn = container.querySelector('#drive-sync-now');
    if (syncBtn) {
      // Not async, and ensureTokenSync runs first with nothing awaited
      // before it — if your sign-in expired since you last opened the app,
      // this is what lets the popup reopen instead of being silently
      // blocked for happening "too late" after the click.
      syncBtn.addEventListener('click', () => {
        DriveAuth.ensureTokenSync({
          onReady: async () => {
            const result = await DriveSync.syncNow();
            await handleSyncResult(result, container);
            render(container);
          },
          onError: (err) => {
            console.warn(err);
            const reason = err?.message || err?.error || 'could not sign in';
            showToast(`Sync failed: ${reason}`, 5000);
          }
        });
      });
    }

    const disconnectBtn = container.querySelector('#drive-disconnect');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', async () => {
        await DriveAuth.disconnect();
        showToast('Disconnected from Drive');
        render(container);
      });
    }

    container.querySelector('#backup-export').addEventListener('click', async () => {
      const snapshot = await exportSnapshot();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lifehub-backup-${todayISO()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    const fileInput = container.querySelector('#backup-file-input');
    container.querySelector('#backup-import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      if (!confirm('This replaces all local data with the backup file. Continue?')) return;
      try {
        const text = await file.text();
        const snapshot = JSON.parse(text);
        await importSnapshot(snapshot, { mode: 'replace' });
        showToast('Backup restored');
        render(container);
      } catch (err) {
        console.warn(err);
        showToast('Could not read that file');
      }
    });

    container.querySelector('#reset-data').addEventListener('click', async () => {
      if (!confirm('This permanently erases ALL local LifeHub data on this device. This cannot be undone. Continue?')) return;
      if (!confirm('Are you absolutely sure? Consider exporting a backup first.')) return;
      await db.delete();
      location.reload();
    });
  }

  async function handleSyncResult(result, container) {
    if (result.status === 'conflict') {
      openConflictSheet(result, container);
      return;
    }
    if (result.status === 'synced') {
      showToast(result.direction === 'pulled' ? 'Pulled latest from Drive' : 'Synced to Drive');
    }
  }

  function openConflictSheet(result, container) {
    openSheet(`
      <div class="sheet__header">
        <div class="sheet__title">Drive has newer data</div>
      </div>
      <div class="text-sm">
        Another device synced changes since this device last synced. Choose which version to keep —
        the other one will be overwritten.
      </div>
      <button class="btn btn-primary btn-block mt-16" id="conflict-use-drive">Use Drive's version (overwrite this device)</button>
      <button class="btn btn-danger btn-block mt-8" id="conflict-keep-mine">Keep this device's version (overwrite Drive)</button>
      <button class="btn btn-block mt-8" id="conflict-cancel">Cancel</button>
    `, {
      onMount: (sheet) => {
        sheet.querySelector('#conflict-use-drive').addEventListener('click', async () => {
          closeSheet();
          const r = await DriveSync.syncNow({ resolution: 'use-drive' });
          await handleSyncResult(r, container);
          render(container);
        });
        sheet.querySelector('#conflict-keep-mine').addEventListener('click', async () => {
          closeSheet();
          const r = await DriveSync.syncNow({ resolution: 'keep-mine' });
          await handleSyncResult(r, container);
          render(container);
        });
        sheet.querySelector('#conflict-cancel').addEventListener('click', closeSheet);
      }
    });
  }

  return { render };
})();
