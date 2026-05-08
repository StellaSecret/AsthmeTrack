import { test, expect } from '@playwright/test';
import { seedMeasures, seedBestDEP, goToTab, addMeasure, fakeMeasure } from './helpers';

test.describe('Navigation & smoke tests', () => {

  test('la page se charge sans erreur JS', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    expect(errors).toHaveLength(0);
  });

  test('l\'onglet Dashboard est actif par défaut', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#page-dashboard')).toHaveClass(/active/);
  });

  test('navigation vers tous les onglets fonctionne', async ({ page }) => {
    await page.goto('/');
    for (const tab of ['saisie', 'historique', 'settings'] as const) {
      await goToTab(page, tab);
      await expect(page.locator(`#page-${tab}`)).toHaveClass(/active/);
    }
  });

  test('dashboard vide affiche un état vide', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.empty-state')).toBeVisible();
  });

});

test.describe('Saisie d\'une mesure complète', () => {

  test('enregistrer une mesure valide redirige vers le dashboard', async ({ page }) => {
    await seedBestDEP(page, 450);
    await page.goto('/');
    await addMeasure(page, { datetime: '2025-01-15T08:00', dep1: 380, dep2: 390, dep3: 400, spo2: 97, easy: 1 });
    await page.waitForSelector('#page-dashboard.active', { timeout: 3000 });
    await expect(page.locator('#page-dashboard')).toHaveClass(/active/);
  });

  test('la mesure enregistrée apparaît dans l\'historique', async ({ page }) => {
    await seedBestDEP(page, 450);
    await page.goto('/');
    await addMeasure(page, { datetime: '2025-06-15T09:00', dep1: 410, dep2: 420, dep3: 415, spo2: 98, easy: 2, comment: 'Bonne journée' });
    await page.waitForSelector('#page-dashboard.active');
    await goToTab(page, 'historique');
    await expect(page.locator('.history-item')).toHaveCount(1);
    await expect(page.locator('.history-item').first()).toContainText('415');
  });

  test('SpO2 manquante bloque l\'enregistrement', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'saisie');
    await page.locator('#page-saisie #dep1').fill('380');
    await page.locator('#page-saisie .easyh-btn[data-val="1"]').click();
    await page.locator('#page-saisie button.btn-primary').click();
    await expect(page.locator('#toast.show')).toBeVisible();
    await expect(page.locator('#page-saisie')).toHaveClass(/active/);
  });

  test('les prises Easyhaler non sélectionnées bloquent l\'enregistrement', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'saisie');
    await page.locator('#page-saisie #dep1').fill('380');
    await page.locator('#page-saisie #inputSpO2').fill('97');
    await page.locator('#page-saisie button.btn-primary').click();
    await expect(page.locator('#toast.show')).toBeVisible();
  });

});

test.describe('Historique', () => {

  test('les mesures sont affichées dans l\'historique', async ({ page }) => {
    await seedMeasures(page, [
      fakeMeasure({ id: 1, dt: '2025-01-15T08:00', dep: 380 }),
      fakeMeasure({ id: 2, dt: '2025-01-16T08:00', dep: 410 }),
    ]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await goToTab(page, 'historique');
    await expect(page.locator('.history-item')).toHaveCount(2);
  });

  test('modifier une mesure met à jour les données', async ({ page }) => {
    await seedMeasures(page, [
      fakeMeasure({ id: 1, dt: '2025-01-15T08:00', dep: 380, dep1: 380, dep2: 380, dep3: 380 }),
    ]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await goToTab(page, 'historique');

    // Les boutons sont des icon-action-btn (✏️ et ✕), pas btn-secondary
    await page.locator('.history-item .icon-action-btn.edit').first().click();
    await expect(page.locator('#editModal')).toHaveClass(/open/);

    await page.locator('#editDep1').fill('420');
    await page.locator('#editDep2').fill('420');
    await page.locator('#editDep3').fill('420');
    await page.locator('#editModal .btn-primary').click();

    const measures = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('at_measures') || '[]')
    );
    expect(measures[0].dep).toBe(420);
  });

  test('supprimer une mesure la retire de l\'historique', async ({ page }) => {
    await seedMeasures(page, [
      fakeMeasure({ id: 1, dt: '2025-01-14T08:00', dep: 380 }),
      fakeMeasure({ id: 2, dt: '2025-01-15T08:00', dep: 410 }),
    ]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await goToTab(page, 'historique');
    await expect(page.locator('.history-item')).toHaveCount(2);

    // deleteMeasure() appelle confirm() — on l'accepte automatiquement
    page.on('dialog', dialog => dialog.accept());
    await page.locator('.history-item .icon-action-btn.del').first().click();

    await expect(page.locator('.history-item')).toHaveCount(1);
  });

});

test.describe('Dashboard — métriques', () => {

  test('affiche le DEP de la dernière mesure', async ({ page }) => {
    await seedMeasures(page, [
      fakeMeasure({ id: 1, dt: '2025-01-14T08:00', dep: 320 }),
      fakeMeasure({ id: 2, dt: '2025-01-15T08:00', dep: 440 }),
    ]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    // measures[0] = dep:440 (plus récent, trié par seedMeasures)
    await expect(page.locator('.metric-value').first()).toContainText('440');
  });

  test('la zone DEP verte s\'affiche pour un DEP >= 80% du meilleur', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ dep: 340 })]);
    await seedBestDEP(page, 400);
    await page.goto('/');
    await expect(page.locator('.metric-box.green').first()).toBeVisible();
  });

  test('la zone DEP rouge s\'affiche pour un DEP < 60% du meilleur', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ dep: 250 })]);
    await seedBestDEP(page, 500);
    await page.goto('/');
    await expect(page.locator('.metric-box.red').first()).toBeVisible();
  });

});
