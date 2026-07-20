import { expect, test, type Page } from '@playwright/test';

/**
 * V1-5-3 acceptance (IMPLEMENTATION_PLAN.md §8): inline live value chips.
 * A sheet publishes a name; typing `@` in prose opens the picker and inserts
 * a chip bound to that node; cell edits update the chip with the recompute
 * flash; an error deep-links to the origin's hosting sheet block; copy/paste
 * keeps chips live (fresh chipId, same node); reload restores bindings; and
 * undo/redo round-trips chip insertion through the ONE engine history.
 *
 * Runs against the shared dev deployment (PUBLIC_CONVEX_URL in .env.local):
 * every test creates its own fresh document and deletes it afterwards.
 * Cell/name access goes through `window.__canvas` (the adapter facade, as in
 * canvas-sheets.spec.ts); chip insertion and the picker use the real UI.
 */

declare global {
	interface Window {
		__canvas: {
			sheetIds: () => string[];
			sheetsMounted: () => boolean;
			blocksOrder: () => string[];
			getCell: (blockId: string, a1: string) => unknown;
			getRawCell: (blockId: string, a1: string) => { v?: unknown; f?: unknown } | null;
			setCell: (blockId: string, a1: string, input: number | string | boolean) => void;
			publish: (blockId: string, a1: string, name: string) => void;
			deleteName: (blockId: string, name: string) => boolean;
			chipIds: () => string[];
			chipBinding: (chipId: string) => { blockId: string; nodeId: string } | null;
			graphDisplay: (blockId: string, a1: string) => unknown;
			formulaOf: (blockId: string, a1: string) => string | null;
			insertSheet: () => void;
			moveBlock: (blockId: string, position: number) => boolean;
			mountMetrics: () => { blockId: string; ms: number }[];
			heapBytes: () => number | null;
		};
		__chipPulsed?: boolean;
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

const chips = (page: Page) => page.locator('.tiptap span[data-chip-id]');
const picker = (page: Page) => page.locator('.octo-chip-picker');

/**
 * One sheet publishing `name` from a cell holding 12 — the standard fixture.
 * Returns the sheet block id.
 */
async function publishFixture(page: Page, name = 'beam.span'): Promise<string> {
	const [a] = await ensureSheets(page, 1);
	await setCell(page, a, 'A1', 12);
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(12);
	await page.evaluate(([id, n]) => window.__canvas.publish(id, 'A1', n), [a, name] as const);
	return a;
}

/** Insert a chip through the real `@` picker UI into the trailing paragraph. */
async function insertChip(page: Page, query: string): Promise<void> {
	await page.locator('.tiptap > p').last().click();
	await page.keyboard.type(`@${query}`);
	await expect(picker(page)).toBeVisible();
	await expect(picker(page).locator('[role="option"]').first()).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await page.keyboard.press('Enter');
	await expect(picker(page)).toHaveCount(0);
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

test('picker inserts a chip; cell edits update it live with the recompute flash', async ({
	page
}) => {
	await createDoc(page);
	const a = await publishFixture(page); // beam.span = A1 = 12
	await setCell(page, a, 'B1', '=A1*2');
	await expect.poll(() => cell(page, a, 'B1'), { timeout: 20_000 }).toBe(24);
	await page.evaluate(([id]) => window.__canvas.publish(id, 'B1', 'beam.load'), [a]);

	// The picker is keyboard-driven and screen-reader labeled (PRD §10).
	await page.locator('.tiptap > p').last().click();
	await page.keyboard.type('Span is @beam');
	await expect(picker(page)).toBeVisible();
	await expect(picker(page)).toHaveAttribute('role', 'listbox');
	await expect(picker(page)).toHaveAttribute('aria-label', 'Published values');
	const options = picker(page).locator('[role="option"]');
	await expect(options).toHaveText(['beam.load', 'beam.span']);
	await expect(options.first()).toHaveAttribute('aria-selected', 'true');

	// ArrowDown moves the highlight (aria-activedescendant tracks it).
	await page.keyboard.press('ArrowDown');
	await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
	await expect(options.first()).toHaveAttribute('aria-selected', 'false');

	// Escape dismisses that trigger; a fresh trigger reopens.
	await page.keyboard.press('Escape');
	await expect(picker(page)).toHaveCount(0);
	for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace'); // delete "@beam"
	await page.keyboard.type('@beam.span');
	await expect(picker(page)).toBeVisible();
	await expect(picker(page).locator('[role="option"]')).toHaveText(['beam.span']);
	await page.keyboard.press('Enter');

	// The chip renders the live value, mono chip styling, labeled for SRs.
	await expect(chips(page)).toHaveCount(1);
	await expect(chips(page)).toHaveText('12');
	await expect(chips(page)).toHaveClass(/chip/);
	await expect(chips(page)).toHaveAttribute('aria-label', 'beam.span: 12');
	expect(await page.evaluate(() => window.__canvas.chipIds().length)).toBe(1);

	// Record the recompute flash (transient 700 ms class) via an observer.
	await page.evaluate(() => {
		const el = document.querySelector('.tiptap span[data-chip-id]');
		if (!el) return;
		window.__chipPulsed = false;
		new MutationObserver(() => {
			if (el.classList.contains('pulse')) window.__chipPulsed = true;
		}).observe(el, { attributes: true, attributeFilter: ['class'] });
	});
	await setCell(page, a, 'A1', 20);
	await expect.poll(() => chips(page).textContent(), { timeout: 20_000 }).toBe('20');
	await expect.poll(() => page.evaluate(() => window.__chipPulsed === true)).toBe(true);
});

test('error chip shows the code and deep-links to the origin sheet block', async ({ page }) => {
	await createDoc(page);
	const [a] = await ensureSheets(page, 1);
	await setCell(page, a, 'A1', 12);
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(12);
	await setCell(page, a, 'B1', '=A1*2');
	await expect.poll(() => cell(page, a, 'B1'), { timeout: 20_000 }).toBe(24);
	await page.evaluate(([id]) => window.__canvas.publish(id, 'B1', 'beam.load'), [a]);

	await insertChip(page, 'beam.load');
	await expect(chips(page)).toHaveText('24');

	// Clearing A1 removes its node: B1 turns #REF! (origin = B1's own node,
	// SCHEMA.md §11) and the chip, bound downstream, renders the code.
	await setCell(page, a, 'A1', '');
	await expect.poll(() => chips(page).textContent(), { timeout: 20_000 }).toBe('#REF!');
	await expect(chips(page)).toHaveClass(/err/);

	// Click deep-links: the origin's hosting sheet block scrolls into view and
	// gets the highlight ring.
	await chips(page).click();
	await expect(page.locator(`div[data-sheet-block="${a}"]`)).toHaveClass(/octo-deeplink/);
	await expect(page.locator(`div[data-sheet-block="${a}"]`)).not.toHaveClass(/octo-deeplink/, {
		timeout: 5_000
	});

	// Chips are focusable: Enter deep-links too (PRD §10).
	await chips(page).focus();
	await page.keyboard.press('Enter');
	await expect(page.locator(`div[data-sheet-block="${a}"]`)).toHaveClass(/octo-deeplink/);

	// Healing the source heals the chip.
	await setCell(page, a, 'A1', 10);
	await expect.poll(() => chips(page).textContent(), { timeout: 20_000 }).toBe('20');
});

test('copy/paste within the doc keeps chips live: fresh chipId, same node', async ({ page }) => {
	await createDoc(page);
	const a = await publishFixture(page);
	await insertChip(page, 'beam.span');
	await expect(chips(page)).toHaveText('12');

	// Copy the chip's paragraph (triple-click = PM node selection), collapse
	// the selection with a plain click, then split and paste below.
	await page.locator('.tiptap > p').last().click({ clickCount: 3 });
	await page.keyboard.press('ControlOrMeta+c');
	await page.locator('.tiptap > p').last().click();
	await page.keyboard.press('Enter');
	await page.keyboard.press('ControlOrMeta+v');

	// Both chips render, live, under DISTINCT chip ids bound to the same node.
	await expect(chips(page)).toHaveCount(2);
	await expect.poll(() => page.evaluate(() => window.__canvas.chipIds().length)).toBe(2);
	const ids = await chips(page).evaluateAll((els) =>
		els.map((el) => (el as HTMLElement).dataset.chipId)
	);
	expect(new Set(ids).size).toBe(2);
	const nodeIds = await page.evaluate(() =>
		window.__canvas.chipIds().map((id) => window.__canvas.chipBinding(id)?.nodeId)
	);
	expect(new Set(nodeIds).size).toBe(1);

	await setCell(page, a, 'A1', 20);
	await expect.poll(() => chips(page).first().textContent(), { timeout: 20_000 }).toBe('20');
	await expect.poll(() => chips(page).last().textContent(), { timeout: 20_000 }).toBe('20');
});

test('reload: the chip binding persists and the chip is still live', async ({ page }) => {
	await createDoc(page);
	const a = await publishFixture(page);
	await insertChip(page, 'beam.span');
	await expect(chips(page)).toHaveText('12');

	await waitSaved(page);
	await page.reload();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.waitForFunction(() => window.__canvas?.sheetsMounted(), undefined, {
		timeout: 120_000
	});

	await expect(chips(page)).toHaveCount(1);
	await expect(chips(page)).toHaveText('12');
	expect(await page.evaluate(() => window.__canvas.chipIds().length)).toBe(1);

	// Still bound: cell edits keep flowing into prose after the reload.
	await setCell(page, a, 'A1', 20);
	await expect.poll(() => chips(page).textContent(), { timeout: 20_000 }).toBe('20');
});

test('undo/redo round-trips chip insertion through the one engine history', async ({ page }) => {
	await createDoc(page);
	const a = await publishFixture(page);
	await insertChip(page, 'beam.span');
	await expect(chips(page)).toHaveText('12');
	expect(await page.evaluate(() => window.__canvas.chipIds().length)).toBe(1);

	// Chip insertion spans two entries: [chipOp create][blockOp update]. The
	// first undo removes the chip node from prose; the second drops the binding.
	await page.locator('.tiptap > p').last().click();
	await page.keyboard.press('ControlOrMeta+z');
	await expect(chips(page)).toHaveCount(0);
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(() => page.evaluate(() => window.__canvas.chipIds().length)).toBe(0);

	// Redo restores the binding first, then the prose — the chip returns live.
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect.poll(() => page.evaluate(() => window.__canvas.chipIds().length)).toBe(1);
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(chips(page)).toHaveCount(1);
	await expect(chips(page)).toHaveText('12');

	// And the round-tripped chip is still live.
	await setCell(page, a, 'A1', 20);
	await expect.poll(() => chips(page).textContent(), { timeout: 20_000 }).toBe('20');
});
