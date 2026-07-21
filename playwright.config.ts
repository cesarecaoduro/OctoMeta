import { defineConfig } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

/**
 * E2E tests run against the production build (`vite preview`) so SSR/hydration
 * behavior matches what ships, not the dev server.
 */
export default defineConfig({
	testDir: 'e2e',
	timeout: 90_000,
	workers: 1,
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{
			name: 'setup',
			testMatch: /auth\.setup\.ts/
		},
		{
			name: 'desktop',
			dependencies: ['setup'],
			testIgnore: [/auth\.setup\.ts/, /\.narrow\.spec\.ts/, /\.webkit\.spec\.ts/],
			use: { browserName: 'chromium', storageState: authFile, viewport: { width: 1440, height: 900 } }
		},
		{
			name: 'narrow',
			dependencies: ['setup'],
			testMatch: /\.narrow\.spec\.ts/,
			use: { browserName: 'chromium', storageState: authFile, viewport: { width: 390, height: 844 } }
		},
		{
			name: 'landing-webkit',
			testMatch: /landing\.webkit\.spec\.ts/,
			use: { browserName: 'webkit', viewport: { width: 390, height: 844 } }
		}
	],
	webServer: {
		command: 'pnpm build && pnpm preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
