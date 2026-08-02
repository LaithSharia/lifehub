/* ==========================================================================
   notes.js — unified notes & tasks: Today / This Week / All, work vs life.
   ========================================================================== */

Views.notes = (() => {
  let state = {
    scope: 'today',   // 'today' | 'week' | 'all'
    list: 'all',       // 'all' | 'work' | 'life'
    search: ''
  };

  async function render(container) {
    container.innerHTML = `
      <div class="segmented" id="notes-scope">
        <button data-scope="today" class="${state.scope === 'today' ? 'is-active' : ''}">Today</button>
        <button data-scope="week" class="${state.scope === 'week' ? 'is-active' : ''}">This Week</button>
        <button data-scope="all" class="${state.scope === 'all' ? 'is-active' : ''}">All</button>
      </div>

      <div class="chip-group mt-16" id="notes-list-filter">
        <div class="chip ${state.list === 'all' ? 'is-selected' : ''}" data-list="all">All</div>
        <div class="chip ${state.list === 'work' ? 'is-selected' : ''}" data-list="work">💼 Work</div>
        <div class="chip ${state.list === 'life' ? 'is-selected' : ''}" data-list="life">🏡 Life</div>
      </div>

      ${state.scope === 'all' ? `
        <div class="field mt-16">
          <input type="search" placeholder="Search notes & tasks..." id="notes-search" value="${escapeHtml(state.search)}">
        </div>
      ` : ''}

      <div id="notes-body" class="mt-16"></div>
    `;

    container.querySelector('#notes-scope').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-scope]');
      if (!btn) return;
      state.scope = btn.dataset.scope;
      render(container);
    });
    container.querySelector('#notes-list-filter').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-list]');
      if (!chip) return;
      state.list = chip.dataset.list;
      render(container);
    });
    const searchInput = container.querySelector('#notes-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.search = searchInput.value;
        renderBody(container.querySelector('#notes-body'));
      });
    }

    await renderBody(container.querySelector('#notes-body'));

    showFab('+', () => openNoteForm(null, container));
  }

  async function renderBody(body) {
    let items;
    if (state.scope === 'today') items = await listTodayItems();
    else if (state.scope === 'week') items = await listWeekItems();
    else items = await listAllNotes();

    if (state.list !== 'all') items = items.filter(n => n.list === state.list);
    if (state.scope === 'all' && state.search.trim()) {
      const q = state.search.trim().toLowerCase();
      items = items.filter(n => (n.title || '').toLowerCase().includes(q) || (n.body || '').toLowerCase().includes(q));
    }

    if (items.length === 0) {
      body.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-state__icon">🗒️</div><div class="empty-state__title">Nothing here</div><div class="text-sm">Tap + to add a note or task</div></div></div>`;
      return;
    }

    body.innerHTML = `<div class="card">${items.map(n => `
      <div class="list-item" data-id="${n.id}">
        ${n.type === 'task' ? `
          <div class="check ${n.done ? 'is-checked' : ''}" data-action="toggle" data-id="${n.id}" data-done="${n.done}">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.5-1.5z"/></svg>
          </div>` : `<div class="list-item__icon" style="width:26px;height:26px;font-size:13px;">📝</div>`}
        <div class="list-item__body" data-action="edit" data-id="${n.id}">
          <div class="list-item__title truncate" style="${n.done ? 'text-decoration:line-through;color:var(--color-text-dim);' : ''}">${escapeHtml(n.title || '(untitled)')}</div>
          <div class="list-item__sub">
            ${n.list === 'work' ? '💼 Work' : '🏡 Life'}
            ${n.dueDate ? ' · ' + fmtDateShort(n.dueDate) : ''}
            ${n.priority === 'high' ? ' · <span class="badge badge-danger">High</span>' : ''}
          </div>
        </div>
      </div>
    `).join('')}</div>`;

    body.querySelectorAll('[data-action="toggle"]').forEach(elm => {
      elm.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = Number(elm.dataset.id);
        const done = elm.dataset.done === 'true';
        await toggleNoteDone(id, !done);
        renderBody(body);
      });
    });
    body.querySelectorAll('[data-action="edit"]').forEach(elm => {
      elm.addEventListener('click', async () => {
        const id = Number(elm.dataset.id);
        const note = await db.notes.get(id);
        openNoteForm(note, document.getElementById('app'));
      });
    });
  }

  function openNoteForm(existing, appContainer) {
    const isEdit = !!existing;
    const type = existing?.type || 'task';
    openSheet(`
      <div class="sheet__header">
        <div class="sheet__title">${isEdit ? 'Edit' : 'New'} note / task</div>
        <button class="icon-btn" id="sheet-close">✕</button>
      </div>
      <form id="note-form">
        <div class="field">
          <label>Type</label>
          <div class="segmented" id="note-type">
            <button type="button" data-type="task" class="${type === 'task' ? 'is-active' : ''}">Task (has due date)</button>
            <button type="button" data-type="note" class="${type === 'note' ? 'is-active' : ''}">Note</button>
          </div>
          <input type="hidden" name="type" value="${type}">
        </div>
        <div class="field">
          <label>List</label>
          <div class="chip-group">
            <div class="chip ${(existing?.list ?? 'life') === 'work' ? 'is-selected' : ''}" data-note-list="work">💼 Work</div>
            <div class="chip ${(existing?.list ?? 'life') === 'life' ? 'is-selected' : ''}" data-note-list="life">🏡 Life</div>
          </div>
          <input type="hidden" name="list" value="${existing?.list ?? 'life'}">
        </div>
        <div class="field">
          <label>Title</label>
          <input type="text" name="title" required value="${escapeHtml(existing?.title ?? '')}">
        </div>
        <div class="field">
          <label>Details</label>
          <textarea name="body">${escapeHtml(existing?.body ?? '')}</textarea>
        </div>
        <div class="field-row" id="note-due-row" style="display:${type === 'task' ? 'flex' : 'none'}">
          <div class="field">
            <label>Due date</label>
            <input type="date" name="dueDate" value="${existing?.dueDate ?? todayISO()}">
          </div>
          <div class="field">
            <label>Priority</label>
            <select name="priority">
              <option value="high" ${existing?.priority === 'high' ? 'selected' : ''}>High</option>
              <option value="normal" ${(!existing || existing.priority === 'normal') ? 'selected' : ''}>Normal</option>
              <option value="low" ${existing?.priority === 'low' ? 'selected' : ''}>Low</option>
            </select>
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-block">${isEdit ? 'Save changes' : 'Add'}</button>
        ${isEdit ? `<button type="button" class="btn btn-danger btn-block mt-8" id="note-delete">Delete</button>` : ''}
      </form>
    `, {
      onMount: (sheet) => {
        sheet.querySelector('#sheet-close').addEventListener('click', closeSheet);
        const form = sheet.querySelector('#note-form');
        const typeInput = form.querySelector('input[name="type"]');
        const listInput = form.querySelector('input[name="list"]');
        const dueRow = sheet.querySelector('#note-due-row');

        sheet.querySelector('#note-type').addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-type]');
          if (!btn) return;
          sheet.querySelectorAll('#note-type button').forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          typeInput.value = btn.dataset.type;
          dueRow.style.display = btn.dataset.type === 'task' ? 'flex' : 'none';
        });
        sheet.querySelectorAll('[data-note-list]').forEach(chip => {
          chip.addEventListener('click', () => {
            sheet.querySelectorAll('[data-note-list]').forEach(c => c.classList.remove('is-selected'));
            chip.classList.add('is-selected');
            listInput.value = chip.dataset.noteList;
          });
        });

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(form);
          const payload = {
            type: fd.get('type'),
            list: fd.get('list'),
            title: fd.get('title'),
            body: fd.get('body'),
            dueDate: fd.get('type') === 'task' ? (fd.get('dueDate') || null) : null,
            priority: fd.get('priority') || 'normal'
          };
          if (isEdit) await updateNote(existing.id, payload);
          else await addNote(payload);
          closeSheet();
          showToast(isEdit ? 'Saved' : 'Added');
          render(appContainer);
        });
        if (isEdit) {
          sheet.querySelector('#note-delete').addEventListener('click', async () => {
            await deleteNote(existing.id);
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
