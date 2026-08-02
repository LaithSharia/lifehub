/* ==========================================================================
   medications.js — daily checklist, streaks/history, manage schedules.

   Note on reminders: iOS Safari has no "alarm at a future time" API for
   installed PWAs without a real push server, so the primary alert should be
   your phone's native Alarm/Reminders app. While LifeHub is open, it also
   does a lightweight in-app check (see app.js `checkMedReminders`) and can
   show a notification banner as a bonus if you grant permission below.
   ========================================================================== */

Views.medications = (() => {
  async function render(container) {
    const medStatus = await getTodayMedStatus();
    const notifSupported = 'Notification' in window;
    const notifPermission = notifSupported ? Notification.permission : 'unsupported';

    container.innerHTML = `
      <div class="card">
        <div class="text-sm">
          Real "wake me up" alerts aren't possible from a home-screen web app on iPhone without a server,
          so use your phone's <b>Alarm</b> app for the actual ping at 5:00–5:30am, after your first meal, and at lunch.
          LifeHub is where you check things off and track your streak.
        </div>
        ${notifSupported && notifPermission !== 'granted' ? `
          <button class="btn btn-sm mt-8" id="enable-notifs">Enable in-app reminder banner</button>
        ` : ''}
      </div>

      <div class="section-title">Today</div>
      <div class="card" id="med-today"></div>

      <div class="section-title">Your medications</div>
      <div class="card" id="med-list"></div>
    `;

    if (container.querySelector('#enable-notifs')) {
      container.querySelector('#enable-notifs').addEventListener('click', async () => {
        const perm = await Notification.requestPermission();
        showToast(perm === 'granted' ? 'Reminders enabled' : 'Permission not granted');
        render(container);
      });
    }

    renderToday(container.querySelector('#med-today'), medStatus, container);
    await renderList(container.querySelector('#med-list'), container);

    showFab('+', () => openMedForm(null, container));
  }

  function renderToday(el, medStatus, appContainer) {
    if (medStatus.length === 0) {
      el.innerHTML = `<div class="empty-state"><div class="empty-state__icon">💊</div><div class="empty-state__title">No medications set up</div></div>`;
      return;
    }
    el.innerHTML = medStatus.map(({ med, log }) => {
      const status = log?.status || 'pending';
      return `
        <div class="card-row">
          <div class="flex gap-8" style="align-items:center; min-width:0;">
            <div class="check ${status === 'taken' ? 'is-checked' : ''}" data-action="taken" data-id="${med.id}" data-current="${status}">
              <svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z"/></svg>
            </div>
            <div style="min-width:0;">
              <div class="list-item__title truncate">${med.icon || '💊'} ${escapeHtml(med.name)}</div>
              <div class="list-item__sub">${escapeHtml(scheduleLabel(med))}</div>
            </div>
          </div>
          <div class="flex gap-8">
            <button class="btn btn-sm ${status === 'skipped' ? 'btn-danger' : ''}" data-action="skip" data-id="${med.id}" data-current="${status}">Skip</button>
          </div>
        </div>
      `;
    }).join('');

    el.querySelectorAll('[data-action="taken"]').forEach(elm => {
      elm.addEventListener('click', async () => {
        const id = Number(elm.dataset.id);
        const next = elm.dataset.current === 'taken' ? 'pending' : 'taken';
        await setMedTaken(id, next);
        render(appContainer);
      });
    });
    el.querySelectorAll('[data-action="skip"]').forEach(elm => {
      elm.addEventListener('click', async () => {
        const id = Number(elm.dataset.id);
        const next = elm.dataset.current === 'skipped' ? 'pending' : 'skipped';
        await setMedTaken(id, next);
        render(appContainer);
      });
    });
  }

  async function renderList(el, appContainer) {
    const meds = await listMedications({ activeOnly: false });
    if (meds.length === 0) {
      el.innerHTML = `<div class="empty-state"><div class="empty-state__icon">➕</div><div class="empty-state__title">Tap + to add a medication</div></div>`;
      return;
    }
    const rows = await Promise.all(meds.map(async m => {
      const streak = await medicationStreak(m.id);
      const history = await medicationHistory(m.id, 14);
      const dots = history.map(h => `<span title="${h.date}: ${h.status}" style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:2px;background:${
        h.status === 'taken' ? 'var(--color-good)' : h.status === 'skipped' ? 'var(--color-danger)' : 'var(--color-border)'
      }"></span>`).join('');
      return `
        <div class="list-item" data-action="edit-med" data-id="${m.id}">
          <div class="list-item__icon" style="background:${m.color}22;">${m.icon || '💊'}</div>
          <div class="list-item__body">
            <div class="list-item__title truncate">${escapeHtml(m.name)} ${!m.active ? '<span class="badge badge-dim">inactive</span>' : ''}</div>
            <div class="list-item__sub">${escapeHtml(scheduleLabel(m))} · 🔥 ${streak}-day streak</div>
            <div class="mt-8">${dots}</div>
          </div>
        </div>
      `;
    }));
    el.innerHTML = rows.join('');
    el.querySelectorAll('[data-action="edit-med"]').forEach(elm => {
      elm.addEventListener('click', async () => {
        const id = Number(elm.dataset.id);
        const med = await db.medications.get(id);
        openMedForm(med, appContainer);
      });
    });
  }

  function openMedForm(existing, appContainer) {
    const isEdit = !!existing;
    const schedType = existing?.scheduleType || 'fixed-time';
    openSheet(`
      <div class="sheet__header">
        <div class="sheet__title">${isEdit ? 'Edit' : 'New'} medication</div>
        <button class="icon-btn" id="sheet-close">✕</button>
      </div>
      <form id="med-form">
        <div class="field-row">
          <div class="field" style="flex:0 0 70px;">
            <label>Icon</label>
            <input type="text" name="icon" maxlength="4" value="${escapeHtml(existing?.icon ?? '💊')}">
          </div>
          <div class="field">
            <label>Name</label>
            <input type="text" name="name" required value="${escapeHtml(existing?.name ?? '')}">
          </div>
        </div>
        <div class="field">
          <label>Dose (optional)</label>
          <input type="text" name="dose" value="${escapeHtml(existing?.dose ?? '')}">
        </div>
        <div class="field">
          <label>Schedule</label>
          <select name="scheduleType" id="med-schedule-type">
            <option value="fixed-time" ${schedType === 'fixed-time' ? 'selected' : ''}>Fixed time</option>
            <option value="after-first-meal" ${schedType === 'after-first-meal' ? 'selected' : ''}>After first meal</option>
            <option value="lunch" ${schedType === 'lunch' ? 'selected' : ''}>At lunch</option>
          </select>
        </div>
        <div class="field" id="med-time-field" style="display:${schedType === 'fixed-time' ? 'block' : 'none'}">
          <label>Time</label>
          <input type="time" name="scheduleTime" value="${existing?.scheduleTime ?? '08:00'}">
        </div>
        <div class="field">
          <label>Note</label>
          <textarea name="note">${escapeHtml(existing?.note ?? '')}</textarea>
        </div>
        <div class="field">
          <label>Active</label>
          <div class="chip-group">
            <div class="chip ${existing?.active !== false ? 'is-selected' : ''}" data-active="true">Active</div>
            <div class="chip ${existing?.active === false ? 'is-selected' : ''}" data-active="false">Paused</div>
          </div>
          <input type="hidden" name="active" value="${existing?.active !== false ? 'true' : 'false'}">
        </div>
        <button type="submit" class="btn btn-primary btn-block">${isEdit ? 'Save changes' : 'Add medication'}</button>
        ${isEdit ? `<button type="button" class="btn btn-danger btn-block mt-8" id="med-delete">Delete</button>` : ''}
      </form>
    `, {
      onMount: (sheet) => {
        sheet.querySelector('#sheet-close').addEventListener('click', closeSheet);
        const form = sheet.querySelector('#med-form');
        const timeField = sheet.querySelector('#med-time-field');
        sheet.querySelector('#med-schedule-type').addEventListener('change', (e) => {
          timeField.style.display = e.target.value === 'fixed-time' ? 'block' : 'none';
        });
        const activeInput = form.querySelector('input[name="active"]');
        sheet.querySelectorAll('[data-active]').forEach(chip => {
          chip.addEventListener('click', () => {
            sheet.querySelectorAll('[data-active]').forEach(c => c.classList.remove('is-selected'));
            chip.classList.add('is-selected');
            activeInput.value = chip.dataset.active;
          });
        });

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(form);
          const payload = {
            icon: fd.get('icon') || '💊',
            name: fd.get('name'),
            dose: fd.get('dose'),
            scheduleType: fd.get('scheduleType'),
            scheduleTime: fd.get('scheduleTime') || '',
            note: fd.get('note'),
            active: fd.get('active') === 'true',
            color: existing?.color || '#0f8f86',
            order: existing?.order ?? 999
          };
          if (isEdit) payload.id = existing.id;
          await upsertMedication(payload);
          closeSheet();
          showToast(isEdit ? 'Saved' : 'Added');
          render(appContainer);
        });
        if (isEdit) {
          sheet.querySelector('#med-delete').addEventListener('click', async () => {
            await deleteMedication(existing.id);
            closeSheet();
            showToast('Deleted');
            render(appContainer);
          });
        }
      }
    });
  }

  return { render };
})();
