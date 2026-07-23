import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('narrow workbench uses contextual published values and a full-screen workbook without overflow', async ({
	page
}) => {
	await page.goto('/app');
	await page.getByTestId('load-demo').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
	).toBe(true);
	const dock = await page.locator('.shell-context').boundingBox();
	expect(dock).not.toBeNull();
	expect(dock!.y).toBeGreaterThan(700);
	expect(dock!.y + dock!.height).toBe(844);

	const workbookToggle = page.getByRole('button', { name: 'Workbook', exact: true });
	await workbookToggle.click();
	await expect(workbookToggle).toHaveAttribute('aria-pressed', 'true');
	const box = await page.getByRole('complementary', { name: 'Attached workbook' }).boundingBox();
	expect(box?.width).toBe(390);
	expect(box?.height).toBe(844);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
	).toBe(true);
	await expect(page.locator('#univer-doc-main-canvas')).toHaveAttribute('tabindex', '0');
	await page.getByRole('button', { name: 'Published values' }).click();
	const dialog = page.getByRole('dialog', { name: 'Published values' });
	await expect(dialog).toBeVisible();
	await expect(page.getByPlaceholder('Search name, label, sheet, or cell')).toBeFocused();
	await dialog.getByRole('button', { name: 'Close published values' }).focus();
	await page.keyboard.press('Shift+Tab');
	expect(
		await page.evaluate(() =>
			Boolean(document.activeElement?.closest('[role="dialog"][aria-label="Published values"]'))
		)
	).toBe(true);
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Published values' })).toBeFocused();

	const axe = await new AxeBuilder({ page }).analyze();
	expect(axe.violations).toEqual([]);
});
