import { Page } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
//  SEED HELPERS  — inject data into IndexedDB before page load
// ─────────────────────────────────────────────────────────────────────────────

/** Helper to write to IndexedDB kv store */
async function writeToIDB(page: Page, key: string, value: any) {
  await page.addInitScript(({ key, value }) => {
    const req = indexedDB.open('AsthmeTrackDB', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
    };
  }, { key, value });
}

/** Helper to wipe IndexedDB */
export async function clearIDB(page: Page) {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('AsthmeTrackDB');
  });
}

/** Helper to read from IndexedDB kv store */
export async function readFromIDB(page: Page, key: string): Promise<any> {
  return await page.evaluate(async (k) => {
    return new Promise((resolve) => {
      const req = indexedDB.open('AsthmeTrackDB', 1);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const getReq = db.transaction('kv').objectStore('kv').get(k);
          getReq.onsuccess = () => resolve(getReq.result);
          getReq.onerror = () => resolve(null);
        } catch(e) { resolve(null); }
      };
      req.onerror = () => resolve(null);
    });
  }, key);
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
  await page.locator(`nav .nav-btn[onclick*="'${tab}'"]`).click();
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
