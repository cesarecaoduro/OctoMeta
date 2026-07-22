import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('narrow workbench uses modal parameters and a full-screen workbook without overflow', async ({
	page
}) => {
	await page.goto('/app');
	await page.getByTestId('load-demo').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
	).toBe(true);

	await page.getByRole('button', { name: 'Parameters' }).click();
	const dialog = page.getByRole('dialog', { name: 'Parameters' });
	await expect(dialog).toBeVisible();
	await expect(page.getByRole('button', { name: 'Close parameters' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Parameters' })).toBeFocused();

	const workbookToggle = page.getByRole('button', { name: /Workbook 3 tabs/ });
	await workbookToggle.click();
	await expect(workbookToggle).toHaveAttribute('aria-expanded', 'true');
	const box = await page.getByRole('complementary', { name: 'Attached workbook' }).boundingBox();
	expect(box?.width).toBe(390);
	expect(box?.height).toBe(844);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
	).toBe(true);
	await expect(page.locator('#univer-doc-main-canvas')).toHaveAttribute('tabindex', '0');

	const axe = await new AxeBuilder({ page }).analyze();
	expect(axe.violations).toEqual([]);
});
