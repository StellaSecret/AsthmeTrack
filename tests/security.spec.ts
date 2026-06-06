import { test, expect } from '@playwright/test';
import { seedMeasures, seedReminders, seedBestDEP, goToTab, fakeMeasure, waitForToast } from './helpers';

// ──────────────────────────────────────────────────────────────────────────────
//  Shared XSS payload
// ──────────────────────────────────────────────────────────────────────────────
const XSS = '<img src=x onerror="window.__xss=true">';
const XSS_SCRIPT = '<script>window.__xss=true<\/script>';

async function xssExecuted(page: any): Promise<boolean> {
  return page.evaluate(() => !!(window as any).__xss);
}

// ──────────────────────────────────────────────────────────────────────────────
//  Alert #1 & #3 — DOM XSS via reminder badge (dashboard) and reminder list
// ──────────────────────────────────────────────────────────────────────────────
test.describe('XSS — reminder label and time (#1 #3)', () => {

  test('reminder label with XSS payload is escaped in the settings list', async ({ page }) => {
    await seedReminders(page, [{ time: '08:00', label: XSS, active: true }]);
    await page.goto('/');
    await goToTab(page, 'settings');
    await expect(page.locator('#page-settings .reminder-label-text').first()).toContainText('<img');
    expect(await xssExecuted(page)).toBe(false);
  });

  test('reminder time with XSS payload is escaped in the settings list', async ({ page }) => {
    await seedReminders(page, [{ time: XSS, label: 'Normal', active: true }]);
    await page.goto('/');
    await goToTab(page, 'settings');
    await expect(page.locator('#page-settings .reminder-time').first()).toContainText('<img');
    expect(await xssExecuted(page)).toBe(false);
  });

  test('active reminder label with XSS payload is escaped in the dashboard badge', async ({ page }) => {
    await seedReminders(page, [{ time: '09:00', label: XSS, active: true }]);
    await seedMeasures(page, [fakeMeasure()]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    // Dashboard renders active reminders as .reminder-badge
    await page.waitForSelector('#dashboardContent .reminder-badge');
    await expect(page.locator('#dashboardContent .reminder-badge').first()).toContainText('<img');
    expect(await xssExecuted(page)).toBe(false);
  });

  test('reminder label with script tag is escaped, not executed', async ({ page }) => {
    await seedReminders(page, [{ time: '10:00', label: XSS_SCRIPT, active: true }]);
    await page.goto('/');
    await goToTab(page, 'settings');
    expect(await xssExecuted(page)).toBe(false);
  });

});

// ──────────────────────────────────────────────────────────────────────────────
//  Alert #2 — DOM XSS via comment in dashboard card
// ──────────────────────────────────────────────────────────────────────────────
test.describe('XSS — measure comment in dashboard (#2)', () => {

  test('comment with XSS payload is escaped in the dashboard card', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ comment: XSS })]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await page.waitForSelector('#dashboardContent .card');
    // The comment should appear as literal text, not trigger onerror
    const cardText = await page.locator('#dashboardContent').innerText();
    expect(cardText).toContain('<img');
    expect(await xssExecuted(page)).toBe(false);
  });

  test('comment with script tag does not execute in dashboard', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ comment: XSS_SCRIPT })]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await page.waitForSelector('#dashboardContent .card');
    expect(await xssExecuted(page)).toBe(false);
  });

});

// ──────────────────────────────────────────────────────────────────────────────
//  Alert #7 & #8 — DOM XSS via comment in history list
// ──────────────────────────────────────────────────────────────────────────────
test.describe('XSS — measure comment in history (#7 #8)', () => {

  test('comment with XSS payload is escaped in the history item', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ comment: XSS })]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await goToTab(page, 'historique');
    await page.waitForSelector('#page-historique .history-item');
    const itemText = await page.locator('#page-historique .history-comment').first().innerText();
    expect(itemText).toContain('<img');
    expect(await xssExecuted(page)).toBe(false);
  });

  test('comment with script tag does not execute in history', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ comment: XSS_SCRIPT })]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await goToTab(page, 'historique');
    expect(await xssExecuted(page)).toBe(false);
  });

  test('edited comment with XSS payload is escaped after saving edit', async ({ page }) => {
    await seedMeasures(page, [fakeMeasure({ id: 1, dt: '2025-01-15T08:00', dep: 380, dep1: 380, dep2: 380, dep3: 380 })]);
    await seedBestDEP(page, 450);
    await page.goto('/');
    await goToTab(page, 'historique');
    await page.locator('#page-historique .history-item .icon-action-btn.edit').first().click();
    await page.locator('#editComment').fill(XSS);
    await page.locator('#editModal .btn-primary').click();
    await page.waitForSelector('#page-historique .history-item');
    const itemText = await page.locator('#page-historique .history-comment').first().innerText();
    expect(itemText).toContain('<img');
    expect(await xssExecuted(page)).toBe(false);
  });

});

// ──────────────────────────────────────────────────────────────────────────────
//  Alert #9 — Clear-text storage of OAuth token
// ──────────────────────────────────────────────────────────────────────────────
test.describe('Token storage (#9)', () => {

  test('driveToken setter uses SecureStore and does not commit to localStorage', async ({ page }) => {
    await page.addInitScript(() => { (window as any).__savedKey = undefined; });
    await page.goto('/');
    await page.exposeFunction('__trackSave', (key: string, value: string) => {
      (global as any).__savedKey = key; // this is for the test node process
    });
    // Need to set tracker on window
    await page.evaluate(() => {
        (window as any).__trackSave = async (k: string, v: string) => { (window as any).__savedKey = k; };
    });

    await page.evaluate(async () => {
      Object.assign((window as any).SecureStore, {
        save: async (key: string, value: string) => {
          await (window as any).__trackSave(key, value);
        },
      });
      await (window as any).DB.setDriveToken('fake_token_abc123');
    });
    const stored = await page.evaluate(() => localStorage.getItem('at_driveToken'));
    expect(stored).toBeNull();
    const savedKey = await page.evaluate(() => (window as any).__savedKey);
    expect(savedKey).toBe('at_driveToken');
  });

  test('clearing driveToken removes it from SecureStore', async ({ page }) => {
    await page.goto('/');
    let removedKey = 'not-set';
    await page.exposeFunction('__trackRemove', (key: string) => { removedKey = key; });
    await page.evaluate(async () => {
      Object.assign((window as any).SecureStore, {
        remove: async (key: string) => { await (window as any).__trackRemove(key); },
      });
      await (window as any).DB.setDriveToken(null);
    });
    expect(removedKey).toBe('at_driveToken');
  });

  test('driveTokenExpiry is written via SecureStore (async)', async ({ page }) => {
    await page.goto('/');
    let savedKey = 'not-set';
    await page.exposeFunction('__trackExpirySave', (key: string) => { savedKey = key; });
    await page.evaluate(async () => {
      Object.assign((window as any).SecureStore, {
        save: async (key: string) => { await (window as any).__trackExpirySave(key); },
      });
      await (window as any).DB.setDriveTokenExpiry(Date.now() + 3600000);
    });
    expect(savedKey).toBe('at_driveTokenExpiry');
  });

});

// ──────────────────────────────────────────────────────────────────────────────
//  Alert #12 — Clear-text storage of sensitive health data (PII)
// ──────────────────────────────────────────────────────────────────────────────
test.describe('Health data storage (#12)', () => {

  test('profile data is not stored in clear-text localStorage when SecureStore is active', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        Plugins: { Preferences: {
          set: () => Promise.resolve(),
          get: () => Promise.resolve({ value: null }),
          remove: () => Promise.resolve()
        }}
      };
    });
    await page.goto('/');
    await page.evaluate(async () => {
      await (window as any).DB.load();
      (window as any).DB.profile = { sex: 'M', age: 30, height: 180 };
    });
    // Give a small amount of time for any potential async bleed (shouldn't happen)
    await page.waitForTimeout(200);
    const stored = await page.evaluate(() => localStorage.getItem('at_profile'));
    expect(stored).toBeNull();
  });

  test('measures data is not stored in clear-text localStorage when SecureStore is active', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        Plugins: { Preferences: {
          set: () => Promise.resolve(),
          get: () => Promise.resolve({ value: null })
        }}
      };
    });
    await page.goto('/');
    await page.evaluate(async () => {
      (window as any).DB.measures = [{ id: 1, dt: '2025-01-01T10:00', dep: 400 }];
    });
    await page.waitForTimeout(200);
    const stored = await page.evaluate(() => localStorage.getItem('at_measures'));
    expect(stored).toBeNull();
  });

});

// ──────────────────────────────────────────────────────────────────────────────
//  Alert #4 — Path traversal in server.js
// ──────────────────────────────────────────────────────────────────────────────
test.describe('Path traversal — server.js (#4 #11)', () => {

  test('request to /../package.json returns 403 or 404', async ({ request }) => {
    const res = await request.get('/../package.json');
    // Client might normalize to /package.json (404) or server might block (403)
    expect([403, 404]).toContain(res.status());
  });

  test('request with encoded traversal /%2e%2e/package.json returns 403 or 404', async ({ request }) => {
    const res = await request.get('/%2e%2e/package.json');
    expect([403, 404]).toContain(res.status());
  });

  test('request with deep traversal path is blocked (403 or 404)', async ({ request }) => {
    const res = await request.get('/../../../etc/passwd');
    expect([403, 404]).toContain(res.status());
  });

  test('request with suspicious characters is blocked (403)', async ({ request }) => {
    // Whitelist check happens before normalization/resolution
    const res = await request.get('/some<file>.js');
    expect(res.status()).toBe(403);
  });

  test('normal static file request still works', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
  });

});

// ──────────────────────────────────────────────────────────────────────────────
//  Alert #5 — Reflected XSS in server.js 404 response
// ──────────────────────────────────────────────────────────────────────────────
test.describe('Reflected XSS — server.js 404 (#5)', () => {

  test('404 response has Content-Type text/plain', async ({ request }) => {
    const res = await request.get('/nonexistent-file.xyz');
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type']).toContain('text/plain');
  });

  test('404 body does not reflect the URL path', async ({ request }) => {
    const res = await request.get('/some-missing-path');
    const body = await res.text();
    expect(body).not.toContain('some-missing-path');
  });

  test('script tag in URL path is not reflected in 404 body', async ({ request }) => {
    const res = await request.get('/<script>alert(1)<\/script>');
    const body = await res.text();
    expect(body).not.toContain('<script>');
  });

});

// ──────────────────────────────────────────────────────────────────────────────
//  Fix 1 — driveUser / driveAvatar XSS in settings
// ──────────────────────────────────────────────────────────────────────────────
test.describe('XSS — driveUser and driveAvatar in settings (fix 1)', () => {

  test('malicious driveUser is escaped in the settings card', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        Plugins: { Preferences: {
          get: ({ key }: { key: string }) => {
            if (key === 'at_driveToken') return Promise.resolve({ value: 'fake_token' });
            if (key === 'at_driveTokenExpiry') return Promise.resolve({ value: String(Date.now() + 3600000) });
            if (key === 'at_driveUser') return Promise.resolve({ value: '<img src=x onerror="window.__xss=true">' });
            if (key === 'at_driveAvatar') return Promise.resolve({ value: '' });
            return Promise.resolve({ value: null });
          },
          set: () => Promise.resolve()
        }}
      };
    });
    await page.goto('/');
    await goToTab(page, 'settings');
    // Settings render is async now, wait for the element
    const driveName = page.locator('#page-settings .drive-name');
    await expect(driveName).toBeVisible({ timeout: 5000 });
    await expect(driveName).toContainText('<img');
    expect(await page.evaluate(() => !!(window as any).__xss)).toBe(false);
  });

  test('malicious driveAvatar src is escaped in the settings card', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).Capacitor = {
        isNativePlatform: () => true,
        Plugins: { Preferences: {
          get: ({ key }: { key: string }) => {
            if (key === 'at_driveToken') return Promise.resolve({ value: 'fake_token' });
            if (key === 'at_driveTokenExpiry') return Promise.resolve({ value: String(Date.now() + 3600000) });
            if (key === 'at_driveUser') return Promise.resolve({ value: 'user@example.com' });
            if (key === 'at_driveAvatar') return Promise.resolve({ value: '" onerror="window.__xss=true" x="' });
            return Promise.resolve({ value: null });
          },
          set: () => Promise.resolve()
        }}
      };
    });
    await page.goto('/');
    await goToTab(page, 'settings');
    // Wait for async render and any potential XSS execution
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => !!(window as any).__xss)).toBe(false);
  });

});

// ──────────────────────────────────────────────────────────────────────────────
//  Fix 2 — future-date validation in saveMeasure
// ──────────────────────────────────────────────────────────────────────────────
test.describe('Future date validation in saveMeasure (fix 2)', () => {

  test('saving a measure with a future date shows an error toast', async ({ page }) => {
    await seedBestDEP(page, 450);
    await page.goto('/');
    await goToTab(page, 'saisie');
    const form = page.locator('#page-saisie');
    const future = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 16);
    await form.locator('#inputDatetime').fill(future);
    await form.locator('#dep1').fill('380');
    await form.locator('#inputSpO2').fill('97');
    await form.locator('.easyh-btn[data-val="1"]').click();
    await form.locator('button.btn-primary').click();
    const toast = await waitForToast(page);
    expect(toast).toMatch(/futur|future/i);
    // Must not have navigated away
    await expect(form).toHaveClass(/active/);
  });

  test('saving a measure with a past date succeeds normally', async ({ page }) => {
    await seedBestDEP(page, 450);
    await page.goto('/');
    await goToTab(page, 'saisie');
    const form = page.locator('#page-saisie');
    await form.locator('#inputDatetime').fill('2024-01-15T08:00');
    await form.locator('#dep1').fill('380');
    await form.locator('#inputSpO2').fill('97');
    await form.locator('.easyh-btn[data-val="1"]').click();
    await form.locator('button.btn-primary').click();
    await page.waitForSelector('#page-dashboard.active', { timeout: 3000 });
    await expect(page.locator('#page-dashboard')).toHaveClass(/active/);
  });

});

// ──────────────────────────────────────────────────────────────────────────────
//  Fix 3 — localStorage QuotaExceededError handled gracefully
// ──────────────────────────────────────────────────────────────────────────────
test.describe('localStorage quota error handled (fix 3)', () => {

  test('DB.measures setter does not throw when localStorage is full', async ({ page }) => {
    await page.goto('/');
    const threw = await page.evaluate(async () => {
      // Simulate QuotaExceededError in SecureStore which uses localStorage on web
      const orig = localStorage.setItem.bind(localStorage);
      Storage.prototype.setItem = () => { throw new DOMException('QuotaExceededError'); };
      try {
        (window as any).DB.measures = [];
        return false;
      } catch(e) {
        return true;
      } finally {
        Storage.prototype.setItem = orig;
      }
    });
    expect(threw).toBe(false);
  });

  test('DB.reminders setter does not throw when localStorage is full', async ({ page }) => {
    await page.goto('/');
    const threw = await page.evaluate(async () => {
      const orig = localStorage.setItem.bind(localStorage);
      Storage.prototype.setItem = () => { throw new DOMException('QuotaExceededError'); };
      try {
        (window as any).DB.reminders = [];
        return false;
      } catch(e) {
        return true;
      } finally {
        Storage.prototype.setItem = orig;
      }
    });
    expect(threw).toBe(false);
  });

});

// ──────────────────────────────────────────────────────────────────────────────
//  Fix 4 — api.anthropic.com removed from CSP
// ──────────────────────────────────────────────────────────────────────────────
test.describe('CSP does not include api.anthropic.com (fix 4)', () => {

  test('Content-Security-Policy meta tag does not reference api.anthropic.com', async ({ page }) => {
    await page.goto('/');
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).not.toContain('api.anthropic.com');
  });

  test('CSP still allows googleapis.com and accounts.google.com', async ({ page }) => {
    await page.goto('/');
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain('https://www.googleapis.com');
    expect(csp).toContain('https://accounts.google.com');
  });

});
