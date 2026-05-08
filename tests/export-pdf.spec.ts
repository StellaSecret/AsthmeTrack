import { test, expect } from '@playwright/test';
import { seedMeasures, seedBestDEP, goToTab, fakeMeasure } from './helpers';
import path from 'path';

test.describe('Export PDF', () => {

  test.beforeEach(async ({ page }) => {
    await seedMeasures(page, [
      fakeMeasure({ id: 1, dt: '2025-01-15T08:00', dep: 400, dep1: 390, dep2: 400, dep3: 410, spo2: 97, easy: 1, comment: 'Test matin' }),
      fakeMeasure({ id: 2, dt: '2025-01-16T08:00', dep: 380, dep1: 375, dep2: 380, dep3: 385, spo2: 96, easy: 2, comment: '' }),
    ]);
    await seedBestDEP(page, 450);
    await page.goto('/');
  });

  test('le bouton PDF déclenche un téléchargement', async ({ page }) => {
    await goToTab(page, 'historique');

    // Attend le téléchargement déclenché par le bouton dans l'historique
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.icon-btn[title="Exporter PDF"]').click(),
    ]);

    expect(download).toBeTruthy();
    const filename = download.suggestedFilename();
    expect(filename).toMatch(/^asthmetrack_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  test('le bouton PDF dans les réglages déclenche un téléchargement', async ({ page }) => {
    await goToTab(page, 'settings');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button[onclick="exportPDF()"]').last().click(),
    ]);

    expect(download.suggestedFilename()).toContain('.pdf');
  });

  test('export PDF sur données vides affiche un toast d\'erreur', async ({ page }) => {
    // Vide le localStorage avant navigation
    await page.addInitScript(() => {
      localStorage.removeItem('at_measures');
    });
    await page.goto('/');
    await goToTab(page, 'historique');

    await page.locator('.icon-btn[title="Exporter PDF"]').click();

    const toast = page.locator('#toast.show');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Aucune donnée');
  });

  test('un toast de confirmation apparaît après l\'export', async ({ page }) => {
    await goToTab(page, 'historique');

    await Promise.all([
      page.waitForEvent('download'),
      page.locator('.icon-btn[title="Exporter PDF"]').click(),
    ]);

    const toast = page.locator('#toast.show');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('PDF');
  });

  test('le fichier PDF n\'est plus nommé .csv (régression)', async ({ page }) => {
    await goToTab(page, 'historique');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.icon-btn[title="Exporter PDF"]').click(),
    ]);

    expect(download.suggestedFilename()).not.toContain('.csv');
  });

});
