import { Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
//  SEED HELPERS  — inject data into IndexedDB before page load
// ─────────────────────────────────────────────────────────────────────────────

/** Ensures we are on the app origin before IDB operations */
async function ensureOrigin(page: Page) {
  const url = page.url();
  if (url === 'about:blank' || !url.includes('localhost:3333')) {
    await page.goto('/app.html');
  }
}

/** Helper to write to IndexedDB kv store */
async function writeToIDB(page: Page, key: string, value: any) {
  await ensureOrigin(page);
  const dbName = await page.evaluate(() => localStorage.getItem('__TEST_DB_NAME__') || 'AsthmeTrackDB');
  await page.evaluate(async ({ key, value, dbName }) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      req.onerror = () => reject(req.error);
    });
  }, { key, value, dbName });
}

/** Helper to wipe IndexedDB */
export async function clearIDB(page: Page, name?: string) {
  await ensureOrigin(page);
  const dbName = name || await page.evaluate(() => localStorage.getItem('__TEST_DB_NAME__') || 'AsthmeTrackDB');
  await page.evaluate(async (name) => {
    return new Promise((resolve) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').clear();
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); resolve(); };
        } catch(e) { db.close(); resolve(); }
      };
      req.onerror = () => resolve();
    });
  }, dbName);
}

/** Helper to read from IndexedDB kv store */
export async function readFromIDB(page: Page, key: string): Promise<any> {
  await ensureOrigin(page);
  const dbName = await page.evaluate(() => localStorage.getItem('__TEST_DB_NAME__') || 'AsthmeTrackDB');
  return await page.evaluate(async ({ k, name }) => {
    return new Promise((resolve) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv'); // Ensure store exists
      req.onsuccess = () => {
        const db = req.result;
        try {
          const getReq = db.transaction('kv').objectStore('kv').get(k);
          getReq.onsuccess = () => { db.close(); resolve(getReq.result); };
          getReq.onerror = () => { db.close(); resolve(null); };
        } catch(e) { db.close(); resolve(null); }
      };
      req.onerror = () => resolve(null);
    });
  }, { k: key, name: dbName });
}

/** Injects measures into IndexedDB (sorted newest-first, matching DB behaviour). */
export async function seedMeasures(page: Page, measures: object[]) {
  const sorted = [...measures].sort((a: any, b: any) =>
    new Date(b.dt).getTime() - new Date(a.dt).getTime()
  );
  await writeToIDB(page, 'at_measures', JSON.stringify(sorted));
}

/** Injects reminders into IndexedDB. */
export async function seedReminders(page: Page, reminders: object[]) {
  await writeToIDB(page, 'at_reminders', JSON.stringify(reminders));
}

/** Injects personal best DEP. */
export async function seedBestDEP(page: Page, value: number) {
  await writeToIDB(page, 'at_bestDEP', String(value));
}

/** Injects patient profile (sex, age, height). */
export async function seedProfile(page: Page, profile: { sex: string; age: number; height: number }) {
  await writeToIDB(page, 'at_profile', JSON.stringify(profile));
}

/** Sets language preference before page load. */
export async function seedLang(page: Page, lang: 'fr' | 'en') {
  await page.addInitScript((l) => {
    localStorage.setItem('at_lang', l);
  }, lang);
}

/** Sets theme preference before page load. */
export async function seedTheme(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript((t) => {
    localStorage.setItem('at_theme', t);
  }, theme);
}

/** Sets font preference before page load. */
export async function seedFont(page: Page, font: 'system' | 'custom') {
  await page.addInitScript((f) => {
    localStorage.setItem('at_font', f);
  }, font);
}

// ─────────────────────────────────────────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────

/** Navigates to a tab via the nav bar. */
export async function goToTab(page: Page, tab: 'dashboard' | 'saisie' | 'historique' | 'settings') {
  await page.locator(`nav .nav-btn[data-val="${tab}"]`).click();
  await page.waitForSelector(`#page-${tab}.active`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  FORM HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Fills and submits the measure form. */
export async function addMeasure(page: Page, opts: {
  datetime?: string;
  dep1: number;
  dep2?: number;
  dep3?: number;
  spo2: number;
  easy: number;
  comment?: string;
}) {
  await goToTab(page, 'saisie');
  const form = page.locator('#page-saisie');
  if (opts.datetime) await form.locator('#inputDatetime').fill(opts.datetime);
  await form.locator('#dep1').fill(String(opts.dep1));
  if (opts.dep2 !== undefined) await form.locator('#dep2').fill(String(opts.dep2));
  if (opts.dep3 !== undefined) await form.locator('#dep3').fill(String(opts.dep3));
  await form.locator('#inputSpO2').fill(String(opts.spo2));
  await form.locator(`.easyh-btn[data-val="${opts.easy}"]`).click();
  if (opts.comment) await form.locator('#inputComment').fill(opts.comment);
  await form.locator('button.btn-primary').click();
}

// ─────────────────────────────────────────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────────────────────────────────────────

/** Waits for a toast to appear and returns its text. */
export async function waitForToast(page: Page): Promise<string> {
  const toast = page.locator('#toast.show');
  await toast.waitFor({ state: 'visible', timeout: 3000 });
  return (await toast.textContent()) ?? '';
}

// ─────────────────────────────────────────────────────────────────────────────
//  FACTORIES
// ─────────────────────────────────────────────────────────────────────────────

/** Returns a fake measure with sensible defaults, overridable per field. */
export function fakeMeasure(overrides: Partial<{
  id: number; dt: string;
  dep: number; dep1: number; dep2: number; dep3: number;
  spo2: number; easy: number; comment: string;
}> = {}) {
  return {
    id: Date.now() + Math.random(),
    dt: '2025-01-15T08:00',
    dep: 400, dep1: 400, dep2: 400, dep3: 400,
    spo2: 97, easy: 1, comment: '',
    ...overrides,
  };
}

/** Builds a sequence of N measures going back N days from a base date,
 *  all with the given DEP value — useful for trend and crisis tests. */
export function fakeMeasureSequence(
  count: number,
  dep: number,
  spo2 = 97,
  baseDateMs = Date.now()
): object[] {
  return Array.from({ length: count }, (_, i) => ({
    id: baseDateMs - i * 1000,
    dt: new Date(baseDateMs - i * 24 * 3600 * 1000).toISOString(),
    dep, dep1: dep, dep2: dep, dep3: dep,
    spo2, easy: 1, comment: '',
  }));
}
