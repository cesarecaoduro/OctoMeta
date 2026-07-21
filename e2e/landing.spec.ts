import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('landing page proves one edit, preserves one signup path, and exposes its content', async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => document.fonts.ready);

	await expect(page.getByRole('heading', { level: 1 })).toHaveText('The living engineering document.');
	await expect(page.getByText('Drag the footing width. Watch the document settle.')).toBeVisible();
	await expect(page.getByRole('heading', { level: 2 })).toHaveText([
		'Calculate. Verify.Deliver.',
		"The calc you stampedisn't the calc you have.",
		'Position is for humans.Order is for the graph.',
		'Engineering judgment stays in charge.',
		'Bring a real calculation.'
	]);

	await expect(page.locator('form')).toHaveCount(1);
	await expect(page.locator('a[href="#waitlist"]')).toHaveCount(3);
	expect(
		await page.evaluate(() => {
			const ids = [...document.querySelectorAll<HTMLElement>('[id]')].map((element) => element.id);
			return ids.length === new Set(ids).size;
		})
	).toBe(true);

	const slider = page.getByRole('slider', { name: 'footing.B in metres' });
	await slider.focus();
	await page.keyboard.press('End');
	await expect(slider).toHaveValue('3');
	await expect(page.locator('.demo-prose .chip').first()).toHaveText('111.1 kPa');

	await page.keyboard.press('Home');
	await page.keyboard.press('Tab');
	await page.reload();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();

	await page.locator('details').click();
	await expect(page.getByLabel('Name')).toBeVisible();
	const axe = await new AxeBuilder({ page }).analyze();
	expect(axe.violations).toEqual([]);
});

test('reduced motion disables automatic changes but keeps manual computation', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');

	const slider = page.getByRole('slider', { name: 'footing.B in metres' });
	const initial = await slider.inputValue();
	await page.waitForTimeout(3000);
	await expect(slider).toHaveValue(initial);

	await slider.focus();
	await page.keyboard.press('End');
	await expect(page.locator('.demo-prose .chip').first()).toHaveText('111.1 kPa');
	expect(
		await page.evaluate(() =>
			[...document.querySelectorAll<HTMLElement>('main section')].every(
				(section) => getComputedStyle(section).opacity !== '0'
			)
		)
	).toBe(true);
});

test('content survives without IntersectionObserver', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(window, 'IntersectionObserver', { value: undefined, configurable: true });
	});
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Engineering judgment stays in charge.' })).toBeVisible();
	await expect(page.getByText('3D geometry + IFC delivery')).toBeVisible();
});
