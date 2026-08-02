/* ==========================================================================
   expenses.js — expense logging, monthly summary/chart, category manager,
   CSV export. All data via db.js helpers.
   ========================================================================== */

Views.expenses = (() => {
  let state = {
    tab: 'list',              // 'list' | 'summary'
    cursor: new Date(),       // month currently viewed
    categoryFilter: null,
    search: ''
  };

  async function render(container) {
    const currency = await getSetting('currency', 'ILS');
    const categories = await listCategories();

    container.innerHTML = `
      <div class="segmented" id="exp-tabs">
        <button data-tab="list" class="${state.tab === 'list' ? 'is-active' : ''}">List</button>
        <button data-tab="summary" class="${state.tab === 'summary' ? 'is-active' : ''}">Summary</button>
      </div>

      <div class="card-row" style="padding-top:14px;">
        <button class="btn btn-sm" id="exp-prev-month">‹</button>
        <div style="font-weight:700;">${escapeHtml(fmtMonthYear(state.cursor.getFullYear(), state.cursor.getMonth()))}</div>
        <button class="btn btn-sm" id="exp-next-month">›</button>
      </div>

      <div id="exp-body"></div>

      <div class="flex gap-8 mt-16">
        <button class="btn" id="exp-manage-categories" style="flex:1;">Categories</button>
        <button class="btn" id="exp-export-csv" style="flex:1;">Export CSV</button>
      </div>
    `;

    container.querySelector('#exp-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      state.tab = btn.dataset.tab;
      render(container);
    });
    container.querySelector('#exp-prev-month').addEventListener('click', () => {
      state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1);
      render(container);
    });
    container.querySelector('#exp-next-month').addEventListener('click', () => {
      state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1);
      render(container);
    });
    container.querySelector('#exp-manage-categories').addEventListener('click', () => openCategoryManager());
    container.querySelector('#exp-export-csv').addEventListener('click', () => exportCsv(state.cursor));

    const body = container.querySelector('#exp-body');
    if (state.tab === 'list') await renderList(body, categories, currency);
    else await renderSummary(body, categories, currency);

    showFab('+', () => openExpenseForm(categories, null, container));
  }

  async function renderList(body, categories, currency) {
    const expenses = await listExpensesForMonth(state.cursor.getFullYear(), state.cursor.getMonth());
    if (expenses.length === 0) {
      body.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-state__icon">🧾</div><div class="empty-state__title">No expenses this month</div><div class="text-sm">Tap + to add your first one</div></div></div>`;
      return;
    }
    const catById = new Map(categories.map(c => [c.id, c]));
    body.innerHTML = `<div class="card">${expenses.map(e => {
      const cat = catById.get(e.categoryId) || { icon: '📦', name: 'Other', color: '#7a8894' };
      return `
        <div class="list-item" data-id="${e.id}" data-action="edit-expense">
          <div class="list-item__icon" style="background:${cat.color}22;">${cat.icon}</div>
          <div class="list-item__body">
            <div class="list-item__title truncate">${escapeHtml(e.merchant || cat.name)}</div>
            <div class="list-item__sub">${fmtDateShort(e.date)} · ${escapeHtml(cat.name)}${e.note ? ' · ' + escapeHtml(e.note) : ''}</div>
          </div>
          <div class="list-item__amount">${fmtMoney(e.amount, e.currency || currency)}</div>
        </div>
      `;
    }).join('')}</div>`;

    body.querySelectorAll('[data-action="edit-expense"]').forEach(elm => {
      elm.addEventListener('click', async () => {
        const id = Number(elm.dataset.id);
        const exp = await db.expenses.get(id);
        openExpenseForm(categories, exp, document.getElementById('app'));
      });
    });
  }

  async function renderSummary(body, categories, currency) {
    const summary = await monthlySummary(state.cursor.getFullYear(), state.cursor.getMonth());
    if (summary.currencies.length === 0) {
      body.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-state__icon">📊</div><div class="empty-state__title">No spending yet this month</div></div></div>`;
      return;
    }

    const prevCursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() - 1, 1);
    const prevSummary = await monthlySummary(prevCursor.getFullYear(), prevCursor.getMonth());
    const prevByCurrency = new Map(prevSummary.currencies.map(c => [c.currency, c.total]));

    body.innerHTML = summary.currencies.map(bucket => {
      const prevTotal = prevByCurrency.get(bucket.currency);
      const delta = prevTotal ? ((bucket.total - prevTotal) / prevTotal) * 100 : null;
      const donut = buildDonutSvg(bucket.breakdown, bucket.total);

      return `
        <div class="card">
          <div class="flex-between">
            <div>
              <div class="text-sm text-dim">Total spent · ${escapeHtml(bucket.currency)}</div>
              <div style="font-size:26px;font-weight:800;">${fmtMoney(bucket.total, bucket.currency)}</div>
            </div>
            ${delta !== null ? `<span class="badge ${delta > 0 ? 'badge-danger' : 'badge-good'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}% vs last month</span>` : ''}
          </div>
          <div class="flex-center mt-16">${donut}</div>
          <div class="chart-legend">
            ${bucket.breakdown.map(row => {
              const pct = (row.amount / bucket.total) * 100;
              // Budgets are set in your default currency (Settings), so only compare them
              // against spend that's actually in that same currency — otherwise ILS spend
              // vs a USD budget (or vice versa) would be a meaningless comparison.
              const showBudget = bucket.isDefault && row.category.budget;
              const overBudget = showBudget && row.amount > row.category.budget;
              return `
                <div>
                  <div class="chart-legend__row">
                    <span class="chart-legend__swatch" style="background:${row.category.color}"></span>
                    <span class="chart-legend__label">${row.category.icon} ${escapeHtml(row.category.name)}</span>
                    <span class="chart-legend__value">${fmtMoney(row.amount, bucket.currency)}</span>
                  </div>
                  ${showBudget ? `
                    <div class="progress">
                      <div class="progress__fill ${overBudget ? 'is-danger' : pct > 80 ? 'is-warn' : ''}" style="width:${Math.min(100, (row.amount / row.category.budget) * 100)}%"></div>
                    </div>
                    <div class="text-sm text-dim">${fmtMoney(row.amount, bucket.currency)} of ${fmtMoney(row.category.budget, bucket.currency)} budget${overBudget ? ' — over budget' : ''}</div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  function buildDonutSvg(breakdown, total) {
    const size = 180, r = 70, cx = size / 2, cy = size / 2, circumference = 2 * Math.PI * r;
    let offset = 0;
    const segments = breakdown.map(row => {
      const frac = row.amount / total;
      const dash = frac * circumference;
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${row.category.color}" stroke-width="22"
        stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" />`;
      offset += dash;
      return seg;
    }).join('');
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${segments}</svg>`;
  }

  async function openExpenseForm(categories, existing, appContainer) {
    const isEdit = !!existing;
    const defaultCurrency = await getSetting('currency', 'ILS');
    const catOptions = categories.map(c => `<option value="${c.id}" ${existing?.categoryId === c.id ? 'selected' : ''}>${c.icon} ${escapeHtml(c.name)}</option>`).join('');
    openSheet(`
      <div class="sheet__header">
        <div class="sheet__title">${isEdit ? 'Edit expense' : 'Add expense'}</div>
        <button class="icon-btn" id="sheet-close">✕</button>
      </div>
      <form id="expense-form">
        <div class="field-row">
          <div class="field" style="flex:2;">
            <label>Amount</label>
            <input type="number" step="0.01" inputmode="decimal" name="amount" required value="${existing?.amount ?? ''}">
          </div>
          <div class="field" style="flex:1;">
            <label>Currency</label>
            <input type="text" name="currency" maxlength="3" style="text-transform:uppercase;" value="${escapeHtml(existing?.currency ?? defaultCurrency)}">
          </div>
        </div>
        <div class="field">
          <label>Date</label>
          <input type="date" name="date" required value="${existing?.date ?? todayISO()}">
        </div>
        <div class="field">
          <label>Category</label>
          <select name="categoryId" required>${catOptions}</select>
        </div>
        <div class="field">
          <label>Merchant / what for</label>
          <input type="text" name="merchant" placeholder="e.g. Carrefour" value="${escapeHtml(existing?.merchant ?? '')}">
        </div>
        <div class="field">
          <label>Payment method</label>
          <input type="text" name="paymentMethod" placeholder="Cash, card..." value="${escapeHtml(existing?.paymentMethod ?? '')}">
        </div>
        <div class="field">
          <label>Note</label>
          <textarea name="note">${escapeHtml(existing?.note ?? '')}</textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block">${isEdit ? 'Save changes' : 'Add expense'}</button>
        ${isEdit ? `<button type="button" class="btn btn-danger btn-block mt-8" id="expense-delete">Delete</button>` : ''}
      </form>
    `, {
      onMount: (sheet) => {
        sheet.querySelector('#sheet-close').addEventListener('click', closeSheet);
        const form = sheet.querySelector('#expense-form');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(form);
          const payload = {
            amount: fd.get('amount'),
            currency: (fd.get('currency') || defaultCurrency).trim().toUpperCase().slice(0, 3),
            date: fd.get('date'),
            categoryId: Number(fd.get('categoryId')),
            merchant: fd.get('merchant'),
            paymentMethod: fd.get('paymentMethod'),
            note: fd.get('note')
          };
          if (isEdit) await updateExpense(existing.id, payload);
          else await addExpense(payload);
          closeSheet();
          showToast(isEdit ? 'Expense updated' : 'Expense added');
          render(appContainer);
        });
        if (isEdit) {
          sheet.querySelector('#expense-delete').addEventListener('click', async () => {
            await deleteExpense(existing.id);
            closeSheet();
            showToast('Expense deleted');
            render(appContainer);
          });
        }
      }
    });
  }

  function openCategoryManager() {
    renderCategoryManagerSheet();
  }

  async function renderCategoryManagerSheet() {
    const categories = await listCategories();
    openSheet(`
      <div class="sheet__header">
        <div class="sheet__title">Categories</div>
        <button class="icon-btn" id="sheet-close">✕</button>
      </div>
      <div id="cat-list"></div>
      <button class="btn btn-block mt-16" id="cat-add">+ New category</button>
    `, {
      onMount: (sheet) => {
        sheet.querySelector('#sheet-close').addEventListener('click', closeSheet);
        const list = sheet.querySelector('#cat-list');
        list.innerHTML = categories.map(c => `
          <div class="list-item" data-id="${c.id}">
            <div class="list-item__icon" style="background:${c.color}22;">${c.icon}</div>
            <div class="list-item__body">
              <div class="list-item__title">${escapeHtml(c.name)}</div>
              <div class="list-item__sub">${c.budget ? 'Budget: ' + fmtMoney(c.budget, '') : 'No budget set'}</div>
            </div>
            <button class="btn btn-sm" data-action="edit-cat">Edit</button>
          </div>
        `).join('');
        list.querySelectorAll('[data-action="edit-cat"]').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = Number(btn.closest('[data-id]').dataset.id);
            openCategoryForm(categories.find(c => c.id === id));
          });
        });
        sheet.querySelector('#cat-add').addEventListener('click', () => openCategoryForm(null));
      }
    });
  }

  function openCategoryForm(existing) {
    const isEdit = !!existing;
    openSheet(`
      <div class="sheet__header">
        <div class="sheet__title">${isEdit ? 'Edit category' : 'New category'}</div>
        <button class="icon-btn" id="sheet-close">✕</button>
      </div>
      <form id="cat-form">
        <div class="field-row">
          <div class="field" style="flex:0 0 70px;">
            <label>Icon</label>
            <input type="text" name="icon" maxlength="4" value="${escapeHtml(existing?.icon ?? '📦')}">
          </div>
          <div class="field">
            <label>Name</label>
            <input type="text" name="name" required value="${escapeHtml(existing?.name ?? '')}">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Color</label>
            <input type="color" name="color" value="${existing?.color ?? '#0f8f86'}">
          </div>
          <div class="field">
            <label>Monthly budget (optional)</label>
            <input type="number" step="0.01" name="budget" value="${existing?.budget ?? ''}">
          </div>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Save</button>
        ${isEdit ? `<button type="button" class="btn btn-danger btn-block mt-8" id="cat-delete">Delete category</button>` : ''}
      </form>
    `, {
      onMount: (sheet) => {
        sheet.querySelector('#sheet-close').addEventListener('click', closeSheet);
        sheet.querySelector('#cat-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const payload = {
            icon: fd.get('icon') || '📦',
            name: fd.get('name'),
            color: fd.get('color'),
            budget: fd.get('budget') ? Number(fd.get('budget')) : null,
            order: existing?.order ?? 999
          };
          if (isEdit) payload.id = existing.id;
          await upsertCategory(payload);
          closeSheet();
          showToast('Category saved');
          renderCategoryManagerSheet();
        });
        if (isEdit) {
          sheet.querySelector('#cat-delete').addEventListener('click', async () => {
            await deleteCategory(existing.id);
            closeSheet();
            showToast('Category deleted');
            renderCategoryManagerSheet();
          });
        }
      }
    });
  }

  async function exportCsv(cursor) {
    const categories = await listCategories();
    const catById = new Map(categories.map(c => [c.id, c]));
    const expenses = await listExpensesForMonth(cursor.getFullYear(), cursor.getMonth());
    const defaultCurrency = await getSetting('currency', 'ILS');
    const rows = [['Date', 'Category', 'Merchant', 'Amount', 'Currency', 'Payment Method', 'Note']];
    for (const e of expenses) {
      const cat = catById.get(e.categoryId);
      rows.push([e.date, cat?.name || '', e.merchant || '', e.amount, e.currency || defaultCurrency, e.paymentMethod || '', (e.note || '').replace(/\n/g, ' ')]);
    }
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifehub-expenses-${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return { render };
})();
