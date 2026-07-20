import { expect, test, type Page } from '@playwright/test';

/**
 * V1-5-2 acceptance (IMPLEMENTATION_PLAN.md §8): sheet blocks in the TipTap
 * canvas. Two sheets in one document publish/consume dotted names through the
 * ONE graph; block moves never change values (SCHEMA.md §5); reload restores
 * both Univer snapshots and all graph state; page-level undo reverts cell
 * edits (and in-grid Cmd/Ctrl+Z routes to the same engine history — Univer's
 * internal undo is suppressed); mount time + JS heap measured at 2/4/8 sheets
 * (docs/v1-0-findings.md landmine 2).
 *
 * Runs against the shared dev deployment (PUBLIC_CONVEX_URL in .env.local):
 * every test creates its own fresh document and deletes it afterwards.
 * Cell/name access goes through `window.__canvas` (the adapter facade) so
 * assertions are deterministic; graph propagation and Univer paints are
 * async, so cell assertions poll.
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
			graphDisplay: (blockId: string, a1: string) => unknown;
			formulaOf: (blockId: string, a1: string) => string | null;
			insertSheet: () => void;
			moveBlock: (blockId: string, position: number) => boolean;
			mountMetrics: () => { blockId: string; ms: number }[];
			heapBytes: () => number | null;
		};
	}
}

// Precise `performance.memory` numbers for the landmine-2 heap measurement.
test.use({ launchOptions: { args: ['--enable-precise-memory-info'] } });

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

const gridCanvas = (page: Page, blockId: string) =>
	page
		.locator(`div[data-sheet-block="${blockId}"] canvas[id^="univer-sheet-main-canvas"]`)
		.first();

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

test('two sheets in one doc: A publishes beam.span, B consumes and follows edits', async ({
	page
}) => {
	await createDoc(page);
	const [a, b] = await ensureSheets(page, 2);

	await setCell(page, a, 'A1', 12);
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(12);
	await page.evaluate(([id]) => window.__canvas.publish(id, 'A1', 'beam.span'), [a]);

	await setCell(page, b, 'A1', '=beam.span * 2');
	await expect.poll(() => cell(page, b, 'A1'), { timeout: 20_000 }).toBe(24);

	// Univer recalc stays demoted to display: no formula in the cell model.
	const raw = await page.evaluate(([id]) => window.__canvas.getRawCell(id, 'A1'), [b]);
	expect(raw?.f ?? null).toBeNull();
	expect(await page.evaluate(([id]) => window.__canvas.formulaOf(id, 'A1'), [b])).toBe(
		'beam.span * 2'
	);

	// Edit the source cell: the consumer on the other sheet follows.
	await setCell(page, a, 'A1', 20);
	await expect.poll(() => cell(page, b, 'A1'), { timeout: 20_000 }).toBe(40);
});

test('moving a sheet block up/down never changes any value (SCHEMA.md §5)', async ({ page }) => {
	await createDoc(page);
	const [a, b] = await ensureSheets(page, 2);

	await setCell(page, a, 'A1', 12);
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(12);
	await page.evaluate(([id]) => window.__canvas.publish(id, 'A1', 'beam.span'), [a]);
	await setCell(page, b, 'A1', '=beam.span * 2');
	await expect.poll(() => cell(page, b, 'A1'), { timeout: 20_000 }).toBe(24);

	// Move sheet B to the top (blockOp move — the same write path the toolbar
	// and Alt-Arrow shortcuts use). The NodeView remounts from its snapshot.
	const moved = await page.evaluate(([id]) => window.__canvas.moveBlock(id, 0), [b]);
	expect(moved).toBe(true);
	await page.waitForFunction(() => window.__canvas.sheetsMounted(), undefined, {
		timeout: 60_000
	});
	expect(await page.evaluate(() => window.__canvas.blocksOrder())).toEqual([b, a]);

	// Values identical after the move, in the graph and on the repainted grids.
	expect(await page.evaluate(([id]) => window.__canvas.graphDisplay(id, 'A1'), [a])).toBe(12);
	expect(await page.evaluate(([id]) => window.__canvas.graphDisplay(id, 'A1'), [b])).toBe(24);
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(12);
	await expect.poll(() => cell(page, b, 'A1'), { timeout: 20_000 }).toBe(24);

	// And back down: still unchanged, still live.
	await page.evaluate(([id]) => window.__canvas.moveBlock(id, 1), [b]);
	await page.waitForFunction(() => window.__canvas.sheetsMounted(), undefined, {
		timeout: 60_000
	});
	await expect.poll(() => cell(page, b, 'A1'), { timeout: 20_000 }).toBe(24);
	await setCell(page, a, 'A1', 20);
	await expect.poll(() => cell(page, b, 'A1'), { timeout: 20_000 }).toBe(40);
});

test('reload restores both snapshots and all graph state, formulas still live', async ({
	page
}) => {
	await createDoc(page);
	const [a, b] = await ensureSheets(page, 2);

	await setCell(page, a, 'A1', 12);
	await setCell(page, a, 'B2', 'persisted');
	await expect.poll(() => cell(page, a, 'B2'), { timeout: 20_000 }).toBe('persisted');
	await page.evaluate(([id]) => window.__canvas.publish(id, 'A1', 'beam.span'), [a]);
	await setCell(page, b, 'A1', '=beam.span * 2');
	await expect.poll(() => cell(page, b, 'A1'), { timeout: 20_000 }).toBe(24);

	await waitSaved(page);
	await page.reload();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.waitForFunction(() => window.__canvas?.sheetsMounted(), undefined, {
		timeout: 120_000
	});

	// Both sheets restored (same ids, same cells) and the graph is intact.
	expect(await page.evaluate(() => window.__canvas.sheetIds())).toEqual([a, b]);
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(12);
	await expect.poll(() => cell(page, a, 'B2'), { timeout: 20_000 }).toBe('persisted');
	await expect.poll(() => cell(page, b, 'A1'), { timeout: 20_000 }).toBe(24);
	expect(await page.evaluate(([id]) => window.__canvas.formulaOf(id, 'A1'), [b])).toBe(
		'beam.span * 2'
	);

	// The dependency survived persistence: edits still propagate across sheets.
	await setCell(page, a, 'A1', 20);
	await expect.poll(() => cell(page, b, 'A1'), { timeout: 20_000 }).toBe(40);
});

test('one undo history: page shortcut and in-grid chord both revert cell edits', async ({
	page
}) => {
	await createDoc(page);
	const [a] = await ensureSheets(page, 1);

	await setCell(page, a, 'A1', 12);
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(12);
	await setCell(page, a, 'A1', 99);
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(99);

	// Page-level shortcut (focus in prose — the trailing paragraph, NOT the
	// grid) runs engine commitUndo; the settle fan-out repaints the grid cell.
	await page.locator('.tiptap p').last().click();
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(12);
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(99);

	// In-grid chord: Univer's internal undo is suppressed; the same engine
	// history entry is undone (no split-brain histories).
	await gridCanvas(page, a).click({ position: { x: 80, y: 50 } });
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(12);
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect.poll(() => cell(page, a, 'A1'), { timeout: 20_000 }).toBe(99);

	// The graph agrees with the display either way.
	expect(await page.evaluate(([id]) => window.__canvas.graphDisplay(id, 'A1'), [a])).toBe(99);
});

test('focus: grid keys never leak to prose; Escape hands focus back', async ({ page }) => {
	await createDoc(page);

	await page.locator('.tiptap').click();
	await page.keyboard.type('prose line');
	const [a] = await ensureSheets(page, 1);

	// Type inside the grid: nothing may leak into the prose block.
	await gridCanvas(page, a).click({ position: { x: 80, y: 50 } });
	await page.keyboard.type('123');
	await page.keyboard.press('Enter');
	await expect(page.locator('.tiptap p').first()).toHaveText('prose line');

	// Escape leaves the grid: the sheet node is selected and prose has focus.
	await page.keyboard.press('Escape');
	await expect(page.locator('div[data-sheet-block].ProseMirror-selectednode')).toHaveCount(1, {
		timeout: 10_000
	});
	// Keyboard is back in the document: arrow down + typing lands in prose.
	await page.keyboard.press('ArrowDown');
	await page.keyboard.type('after the sheet');
	await expect(page.locator('.tiptap')).toContainText('after the sheet');
});

test('mount metrics at 2/4/8 sheets (landmine 2): measure and record', async ({
	page
}, testInfo) => {
	test.setTimeout(600_000);
	await createDoc(page);

	const readings: { sheets: number; mounts: number[]; totalMs: number; heapMB: number | null }[] =
		[];
	for (const n of [2, 4, 8]) {
		await ensureSheets(page, n);
		const metrics = await page.evaluate(() => window.__canvas.mountMetrics());
		const heap = await page.evaluate(() => window.__canvas.heapBytes());
		readings.push({
			sheets: n,
			mounts: metrics.map((m) => m.ms),
			totalMs: metrics.reduce((sum, m) => sum + m.ms, 0),
			heapMB: heap === null ? null : Math.round(heap / 1024 / 1024)
		});
	}

	for (const r of readings) {
		const line = `sheets=${r.sheets} mounts(ms)=[${r.mounts.join(', ')}] totalMountMs=${r.totalMs} heapMB=${r.heapMB}`;
		console.log(`[mount-metrics] ${line}`);
		testInfo.annotations.push({ type: 'mount-metrics', description: line });
	}

	// All 8 grids live and usable; metrics exist for every mount (moves would
	// add remount entries — none happened here).
	expect(readings.at(-1)?.mounts.length).toBe(8);
	const last = await page.evaluate(() => window.__canvas.sheetIds());
	await setCell(page, last[7], 'A1', 5);
	await expect.poll(() => cell(page, last[7], 'A1'), { timeout: 20_000 }).toBe(5);
});
