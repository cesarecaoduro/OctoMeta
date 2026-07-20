import { expect, test, type Page } from '@playwright/test';

/**
 * V1-5-5 acceptance (IMPLEMENTATION_PLAN.md §8): the provenance inspector —
 * the read-only reviewability panel. Alt+click (or Alt+Enter) on a chip opens
 * it targeted at the chip's bound node, showing name, kind, canonical
 * formula, current value, and authorship; its inputs/dependents links walk
 * the dependency chain up to a source input and back down without leaving the
 * panel; selecting a graph-bound sheet cell targets its node; the close
 * button and Escape close it, returning focus to the opening chip.
 *
 * Runs against the shared dev deployment (PUBLIC_CONVEX_URL in .env.local):
 * every test creates its own fresh document and deletes it afterwards.
 * Cell/name access goes through `window.__canvas` (the adapter facade, as in
 * chips.spec.ts); chip insertion, the inspector, and cell selection use the
 * real UI (canvas clicks for selection — the adapter's user-intent gate means
 * programmatic selection never opens the panel).
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

const chips = (page: Page) => page.locator('.tiptap span[data-chip-id]');
const inspector = (page: Page) => page.getByTestId('inspector');
const inspectorTitle = (page: Page) => page.getByTestId('inspector-title');

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

/**
 * The standard fixture: one sheet where A1 = 12 publishes `beam.span` and
 * B1 `=A1*2` publishes `beam.load`, plus a chip on `beam.load` in prose.
 * Returns the sheet block id.
 */
async function chainFixture(page: Page): Promise<string> {
	const [a] = await ensureSheets(page, 1);
	await setCell(page, a, 'A1', 12);
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(12);
	await setCell(page, a, 'B1', '=A1*2');
	await expect.poll(() => cell(page, a, 'B1'), { timeout: 20_000 }).toBe(24);
	await page.evaluate(([id]) => window.__canvas.publish(id, 'A1', 'beam.span'), [a]);
	await page.evaluate(([id]) => window.__canvas.publish(id, 'B1', 'beam.load'), [a]);
	await insertChip(page, 'beam.load');
	await expect(chips(page)).toHaveText('24');
	return a;
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

test('Alt+click on a chip opens the inspector: name, kind, formula, value, authorship', async ({
	page
}) => {
	await createDoc(page);
	await chainFixture(page);

	// The affordance is announced to assistive tech on the chip itself.
	await expect(chips(page)).toHaveAttribute('aria-keyshortcuts', 'Alt+Enter');

	await chips(page).click({ modifiers: ['Alt'] });
	await expect(inspector(page)).toBeVisible();

	// The chip binds the published name: a namedOutput aliasing cell B1.
	await expect(inspectorTitle(page)).toHaveText('beam.load');
	await expect(page.getByTestId('inspector-kind')).toHaveText('namedOutput');
	await expect(page.getByTestId('inspector-formula')).toHaveText('= B1');
	await expect(page.getByTestId('inspector-value')).toHaveText('24');
	// Authorship: actor kind plus a human-readable absolute time.
	await expect(page.getByTestId('inspector-authored')).toContainText('human');
	await expect(page.getByTestId('inspector-authored')).toContainText(String(new Date().getFullYear()));

	// Opening from the chip moves focus to the panel (keyboard walkable).
	await expect(inspector(page)).toBeFocused();

	// Alt+click never triggered the show-steps expansion (V1-5-4 affordance).
	await expect(chips(page)).toHaveAttribute('aria-expanded', 'false');
});

test('inputs links walk up to the source input; dependents walk back down', async ({ page }) => {
	await createDoc(page);
	await chainFixture(page);

	await chips(page).click({ modifiers: ['Alt'] });
	await expect(inspectorTitle(page)).toHaveText('beam.load'); // namedOutput

	// beam.load ← B1 (the computed cell).
	await expect(page.getByTestId('inspector-input')).toHaveText(/B1/);
	await page.getByTestId('inspector-input').click();
	await expect(inspectorTitle(page)).toHaveText('B1');
	await expect(page.getByTestId('inspector-kind')).toHaveText('formula');
	await expect(page.getByTestId('inspector-formula')).toHaveText('= A1 * 2');
	await expect(page.getByTestId('inspector-value')).toHaveText('24');

	// B1 ← A1 (the source input: no formula, no further inputs).
	await page.getByTestId('inspector-input').click();
	await expect(inspectorTitle(page)).toHaveText('A1');
	await expect(page.getByTestId('inspector-kind')).toHaveText('input');
	await expect(page.getByTestId('inspector-value')).toHaveText('12');
	await expect(page.getByTestId('inspector-formula')).toHaveCount(0);
	await expect(page.getByTestId('inspector-input')).toHaveCount(0);

	// Back down the chain: A1 → B1 → beam.load, via dependents (sorted).
	const dependents = page.getByTestId('inspector-dependent');
	await expect(dependents).toHaveText([/B1/, /beam\.span/]);
	await dependents.first().click();
	await expect(inspectorTitle(page)).toHaveText('B1');
	await expect(dependents).toHaveText([/beam\.load/]);
	await dependents.first().click();
	await expect(inspectorTitle(page)).toHaveText('beam.load');
});

test('selecting a graph-bound sheet cell targets its node, live', async ({ page }) => {
	await createDoc(page);
	const [a] = await ensureSheets(page, 1);
	// Bind B2 (not the default A1 selection) so the user click changes the
	// selection for certain: rowHeader ≈46px + col A 88px puts col B around
	// x=178; colHeader ≈20px + row 1 at 24px puts row 2 around y=56.
	await setCell(page, a, 'B2', 12);
	await expect.poll(() => cell(page, a, 'B2'), { timeout: 20_000 }).toBe(12);
	await expect(inspector(page)).toHaveCount(0);

	const canvas = page.locator(
		`div[data-sheet-block="${a}"] canvas[id^="univer-sheet-main-canvas"]`
	);
	await canvas.click({ position: { x: 178, y: 56 } });

	await expect(inspector(page)).toBeVisible();
	await expect(inspectorTitle(page)).toHaveText('B2');
	await expect(page.getByTestId('inspector-kind')).toHaveText('input');
	await expect(page.getByTestId('inspector-value')).toHaveText('12');
	// Cell-selection opening never steals focus from the grid.
	await expect(inspector(page)).not.toBeFocused();

	// The open panel is live: the value follows a cell edit (settle fan-out).
	await setCell(page, a, 'B2', 20);
	await expect
		.poll(() => page.getByTestId('inspector-value').textContent(), { timeout: 20_000 })
		.toBe('20');
});

test('close button and Escape close the panel; focus returns to the chip', async ({ page }) => {
	await createDoc(page);
	await chainFixture(page);

	// Open from the chip, close with the button: focus returns to the chip.
	await chips(page).click({ modifiers: ['Alt'] });
	await expect(inspector(page)).toBeVisible();
	await page.getByTestId('inspector-close').click();
	await expect(inspector(page)).toHaveCount(0);
	await expect(chips(page)).toBeFocused();

	// Reopen with the keyboard affordance (Alt+Enter on the focused chip).
	await page.keyboard.press('Alt+Enter');
	await expect(inspector(page)).toBeVisible();
	await expect(inspector(page)).toBeFocused();

	// Escape closes from anywhere outside a grid.
	await page.keyboard.press('Escape');
	await expect(inspector(page)).toHaveCount(0);
	await expect(chips(page)).toBeFocused();
});
