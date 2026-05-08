import { Page } from '@playwright/test';

/**
 * Helpers partagés entre tous les tests AsthmeTrack.
 */

/** Injecte des mesures directement dans localStorage avant le chargement de la page. */
export async function seedMeasures(page: Page, measures: object[]) {
  await page.addInitScript((data) => {
    localStorage.setItem('at_measures', JSON.stringify(data));
  }, measures);
}

/** Injecte des rappels dans localStorage avant le chargement de la page. */
export async function seedReminders(page: Page, reminders: object[]) {
  await page.addInitScript((data) => {
    localStorage.setItem('at_reminders', JSON.stringify(data));
  }, reminders);
}

/** Injecte le meilleur DEP de référence. */
export async function seedBestDEP(page: Page, value: number) {
  await page.addInitScript((v) => {
    localStorage.setItem('at_bestDEP', String(v));
  }, value);
}

/** Navigue vers un onglet via le bouton de la barre de navigation.
 *  On cible .nav-btn[onclick*="'tab'"] plutôt que getByText() car les labels
 *  ("Mesure", "Historique"…) apparaissent aussi dans le contenu de la page,
 *  ce qui déclenche une violation de strict mode avec getByText. */
export async function goToTab(page: Page, tab: 'dashboard' | 'saisie' | 'historique' | 'settings') {
  await page.locator(`nav .nav-btn[onclick*="'${tab}'"]`).click();
  await page.waitForSelector(`#page-${tab}.active`);
}

/** Remplit et soumet le formulaire de saisie d'une mesure. */
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

  if (opts.datetime) {
    await page.locator('#inputDatetime').fill(opts.datetime);
  }

  await page.locator('#dep1').fill(String(opts.dep1));
  if (opts.dep2 !== undefined) await page.locator('#dep2').fill(String(opts.dep2));
  if (opts.dep3 !== undefined) await page.locator('#dep3').fill(String(opts.dep3));

  await page.locator('#inputSpO2').fill(String(opts.spo2));
  await page.locator(`.easyh-btn[data-val="${opts.easy}"]`).click();

  if (opts.comment) {
    await page.locator('#inputComment').fill(opts.comment);
  }

  await page.locator('button.btn-primary', { hasText: /enregistrer/i }).click();
}

/** Attend l'apparition d'un toast et retourne son texte. */
export async function waitForToast(page: Page): Promise<string> {
  const toast = page.locator('#toast.show');
  await toast.waitFor({ state: 'visible', timeout: 3000 });
  return toast.textContent() ?? '';
}

/** Fabrique une mesure factice avec des valeurs par défaut. */
export function fakeMeasure(overrides: Partial<{
  id: number;
  dt: string;
  dep: number;
  dep1: number;
  dep2: number;
  dep3: number;
  spo2: number;
  easy: number;
  comment: string;
}> = {}) {
  return {
    id: Date.now() + Math.random(),
    dt: '2025-01-15T08:00',
    dep: 400,
    dep1: 400,
    dep2: 400,
    dep3: 400,
    spo2: 97,
    easy: 1,
    comment: '',
    ...overrides,
  };
}
