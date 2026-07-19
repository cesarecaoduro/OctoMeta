import { defineConfig } from '@playwright/test';

/**
 * E2E tests run against the production build (`vite preview`) so SSR/hydration
 * behavior matches what ships, not the dev server.
 */
export default defineConfig({
	testDir: 'e2e',
	timeout: 90_000,
	// The Univer spike page is heavy; parallel workers starve each other's page
	// loads on one machine and cause spurious goto timeouts.
	workers: 1,
	use: {
		baseURL: 'http://localhost:4173'
	},
	webServer: {
		command: 'pnpm build && pnpm preview',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
