import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';
process.env.CLASSFLOW_QA_PASSWORD ??= randomBytes(24).toString('hex');
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 90000,
  use: {
    actionTimeout: 12000,
    baseURL: 'http://127.0.0.1:4273',
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Los_Angeles',
    locale: 'zh-CN',
  },
  webServer: {
    command: 'tsx tests/serve.ts',
    url: 'http://127.0.0.1:4273/api/auth/session',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
