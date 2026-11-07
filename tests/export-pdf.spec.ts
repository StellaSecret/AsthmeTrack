import { test, expect } from '@playwright/test';
import { seedMeasures, seedBestDEP, seedConditionEntries, goToTab, fakeMeasure, clearIDB } from './helpers';
import path from 'path';
import fs from 'fs';

test.describe('Export PDF', () => {

  test.beforeEach(async ({ page }, testInfo) => {
    const dbName = `ChroniTrackDB_worker_${testInfo.workerIndex}`;
    await page.addInitScript((name) => localStorage.setItem('__TEST_DB_NAME__', name), dbName);
    await clearIDB(page, dbName);
    await page.addInitScript(() => localStorage.clear());
    await page.addInitScript((name) => localStorage.setItem('__TEST_DB_NAME__', name), dbName);

    await seedMeasures(page, [
      fakeMeasure({ id: 1, dt: '2025-01-15T08:00', dep: 400, dep1: 390, dep2: 400, dep3: 410, spo2: 97, easy: 1, comment: 'Test matin' }),
      fakeMeasure({ id: 2, dt: '2025-01-16T08:00', dep: 380, dep1: 375, dep2: 380, dep3: 385, spo2: 96, easy: 2, comment: '' }),
    ]);
    await seedBestDEP(page, 450);
    await page.goto('/app/app.html');
  });

  test('le bouton PDF déclenche un téléchargement', async ({ page }) => {
    await goToTab(page, 'historique');

    await page.locator('.icon-btn[title="Exporter PDF"]').click();
    await expect(page.locator('#pdfModal')).toHaveClass(/open/);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#pdfModal [data-action="confirmExportPDF"]').click(),
    ]);

    expect(download).toBeTruthy();
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^asthmetrack_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  test('on peut choisir les catégories à exporter', async ({ page }) => {
    await seedConditionEntries(page, [{
      id: 'htn-1', conditionId: 'hypertension', type: 'measure',
      timestamp: '2025-01-17T08:00:00.000Z',
      data: { systolic: 120, diastolic: 80, pulse: 70 },
    }]);
    await page.goto('/app/app.html');
    await goToTab(page, 'historique');

    await page.locator('.icon-btn[title="Exporter PDF"]').click();
    const modal = page.locator('#pdfModal');
    await expect(modal).toHaveClass(/open/);
    await expect(modal.locator('.pdf-cond-row')).toHaveCount(3);
    await expect(modal.locator('input[value="hypertension"]')).toBeEnabled();
    await expect(modal.locator('input[value="diabetes"]')).toBeDisabled();

    await modal.locator('input[value="asthma"]').uncheck();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      modal.locator('[data-action="confirmExportPDF"]').click(),
    ]);
    expect(download.suggestedFilename()).toContain('.pdf');
  });

  test('le PDF contient les graphes asthme, tension et glycémie', async ({ page }) => {
    await seedConditionEntries(page, [
      { id: 'htn-1', conditionId: 'hypertension', type: 'measure', timestamp: '2025-01-17T08:00:00.000Z', data: { systolic: 120, diastolic: 80, pulse: 70 } },
      { id: 'htn-2', conditionId: 'hypertension', type: 'measure', timestamp: '2025-01-18T08:00:00.000Z', data: { systolic: 135, diastolic: 88, pulse: 75 } },
      { id: 'dm-1', conditionId: 'diabetes', type: 'measure', timestamp: '2025-01-17T07:00:00.000Z', data: { glucose: 110, unit: 'mg/dL', context: 'jeun' } },
      { id: 'dm-2', conditionId: 'diabetes', type: 'measure', timestamp: '2025-01-18T07:00:00.000Z', data: { glucose: 140, unit: 'mg/dL', context: 'post' } },
    ]);
    await page.goto('/app/app.html');
    await goToTab(page, 'historique');

    await page.locator('.icon-btn[title="Exporter PDF"]').click();
    const modal = page.locator('#pdfModal');
    await expect(modal.locator('input[value="hypertension"]')).toBeEnabled();
    await expect(modal.locator('input[value="diabetes"]')).toBeEnabled();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      modal.locator('[data-action="confirmExportPDF"]').click(),
    ]);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    const raw = fs.readFileSync(filePath!, 'latin1');

    const pages = (raw.match(/\/Type\s*\/Page\b/g) || []).length;
    const images = (raw.match(/\/Subtype\s*\/Image/g) || []).length;
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(images).toBeGreaterThanOrEqual(4);
    expect(raw).toContain('Tension art');
    expect(raw).toContain('Glyc');
  });

  test('le bouton PDF dans les réglages déclenche un téléchargement', async ({ page }) => {
    await goToTab(page, 'settings');

    await page.locator('button[data-action="exportPDF"]').last().click();
    await expect(page.locator('#pdfModal')).toHaveClass(/open/);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#pdfModal [data-action="confirmExportPDF"]').click(),
    ]);

    expect(download.suggestedFilename()).toContain('.pdf');
  });

  test('export PDF sur données vides affiche un toast d\'erreur', async ({ page }) => {
    // Override beforeEach seeding by clearing again
    await clearIDB(page);
    await page.goto('/app/app.html');
    await goToTab(page, 'historique');

    await page.locator('.icon-btn[title="Exporter PDF"]').click();

    const toast = page.locator('#toast.show');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Aucune donnée');
  });

  test('un toast de confirmation apparaît après l\'export', async ({ page }) => {
    await goToTab(page, 'historique');

    await page.locator('.icon-btn[title="Exporter PDF"]').click();
    await Promise.all([
      page.waitForEvent('download'),
      page.locator('#pdfModal [data-action="confirmExportPDF"]').click(),
    ]);

    const toast = page.locator('#toast.show');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('PDF');
  });

  test('le fichier PDF n\'est plus nommé .csv (régression)', async ({ page }) => {
    await goToTab(page, 'historique');

    await page.locator('.icon-btn[title="Exporter PDF"]').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#pdfModal [data-action="confirmExportPDF"]').click(),
    ]);

    expect(download.suggestedFilename()).not.toContain('.csv');
  });

});
