import { expect, test as setup } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const authFile = 'playwright/.auth/user.json';

setup('create an isolated authenticated owner', async ({ page }) => {
	const run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	await page.goto('/signin');
	await page.getByRole('button', { name: 'New here? Create an account' }).click();
	await page.getByLabel('Name').fill('OctoMeta release test');
	await page.getByLabel('Email').fill(`release-${run}@example.com`);
	await page.getByLabel('Password').fill(`Release-${run}-pass`);
	await page.getByRole('button', { name: 'Create account', exact: true }).click();
	await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
	await mkdir('playwright/.auth', { recursive: true });
	await page.context().storageState({ path: authFile });
});
