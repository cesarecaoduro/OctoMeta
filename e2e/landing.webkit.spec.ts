import { expect, test } from '@playwright/test';

test('landing proof and signup remain operable in WebKit', async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => document.fonts.ready);

	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	const slider = page.getByRole('slider', { name: 'footing.B in metres' });
	await slider.focus();
	await page.keyboard.press('End');
	await expect(page.locator('.demo-prose .chip').first()).toHaveText('111.1 kPa');

	await page.getByText('Tell us about your team').click();
	await expect(page.getByLabel('Name')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Join the private beta' })).toBeVisible();
});
