/* ==========================================================================
   dashboard.js — home screen: today's meds, today/week tasks, month spend.
   ========================================================================== */

Views.dashboard = {
  async render(container) {
    const [medStatus, todayItems, currency] = await Promise.all([
      getTodayMedStatus(),
      listTodayItems(),
      getSetting('currency', 'ILS')
    ]);

    const now = new Date();
    const summary = await monthlySummary(now.getFullYear(), now.getMonth());
    const topBucket = summary.currencies[0]; // default currency, or the largest bucket if none used yet
    const topCat = topBucket?.breakdown[0];
    const spentDisplay = summary.currencies.length
      ? summary.currencies.map(c => fmtMoney(c.total, c.currency)).join(' + ')
      : fmtMoney(0, currency);

    container.innerHTML = `
      <div class="section-title">Today's medicine</div>
      <div class="card" id="dash-meds"></div>

      <div class="section-title">Today</div>
      <div class="card" id="dash-today"></div>

      <div class="section-title">${escapeHtml(fmtMonthYear(now.getFullYear(), now.getMonth()))}</div>
      <div class="stat-grid">
        <div class="stat-tile">
          <div class="stat-tile__label">Spent so far</div>
          <div class="stat-tile__value" style="font-size:${summary.currencies.length > 1 ? '16px' : '22px'}">${spentDisplay}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile__label">Top category</div>
          <div class="stat-tile__value" style="font-size:16px">${topCat ? topCat.category.icon + ' ' + escapeHtml(topCat.category.name) : '—'}</div>
        </div>
      </div>
      <div class="mt-8">
        <a href="#/expenses" class="btn btn-block">Open Expenses</a>
      </div>
    `;

    renderDashMeds(container.querySelector('#dash-meds'), medStatus);
    renderDashToday(container.querySelector('#dash-today'), todayItems);
  }
};

function renderDashMeds(el, medStatus) {
  if (medStatus.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state__icon">💊</div><div class="empty-state__title">No medications yet</div><a href="#/meds" class="btn btn-sm mt-8">Add one</a></div>`;
    return;
  }
  el.innerHTML = medStatus.map(({ med, log }) => {
    const status = log?.status || 'pending';
    return `
      <div class="card-row" data-med-id="${med.id}">
        <div class="flex gap-8" style="align-items:center; min-width:0;">
          <div class="check ${status === 'taken' ? 'is-checked' : ''}" data-action="toggle-med" data-med-id="${med.id}" data-current="${status}">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z"/></svg>
          </div>
          <div style="min-width:0;">
            <div class="list-item__title truncate">${med.icon || '💊'} ${escapeHtml(med.name)}</div>
            <div class="list-item__sub">${escapeHtml(scheduleLabel(med))}${med.note ? ' · ' + escapeHtml(med.note) : ''}</div>
          </div>
        </div>
        <span class="badge ${status === 'taken' ? 'badge-good' : status === 'skipped' ? 'badge-danger' : 'badge-dim'}">${status}</span>
      </div>
    `;
  }).join('');

  el.querySelectorAll('[data-action="toggle-med"]').forEach(elm => {
    elm.addEventListener('click', async () => {
      const id = Number(elm.dataset.medId);
      const current = elm.dataset.current;
      const next = current === 'taken' ? 'pending' : 'taken';
      await setMedTaken(id, next);
      Views.dashboard.render(document.getElementById('app'));
      if (next === 'taken') showToast('Marked as taken');
    });
  });
}

function renderDashToday(el, items) {
  if (items.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state__icon">✅</div><div class="empty-state__title">Nothing due today</div></div>`;
    return;
  }
  el.innerHTML = items.map(n => `
    <div class="card-row">
      <div class="flex gap-8" style="align-items:center; min-width:0;">
        ${n.type === 'task' ? `
          <div class="check ${n.done ? 'is-checked' : ''}" data-action="toggle-note" data-id="${n.id}" data-done="${n.done}">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z"/></svg>
          </div>` : `<div class="list-item__icon" style="width:26px;height:26px;font-size:13px;">📝</div>`}
        <div style="min-width:0;">
          <div class="list-item__title truncate" style="${n.done ? 'text-decoration:line-through;color:var(--color-text-dim);' : ''}">${escapeHtml(n.title || '(untitled)')}</div>
          <div class="list-item__sub">${n.list === 'work' ? '💼 Work' : '🏡 Life'}</div>
        </div>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-action="toggle-note"]').forEach(elm => {
    elm.addEventListener('click', async () => {
      const id = Number(elm.dataset.id);
      const done = elm.dataset.done === 'true';
      await toggleNoteDone(id, !done);
      Views.dashboard.render(document.getElementById('app'));
    });
  });
}
