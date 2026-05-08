import { test, expect } from '@playwright/test';
import { seedReminders, goToTab, waitForToast } from './helpers';

test.describe('Rappels — scheduling & notifications', () => {

  test('la permission de notification est demandée au chargement', async ({ page }) => {
    // On mocke Notification pour simuler permission === 'default'
    // (En headless Chromium, permission peut être 'denied' — on force 'default' via mock)
    await page.addInitScript(() => {
      (window as any).__notifPermissionCalled = false;

      // Remplace l'objet Notification global par un mock contrôlé
      const mockNotification = {
        permission: 'default' as NotificationPermission,
        requestPermission: async () => {
          (window as any).__notifPermissionCalled = true;
          return 'granted' as NotificationPermission;
        },
      };
      Object.defineProperty(window, 'Notification', {
        value: mockNotification,
        writable: true,
        configurable: true,
      });
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(100);

    const called = await page.evaluate(() => (window as any).__notifPermissionCalled);
    expect(called).toBe(true);
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

    // Le checkbox est dans un <label class="toggle"> avec display CSS qui cache l'input natif.
    // Playwright refuse waitFor({state:'visible'}) sur un input caché par CSS.
    // On clique directement sur le label toggle qui est lui visible.
    const toggleLabel = page.locator('.reminder-item .toggle');
    await toggleLabel.waitFor({ state: 'visible' });
    await toggleLabel.click();

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
    await page.locator('#reminderLabel').fill('Sans heure');
    await page.locator('button[onclick="addReminder()"]').click();
    const toast = await waitForToast(page);
    expect(toast).toContain('heure');
  });

  test('scheduleReminders programme un setTimeout pour chaque rappel actif', async ({ page }) => {
    await seedReminders(page, [{ time: '23:59', label: 'Test', active: true }]);
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
    expect(count).toBeGreaterThanOrEqual(1);
  });

});
