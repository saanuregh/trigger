import { defineConfig } from '@playwright/test';

export default defineConfig({
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // Specify the executable path for Arch Linux
        launchOptions: {
          executablePath: '/usr/bin/chromium' 
        }
      },
    },
  ],
});
