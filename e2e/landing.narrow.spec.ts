import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('narrow landing page fits, stays concise, and provides touch-sized controls', async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => document.fonts.ready);

	const measurements = await page.evaluate(() => {
		const range = document.querySelector<HTMLInputElement>('input[type="range"]')?.getBoundingClientRect();
		const buttons = [...document.querySelectorAll<HTMLElement>('.btn')].map((button) =>
			button.getBoundingClientRect().height
		);
		return {
			scrollWidth: document.documentElement.scrollWidth,
			scrollHeight: document.documentElement.scrollHeight,
			viewportWidth: window.innerWidth,
			rangeWidth: range?.width ?? 0,
			rangeHeight: range?.height ?? 0,
			buttons
		};
	});

	expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.viewportWidth);
	expect(measurements.scrollHeight).toBeLessThanOrEqual(7000);
	expect(measurements.rangeWidth).toBeGreaterThanOrEqual(44);
	expect(measurements.rangeHeight).toBeGreaterThanOrEqual(44);
	expect(measurements.buttons.every((height) => height >= 44)).toBe(true);
	await expect(page.locator('form')).toHaveCount(1);
	await expect(page.getByText('3D geometry + IFC delivery')).toBeVisible();

	const axe = await new AxeBuilder({ page }).analyze();
	expect(axe.violations).toEqual([]);
});
