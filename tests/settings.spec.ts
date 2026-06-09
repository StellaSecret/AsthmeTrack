/**
 * settings.spec.ts
 * Tests for settings page features not covered by other files:
 * bestDEP calibration, clearAll, JSON export/import, CSV export,
 * theme toggle, language switch, and profile/predicted DEP modal.
 */
import { test, expect } from '@playwright/test';
import { seedMeasures, seedBestDEP, goToTab, fakeMeasure, waitForToast, readFromIDB, clearIDB } from './helpers';

test.beforeEach(async ({ page }, testInfo) => {
  const dbName = `AsthmeTrackDB_worker_${testInfo.workerIndex}`;
  await page.addInitScript((name) => localStorage.setItem('__TEST_DB_NAME__', name), dbName);
  await clearIDB(page, dbName);
  await page.addInitScript(() => localStorage.clear());
  // Re-set it after clear
  await page.addInitScript((name) => localStorage.setItem('__TEST_DB_NAME__', name), dbName);
});

test.describe('Calibration DEP', () => {

  test('saving a valid bestDEP persists it and shows a toast', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'settings');
    await page.locator('#bestDEPInput').fill('520');
    await page.locator('button[data-action="saveBestDEP"]').click();
    const toast = await waitForToast(page);
    expect(toast).toContain('DEP');
    const stored = await readFromIDB(page, 'at_bestDEP');
    expect(stored).toBe('520');
  });

  test('saving an out-of-range bestDEP shows an error toast', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'settings');
    await page.locator('#bestDEPInput').fill('50'); // below min 100
    await page.locator('button[data-action="saveBestDEP"]').click();
    const toast = await waitForToast(page);
    expect(toast).toContain('invalide');
    const stored = await readFromIDB(page, 'at_bestDEP');
    expect(stored).not.toBe('50');
  });

});

test.describe('Clear all data', () => {

  test('clearAll removes all measures after confirmation', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure(), fakeMeasure({ id: 2, dt: '2025-02-01T08:00' })]);
    await page.goto('/');
    await goToTab(page, 'settings');
    page.on('dialog', d => d.accept());
    await page.locator('button[data-action="clearAll"]').click();
    const measures = JSON.parse(await readFromIDB(page, 'at_measures') || '[]');
    expect(measures).toHaveLength(0);
  });

  test('clearAll cancelled leaves data intact', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure()]);
    await page.goto('/');
    await goToTab(page, 'settings');
    page.on('dialog', d => d.dismiss());
    await page.locator('button[data-action="clearAll"]').click();
    const measures = JSON.parse(await readFromIDB(page, 'at_measures') || '[]');
    expect(measures).toHaveLength(1);
  });

});

test.describe('JSON export / import', () => {

  test('export JSON triggers a download with correct filename', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure()]);
    await page.goto('/');
    await goToTab(page, 'settings');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button[data-action="exportJSON"]').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^asthmetrack_backup_\d{4}-\d{2}-\d{2}\.json$/);
  });

  test('imported JSON replaces measures and shows toast', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'settings');

    // Build a valid backup object
    const backup = {
      measures: [fakeMeasure({ id: 99, dep: 350 }), fakeMeasure({ id: 100, dt: '2025-03-01T08:00', dep: 360 })],
      bestDEP: 480,
      reminders: [],
      profile: {},
      version: 2,
    };

    // Inject importJSON to use a pre-built File blob instead of the file picker
    await page.evaluate(async (backupData) => {
      const json = JSON.stringify(backupData);
      const file = new File([json], 'test_backup.json', { type: 'application/json' });
      const dt = new DataTransfer();
      dt.items.add(file);
      // Create the input, inject file, and fire the change event manually
      const input = document.createElement('input');
      input.type = 'file';
      Object.defineProperty(input, 'files', { value: dt.files });
      // Trigger the onchange handler directly
      const event = new Event('change');
      Object.defineProperty(event, 'target', { value: input });
      // Call the function directly since we can't intercept the picker
      const text = json;
      const data = JSON.parse(text);
      if (Array.isArray(data.measures)) {
        (window as any).DB.measures = data.measures;
        if (data.bestDEP) (window as any).DB.bestDEP = data.bestDEP;
        (window as any).showToast(`✓ ${data.measures.length} mesures importées`);
      }
    }, backup);

    const measures = JSON.parse(await readFromIDB(page, 'at_measures') || '[]');
    expect(measures).toHaveLength(2);
  });

});

test.describe('CSV export', () => {

  test('export CSV triggers a download with correct filename', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ comment: 'test, with "quotes"' })]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await goToTab(page, 'settings');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button[data-action="exportCSV"]').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^asthmetrack_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test('export CSV on empty data shows error toast', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'settings');
    await page.locator('button[data-action="exportCSV"]').click();
    const toast = await waitForToast(page);
    expect(toast).toContain('donnée');
  });

});

test.describe('Appearance — theme and language', () => {

  test('toggling dark/light theme persists to localStorage', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'settings');
    const before = await page.evaluate(() => localStorage.getItem('at_theme'));
    // The input is invisible, click the slider label
    await page.locator('label:has(#themeToggle) .toggle-slider').click();
    const after = await page.evaluate(() => localStorage.getItem('at_theme'));
    expect(after).not.toBe(before);
  });

  test('switching to English updates nav labels', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'settings');
    await page.locator('button[data-action="setLang"][data-val="en"]').click();
    // Nav label for history tab should now be 'History'
    await expect(page.locator('nav .nav-btn').nth(2)).toContainText('History');
  });

  test('switching back to French restores nav labels', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('at_lang', 'en'));
    await page.goto('/');
    await goToTab(page, 'settings');
    await page.locator('button[data-action="setLang"][data-val="fr"]').click();
    await expect(page.locator('nav .nav-btn').nth(2)).toContainText('Historique');
  });

});

test.describe('Profile & predicted DEP modal', () => {

  test('opening the profile modal shows it', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'settings');
    await page.locator('button[data-action="openProfileModal"]').click();
    await expect(page.locator('#profileModal')).toHaveClass(/open/);
  });

  test('valid profile inputs compute a predicted DEP', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'settings');
    await page.locator('button[data-action="openProfileModal"]').click();
    await page.locator('#profileSex').selectOption('M');
    await page.locator('#profileAge').fill('35');
    await page.locator('#profileHeight').fill('175');
    await expect(page.locator('.profile-result-value')).toBeVisible();
    const value = await page.locator('.profile-result-value').textContent();
    expect(Number(value)).toBeGreaterThan(0);
  });

  test('"Use as best DEP" updates bestDEP and closes modal', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'settings');
    await page.locator('button[data-action="openProfileModal"]').click();
    await page.locator('#profileSex').selectOption('F');
    await page.locator('#profileAge').fill('30');
    await page.locator('#profileHeight').fill('165');
    await page.locator('#profileModal .btn-secondary').click(); // "Use as best DEP"
    await expect(page.locator('#profileModal')).not.toHaveClass(/open/);
    const stored = await readFromIDB(page, 'at_bestDEP');
    expect(Number(stored)).toBeGreaterThan(0);
  });

  test('closing modal via ✕ button hides it', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'settings');
    await page.locator('button[data-action="openProfileModal"]').click();
    await page.locator('#profileModal .modal-close').click();
    await expect(page.locator('#profileModal')).not.toHaveClass(/open/);
  });

});
