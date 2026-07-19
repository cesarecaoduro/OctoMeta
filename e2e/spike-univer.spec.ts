import { expect, test, type Page } from '@playwright/test';

/**
 * V1-0 spike proofs, run against the production build (SSR + hydration).
 *
 * The spike page exposes `window.__spike` helpers so cell reads/writes go
 * through the Univer Facade deterministically instead of canvas coordinates.
 * Univer recalc is async, so every cell assertion polls.
 */

declare global {
	interface Window {
		__spike: {
			isReady: () => boolean;
			getCell: (a1: string) => unknown;
			setCell: (a1: string, v: number | string) => void;
			setFormula: (a1: string, f: string) => void;
			docText: () => string;
			serialize: () => unknown;
			restore: () => void;
			moveSheet: (dir: 'up' | 'down') => void;
		};
	}
}

async function gotoSpike(page: Page) {
	await page.goto('/spike/univer');
	// Grid mounted = univer canvas present inside the NodeView.
	await expect(page.locator('[data-univer-sheet] canvas').first()).toBeVisible({
		timeout: 30_000
	});
	await page.waitForFunction(() => window.__spike?.isReady(), undefined, { timeout: 30_000 });
}

function cell(page: Page, a1: string) {
	return page.evaluate((ref) => window.__spike.getCell(ref), a1);
}

test('V1-0-1: spike index renders', async ({ page }) => {
	await page.goto('/spike');
	await expect(page.getByRole('heading', { name: 'Spike index' })).toBeVisible();
	await expect(page.getByRole('link', { name: '/spike/univer' })).toBeVisible();
});

test('proof (a): page SSRs and hydrates with a live Univer grid', async ({ page }) => {
	// SSR: the document body already contains the page shell without JS.
	const response = await page.request.get('/spike/univer');
	expect(response.ok()).toBeTruthy();
	expect(await response.text()).toContain('Univer sheet inside a TipTap NodeView');

	await gotoSpike(page);
	await expect(page.locator('.tiptap p').first()).toHaveText('Prose above the sheet.');
});

test('proof (b): keyboard focus enters and leaves the grid; TipTap never steals keys', async ({
	page
}) => {
	await gotoSpike(page);

	// Type into prose: TipTap owns the keys.
	await page.locator('.tiptap p').first().click();
	await page.keyboard.type(' PROSE-EDIT');
	await expect(page.locator('.tiptap p').first()).toContainText('PROSE-EDIT');

	// Click into the grid (cell region of the sheet canvas — Univer renders
	// several canvases; the grid one is univer-sheet-main-canvas_<unitId>).
	const canvas = page.locator('[data-univer-sheet] canvas[id^="univer-sheet-main-canvas"]').first();
	await canvas.click({ position: { x: 80, y: 50 } });
	await page.keyboard.type('4321');
	await page.keyboard.press('Enter');

	// The digits landed in the sheet, not in the prose document.
	// (80,50) inside the grid canvas selects A2 once headers are accounted for.
	await expect.poll(() => cell(page, 'A2'), { timeout: 15_000 }).toBe(4321);
	const text = await page.evaluate(() => window.__spike.docText());
	expect(text).not.toContain('4321');

	// Focus leaves the grid again: prose typing still works afterwards.
	await page.locator('.tiptap p').last().click();
	await page.keyboard.type(' BACK-IN-PROSE');
	await expect(page.locator('.tiptap p').last()).toContainText('BACK-IN-PROSE');
});

test('proof (c): sheet edits survive block move up/down', async ({ page }) => {
	await gotoSpike(page);

	await page.evaluate(() => window.__spike.setCell('A1', 42));
	await expect.poll(() => cell(page, 'A1')).toBe(42);
	// Let the debounced snapshot save fire before the view is destroyed.
	await page.waitForTimeout(500);

	// Note: StarterKit v3 keeps a trailing paragraph after the last block, so the
	// sheet is asserted by child index, not by :last-child.
	const sheetIndex = () =>
		page.evaluate(() =>
			[...(document.querySelector('.tiptap')?.children ?? [])].findIndex((c) =>
				c.hasAttribute('data-univer-sheet')
			)
		);

	await page.getByTestId('move-down').click();
	await expect(page.getByTestId('status')).toHaveText('moved down');
	// Remount takes a few seconds (new Univer instance must reach Steady).
	await page.waitForFunction(() => window.__spike?.isReady(), undefined, { timeout: 30_000 });
	expect(await sheetIndex()).toBe(2);
	await page.waitForFunction(() => window.__spike.getCell('A1') === 42, undefined, {
		timeout: 30_000
	});

	await page.getByTestId('move-up').click();
	await expect(page.getByTestId('status')).toHaveText('moved up');
	await page.waitForFunction(() => window.__spike?.isReady(), undefined, { timeout: 30_000 });
	expect(await sheetIndex()).toBe(1);
	await page.waitForFunction(() => window.__spike.getCell('A1') === 42, undefined, {
		timeout: 30_000
	});
});

test('proof (d): snapshot serialize → teardown → restore', async ({ page }) => {
	await gotoSpike(page);

	await page.evaluate(() => window.__spike.setCell('B2', 'persisted'));
	await expect.poll(() => cell(page, 'B2')).toBe('persisted');

	const serialized = await page.evaluate(() => window.__spike.serialize());
	expect(JSON.stringify(serialized)).toContain('persisted');

	await page.getByTestId('restore').click();
	await expect(page.getByTestId('status')).toHaveText('restored');
	await expect(page.locator('[data-univer-sheet] canvas').first()).toBeVisible({
		timeout: 30_000
	});
	await page.waitForFunction(() => window.__spike.getCell('B2') === 'persisted', undefined, {
		timeout: 30_000
	});
});

test('V1-0-3: facade custom function evaluates', async ({ page }) => {
	await gotoSpike(page);
	await page.evaluate(() => window.__spike.setFormula('D1', '=OCTO_DOUBLE(21)'));
	await expect.poll(() => cell(page, 'D1'), { timeout: 15_000 }).toBe(42);
});

test('V1-0-3: facade custom function returning a 2D array spills', async ({ page }) => {
	await gotoSpike(page);
	await page.evaluate(() => window.__spike.setFormula('F1', '=OCTO_MATRIX(2)'));
	// A spilling 2×2 result fills F1:G2 with 1..4.
	await expect.poll(() => cell(page, 'F1'), { timeout: 15_000 }).toBe(1);
	await expect.poll(() => cell(page, 'G1'), { timeout: 15_000 }).toBe(2);
	await expect.poll(() => cell(page, 'F2'), { timeout: 15_000 }).toBe(3);
	await expect.poll(() => cell(page, 'G2'), { timeout: 15_000 }).toBe(4);
});

test('V1-0-3: tagged string return round-trips for TypedValue display', async ({ page }) => {
	await gotoSpike(page);
	await page.evaluate(() => window.__spike.setFormula('D3', '=OCTO_QTY(5, "kN")'));
	await expect.poll(() => cell(page, 'D3'), { timeout: 15_000 }).toBe('5 kN');
});
