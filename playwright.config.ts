import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: 'http://localhost:3333',
    trace: 'on-first-retry',
    permissions: ['notifications'],
  },

  // Démarre un serveur HTTP statique sur le dossier www/ avant les tests
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:3333',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Décommente pour tester le viewport mobile Android
    // {
    //   name: 'android-mobile',
    //   use: { ...devices['Pixel 7'], permissions: ['notifications'] },
    // },
  ],
});
