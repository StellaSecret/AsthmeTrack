import { test, expect } from '@playwright/test';
import {
  seedMeasures, seedBestDEP, seedReminders, seedProfile,
  seedLang, seedTheme, seedFont,
  goToTab, addMeasure, waitForToast,
  fakeMeasure, fakeMeasureSequence,
  readFromIDB, clearIDB
} from './helpers';

test.beforeEach(async ({ page }, testInfo) => {
  const dbName = `AsthmeTrackDB_worker_${testInfo.workerIndex}`;
  await page.addInitScript((name) => localStorage.setItem('__TEST_DB_NAME__', name), dbName);
  await clearIDB(page, dbName);
  await page.addInitScript(() => localStorage.clear());
  // Re-set it after clear
  await page.addInitScript((name) => localStorage.setItem('__TEST_DB_NAME__', name), dbName);
});

// ─────────────────────────────────────────────────────────────────────────────
//  SMOKE & NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Smoke & navigation', () => {

  test('page loads with no JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/app/app.html');
    expect(errors).toHaveLength(0);
  });

  test('dashboard tab is active by default', async ({ page }) => {
    await page.goto('/app/app.html');
    await expect(page.locator('#page-dashboard')).toHaveClass(/active/);
  });

  test('all four tabs navigate correctly', async ({ page }) => {
    await page.goto('/app/app.html');
    for (const tab of ['saisie', 'historique', 'settings'] as const) {
      await goToTab(page, tab);
      await expect(page.locator(`#page-${tab}`)).toHaveClass(/active/);
    }
  });

  test('empty dashboard shows empty-state', async ({ page }) => {
    await page.goto('/app/app.html');
    await page.waitForSelector('#dashboardContent .empty-state');
    await expect(page.locator('.empty-state')).toBeVisible();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  MEASURE FORM — happy paths
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Measure form — happy paths', () => {

  test('saving a valid measure redirects to dashboard', async ({ page }) => {
    await seedBestDEP(page, 450);
    await page.goto('/app/app.html');
    await addMeasure(page, { datetime: '2025-01-15T08:00', dep1: 380, dep2: 390, dep3: 400, spo2: 97, easy: 1 });
    await page.waitForSelector('#page-dashboard.active', { timeout: 3000 });
    await expect(page.locator('#page-dashboard')).toHaveClass(/active/);
  });

  test('saved measure appears in history', async ({ page }) => {
    await seedBestDEP(page, 450);
    await page.goto('/app/app.html');
    await addMeasure(page, { datetime: '2025-06-15T09:00', dep1: 410, dep2: 420, dep3: 415, spo2: 98, easy: 2, comment: 'Good day' });
    await page.waitForSelector('#page-dashboard.active');
    await goToTab(page, 'historique');
    await expect(page.locator('.history-item')).toHaveCount(1);
    await expect(page.locator('.history-item').first()).toContainText('415');
  });

  test('3-blow DEP average is computed and shown', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'saisie');
    await page.locator('#dep1').fill('300');
    await page.locator('#dep2').fill('360');
    await page.locator('#dep3').fill('330');
    // average = 330
    await expect(page.locator('#depAvgValue')).toContainText('330');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  MEASURE FORM — validation
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Measure form — validation', () => {

  test('missing SpO2 blocks save and shows toast', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'saisie');
    await page.locator('#page-saisie #dep1').fill('380');
    await page.locator('#page-saisie .easyh-btn[data-val="1"]').click();
    await page.locator('#page-saisie button.btn-primary').click();
    await expect(page.locator('#toast.show')).toBeVisible();
    await expect(page.locator('#page-saisie')).toHaveClass(/active/);
  });

  test('missing Easyhaler selection blocks save', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'saisie');
    await page.locator('#page-saisie #dep1').fill('380');
    await page.locator('#page-saisie #inputSpO2').fill('97');
    await page.locator('#page-saisie button.btn-primary').click();
    await expect(page.locator('#toast.show')).toBeVisible();
  });

  test('SpO2 out of range (< 70) shows error toast', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'saisie');
    await page.locator('#page-saisie #dep1').fill('380');
    await page.locator('#page-saisie #inputSpO2').fill('60');
    await page.locator('#page-saisie .easyh-btn[data-val="1"]').click();
    await page.locator('#page-saisie button.btn-primary').click();
    await expect(page.locator('#toast.show')).toBeVisible();
  });

  test('DEP out of range shows dep-hint span', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'saisie');
    await page.locator('#page-saisie #dep1').fill('20'); // below 50
    await expect(page.locator('#page-saisie #depHint1')).toHaveClass(/visible/);
  });

  test('DEP out of range input gets dep-invalid class', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'saisie');
    await page.locator('#page-saisie #dep1').fill('999'); // above 900
    await expect(page.locator('#page-saisie #dep1')).toHaveClass(/dep-invalid/);
  });

  test('validation failure adds field-error shake to SpO2 field', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'saisie');
    await page.locator('#page-saisie #dep1').fill('380');
    await page.locator('#page-saisie #inputSpO2').fill('200'); // invalid
    await page.locator('#page-saisie .easyh-btn[data-val="1"]').click();
    await page.locator('#page-saisie button.btn-primary').click();
    const field = page.locator('#page-saisie .field:has(#inputSpO2)');
    await expect(field).toHaveClass(/field-error/);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  HISTORY
// ─────────────────────────────────────────────────────────────────────────────
test.describe('History', () => {

  test('displays all seeded measures', async ({ page }) => {
    await seedMeasures(page, [
      fakeMeasure({ id: 1, dt: '2025-01-15T08:00', dep: 380 }),
      fakeMeasure({ id: 2, dt: '2025-01-16T08:00', dep: 410 }),
    ]);
    await seedBestDEP(page, 450);
    await page.goto('/app/app.html');
    await goToTab(page, 'historique');
    await expect(page.locator('.history-item')).toHaveCount(2);
  });

  test('empty history shows CTA button that navigates to measure form', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'historique');
    const cta = page.locator('.empty-state-cta');
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page.locator('#page-saisie')).toHaveClass(/active/);
  });

  test('edit modal opens and saves updated DEP', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ id: 1, dep: 380, dep1: 380, dep2: 380, dep3: 380 })]);
    await seedBestDEP(page, 450);
    await page.goto('/app/app.html');
    await goToTab(page, 'historique');
    await page.locator('.history-item .icon-action-btn.edit').first().click();
    await expect(page.locator('#editModal')).toHaveClass(/open/);
    await page.locator('#editDep1').fill('420');
    await page.locator('#editDep2').fill('420');
    await page.locator('#editDep3').fill('420');
    await page.locator('#editModal .btn-primary').click();
    const measures = JSON.parse(await readFromIDB(page, 'at_measures') || '[]');
    expect(measures[0].dep).toBe(420);
  });

  test('edit modal rejects a future date', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ id: 1 })]);
    await seedBestDEP(page, 450);
    await page.goto('/app/app.html');
    await goToTab(page, 'historique');
    await page.locator('.history-item .icon-action-btn.edit').first().click();
    await page.locator('#editDatetime').fill('2099-01-01T00:00');
    await page.locator('#editModal .btn-primary').click();
    await expect(page.locator('#toast.show')).toBeVisible();
    await expect(page.locator('#editModal')).toHaveClass(/open/); // still open
  });

  test('delete measure removes it from history', async ({ page }) => {
    await seedMeasures(page, [
      fakeMeasure({ id: 1, dt: '2025-01-14T08:00' }),
      fakeMeasure({ id: 2, dt: '2025-01-15T08:00' }),
    ]);
    await seedBestDEP(page, 450);
    await page.goto('/app/app.html');
    await goToTab(page, 'historique');
    await expect(page.locator('.history-item')).toHaveCount(2);
    page.on('dialog', d => d.accept());
    await page.locator('.history-item .icon-action-btn.del').first().click();
    await expect(page.locator('.history-item')).toHaveCount(1);
  });

  test('history items have swipe background element', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure()]);
    await seedBestDEP(page, 450);
    await page.goto('/app/app.html');
    await goToTab(page, 'historique');
    await expect(page.locator('.history-swipe-bg').first()).toBeAttached();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  HISTORY PAGINATION (#10)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('History Pagination', () => {

  test('load more button appears and loads next page', async ({ page }) => {
    // Seed 45 measures (HISTORY_PAGE_SIZE is 30)
    const measures = Array.from({ length: 45 }, (_, i) => fakeMeasure({ id: i, dt: new Date(Date.now() - i * 3600000).toISOString() }));
    await seedMeasures(page, measures);
    await page.goto('/app/app.html');
    await goToTab(page, 'historique');

    // Should show 30 items initially
    await expect(page.locator('.history-item')).toHaveCount(30);

    // Button should show "Afficher plus (15)" or "Load more (15)"
    const loadBtn = page.locator('button.btn-secondary', { hasText: /Afficher plus|Load more/ });
    await expect(loadBtn).toBeVisible();
    await expect(loadBtn).toContainText('15');

    // Click to load more
    await loadBtn.click();
    await expect(page.locator('.history-item')).toHaveCount(45);
    await expect(loadBtn).not.toBeVisible();
  });

  test('page reset on delete ensures consistent view', async ({ page }) => {
    // Seed 35 measures. Page 1 shows 30.
    const measures = Array.from({ length: 35 }, (_, i) => fakeMeasure({ id: i, dt: new Date(Date.now() - i * 3600000).toISOString() }));
    await seedMeasures(page, measures);
    await page.goto('/app/app.html');
    await goToTab(page, 'historique');

    // Click load more to show all 35
    await page.locator('button.btn-secondary', { hasText: /Afficher plus|Load more/ }).click();
    await expect(page.locator('.history-item')).toHaveCount(35);

    // Delete one item
    page.on('dialog', d => d.accept());
    await page.locator('.history-item .icon-action-btn.del').first().click();

    // After delete, the list should be re-rendered and reset to page 1 size (30)
    await expect(page.locator('.history-item')).toHaveCount(30);
    // Button should now show "Afficher plus (4)"
    await expect(page.locator('button.btn-secondary', { hasText: /Afficher plus|Load more/ })).toContainText('4');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  DASHBOARD — metrics, zones, trend, crisis
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Dashboard — metrics & zones', () => {

  test('shows DEP of most recent measure', async ({ page }) => {
    await seedMeasures(page, [
      fakeMeasure({ id: 1, dt: '2025-01-14T08:00', dep: 320 }),
      fakeMeasure({ id: 2, dt: '2025-01-15T08:00', dep: 440 }),
    ]);
    await seedBestDEP(page, 450);
    await page.goto('/app/app.html');
    await page.waitForSelector('#dashboardContent .metric-value');
    await expect(page.locator('.metric-value').first()).toContainText('440');
  });

  test('green zone when DEP >= 80% of best', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ dep: 340 })]);
    await seedBestDEP(page, 400); // 340/400 = 85%
    await page.goto('/app/app.html');
    await page.waitForSelector('#dashboardContent .metric-box');
    await expect(page.locator('.metric-box.green').first()).toBeVisible();
  });

  test('yellow zone when DEP is 60–80% of best', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ dep: 280 })]);
    await seedBestDEP(page, 400); // 280/400 = 70%
    await page.goto('/app/app.html');
    await page.waitForSelector('#dashboardContent .metric-box');
    await expect(page.locator('.metric-box.yellow').first()).toBeVisible();
  });

  test('red zone when DEP < 60% of best', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ dep: 220 })]);
    await seedBestDEP(page, 500); // 220/500 = 44%
    await page.goto('/app/app.html');
    await page.waitForSelector('#dashboardContent .metric-box');
    await expect(page.locator('.metric-box.red').first()).toBeVisible();
  });

  test('dose count shows on dashboard', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ easy: 3 })]);
    await seedBestDEP(page, 400);
    await page.goto('/app/app.html');
    await page.waitForSelector('#dashboardContent .metric-value');
    await expect(page.locator('#dashboardContent')).toContainText('3');
  });

});

test.describe('Dashboard — crisis banner', () => {

  test('crisis banner shown when last 2 readings are red zone', async ({ page }) => {
    // 2 consecutive red readings (DEP way below 60% of best)
    await seedMeasures(page, fakeMeasureSequence(2, 100, 97)); // dep=100, best=500 → 20%
    await seedBestDEP(page, 500);
    await page.goto('/app/app.html');
    await page.waitForSelector('#dashboardContent');
    await expect(page.locator('.crisis-banner')).toBeVisible();
  });

  test('crisis banner NOT shown when last 2 readings are green zone', async ({ page }) => {
    await seedMeasures(page, fakeMeasureSequence(2, 420, 97)); // dep=420, best=500 → 84%
    await seedBestDEP(page, 500);
    await page.goto('/app/app.html');
    await page.waitForSelector('#dashboardContent .metric-value');
    await expect(page.locator('.crisis-banner')).not.toBeVisible();
  });

  test('crisis banner NOT shown with only 1 red reading', async ({ page }) => {
    await seedMeasures(page, [
      fakeMeasure({ dt: new Date(Date.now() - 1000).toISOString(), dep: 100 }), // red
      fakeMeasure({ dt: new Date(Date.now() - 2000).toISOString(), dep: 420 }), // green
    ]);
    await seedBestDEP(page, 500);
    await page.goto('/app/app.html');
    await page.waitForSelector('#dashboardContent .metric-value');
    await expect(page.locator('.crisis-banner')).not.toBeVisible();
  });

});

test.describe('Dashboard — trend arrows', () => {

  test('up arrow shown when last 3 days DEP improved vs previous 3 days', async ({ page }) => {
    const now = Date.now();
    const measures = [
      // last 3 days: high DEP (good)
      ...Array.from({ length: 3 }, (_, i) => fakeMeasure({
        id: now + i, dep: 420,
        dt: new Date(now - i * 24 * 3600 * 1000).toISOString(),
      })),
      // previous 3 days: low DEP
      ...Array.from({ length: 3 }, (_, i) => fakeMeasure({
        id: now - 10000 + i, dep: 300,
        dt: new Date(now - (3 + i) * 24 * 3600 * 1000).toISOString(),
      })),
    ];
    await seedMeasures(page, measures);
    await seedBestDEP(page, 500);
    await page.goto('/app/app.html');
    await page.waitForSelector('#dashboardContent .metric-value');
    await expect(page.locator('.trend-up').first()).toBeVisible();
  });

  test('down arrow shown when last 3 days DEP worsened', async ({ page }) => {
    const now = Date.now();
    const measures = [
      ...Array.from({ length: 3 }, (_, i) => fakeMeasure({
        id: now + i, dep: 280,
        dt: new Date(now - i * 24 * 3600 * 1000).toISOString(),
      })),
      ...Array.from({ length: 3 }, (_, i) => fakeMeasure({
        id: now - 10000 + i, dep: 420,
        dt: new Date(now - (3 + i) * 24 * 3600 * 1000).toISOString(),
      })),
    ];
    await seedMeasures(page, measures);
    await seedBestDEP(page, 500);
    await page.goto('/app/app.html');
    await page.waitForSelector('#dashboardContent .metric-value');
    await expect(page.locator('.trend-down').first()).toBeVisible();
  });

  test('flat arrow shown when change is < 3%', async ({ page }) => {
    const now = Date.now();
    const measures = [
      ...Array.from({ length: 3 }, (_, i) => fakeMeasure({
        id: now + i, dep: 401,
        dt: new Date(now - i * 24 * 3600 * 1000).toISOString(),
      })),
      ...Array.from({ length: 3 }, (_, i) => fakeMeasure({
        id: now - 10000 + i, dep: 400,
        dt: new Date(now - (3 + i) * 24 * 3600 * 1000).toISOString(),
      })),
    ];
    await seedMeasures(page, measures);
    await seedBestDEP(page, 500);
    await page.goto('/app/app.html');
    await page.waitForSelector('#dashboardContent .metric-value');
    await expect(page.locator('.trend-flat').first()).toBeVisible();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  SETTINGS — best DEP, clear, reminders
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Settings — best DEP & reminders', () => {

  test('saving a valid best DEP persists it', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('#bestDEPInput').fill('480');
    await page.locator('#page-settings button.btn-primary').click();
    const saved = await readFromIDB(page, 'at_bestDEP');
    expect(Number(saved)).toBe(480);
  });

  test('saving an invalid best DEP (< 100) shows error toast', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('#bestDEPInput').fill('50');
    await page.locator('#page-settings button.btn-primary').click();
    await expect(page.locator('#toast.show')).toBeVisible();
  });

  test('clearAll wipes localStorage and shows empty dashboard', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure(), fakeMeasure({ id: 2 })]);
    await seedBestDEP(page, 450);
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    page.on('dialog', d => d.accept());
    await page.locator('button.btn-secondary', { hasText: /Effacer|Delete/ }).click();
    const measures = await readFromIDB(page, 'at_measures');
    expect(JSON.parse(measures || '[]')).toHaveLength(0);
  });

  test('adding a reminder persists and renders it', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('#reminderTime').fill('08:30');
    await page.locator('#reminderLabel').fill('Matin');
    await page.locator('button.btn-secondary', { hasText: /Ajouter|Add/ }).click();
    const reminders = JSON.parse(await readFromIDB(page, 'at_reminders') || '[]');
    expect(reminders).toHaveLength(1);
    expect(reminders[0].time).toBe('08:30');
  });

  test('reminder without a time shows error toast', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('#reminderLabel').fill('Matin');
    await page.locator('button.btn-secondary', { hasText: /Ajouter|Add/ }).click();
    await expect(page.locator('#toast.show')).toBeVisible();
  });

  test('deleting a reminder removes it', async ({ page }) => {
    await seedReminders(page, [{ id: 1, time: '08:00', label: 'Matin' }]);
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('.reminder-del').first().click();
    const reminders = JSON.parse(await readFromIDB(page, 'at_reminders') || '[]');
    expect(reminders).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  SETTINGS — predicted DEP / profile modal
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Settings — predicted DEP profile modal', () => {

  test('profile modal opens from settings', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('button.btn-secondary', { hasText: /Calculer|Calculate/ }).first().click();
    await expect(page.locator('#profileModal')).toHaveClass(/open/);
  });

  test('predicted DEP result renders for male 35yo 175cm', async ({ page }) => {
    // Male, 35, 175 cm → Quanjer: ((1.75*5.48+1.58)-(35*0.041))*60 ≈ 606
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('button.btn-secondary', { hasText: /Calculer|Calculate/ }).first().click();
    await page.locator('#profileSex').selectOption('M');
    await page.locator('#profileAge').fill('35');
    await page.locator('#profileHeight').fill('175');
    const resultText = await page.locator('#profileResult').textContent();
    // result should contain a number in 550–660 range
    const match = resultText?.match(/\d{3}/);
    expect(match).not.toBeNull();
    const val = parseInt(match![0]);
    expect(val).toBeGreaterThan(550);
    expect(val).toBeLessThan(660);
  });

  test('predicted DEP result renders for female 50yo 162cm', async ({ page }) => {
    // Female, 50, 162 cm → Quanjer: ((1.62*3.72+2.24)-(50*0.030))*60 ≈ 421
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('button.btn-secondary', { hasText: /Calculer|Calculate/ }).first().click();
    await page.locator('#profileSex').selectOption('F');
    await page.locator('#profileAge').fill('50');
    await page.locator('#profileHeight').fill('162');
    const resultText = await page.locator('#profileResult').textContent();
    const match = resultText?.match(/\d{3}/);
    expect(match).not.toBeNull();
    const val = parseInt(match![0]);
    expect(val).toBeGreaterThan(370);
    expect(val).toBeLessThan(470);
  });

  test('profile modal closes on backdrop click', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('button.btn-secondary', { hasText: /Calculer|Calculate/ }).first().click();
    await expect(page.locator('#profileModal')).toHaveClass(/open/);
    await page.locator('#profileModal').click({ position: { x: 5, y: 5 } }); // click backdrop
    await expect(page.locator('#profileModal')).not.toHaveClass(/open/);
  });

  test('"use as best DEP" sets bestDEP in localStorage', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('button.btn-secondary', { hasText: /Calculer|Calculate/ }).first().click();
    await page.locator('#profileSex').selectOption('M');
    await page.locator('#profileAge').fill('40');
    await page.locator('#profileHeight').fill('180');
    // wait for result to render with the button
    await page.waitForSelector('#profileResult button');
    await page.locator('#profileResult button').click();
    const saved = await readFromIDB(page, 'at_bestDEP');
    expect(Number(saved)).toBeGreaterThan(0);
  });

  test('profile is saved to localStorage when fields are filled', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('button.btn-secondary', { hasText: /Calculer|Calculate/ }).first().click();
    await page.locator('#profileSex').selectOption('F');
    await page.locator('#profileAge').fill('45');
    await page.locator('#profileHeight').fill('165');
    const profile = JSON.parse(await readFromIDB(page, 'at_profile') || '{}');
    expect(profile.sex).toBe('F');
    expect(profile.age).toBe(45);
    expect(profile.height).toBe(165);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  i18n — language switch
// ─────────────────────────────────────────────────────────────────────────────
test.describe('i18n — language switch', () => {

  test('default language is French', async ({ page }) => {
    await page.goto('/app/app.html');
    await page.waitForSelector('#dashboardContent');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  });

  test('switching to EN updates html[lang]', async ({ page }) => {
    await seedLang(page, 'en');
    await page.goto('/app/app.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('switching to EN translates measure form labels', async ({ page }) => {
    await seedLang(page, 'en');
    await page.goto('/app/app.html');
    await goToTab(page, 'saisie');
    // "Prises Easyhaler" → "Easyhaler doses"
    await expect(page.locator('#page-saisie')).toContainText('Easyhaler doses');
  });

  test('switching to EN translates settings labels', async ({ page }) => {
    await seedLang(page, 'en');
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await expect(page.locator('#settingsContent')).toContainText('PEF Calibration');
  });

  test('language switch from settings re-renders current page', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    // Click EN button
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.locator('#settingsContent')).toContainText('Appearance');
  });

  test('language choice persists after page reload', async ({ page }) => {
    await seedLang(page, 'en');
    await page.goto('/app/app.html');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('switching to EN translates empty history state', async ({ page }) => {
    await seedLang(page, 'en');
    await page.goto('/app/app.html');
    await goToTab(page, 'historique');
    await expect(page.locator('#page-historique .empty-state')).toContainText('No measurements');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  THEME toggle
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Theme toggle', () => {

  test('default theme is dark (data-theme=dark)', async ({ page }) => {
    await page.goto('/app/app.html');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('seedTheme light sets data-theme=light on load', async ({ page }) => {
    await seedTheme(page, 'light');
    await page.goto('/app/app.html');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('toggle in settings switches to light theme', async ({ page }) => {
    await seedTheme(page, 'dark');
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    const toggle = page.locator('#themeToggle');
    await page.locator('label:has(#themeToggle) .toggle-slider').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('theme persists after reload', async ({ page }) => {
    await seedTheme(page, 'light');
    await page.goto('/app/app.html');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('theme choice stored in localStorage', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('label:has(#themeToggle) .toggle-slider').click();
    const stored = await page.evaluate(() => localStorage.getItem('at_theme'));
    expect(stored).toBe('light');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  FONT toggle
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Font toggle', () => {

  test('default font is custom (Lexend)', async ({ page }) => {
    await page.goto('/app/app.html');
    const fontMono = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--font-mono')
    );
    expect(fontMono).toContain('Lexend');
  });

  test('selecting System switches to system sans-serif stack', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('#settingsContent button', { hasText: /Système|System/ }).click();
    const fontMono = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--font-mono')
    );
    expect(fontMono).toContain('-apple-system');
  });

  test('selecting Lexend switches the font stack', async ({ page }) => {
    await seedFont(page, 'system');
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('#settingsContent button', { hasText: 'Lexend' }).click();
    const fontMono = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--font-mono')
    );
    expect(fontMono).toContain('Lexend');
  });

  test('font choice persists in localStorage', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('#settingsContent button', { hasText: /Système|System/ }).click();
    const stored = await page.evaluate(() => localStorage.getItem('at_font'));
    expect(stored).toBe('system');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  OFFLINE BANNER
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Offline banner', () => {

  test('offline banner not visible when online', async ({ page }) => {
    await page.goto('/app/app.html');
    await expect(page.locator('#offlineBanner')).not.toHaveClass(/visible/);
  });

  test('offline banner becomes visible when network is offline', async ({ page }) => {
    await page.goto('/app/app.html');
    await page.context().setOffline(true);
    // trigger the event
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.locator('#offlineBanner')).toHaveClass(/visible/);
    await page.context().setOffline(false);
  });

  test('offline banner hides again when network comes back', async ({ page }) => {
    await page.goto('/app/app.html');
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.locator('#offlineBanner')).toHaveClass(/visible/);
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('#offlineBanner')).not.toHaveClass(/visible/);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  JSON EXPORT / IMPORT
// ─────────────────────────────────────────────────────────────────────────────
test.describe('JSON export / import', () => {

  test('export JSON triggers a file download', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure()]);
    await seedBestDEP(page, 450);
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button.btn-secondary', { hasText: /JSON/ }).first().click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/asthmetrack_backup.*\.json/);
  });

  test('exported JSON contains measures and profile', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ dep: 410 })]);
    await seedBestDEP(page, 450);
    await seedProfile(page, { sex: 'M', age: 40, height: 175 });
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button.btn-secondary', { hasText: /JSON/ }).first().click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const parsed = JSON.parse(Buffer.concat(chunks).toString());
    expect(parsed.measures).toHaveLength(1);
    expect(parsed.measures[0].dep).toBe(410);
    expect(parsed.profile.sex).toBe('M');
    expect(parsed.version).toBe(2);
  });

  test('importing invalid JSON shows error toast', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    // intercept the file chooser and provide invalid JSON
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('button.btn-secondary', { hasText: /Importer|Import/ }).click(),
    ]);
    await fileChooser.setFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ "not_measures": [] }'),
    });
    await expect(page.locator('#toast.show')).toBeVisible();
  });

  test('importing valid JSON restores measures and profile', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    const payload = JSON.stringify({
      measures: [fakeMeasure({ id: 99, dep: 375 })],
      bestDEP: 480,
      reminders: [],
      profile: { sex: 'F', age: 35, height: 160 },
      version: 2,
    });
    page.on('dialog', d => d.accept()); // confirm overwrite
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('button.btn-secondary', { hasText: /Importer|Import/ }).click(),
    ]);
    await fileChooser.setFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(payload),
    });
    await expect(page.locator('#toast.show')).toBeVisible();
    const measures = JSON.parse(await readFromIDB(page, 'at_measures') || '[]');
    expect(measures).toHaveLength(1);
    expect(measures[0].dep).toBe(375);
    const profile = JSON.parse(await readFromIDB(page, 'at_profile') || '{}');
    expect(profile.sex).toBe('F');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  CSV EXPORT
// ─────────────────────────────────────────────────────────────────────────────
test.describe('CSV export', () => {

  test('CSV export triggers a download', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure()]);
    await seedBestDEP(page, 450);
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button.btn-secondary', { hasText: /CSV/ }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/asthmetrack.*\.csv/);
  });

  test('CSV content has header row and one data row', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ dep: 410, spo2: 96 })]);
    await seedBestDEP(page, 500);
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button.btn-secondary', { hasText: /CSV/ }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const csv = Buffer.concat(chunks).toString().replace(/^\uFEFF/, ''); // strip BOM
    const lines = csv.trim().split(/\r?\n/);
    expect(lines.length).toBe(2); // header + 1 row
    expect(lines[1]).toContain('410');
    expect(lines[1]).toContain('96');
  });

  test('CSV export with no data shows error toast', async ({ page }) => {
    await page.goto('/app/app.html');
    await goToTab(page, 'settings');
    await page.locator('button.btn-secondary', { hasText: /CSV/ }).click();
    await expect(page.locator('#toast.show')).toBeVisible();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
//  PREDICTED DEP — formula correctness (pure logic, no UI)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Predicted DEP — Quanjer formula', () => {

  test('male 35yo 175cm gives ~584 L/min', async ({ page }) => {
    await page.goto('/app/app.html');
    const result = await page.evaluate(() => {
      // @ts-ignore
      return window.predictedDEP('M', 35, 175);
    });
    expect(result).toBeGreaterThanOrEqual(570);
    expect(result).toBeLessThanOrEqual(600);
  });

  test('female 50yo 162cm gives ~406 L/min', async ({ page }) => {
    await page.goto('/app/app.html');
    const result = await page.evaluate(() => {
      // @ts-ignore
      return window.predictedDEP('F', 50, 162);
    });
    expect(result).toBeGreaterThanOrEqual(390);
    expect(result).toBeLessThanOrEqual(425);
  });

  test('female always returns lower value than male with same inputs', async ({ page }) => {
    await page.goto('/app/app.html');
    const [m, f] = await page.evaluate(() => [
      // @ts-ignore
      window.predictedDEP('M', 40, 170),
      // @ts-ignore
      window.predictedDEP('F', 40, 170),
    ]);
    expect(m).toBeGreaterThan(f);
  });

});
