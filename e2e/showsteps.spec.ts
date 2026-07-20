import { expect, test, type Page } from '@playwright/test';

/**
 * V1-5-4 acceptance (IMPLEMENTATION_PLAN.md §8): show-steps rendering.
 * Expanding a value chip opens its derivation in-canvas (formula →
 * substitution → intermediates → result, all mono, plain text for screen
 * readers); the open panel re-derives when an upstream cell changes; a
 * `=SHOWSTEPS(name)` cell settles to the plain-text derivation string (the
 * session recalc is wired with the derivation-capable evaluator); and a
 * reload rehydrates the SHOWSTEPS cell with zero reproducibility mismatches.
 *
 * Runs against the shared dev deployment (PUBLIC_CONVEX_URL in .env.local):
 * every test creates its own fresh document and deletes it afterwards.
 * Cell/name access goes through `window.__canvas` (the adapter facade, as in
 * chips.spec.ts); chip insertion and expansion use the real UI.
 */

declare global {
	interface Window {
		__canvas: {
			sheetIds: () => string[];
			sheetsMounted: () => boolean;
			getCell: (blockId: string, a1: string) => unknown;
			setCell: (blockId: string, a1: string, input: number | string | boolean) => void;
			publish: (blockId: string, a1: string, name: string) => void;
		};
	}
}

const createdIds: string[] = [];

/** Create a fresh document from /app and land in its editor, ready. */
async function createDoc(page: Page): Promise<string> {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await page.waitForURL(/\/app\/[^/]+$/);
	const id = page.url().split('/').pop() as string;
	createdIds.push(id);
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	return id;
}

/** Insert sheets until the document has `count`, then wait for all grids. */
async function ensureSheets(page: Page, count: number): Promise<string[]> {
	const have = await page.evaluate(() => window.__canvas.sheetIds().length);
	for (let i = have; i < count; i++) await page.getByTestId('insert-sheet').click();
	await page.waitForFunction(
		(n) => window.__canvas.sheetIds().length === n && window.__canvas.sheetsMounted(),
		count,
		{ timeout: 120_000 }
	);
	return page.evaluate(() => window.__canvas.sheetIds());
}

function cell(page: Page, blockId: string, a1: string) {
	return page.evaluate(([b, ref]) => window.__canvas.getCell(b, ref), [blockId, a1]);
}

function setCell(page: Page, blockId: string, a1: string, input: number | string | boolean) {
	return page.evaluate(
		([b, ref, value]) => window.__canvas.setCell(b as string, ref as string, value),
		[blockId, a1, input] as const
	);
}

/** Wait until the debounced saver reports everything persisted. */
async function waitSaved(page: Page): Promise<void> {
	await expect(page.getByTestId('save-state')).toHaveAttribute('data-save-state', 'idle', {
		timeout: 30_000
	});
}

const chip = (page: Page) => page.locator('.tiptap span[data-chip-id]');
const panel = (page: Page) => page.locator('.tiptap [data-chip-steps]');
const lines = (page: Page) => panel(page).locator('[data-step-kind]');

/**
 * One sheet: A1 = 12 published as `beam.span`, B1 `=A1 * 2 + 1` (25)
 * published as `beam.load` — a derivation with all four step kinds.
 * Returns the sheet block id.
 */
async function calcFixture(page: Page): Promise<string> {
	const [a] = await ensureSheets(page, 1);
	await setCell(page, a, 'A1', 12);
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(12);
	await page.evaluate(([id]) => window.__canvas.publish(id, 'A1', 'beam.span'), [a]);
	await setCell(page, a, 'B1', '=A1 * 2 + 1');
	await expect.poll(() => cell(page, a, 'B1'), { timeout: 20_000 }).toBe(25);
	await page.evaluate(([id]) => window.__canvas.publish(id, 'B1', 'beam.load'), [a]);
	return a;
}

/** Insert a chip through the real `@` picker UI into the trailing paragraph. */
async function insertChip(page: Page, query: string): Promise<void> {
	await page.locator('.tiptap > p').last().click();
	await page.keyboard.type(`@${query}`);
	const picker = page.locator('.octo-chip-picker');
	await expect(picker).toBeVisible();
	await expect(picker.locator('[role="option"]').first()).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('Enter');
	await expect(picker).toHaveCount(0);
}

test.afterEach(async ({ page }) => {
	while (createdIds.length > 0) {
		const id = createdIds.pop() as string;
		await page.goto('/app');
		const row = page.getByTestId('doc-row').filter({ has: page.locator(`a[href="/app/${id}"]`) });
		if ((await row.count()) === 0) continue;
		await row.getByTestId('delete').click();
		await row.getByTestId('delete-confirm').click();
		await expect(row).toHaveCount(0);
	}
});

test('expanding a value chip shows the full derivation, mono and labeled', async ({ page }) => {
	await createDoc(page);
	await calcFixture(page);
	await insertChip(page, 'beam.load');
	await expect(chip(page)).toHaveText('25');

	// The expansion affordance: value chips are buttons with aria-expanded.
	await expect(chip(page)).toHaveAttribute('role', 'button');
	await expect(chip(page)).toHaveAttribute('aria-expanded', 'false');
	await expect(panel(page)).toHaveCount(0);

	// Click expands: formula → substitution → intermediate → result, headed by
	// the published name (the alias hop lands on the cell's real formula).
	await chip(page).click();
	await expect(chip(page)).toHaveAttribute('aria-expanded', 'true');
	await expect(panel(page)).toBeVisible();
	await expect(lines(page)).toHaveText([
		'beam.load = A1 * 2 + 1',
		'= 12 * 2 + 1',
		'= 24 + 1',
		'= 25'
	]);
	await expect(lines(page).nth(0)).toHaveAttribute('data-step-kind', 'formula');
	await expect(lines(page).nth(1)).toHaveAttribute('data-step-kind', 'substitution');
	await expect(lines(page).nth(2)).toHaveAttribute('data-step-kind', 'intermediate');
	await expect(lines(page).nth(3)).toHaveAttribute('data-step-kind', 'result');

	// Screen readers get the engine's plain-text form; the styled lines are
	// aria-hidden so nothing reads twice.
	expect(
		await panel(page).locator('.visually-hidden').textContent()
	).toBe('beam.load = A1 * 2 + 1\n  = 12 * 2 + 1\n  = 24 + 1\n  = 25');
	await expect(panel(page).locator('.chip-steps-lines')).toHaveAttribute('aria-hidden', 'true');

	// Click again collapses.
	await chip(page).click();
	await expect(panel(page)).toHaveCount(0);
	await expect(chip(page)).toHaveAttribute('aria-expanded', 'false');
});

test('an open panel re-derives when an upstream cell changes', async ({ page }) => {
	await createDoc(page);
	const a = await calcFixture(page);
	await insertChip(page, 'beam.load');
	await expect(chip(page)).toHaveText('25');

	await chip(page).click();
	await expect(lines(page).last()).toHaveText('= 25');

	// Edit the upstream input while the panel is open: chip AND steps follow.
	await setCell(page, a, 'A1', 10);
	await expect.poll(() => chip(page).locator('span').first().textContent(), {
		timeout: 20_000
	}).toBe('21');
	await expect(lines(page)).toHaveText([
		'beam.load = A1 * 2 + 1',
		'= 10 * 2 + 1',
		'= 20 + 1',
		'= 21'
	]);
});

test('=SHOWSTEPS(name) in a cell settles to the derivation text', async ({ page }) => {
	await createDoc(page);
	const a = await calcFixture(page);

	// The session recalc carries the derivation-capable evaluator, so the
	// cell settles to the plain-text derivation, never the degraded #VALUE!.
	await setCell(page, a, 'C1', '=SHOWSTEPS(beam.span)');
	await expect
		.poll(() => cell(page, a, 'C1'), { timeout: 20_000 })
		.toBe('beam.span = A1\n  = 12');
	await setCell(page, a, 'C2', '=SHOWSTEPS(B1)');
	await expect
		.poll(() => cell(page, a, 'C2'), { timeout: 20_000 })
		.toBe('A1 * 2 + 1\n  = 12 * 2 + 1\n  = 24 + 1\n  = 25');

	// The derivation is live: an upstream edit recomputes the steps text.
	await setCell(page, a, 'A1', 10);
	await expect
		.poll(() => cell(page, a, 'C2'), { timeout: 20_000 })
		.toBe('A1 * 2 + 1\n  = 10 * 2 + 1\n  = 20 + 1\n  = 21');
});

test('reload keeps SHOWSTEPS text and hydration reports zero mismatches', async ({ page }) => {
	await createDoc(page);
	const a = await calcFixture(page);
	await setCell(page, a, 'C1', '=SHOWSTEPS(B1)');
	await expect
		.poll(() => cell(page, a, 'C1'), { timeout: 20_000 })
		.toBe('A1 * 2 + 1\n  = 12 * 2 + 1\n  = 24 + 1\n  = 25');
	await waitSaved(page);

	// hydrateGraph verifies every contentHash on load and the page warns on
	// any mismatch — a SHOWSTEPS node re-derives only because hydration uses
	// the derivation-capable evaluator too.
	const warnings: string[] = [];
	page.on('console', (msg) => {
		if (msg.text().includes('reproducibility mismatches')) warnings.push(msg.text());
	});
	await page.reload();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.waitForFunction(() => window.__canvas?.sheetsMounted(), undefined, {
		timeout: 120_000
	});

	expect(warnings).toEqual([]);
	await expect
		.poll(() => cell(page, a, 'C1'), { timeout: 20_000 })
		.toBe('A1 * 2 + 1\n  = 12 * 2 + 1\n  = 24 + 1\n  = 25');
});
