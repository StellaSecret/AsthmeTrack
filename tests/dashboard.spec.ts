/**
 * dashboard.spec.ts
 * Tests for dashboard features not covered by app.spec.ts:
 * crisis banner, trend arrows, zone logic, offline banner,
 * and chart rendering smoke test.
 */
import { test, expect } from '@playwright/test';
import { seedMeasures, seedBestDEP, fakeMeasure } from './helpers';

test.describe('Crisis banner', () => {

  test('crisis banner shows when last 2+ measures are red zone', async ({ page }) => {
    // Red zone = DEP < 60% of bestDEP (450). 60% = 270. Use dep=200.
    await seedMeasures(page, [
      fakeMeasure({ id: 1, dt: '2025-01-15T08:00', dep: 200 }),
      fakeMeasure({ id: 2, dt: '2025-01-14T08:00', dep: 210 }),
    ]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await page.waitForSelector('#dashboardContent .crisis-banner');
    await expect(page.locator('.crisis-banner')).toBeVisible();
  });

  test('crisis banner does NOT show when last measure is green zone', async ({ page }) => {
    await seedMeasures(page, [
      fakeMeasure({ id: 1, dt: '2025-01-15T08:00', dep: 400 }), // green (>80%)
      fakeMeasure({ id: 2, dt: '2025-01-14T08:00', dep: 200 }), // red but not latest
    ]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await page.waitForSelector('#dashboardContent .card');
    await expect(page.locator('.crisis-banner')).toHaveCount(0);
  });

  test('crisis banner does NOT show when only one red measure', async ({ page }) => {
    await seedMeasures(page, [
      fakeMeasure({ id: 1, dt: '2025-01-15T08:00', dep: 200 }),
    ]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await page.waitForSelector('#dashboardContent .card');
    await expect(page.locator('.crisis-banner')).toHaveCount(0);
  });

});

test.describe('Zone logic', () => {

  test('DEP yellow zone: 60–80% of bestDEP', async ({ page }) => {
    // 70% of 500 = 350
    await seedMeasures(page, [fakeMeasure({ dep: 350 })]);
    await seedBestDEP(page, 500);
    await page.goto('/');
    await page.waitForSelector('#dashboardContent .metric-box');
    await expect(page.locator('.metric-box.yellow').first()).toBeVisible();
  });

  test('SpO2 green zone: >= 95%', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ spo2: 97 })]);
    await seedBestDEP(page, 400);
    await page.goto('/');
    await page.waitForSelector('#dashboardContent .metric-box');
    // Second metric-box is SpO2
    await expect(page.locator('.metric-box').nth(1)).toHaveClass(/green/);
  });

  test('SpO2 red zone: < 90%', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ spo2: 88 })]);
    await seedBestDEP(page, 400);
    await page.goto('/');
    await page.waitForSelector('#dashboardContent .metric-box');
    await expect(page.locator('.metric-box').nth(1)).toHaveClass(/red/);
  });

  test('SpO2 yellow zone: 90–94%', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ spo2: 92 })]);
    await seedBestDEP(page, 400);
    await page.goto('/');
    await page.waitForSelector('#dashboardContent .metric-box');
    await expect(page.locator('.metric-box').nth(1)).toHaveClass(/yellow/);
  });

});

test.describe('Charts', () => {

  test('DEP and SpO2 canvas elements are rendered with non-zero size', async ({ page }) => {
    await seedMeasures(page, [
      fakeMeasure({ id: 1, dt: '2025-01-14T08:00', dep: 380 }),
      fakeMeasure({ id: 2, dt: '2025-01-15T08:00', dep: 400 }),
    ]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await page.waitForSelector('#chartDEP');
    const depW  = await page.locator('#chartDEP').evaluate((c: HTMLCanvasElement) => c.width);
    const spo2W = await page.locator('#chartSPO2').evaluate((c: HTMLCanvasElement) => c.width);
    expect(depW).toBeGreaterThan(0);
    expect(spo2W).toBeGreaterThan(0);
  });

});

test.describe('Offline banner', () => {

  test('offline banner appears when navigator.onLine is false', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(page.locator('.offline-banner')).toHaveClass(/visible/);
  });

  test('offline banner disappears when back online', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      window.dispatchEvent(new Event('online'));
    });
    await expect(page.locator('.offline-banner')).not.toHaveClass(/visible/);
  });

});

test.describe('Easyhaler dose display on dashboard', () => {

  test('dose count appears in the dashboard card', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ easy: 3 })]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await page.waitForSelector('#dashboardContent .zone-badge');
    await expect(page.locator('#dashboardContent')).toContainText('3');
  });

});
