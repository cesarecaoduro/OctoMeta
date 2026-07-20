import { expect, test, type Page } from '@playwright/test';

/**
 * V1-3-1 acceptance, run against the production build (SSR + hydration).
 *
 * The /sheet page mounts two Univer instances bound to one DocumentGraph and
 * exposes `window.__sheet` hooks so cell/name access goes through the adapter
 * facade deterministically (docs/v1-0-findings.md landmine 5: pointer tests
 * must target `canvas[id^="univer-sheet-main-canvas"]`; headers eat ~20 px).
 * Graph propagation and Univer paints are async, so cell assertions poll.
 */

declare global {
	interface Window {
		__sheet: {
			isReady: () => boolean;
			status: () => string;
			getCell: (s: 'a' | 'b', a1: string) => unknown;
			getRawCell: (s: 'a' | 'b', a1: string) => { v?: unknown; f?: unknown } | null;
			setCell: (s: 'a' | 'b', a1: string, input: number | string | boolean) => void;
			publish: (s: 'a' | 'b', a1: string, name: string) => void;
			rename: (oldName: string, newName: string) => boolean;
			deleteName: (name: string) => boolean;
			formulaOf: (s: 'a' | 'b', a1: string) => string | null;
			graphDisplay: (s: 'a' | 'b', a1: string) => unknown;
			restore: () => Promise<void>;
		};
	}
}

async function gotoSheet(page: Page) {
	await page.goto('/sheet');
	await expect(
		page.locator('[data-sheet="a"] canvas[id^="univer-sheet-main-canvas"]').first()
	).toBeVisible({ timeout: 45_000 });
	await expect(
		page.locator('[data-sheet="b"] canvas[id^="univer-sheet-main-canvas"]').first()
	).toBeVisible({ timeout: 45_000 });
	await page.waitForFunction(() => window.__sheet?.isReady(), undefined, { timeout: 45_000 });
}

function cell(page: Page, sheet: 'a' | 'b', a1: string) {
	return page.evaluate(([s, ref]) => window.__sheet.getCell(s as 'a' | 'b', ref), [sheet, a1]);
}

function setCell(page: Page, sheet: 'a' | 'b', a1: string, input: number | string | boolean) {
	return page.evaluate(
		([s, ref, value]) => window.__sheet.setCell(s as 'a' | 'b', ref as string, value),
		[sheet, a1, input] as const
	);
}

test('page SSRs, hydrates, and mounts two live grids', async ({ page }) => {
	const response = await page.request.get('/sheet');
	expect(response.ok()).toBeTruthy();
	expect(await response.text()).toContain('Two sheets, one graph');
	await gotoSheet(page);
});

test('typing =5 * 2 into the grid shows 10, computed by the graph', async ({ page }) => {
	await gotoSheet(page);

	// Click into sheet A's grid canvas: (80, 50) lands on A2 once the ~20 px
	// headers are accounted for (spike-proven coordinates).
	const canvas = page
		.locator('[data-sheet="a"] canvas[id^="univer-sheet-main-canvas"]')
		.first();
	await canvas.click({ position: { x: 80, y: 50 } });
	await page.keyboard.type('=5 * 2');
	await page.keyboard.press('Enter');

	await expect.poll(() => cell(page, 'a', 'A2'), { timeout: 20_000 }).toBe(10);
	// Univer recalc is demoted to display: no formula survives in the cell
	// model, the graph owns it.
	const raw = await page.evaluate(() => window.__sheet.getRawCell('a', 'A2'));
	expect(raw?.f ?? null).toBeNull();
	const formula = await page.evaluate(() => window.__sheet.formulaOf('a', 'A2'));
	expect(formula).toBe('5 * 2');
});

test('published name on sheet A resolves in a sheet B formula, reactively', async ({ page }) => {
	await gotoSheet(page);

	await setCell(page, 'a', 'A1', 12);
	await expect.poll(() => cell(page, 'a', 'A1'), { timeout: 20_000 }).toBe(12);
	await page.evaluate(() => window.__sheet.publish('a', 'A1', 'beam.span'));

	await setCell(page, 'b', 'A1', '=beam.span * 2');
	await expect.poll(() => cell(page, 'b', 'A1'), { timeout: 20_000 }).toBe(24);

	// Edit the source cell: the consumer on the other sheet follows.
	await setCell(page, 'a', 'A1', 20);
	await expect.poll(() => cell(page, 'b', 'A1'), { timeout: 20_000 }).toBe(40);
});

test('renaming the published name updates dependents (Excel semantics)', async ({ page }) => {
	await gotoSheet(page);

	await setCell(page, 'a', 'A1', 12);
	await expect.poll(() => cell(page, 'a', 'A1'), { timeout: 20_000 }).toBe(12);
	await page.evaluate(() => window.__sheet.publish('a', 'A1', 'beam.span'));
	await setCell(page, 'b', 'A1', '=beam.span * 2');
	await expect.poll(() => cell(page, 'b', 'A1'), { timeout: 20_000 }).toBe(24);

	const renamed = await page.evaluate(() => window.__sheet.rename('beam.span', 'beam.length'));
	expect(renamed).toBe(true);

	// The dependent formula was rewritten to the new name and still resolves.
	await expect
		.poll(() => page.evaluate(() => window.__sheet.formulaOf('b', 'A1')), { timeout: 20_000 })
		.toBe('beam.length * 2');
	await expect.poll(() => cell(page, 'b', 'A1'), { timeout: 20_000 }).toBe(24);

	// And it stays live under the new name.
	await setCell(page, 'a', 'A1', 20);
	await expect.poll(() => cell(page, 'b', 'A1'), { timeout: 20_000 }).toBe(40);
});

test('deleting the published name turns dependents into name errors', async ({ page }) => {
	await gotoSheet(page);

	await setCell(page, 'a', 'A1', 12);
	await expect.poll(() => cell(page, 'a', 'A1'), { timeout: 20_000 }).toBe(12);
	await page.evaluate(() => window.__sheet.publish('a', 'A1', 'beam.span'));
	await setCell(page, 'b', 'A1', '=beam.span * 2');
	await expect.poll(() => cell(page, 'b', 'A1'), { timeout: 20_000 }).toBe(24);

	const deleted = await page.evaluate(() => window.__sheet.deleteName('beam.span'));
	expect(deleted).toBe(true);
	// The unresolved published name settles as #NAME? (SCHEMA.md §11).
	await expect.poll(() => cell(page, 'b', 'A1'), { timeout: 20_000 }).toBe('#NAME?');
});

test('a self-referencing formula shows #CYCLE! in the cell', async ({ page }) => {
	await gotoSheet(page);
	await setCell(page, 'a', 'C3', '=C3 + 1');
	await expect.poll(() => cell(page, 'a', 'C3'), { timeout: 20_000 }).toBe('#CYCLE!');
});

test('error codes render as their code text', async ({ page }) => {
	await gotoSheet(page);
	await setCell(page, 'a', 'D1', '=NOSUCHFN(1)');
	await expect.poll(() => cell(page, 'a', 'D1'), { timeout: 20_000 }).toBe('#NAME?');
	await setCell(page, 'a', 'D2', '=ghost.name + 1');
	await expect.poll(() => cell(page, 'a', 'D2'), { timeout: 20_000 }).toBe('#NAME?');
});

test('engine registry functions evaluate through the graph', async ({ page }) => {
	await gotoSheet(page);
	await setCell(page, 'a', 'E1', '=SUM(1, 2, 3) + MAX(1, 10)');
	await expect.poll(() => cell(page, 'a', 'E1'), { timeout: 20_000 }).toBe(16);
});

test('snapshot serialize -> teardown -> restore keeps cells and graph bindings', async ({
	page
}) => {
	await gotoSheet(page);

	await setCell(page, 'a', 'A1', 12);
	await setCell(page, 'a', 'B2', 'persisted');
	await expect.poll(() => cell(page, 'a', 'B2'), { timeout: 20_000 }).toBe('persisted');
	await page.evaluate(() => window.__sheet.publish('a', 'A1', 'beam.span'));
	await setCell(page, 'b', 'A1', '=beam.span * 2');
	await expect.poll(() => cell(page, 'b', 'A1'), { timeout: 20_000 }).toBe(24);

	await page.evaluate(() => window.__sheet.restore());
	await expect(page.getByTestId('status')).toHaveText('restored', { timeout: 60_000 });
	await page.waitForFunction(() => window.__sheet?.isReady(), undefined, { timeout: 45_000 });

	await expect.poll(() => cell(page, 'a', 'B2'), { timeout: 20_000 }).toBe('persisted');
	await expect.poll(() => cell(page, 'a', 'A1'), { timeout: 20_000 }).toBe(12);
	await expect.poll(() => cell(page, 'b', 'A1'), { timeout: 20_000 }).toBe(24);

	// The binding survived: editing the restored source still drives sheet B.
	await setCell(page, 'a', 'A1', 20);
	await expect.poll(() => cell(page, 'b', 'A1'), { timeout: 20_000 }).toBe(40);
});
