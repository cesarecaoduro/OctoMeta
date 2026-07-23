import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('appearance is semantic, persistent, and accessible in both appearances', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto('/');

	await expect(page.locator('html')).toHaveAttribute('data-appearance-preference', 'system');
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');

	const appearance = page.getByRole('button', { name: 'Appearance: System' });
	await appearance.click();
	await page.getByRole('menuitemradio', { name: 'Light' }).click();
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
	expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

	await page.getByRole('button', { name: 'Appearance: Light' }).click();
	await page.getByRole('menuitemradio', { name: 'Dark' }).click();
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
	expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-appearance-preference', 'dark');
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
});

test('workbench mode follows available content width without horizontal page overflow', async ({
	page
}) => {
	await page.goto('/app');
	await page.getByTestId('load-demo').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');

	for (const expectation of [
		{ width: 320, mode: 'compact' },
		{ width: 679, mode: 'compact' },
		{ width: 680, mode: 'regular' },
		{ width: 1_079, mode: 'regular' },
		{ width: 1_080, mode: 'expanded' },
		{ width: 1_440, mode: 'expanded' }
	] as const) {
		await page.setViewportSize({ width: expectation.width, height: 900 });
		await expect(page.getByTestId('workbench')).toHaveAttribute(
			'data-layout-mode',
			expectation.mode
		);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
	}

	await expect(page.getByRole('group', { name: 'Workspace' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Hide Workbook' }).click();
	await expect(page.getByRole('complementary', { name: 'Attached workbook' })).not.toBeVisible();
	await page.setViewportSize({ width: 1_079, height: 900 });
	await page.setViewportSize({ width: 1_440, height: 900 });
	await expect(page.getByRole('complementary', { name: 'Attached workbook' })).not.toBeVisible();
	await page.getByRole('button', { name: 'Show Workbook' }).click();
	const workbook = page.getByRole('complementary', { name: 'Attached workbook' });
	await expect(workbook).toBeVisible();
	const workbookBounds = await workbook.boundingBox();
	expect(workbookBounds).not.toBeNull();
	expect(workbookBounds!.x).toBe(0);
	expect(workbookBounds!.width).toBe(1_440);
	expect(workbookBounds!.y).toBeGreaterThan(400);
	const documentBounds = await page.locator('.workbench-main').boundingBox();
	expect(documentBounds).not.toBeNull();
	expect(documentBounds!.y + documentBounds!.height).toBeLessThanOrEqual(workbookBounds!.y + 1);
	await expect(page.getByRole('button', { name: 'Save new version' })).toBeVisible();
	const more = page.getByRole('button', { name: 'More workbench actions' });
	await more.click();
	await expect(page.getByRole('dialog', { name: 'Workbench actions' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'Workbench actions' })).toHaveCount(0);
	await expect(more).toBeFocused();

	for (const appearance of ['light', 'dark'] as const) {
		await page.evaluate((next) => {
			localStorage.setItem('octometa:appearance', next);
			window.dispatchEvent(new CustomEvent('octometa:appearance-change', { detail: next }));
		}, appearance);
		await expect(page.locator('[data-testid="workbook-grid"] .univer-dark')).toHaveCount(
			appearance === 'dark' ? 1 : 0
		);
		for (const width of [679, 680, 1_079, 1_080]) {
			await page.setViewportSize({ width, height: 900 });
			await expect(page.getByTestId('workbench')).toHaveAttribute(
				'data-layout-mode',
				width < 680 ? 'compact' : width < 1_080 ? 'regular' : 'expanded'
			);
			await expect(page.locator('[data-u-comp][tabindex="1"]')).toHaveCount(0);
			await expect
				.poll(() =>
					page
						.locator('section[aria-label^="Workbook notifications"]')
						.evaluateAll((regions) => new Set(regions.map((region) => region.ariaLabel)).size)
				)
				.toBeGreaterThan(1);
			const axe = await new AxeBuilder({ page }).include('[data-testid="workbench"]').analyze();
			expect(axe.violations).toEqual([]);
		}
	}
});

test('authentication and document library inherit the same accessible appearance system', async ({
	page
}) => {
	await page.goto('/signin');
	await page.getByRole('button', { name: /Appearance:/ }).click();
	await page.getByRole('menuitemradio', { name: 'Dark' }).click();
	await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
	expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

	await page.goto('/app');
	await expect(page.getByTestId('new-doc')).toBeEnabled();
	await expect(page.getByRole('button', { name: 'Appearance: Dark' })).toBeVisible();
	expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
