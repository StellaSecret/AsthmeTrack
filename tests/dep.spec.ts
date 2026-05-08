import { test, expect } from '@playwright/test';
import { goToTab, seedBestDEP, waitForToast } from './helpers';

test.describe('DEP — calcul de la moyenne', () => {

  test.beforeEach(async ({ page }) => {
    await seedBestDEP(page, 450);
    await page.goto('/');
    await goToTab(page, 'saisie');
  });

  test('moyenne sur 3 souffles identiques', async ({ page }) => {
    await page.locator('#dep1').fill('300');
    await page.locator('#dep2').fill('300');
    await page.locator('#dep3').fill('300');

    await expect(page.locator('#depAvgDisplay')).toBeVisible();
    await expect(page.locator('#depAvgValue')).toHaveText('300 L/min');
  });

  test('moyenne arrondie correctement', async ({ page }) => {
    await page.locator('#dep1').fill('310');
    await page.locator('#dep2').fill('320');
    await page.locator('#dep3').fill('330');

    // (310+320+330)/3 = 320
    await expect(page.locator('#depAvgValue')).toHaveText('320 L/min');
  });

  test('un seul souffle renseigné — moyenne = ce souffle', async ({ page }) => {
    await page.locator('#dep1').fill('275');

    await expect(page.locator('#depAvgDisplay')).toBeVisible();
    await expect(page.locator('#depAvgValue')).toHaveText('275 L/min');
  });

  test('valeur à 2 chiffres (ex: 85) est bien prise en compte', async ({ page }) => {
    // Régression : les valeurs < 100 étaient parfois ignorées à tort
    await page.locator('#dep1').fill('85');
    await page.locator('#dep2').fill('90');
    await page.locator('#dep3').fill('88');

    const avg = Math.round((85 + 90 + 88) / 3); // 88
    await expect(page.locator('#depAvgValue')).toHaveText(`${avg} L/min`);
  });

  test('valeur hors limite (< 50) affiche un toast d\'erreur et est ignorée', async ({ page }) => {
    await page.locator('#dep1').fill('30');   // hors limite
    await page.locator('#dep2').fill('300');  // valide
    await page.locator('#dep3').fill('310');  // valide

    // Remplir SpO2 et prises pour pouvoir soumettre
    await page.locator('#inputSpO2').fill('97');
    await page.locator('#page-saisie .easyh-btn[data-val="1"]').click();
    await page.locator('#page-saisie button.btn-primary').click();

    const toast = await waitForToast(page);
    expect(toast).toContain('hors limites');
  });

  test('valeur hors limite (> 900) affiche un toast d\'erreur et est ignorée', async ({ page }) => {
    await page.locator('#dep1').fill('950');  // hors limite
    await page.locator('#dep2').fill('400');  // valide

    await page.locator('#inputSpO2').fill('97');
    await page.locator('#page-saisie .easyh-btn[data-val="1"]').click();
    await page.locator('#page-saisie button.btn-primary').click();

    const toast = await waitForToast(page);
    expect(toast).toContain('hors limites');
  });

  test('aucun souffle valide bloque l\'enregistrement', async ({ page }) => {
    await page.locator('#inputSpO2').fill('97');
    await page.locator('#page-saisie .easyh-btn[data-val="1"]').click();
    await page.locator('#page-saisie button.btn-primary').click();

    const toast = await waitForToast(page);
    expect(toast).toContain('DEP');
  });

  test('l\'affichage de la moyenne se masque si tous les champs sont effacés', async ({ page }) => {
    await page.locator('#dep1').fill('300');
    await expect(page.locator('#depAvgDisplay')).toBeVisible();

    await page.locator('#dep1').fill('');
    await expect(page.locator('#depAvgDisplay')).toBeHidden();
  });

});
