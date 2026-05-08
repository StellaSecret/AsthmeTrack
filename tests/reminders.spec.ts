import { test, expect } from '@playwright/test';
import { seedReminders, goToTab, waitForToast } from './helpers';

test.describe('Rappels — scheduling & notifications', () => {

  test('la permission de notification est demandée au chargement', async ({ page, context }) => {
    // On écoute les requêtes de permission avant le chargement
    let permissionRequested = false;

    await context.route('**', (route) => route.continue());

    // On intercepte Notification.requestPermission via addInitScript
    await page.addInitScript(() => {
      const original = Notification.requestPermission.bind(Notification);
      (window as any).__notifPermissionCalled = false;
      Notification.requestPermission = async () => {
        (window as any).__notifPermissionCalled = true;
        return original();
      };
    });

    await page.goto('/');

    permissionRequested = await page.evaluate(() => (window as any).__notifPermissionCalled);
    expect(permissionRequested).toBe(true);
  });

  test('ajouter un rappel l\'affiche dans la liste', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'settings');

    await page.locator('#reminderTime').fill('08:30');
    await page.locator('#reminderLabel').fill('Matin');
    await page.locator('button[onclick="addReminder()"]').click();

    await expect(page.locator('.reminder-time')).toContainText('08:30');
    await expect(page.locator('.reminder-label-text')).toContainText('Matin');
  });

  test('un rappel ajouté est persisté dans localStorage', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'settings');

    await page.locator('#reminderTime').fill('20:00');
    await page.locator('#reminderLabel').fill('Soir');
    await page.locator('button[onclick="addReminder()"]').click();

    const reminders = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('at_reminders') || '[]')
    );

    expect(reminders).toHaveLength(1);
    expect(reminders[0].time).toBe('20:00');
    expect(reminders[0].label).toBe('Soir');
    expect(reminders[0].active).toBe(true);
  });

  test('désactiver un rappel le marque inactive', async ({ page }) => {
    await seedReminders(page, [{ time: '08:00', label: 'Matin', active: true }]);
    await page.goto('/');
    await goToTab(page, 'settings');

    // Toggle le checkbox
    await page.locator('.toggle input[type="checkbox"]').uncheck();

    const reminders = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('at_reminders') || '[]')
    );
    expect(reminders[0].active).toBe(false);
  });

  test('supprimer un rappel le retire de la liste', async ({ page }) => {
    await seedReminders(page, [
      { time: '08:00', label: 'Matin', active: true },
      { time: '20:00', label: 'Soir', active: true },
    ]);
    await page.goto('/');
    await goToTab(page, 'settings');

    await expect(page.locator('.reminder-item')).toHaveCount(2);

    // Supprime le premier
    await page.locator('.reminder-del').first().click();

    await expect(page.locator('.reminder-item')).toHaveCount(1);

    const reminders = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('at_reminders') || '[]')
    );
    expect(reminders).toHaveLength(1);
  });

  test('ajouter un rappel sans heure affiche une erreur', async ({ page }) => {
    await page.goto('/');
    await goToTab(page, 'settings');

    // On ne remplit pas l'heure
    await page.locator('#reminderLabel').fill('Sans heure');
    await page.locator('button[onclick="addReminder()"]').click();

    const toast = await waitForToast(page);
    expect(toast).toContain('heure');
  });

  test('les rappels actifs s\'affichent sur le dashboard', async ({ page }) => {
    await seedReminders(page, [
      { time: '08:00', label: 'Matin', active: true },
      { time: '20:00', label: 'Soir', active: false }, // inactif — ne doit pas apparaître
    ]);
    await page.goto('/');

    // Ajouter une mesure pour que le dashboard ait du contenu
    await page.evaluate(() => {
      localStorage.setItem('at_measures', JSON.stringify([{
        id: 1, dt: '2025-01-15T08:00', dep: 400, dep1: 400, dep2: 400, dep3: 400, spo2: 97, easy: 1, comment: ''
      }]));
    });
    await page.reload();

    const badges = page.locator('.reminder-badge');
    await expect(badges).toHaveCount(1);
    await expect(badges.first()).toContainText('08:00');
    await expect(badges.first()).toContainText('Matin');
  });

  test('scheduleReminders programme un setTimeout pour chaque rappel actif', async ({ page }) => {
    await seedReminders(page, [
      { time: '23:59', label: 'Test', active: true }, // heure lointaine = setTimeout long
    ]);

    await page.addInitScript(() => {
      (window as any).__setTimeoutCallCount = 0;
      const orig = window.setTimeout;
      (window as any).setTimeout = function (fn: TimerHandler, delay?: number, ...args: unknown[]) {
        (window as any).__setTimeoutCallCount++;
        return orig(fn, delay, ...args);
      };
    });

    await page.goto('/');

    const count = await page.evaluate(() => (window as any).__setTimeoutCallCount);
    // Au moins un setTimeout doit avoir été appelé pour le rappel
    expect(count).toBeGreaterThanOrEqual(1);
  });

});
