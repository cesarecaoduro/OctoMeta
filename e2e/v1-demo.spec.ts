import { expect, test, type Page } from '@playwright/test';

/**
 * V1-5-6 · the V1 exit gate (IMPLEMENTATION_PLAN.md §8): ONE continuous
 * end-to-end scenario on ONE document — the scripted prototype demo. It walks
 * the whole story through the real UI on /app:
 *
 *   create doc → author markdown prose → insert a sheet, enter inputs and
 *   formulas (one typed straight into the grid), publish names → insert chips
 *   in prose via the @-picker → edit a cell: chips flash and follow (undo/redo
 *   round-trips it) → add a second sheet consuming cross-sheet dotted names →
 *   introduce a #CYCLE! and fix it → introduce a #VALUE! and fix it → expand a
 *   chip to its show-steps derivation → open the provenance inspector and walk
 *   the dependency chain up to a source input and back down → reload: values,
 *   chips, and sheets intact with zero hydration mismatches → undo the last
 *   PRE-reload edit AFTER the reload, redo it, and keep editing live.
 *
 * The image block is exercised by app-editor.spec.ts and skipped here to keep
 * the scenario at live-demo length (< 3 minutes).
 *
 * Runs against the shared dev deployment (PUBLIC_CONVEX_URL in .env.local):
 * the test creates one fresh document and deletes it afterwards. Cell/name
 * access goes through `window.__canvas` (the adapter facade, as in
 * canvas-sheets.spec.ts); prose, chips, steps, inspector, and undo use the
 * real UI. Graph propagation and Univer paints are async, so cell assertions
 * poll; sheet mounts take ~3.4 s each (eager strategy, ARCHITECTURE.md).
 */

declare global {
	interface Window {
		__canvas: {
			sheetIds: () => string[];
			sheetsMounted: () => boolean;
			getCell: (blockId: string, a1: string) => unknown;
			setCell: (blockId: string, a1: string, input: number | string | boolean) => void;
			publish: (blockId: string, a1: string, name: string) => void;
			formulaOf: (blockId: string, a1: string) => string | null;
			chipIds: () => string[];
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

function publish(page: Page, blockId: string, a1: string, name: string) {
	return page.evaluate(
		([b, ref, n]) => window.__canvas.publish(b, ref, n),
		[blockId, a1, name] as const
	);
}

/** Wait until the debounced saver reports everything persisted. */
async function waitSaved(page: Page): Promise<void> {
	await expect(page.getByTestId('save-state')).toHaveAttribute('data-save-state', 'idle', {
		timeout: 30_000
	});
}

const editor = (page: Page) => page.locator('.tiptap');
const chips = (page: Page) => page.locator('.tiptap span[data-chip-id]');
const stepsPanel = (page: Page) => page.locator('.tiptap [data-chip-steps]');
const stepLines = (page: Page) => stepsPanel(page).locator('[data-step-kind]');
const inspector = (page: Page) => page.getByTestId('inspector');
const inspectorTitle = (page: Page) => page.getByTestId('inspector-title');
const gridCanvas = (page: Page, blockId: string) =>
	page.locator(`div[data-sheet-block="${blockId}"] canvas[id^="univer-sheet-main-canvas"]`).first();

/** Pick a chip through the real `@` picker at the current caret position. */
async function pickChip(page: Page, query: string): Promise<void> {
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

test('V1 demo: the full prototype story, end to end on one document', async ({ page }) => {
	test.setTimeout(300_000);
	await createDoc(page);

	// ── 1 · Markdown prose: heading + bold via input rules ──────────────────
	await editor(page).click();
	await page.keyboard.type('# Simply supported beam');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Design check for a **uniform** load w over span L.');
	await expect(editor(page).locator('h1')).toHaveText('Simply supported beam');
	await expect(editor(page).locator('p strong')).toHaveText('uniform');

	// ── 2 · Sheet 1: inputs and the moment formula, names published ─────────
	const [inputs] = await ensureSheets(page, 1);

	// One input typed straight into the grid (real keyboard path): (80, 50)
	// lands on A2 once the ~20 px headers are accounted for (spike-proven).
	await gridCanvas(page, inputs).click({ position: { x: 80, y: 50 } });
	await page.keyboard.type('8');
	await page.keyboard.press('Enter');
	await expect.poll(() => cell(page, inputs, 'A2'), { timeout: 20_000 }).toBe(8);
	await page.keyboard.press('Escape'); // leave the grid, back to the document

	await setCell(page, inputs, 'A1', 15);
	await expect.poll(() => cell(page, inputs, 'A1'), { timeout: 20_000 }).toBe(15);
	await setCell(page, inputs, 'A3', '=A1 * A2^2 / 8'); // M = w·L²/8
	await expect.poll(() => cell(page, inputs, 'A3'), { timeout: 20_000 }).toBe(120);
	await publish(page, inputs, 'A1', 'beam.w');
	await publish(page, inputs, 'A2', 'beam.span');
	await publish(page, inputs, 'A3', 'beam.moment');

	// ── 3 · Chips in prose via the @-picker ─────────────────────────────────
	// Both chips land in the trailing paragraph: click once (empty paragraph,
	// caret at start), then keep typing — the caret sits after each insert.
	await page.locator('.tiptap > p').last().click();
	await page.keyboard.type('The midspan moment is ');
	await pickChip(page, 'beam.moment');
	await page.keyboard.type(' over a span of ');
	await pickChip(page, 'beam.span');
	await expect(chips(page)).toHaveCount(2);
	await expect(chips(page).first()).toHaveText('120');
	await expect(chips(page).last()).toHaveText('8');

	// Let the 300 ms prose debounce and the 500 ms saver settle so the typed
	// text is committed BEFORE the next cell edit — the toolbar undo below must
	// target the cell edit, not a pending prose flush.
	await waitSaved(page);

	// ── 4 · Edit a cell: the chip flashes and follows; undo/redo round-trips ─
	await page.evaluate(() => {
		const el = document.querySelector('.tiptap span[data-chip-id]');
		if (!el) return;
		window.__chipPulsed = false;
		new MutationObserver(() => {
			if (el.classList.contains('pulse')) window.__chipPulsed = true;
		}).observe(el, { attributes: true, attributeFilter: ['class'] });
	});
	await setCell(page, inputs, 'A1', 20); // w: 15 → 20
	await expect.poll(() => chips(page).first().textContent(), { timeout: 20_000 }).toBe('160');
	await expect.poll(() => page.evaluate(() => window.__chipPulsed === true)).toBe(true);

	// The one engine history spans cell edits: toolbar undo/redo round-trips.
	await page.getByTestId('undo').click();
	await expect.poll(() => chips(page).first().textContent(), { timeout: 20_000 }).toBe('120');
	await page.getByTestId('redo').click();
	await expect.poll(() => chips(page).first().textContent(), { timeout: 20_000 }).toBe('160');

	// ── 5 · Sheet 2: cross-sheet dotted references ──────────────────────────
	// Pin the insertion point at the document end (undo/redo may have moved
	// the selection), then insert the second sheet.
	await page.locator('.tiptap > p').last().click();
	const sheetIds = await ensureSheets(page, 2);
	const checks = sheetIds.find((id) => id !== inputs) as string;
	await setCell(page, checks, 'A1', 200); // capacity
	await expect.poll(() => cell(page, checks, 'A1'), { timeout: 20_000 }).toBe(200);
	await setCell(page, checks, 'A2', '=beam.moment / A1');
	await expect.poll(() => cell(page, checks, 'A2'), { timeout: 20_000 }).toBe(0.8);
	await publish(page, checks, 'A2', 'beam.util');
	// The dotted reference is live across sheets — proven again after reload.

	// ── 6 · Introduce a #CYCLE! and fix it ──────────────────────────────────
	await setCell(page, checks, 'B1', '=B1 + 1');
	await expect.poll(() => cell(page, checks, 'B1'), { timeout: 20_000 }).toBe('#CYCLE!');
	await setCell(page, checks, 'B1', '=beam.span * 2'); // the fix, cross-sheet too
	await expect.poll(() => cell(page, checks, 'B1'), { timeout: 20_000 }).toBe(16);

	// ── 7 · Introduce a #VALUE! and fix it ──────────────────────────────────
	await setCell(page, checks, 'B3', 'eight'); // a string where a number belongs
	await expect.poll(() => cell(page, checks, 'B3'), { timeout: 20_000 }).toBe('eight');
	await setCell(page, checks, 'B2', '=B3 * 2');
	await expect.poll(() => cell(page, checks, 'B2'), { timeout: 20_000 }).toBe('#VALUE!');
	await setCell(page, checks, 'B3', 4); // the fix — the LAST pre-reload edit
	await expect.poll(() => cell(page, checks, 'B2'), { timeout: 20_000 }).toBe(8);

	// ── 8 · Expand a chip to its show-steps derivation ──────────────────────
	await expect(chips(page).first()).toHaveAttribute('aria-expanded', 'false');
	await chips(page).first().click();
	await expect(stepsPanel(page)).toBeVisible();
	await expect(stepLines(page)).toHaveText([
		'beam.moment = A1 * A2 ^ 2 / 8',
		'= 20 * 8 ^ 2 / 8',
		'= 20 * 64 / 8',
		'= 1280 / 8',
		'= 160'
	]);
	await chips(page).first().click(); // collapse
	await expect(stepsPanel(page)).toHaveCount(0);

	// ── 9 · Provenance inspector: walk the chain up and back down ───────────
	await chips(page).first().click({ modifiers: ['Alt'] });
	await expect(inspector(page)).toBeVisible();
	await expect(inspectorTitle(page)).toHaveText('beam.moment');
	await expect(page.getByTestId('inspector-kind')).toHaveText('namedOutput');
	await expect(page.getByTestId('inspector-value')).toHaveText('160');
	await expect(page.getByTestId('inspector-authored')).toContainText('human');

	// Up: beam.moment ← A3 (the formula cell) ← A1 (a source input).
	await page.getByTestId('inspector-input').click();
	await expect(inspectorTitle(page)).toHaveText('A3');
	await expect(page.getByTestId('inspector-kind')).toHaveText('formula');
	await expect(page.getByTestId('inspector-formula')).toHaveText('= A1 * A2 ^ 2 / 8');
	await expect(page.getByTestId('inspector-input')).toHaveText([/A1/, /A2/]);
	await page.getByTestId('inspector-input').first().click();
	await expect(inspectorTitle(page)).toHaveText('A1');
	await expect(page.getByTestId('inspector-kind')).toHaveText('input');
	await expect(page.getByTestId('inspector-value')).toHaveText('20');
	await expect(page.getByTestId('inspector-formula')).toHaveCount(0);
	await expect(page.getByTestId('inspector-input')).toHaveCount(0); // a source

	// Down: A1 → A3 → beam.moment, via the dependents links.
	await expect(page.getByTestId('inspector-dependent')).toHaveText([/A3/, /beam\.w/]);
	await page.getByTestId('inspector-dependent').first().click();
	await expect(inspectorTitle(page)).toHaveText('A3');
	await page.getByTestId('inspector-dependent').first().click();
	await expect(inspectorTitle(page)).toHaveText('beam.moment');
	await page.keyboard.press('Escape');
	await expect(inspector(page)).toHaveCount(0);

	// ── 10 · Reload: state intact, zero hydration mismatches ────────────────
	const warnings: string[] = [];
	page.on('console', (msg) => {
		if (msg.text().includes('reproducibility mismatches')) warnings.push(msg.text());
	});
	await waitSaved(page);
	await page.reload();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.waitForFunction(() => window.__canvas?.sheetsMounted(), undefined, {
		timeout: 120_000
	});
	expect(warnings).toEqual([]);

	// Prose, chips, and every sheet value came back exactly.
	await expect(editor(page).locator('h1')).toHaveText('Simply supported beam');
	await expect(editor(page).locator('p strong')).toHaveText('uniform');
	await expect(chips(page)).toHaveCount(2);
	await expect(chips(page).first()).toHaveText('160');
	await expect(chips(page).last()).toHaveText('8');
	expect((await page.evaluate(() => window.__canvas.sheetIds())).sort()).toEqual(
		[inputs, checks].sort()
	);
	await expect.poll(() => cell(page, inputs, 'A1'), { timeout: 20_000 }).toBe(20);
	await expect.poll(() => cell(page, inputs, 'A3'), { timeout: 20_000 }).toBe(160);
	await expect.poll(() => cell(page, checks, 'A2'), { timeout: 20_000 }).toBe(0.8);
	await expect.poll(() => cell(page, checks, 'B1'), { timeout: 20_000 }).toBe(16);
	await expect.poll(() => cell(page, checks, 'B2'), { timeout: 20_000 }).toBe(8);
	expect(await page.evaluate(([id]) => window.__canvas.formulaOf(id, 'A2'), [checks])).toBe(
		'beam.moment / A1'
	);

	// ── 11 · Undo a PRE-reload edit AFTER the reload; redo; stay live ───────
	// The last pre-reload commit was the #VALUE! fix (B3: 'eight' → 4).
	await page.locator('.tiptap > p').last().click();
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(() => cell(page, checks, 'B3'), { timeout: 20_000 }).toBe('eight');
	await expect.poll(() => cell(page, checks, 'B2'), { timeout: 20_000 }).toBe('#VALUE!');
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect.poll(() => cell(page, checks, 'B2'), { timeout: 20_000 }).toBe(8);

	// And the whole document is still one live graph: a fresh edit fans out
	// across sheets and into prose.
	await setCell(page, inputs, 'A1', 10); // w: 20 → 10 ⇒ M = 80, util = 0.4
	await expect.poll(() => chips(page).first().textContent(), { timeout: 20_000 }).toBe('80');
	await expect.poll(() => cell(page, checks, 'A2'), { timeout: 20_000 }).toBe(0.4);
});
