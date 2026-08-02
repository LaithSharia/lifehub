/* ==========================================================================
   db.js — Dexie (IndexedDB) schema, seed data, and small CRUD/query helpers.
   Everything the app reads/writes lives here so views stay simple.
   ========================================================================== */

// Declared here (loaded before the view files) so each js/views/*.js can
// register itself as Views.<name> = {...} when it runs.
const Views = {};

const db = new Dexie('LifeHubDB');

db.version(1).stores({
  // ++id = auto-increment primary key. Extra fields listed are indexed.
  expenses: '++id, date, categoryId, updatedAt',
  categories: '++id, name, order',
  notes: '++id, type, list, dueDate, done, updatedAt',
  medications: '++id, order, active',
  medicationLog: '++id, medicationId, date, status',
  settings: 'key'
});

/* ---------------------------------------------------------------------- */
/* Utilities                                                              */
/* ---------------------------------------------------------------------- */

function todayISO(d = new Date()) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10); // YYYY-MM-DD, local date
}

function startOfWeek(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay(); // 0 = Sunday
  const diff = day; // week starts Sunday; change to (day + 6) % 7 for Monday start
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfWeek(d = new Date()) {
  const start = startOfWeek(d);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function nowTs() { return Date.now(); }

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------------------------------------------------------------- */
/* Seed data — runs once, only if the store is empty                     */
/* ---------------------------------------------------------------------- */

const DEFAULT_CATEGORIES = [
  { name: 'Groceries',      icon: '🛒', color: '#3c8f5f' },
  { name: 'Eating Out',     icon: '🍔', color: '#e0864f' },
  { name: 'Transport',      icon: '🚗', color: '#4f7be0' },
  { name: 'Bills & Utilities', icon: '💡', color: '#b9812a' },
  { name: 'Housing / Rent', icon: '🏠', color: '#8a5fd6' },
  { name: 'Health & Medicine', icon: '💊', color: '#c94b4b' },
  { name: 'Shopping',       icon: '🛍️', color: '#d64f8a' },
  { name: 'Subscriptions',  icon: '🔁', color: '#4fb0d6' },
  { name: 'Entertainment',  icon: '🎬', color: '#9a4fd6' },
  { name: 'Education',      icon: '📚', color: '#4fd68f' },
  { name: 'Family & Gifts', icon: '🎁', color: '#d6a44f' },
  { name: 'Other',          icon: '📦', color: '#7a8894' }
];

const DEFAULT_MEDICATIONS = [
  {
    name: 'Thyroxine (Euthyrox)',
    dose: '',
    scheduleType: 'fixed-time',
    scheduleTime: '05:15',
    note: 'Take on empty stomach, wait 30–60 min before eating',
    icon: '⏰',
    color: '#c94b4b'
  },
  {
    name: 'Selenium',
    dose: '',
    scheduleType: 'after-first-meal',
    scheduleTime: '',
    note: 'After your first meal of the day',
    icon: '🍳',
    color: '#b9812a'
  },
  {
    name: 'Omega-3',
    dose: '',
    scheduleType: 'lunch',
    scheduleTime: '',
    note: 'With lunch',
    icon: '🐟',
    color: '#4f7be0'
  },
  {
    name: 'B12',
    dose: '',
    scheduleType: 'lunch',
    scheduleTime: '',
    note: 'With lunch',
    icon: '🟡',
    color: '#d6a44f'
  }
];

async function ensureSeedData() {
  const catCount = await db.categories.count();
  if (catCount === 0) {
    await db.categories.bulkAdd(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, order: i })));
  }
  const medCount = await db.medications.count();
  if (medCount === 0) {
    await db.medications.bulkAdd(DEFAULT_MEDICATIONS.map((m, i) => ({ ...m, order: i, active: true })));
  }
  const settingsCount = await db.settings.count();
  if (settingsCount === 0) {
    await db.settings.bulkAdd([
      { key: 'currency', value: 'ILS' },
      { key: 'theme', value: 'system' },
      { key: 'lastSyncedAt', value: null },
      { key: 'driveFileId', value: null }
    ]);
  }
}

/* ---------------------------------------------------------------------- */
/* Settings helpers                                                       */
/* ---------------------------------------------------------------------- */

async function getSetting(key, fallback = null) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}
async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

/* ---------------------------------------------------------------------- */
/* Categories                                                             */
/* ---------------------------------------------------------------------- */

async function listCategories() {
  return db.categories.orderBy('order').toArray();
}
async function upsertCategory(cat) {
  if (cat.id) return db.categories.put(cat), cat.id;
  return db.categories.add(cat);
}
async function deleteCategory(id) {
  return db.categories.delete(id);
}

/* ---------------------------------------------------------------------- */
/* Expenses                                                               */
/* ---------------------------------------------------------------------- */

async function addExpense(exp) {
  const now = nowTs();
  return db.expenses.add({
    date: exp.date || todayISO(),
    amount: Number(exp.amount) || 0,
    currency: (exp.currency || await getSetting('currency', 'ILS')).toUpperCase(),
    categoryId: exp.categoryId,
    merchant: exp.merchant || '',
    note: exp.note || '',
    paymentMethod: exp.paymentMethod || '',
    tags: exp.tags || [],
    createdAt: now,
    updatedAt: now
  });
}
async function updateExpense(id, patch) {
  return db.expenses.update(id, { ...patch, updatedAt: nowTs() });
}
async function deleteExpense(id) {
  return db.expenses.delete(id);
}
async function listExpensesInRange(startISO, endISO) {
  return db.expenses.where('date').between(startISO, endISO, true, true).reverse().sortBy('date');
}
async function listExpensesForMonth(year, month /* 0-11 */) {
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return listExpensesInRange(start, end);
}
// Amounts are never blended across currencies (ILS + USD don't sum to a
// meaningful number without a live exchange rate this app doesn't fetch).
// Instead this groups everything into one bucket per currency actually
// used that month, each with its own total + category breakdown.
async function monthlySummary(year, month) {
  const expenses = await listExpensesForMonth(year, month);
  const categories = await listCategories();
  const defaultCurrency = await getSetting('currency', 'ILS');

  const byCurrency = new Map(); // currency -> { total, byCat: Map(catId -> amount) }
  for (const e of expenses) {
    const cur = (e.currency || defaultCurrency).toUpperCase();
    if (!byCurrency.has(cur)) byCurrency.set(cur, { total: 0, byCat: new Map() });
    const bucket = byCurrency.get(cur);
    bucket.total += e.amount;
    bucket.byCat.set(e.categoryId, (bucket.byCat.get(e.categoryId) || 0) + e.amount);
  }

  const currencies = [...byCurrency.entries()]
    .map(([currency, { total, byCat }]) => ({
      currency,
      total,
      isDefault: currency === defaultCurrency.toUpperCase(),
      breakdown: categories
        .map(c => ({ category: c, amount: byCat.get(c.id) || 0 }))
        .filter(row => row.amount > 0)
        .sort((a, b) => b.amount - a.amount)
    }))
    .sort((a, b) => (b.isDefault - a.isDefault) || (b.total - a.total)); // default currency first

  return { currencies, count: expenses.length, expenses };
}

/* ---------------------------------------------------------------------- */
/* Notes & Tasks (unified store, filtered by `type`)                      */
/* ---------------------------------------------------------------------- */

async function addNote(note) {
  const now = nowTs();
  return db.notes.add({
    type: note.type || 'note',       // 'note' | 'task'
    list: note.list || 'life',       // 'work' | 'life'
    title: note.title || '',
    body: note.body || '',
    dueDate: note.dueDate || null,   // YYYY-MM-DD or null
    priority: note.priority || 'normal',
    done: false,
    createdAt: now,
    updatedAt: now
  });
}
async function updateNote(id, patch) {
  return db.notes.update(id, { ...patch, updatedAt: nowTs() });
}
async function deleteNote(id) {
  return db.notes.delete(id);
}
async function toggleNoteDone(id, done) {
  return db.notes.update(id, { done, updatedAt: nowTs() });
}
async function listAllNotes() {
  return db.notes.orderBy('updatedAt').reverse().toArray();
}
async function listTodayItems() {
  const today = todayISO();
  const all = await db.notes.toArray();
  return all
    .filter(n => n.dueDate === today || (n.type === 'note' && !n.dueDate && !n.done && isRecent(n)))
    .sort(sortByPriorityThenDue);
}
async function listWeekItems() {
  const start = todayISO(startOfWeek());
  const end = todayISO(endOfWeek());
  const all = await db.notes.toArray();
  return all
    .filter(n => n.dueDate && n.dueDate >= start && n.dueDate <= end)
    .sort(sortByPriorityThenDue);
}
function isRecent(n) {
  return (Date.now() - n.createdAt) < 1000 * 60 * 60 * 24 * 3; // undated notes surface for 3 days
}
function sortByPriorityThenDue(a, b) {
  const pw = { high: 0, normal: 1, low: 2 };
  if (a.done !== b.done) return a.done ? 1 : -1;
  if ((pw[a.priority] ?? 1) !== (pw[b.priority] ?? 1)) return (pw[a.priority] ?? 1) - (pw[b.priority] ?? 1);
  return (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1;
}

/* ---------------------------------------------------------------------- */
/* Medications                                                            */
/* ---------------------------------------------------------------------- */

async function listMedications({ activeOnly = true } = {}) {
  const meds = await db.medications.orderBy('order').toArray();
  return activeOnly ? meds.filter(m => m.active) : meds;
}
async function upsertMedication(med) {
  if (med.id) return db.medications.put(med), med.id;
  return db.medications.add(med);
}
async function deleteMedication(id) {
  return db.medications.delete(id);
}

function scheduleLabel(med) {
  switch (med.scheduleType) {
    case 'fixed-time': return med.scheduleTime || '--:--';
    case 'after-first-meal': return 'After first meal';
    case 'lunch': return 'At lunch';
    default: return med.scheduleTime || '';
  }
}

async function getTodayMedStatus() {
  const date = todayISO();
  const meds = await listMedications();
  const logs = await db.medicationLog.where('date').equals(date).toArray();
  const logByMed = new Map(logs.map(l => [l.medicationId, l]));
  return meds
    .map(m => ({ med: m, log: logByMed.get(m.id) || null }))
    .sort((a, b) => {
      if (a.med.scheduleType === 'fixed-time' && b.med.scheduleType === 'fixed-time') {
        return a.med.scheduleTime.localeCompare(b.med.scheduleTime);
      }
      if (a.med.scheduleType === 'fixed-time') return -1;
      if (b.med.scheduleType === 'fixed-time') return 1;
      return a.med.order - b.med.order;
    });
}

async function setMedTaken(medicationId, status /* 'taken' | 'skipped' | 'pending' */) {
  const date = todayISO();
  const existing = await db.medicationLog.where({ medicationId, date }).first();
  if (existing) {
    if (status === 'pending') return db.medicationLog.delete(existing.id);
    return db.medicationLog.update(existing.id, { status, takenAt: nowTs() });
  }
  if (status === 'pending') return;
  return db.medicationLog.add({ medicationId, date, status, takenAt: nowTs() });
}

async function medicationStreak(medicationId) {
  // count consecutive days (ending yesterday or today) with status 'taken'
  let streak = 0;
  let cursor = new Date();
  for (let i = 0; i < 365; i++) {
    const dateISO = todayISO(cursor);
    const log = await db.medicationLog.where({ medicationId, date: dateISO }).first();
    if (log && log.status === 'taken') {
      streak++;
    } else if (dateISO === todayISO()) {
      // today not yet taken doesn't break the streak count from yesterday
    } else {
      break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

async function medicationHistory(medicationId, days = 30) {
  const logs = await db.medicationLog.where('medicationId').equals(medicationId).toArray();
  const byDate = new Map(logs.map(l => [l.date, l]));
  const out = [];
  const cursor = new Date();
  for (let i = 0; i < days; i++) {
    const dateISO = todayISO(cursor);
    out.push({ date: dateISO, status: byDate.get(dateISO)?.status || 'missed' });
    cursor.setDate(cursor.getDate() - 1);
  }
  return out.reverse();
}

/* ---------------------------------------------------------------------- */
/* Full snapshot export/import — used by Drive sync and manual backup    */
/* ---------------------------------------------------------------------- */

async function exportSnapshot() {
  const [expenses, categories, notes, medications, medicationLog, settings] = await Promise.all([
    db.expenses.toArray(),
    db.categories.toArray(),
    db.notes.toArray(),
    db.medications.toArray(),
    db.medicationLog.toArray(),
    db.settings.toArray()
  ]);
  return {
    version: 1,
    exportedAt: nowTs(),
    data: { expenses, categories, notes, medications, medicationLog, settings }
  };
}

async function importSnapshot(snapshot, { mode = 'replace' } = {}) {
  if (!snapshot || !snapshot.data) throw new Error('Invalid snapshot');
  const { expenses, categories, notes, medications, medicationLog, settings } = snapshot.data;
  await db.transaction('rw', db.expenses, db.categories, db.notes, db.medications, db.medicationLog, db.settings, async () => {
    if (mode === 'replace') {
      await Promise.all([
        db.expenses.clear(), db.categories.clear(), db.notes.clear(),
        db.medications.clear(), db.medicationLog.clear(), db.settings.clear()
      ]);
    }
    if (expenses) await db.expenses.bulkPut(expenses);
    if (categories) await db.categories.bulkPut(categories);
    if (notes) await db.notes.bulkPut(notes);
    if (medications) await db.medications.bulkPut(medications);
    if (medicationLog) await db.medicationLog.bulkPut(medicationLog);
    if (settings) await db.settings.bulkPut(settings);
  });
}
