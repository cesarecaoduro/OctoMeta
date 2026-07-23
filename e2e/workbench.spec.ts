import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

declare global {
	interface Window {
		__documentIndex: {
			persistenceActivity(): Array<{
				target: 'local' | 'cloud';
				access: 'read' | 'write';
				operation: string;
				phase: 'started' | 'succeeded' | 'failed';
			}>;
			clearPersistenceActivity(): void;
		};
		__canvas: {
			sheetIds(): string[];
			sheetsMounted(): boolean;
			getCell(sheetId: string, a1: string): unknown;
			getRawCell(sheetId: string, a1: string): { f?: unknown } | null;
			graphDisplay(sheetId: string, a1: string): unknown;
			setCell(sheetId: string, a1: string, input: number | string | boolean): void;
			renameName(oldName: string, newName: string): boolean;
			selection(): { sheetId: string; a1: string } | null;
			persistenceActivity(): Array<{
				target: 'local' | 'cloud';
				access: 'read' | 'write';
				operation: string;
				phase: 'started' | 'succeeded' | 'failed';
			}>;
			clearPersistenceActivity(): void;
			undoCursor(): number;
		};
	}
}

const chip = (page: Page, id: string) => page.locator(`[data-chip-id="${id}"]`);

async function waitSaved(page: Page): Promise<void> {
	await expect(page.getByTestId('save-state')).toHaveAttribute('data-save-state', 'idle', {
		timeout: 30_000
	});
}

async function durableWorkingCopy(page: Page): Promise<{
	generation: number;
	content: { title: string; graph: { history: { undoCursor: number } } };
}> {
	return page.evaluate(async () => {
		const request = indexedDB.open('octometa-browser-workspace');
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const read = database.transaction('workspaces', 'readonly').objectStore('workspaces').getAll();
		const rows = await new Promise<
			Array<{ documentId: string; generation: number; content: { title: string; graph: { history: { undoCursor: number } } } }>
		>((resolve, reject) => {
			read.onsuccess = () => resolve(read.result);
			read.onerror = () => reject(read.error);
		});
		database.close();
		const documentId = location.pathname.split('/').at(-1);
		const record = rows.find((row) => row.documentId === documentId);
		if (!record) throw new Error('durable working copy not found');
		return record;
	});
}

test('local create, document and workbook edits, history, and reload make zero Convex product writes', async ({
	page
}) => {
	await page.goto('/app');
	await expect(page.getByTestId('new-doc')).toBeEnabled();
	await page.evaluate(() => window.__documentIndex.clearPersistenceActivity());
	await page.getByTestId('new-doc').click();
	await page.waitForURL(/\/app\/[^/]+$/);
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await expect(page.getByTestId('save-state')).toHaveText('Stored on this device');

	await page.getByTestId('slot-insert-text').last().click();
	await page.keyboard.type('Local narrative survives reload');
	await expect(page.locator('.tiptap')).toContainText('Local narrative survives reload');
	await expect(page.getByTestId('save-state')).toHaveText('Saving locally…');

	await page.waitForFunction(() => window.__canvas.sheetsMounted(), null, { timeout: 30_000 });
	const [sheetId] = await page.evaluate(() => window.__canvas.sheetIds());
	await page.evaluate(([sheet]) => window.__canvas.setCell(sheet, 'A1', 42), [sheetId]);
	await expect.poll(() => page.evaluate(([sheet]) => window.__canvas.graphDisplay(sheet, 'A1'), [sheetId])).toBe(42);
	await page.getByTestId('undo').click();
	await expect.poll(() => page.evaluate(([sheet]) => window.__canvas.graphDisplay(sheet, 'A1'), [sheetId])).toBe('#VALUE!');
	await page.getByTestId('redo').click();
	await expect.poll(() => page.evaluate(([sheet]) => window.__canvas.graphDisplay(sheet, 'A1'), [sheetId])).toBe(42);
	await waitSaved(page);

	const durable = await durableWorkingCopy(page);
	expect(durable.generation).toBeGreaterThan(1);
	expect(durable.content.title).toBe('Untitled');
	expect(durable.content.graph.history.undoCursor).toBeGreaterThan(0);
	const durableUndoCursor = durable.content.graph.history.undoCursor;

	const cloudWrites = await page.evaluate(() =>
		[
			...window.__documentIndex.persistenceActivity(),
			...window.__canvas.persistenceActivity()
		].filter((activity) => activity.target === 'cloud' && activity.access === 'write')
	);
	expect(cloudWrites).toEqual([]);

	await page.reload();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await expect(page.locator('.tiptap')).toContainText('Local narrative survives reload');
	await expect.poll(() => page.evaluate(([sheet]) => window.__canvas.graphDisplay(sheet, 'A1'), [sheetId])).toBe(42);
	expect(await page.evaluate(() => window.__canvas.undoCursor())).toBe(durableUndoCursor);
	await expect(page.getByTestId('save-state')).toHaveText('Stored on this device');
	expect(
		await page.evaluate(() =>
			window.__canvas
				.persistenceActivity()
				.filter((activity) => activity.target === 'cloud' && activity.access === 'write')
		)
	).toEqual([]);
});

test('the unified index manages a local document without cloud writes', async ({ page }) => {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.getByTestId('back').click();

	let row = page.getByTestId('doc-row').filter({ hasText: 'Untitled' }).first();
	await expect(row.getByTestId('storage-status')).toContainText(
		'On this device · No cloud version'
	);
	await expect(row.getByTestId('save-entry')).toBeVisible();
	await expect(row.getByTestId('export-entry')).toBeVisible();
	await expect(row.getByTestId('duplicate')).toBeVisible();
	await expect(row.getByTestId('discard')).toBeVisible();

	await page.evaluate(() => window.__documentIndex.clearPersistenceActivity());
	await row.getByTestId('rename').click();
	await page.getByTestId('rename-input').fill('Index lifecycle');
	await page.getByTestId('rename-input').press('Enter');
	row = page.getByTestId('doc-row').filter({ hasText: 'Index lifecycle' }).first();
	await expect(row).toBeVisible();
	await row.getByTestId('save-entry').click();
	await expect(page.getByTestId('toast')).toContainText('No cloud write was made');
	await row.getByTestId('export-entry').click();
	await expect(page.getByTestId('toast')).toContainText('not available yet');
	await row.getByTestId('duplicate').click();

	const duplicate = page.getByTestId('doc-row').filter({ hasText: 'Index lifecycle copy' });
	await expect(duplicate).toHaveCount(1);
	await expect(duplicate.getByTestId('storage-status')).toContainText(
		'On this device · No cloud version'
	);
	await duplicate.getByTestId('discard').click();
	await duplicate.getByTestId('confirm-discard').click();
	await expect(duplicate).toHaveCount(0);

	row = page.getByTestId('doc-row').filter({ hasText: 'Index lifecycle' }).first();
	await row.getByTestId('discard').click();
	await row.getByTestId('confirm-discard').click();
	await expect(page.getByTestId('doc-row').filter({ hasText: 'Index lifecycle' })).toHaveCount(0);

	expect(
		await page.evaluate(() =>
			window.__documentIndex
				.persistenceActivity()
				.filter((activity) => activity.target === 'cloud' && activity.access === 'write')
		)
	).toEqual([]);
});

test('the complete owned steel workbench survives edit, error, reload, trash, and restore', async ({
	page
}) => {
	const consoleErrors: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});

	await page.goto('/app');
	await page.getByTestId('load-demo').click();
	await page.waitForURL(/\/app\/[^/]+$/);
	const docUrl = page.url();
	const docPath = new URL(docUrl).pathname;
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.waitForFunction(() => window.__canvas?.sheetsMounted(), null, { timeout: 30_000 });

	await expect(page.getByTestId('doc-title')).toHaveText('Steel beam check');
	await expect(page.locator('.tiptap h1')).toHaveText('Steel beam check');
	await expect(page.locator('.tiptap h2')).toHaveText(['Inputs', 'Results']);
	await expect(chip(page, 'chip-steel-fy')).toHaveText('50 ksi');
	await expect(chip(page, 'chip-steel-d')).toHaveText('20 in');
	await expect(chip(page, 'chip-steel-area')).toHaveText('38.00 in²');
	await expect(chip(page, 'chip-steel-rt')).toHaveText('2.115 in');
	await expect(page.locator('[data-equation-block] .katex')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByRole('button', { name: /Workbook 3 tabs/ })).toBeVisible();

	await page.getByRole('button', { name: 'Parameters' }).click();
	const depth = page.getByLabel('Edit steel.d');
	await depth.fill('22 in');
	await depth.press('Enter');
	await expect(chip(page, 'chip-steel-d')).toHaveText('22 in');
	await expect(chip(page, 'chip-steel-area')).toHaveText('42.00 in²');
	await page.getByRole('button', { name: 'Close parameters' }).click();

	const [input, calculation] = await page.evaluate(() => window.__canvas.sheetIds());
	await page.evaluate(() => window.__canvas.clearPersistenceActivity());
	await page.evaluate(([sheet]) => window.__canvas.setCell(sheet, 'A2', '20 in'), [input]);
	await expect(chip(page, 'chip-steel-d')).toHaveText('20 in');
	await expect(chip(page, 'chip-steel-area')).toHaveText('38.00 in²');
	await waitSaved(page);
	const saveActivity = await page.evaluate(() =>
		window.__canvas
			.persistenceActivity()
			.filter((activity) => activity.operation === 'workspace.commit')
			.map(({ target, access, operation, phase }) => ({ target, access, operation, phase }))
	);
	expect(saveActivity).toEqual([
		{
			target: 'local',
			access: 'write',
			operation: 'workspace.commit',
			phase: 'started'
		},
		{
			target: 'local',
			access: 'write',
			operation: 'workspace.commit',
			phase: 'succeeded'
		}
	]);

	await page.evaluate(([sheet]) => window.__canvas.setCell(sheet, 'A1', '=missing.value'), [
		calculation
	]);
	await expect(chip(page, 'chip-steel-area')).toHaveText('#NAME?');
	await chip(page, 'chip-steel-area').click();
	await expect(page.getByRole('button', { name: /Workbook 3 tabs/ })).toHaveAttribute(
		'aria-expanded',
		'true'
	);
	await expect
		.poll(() => page.evaluate(() => window.__canvas.selection()))
		.toMatchObject({ sheetId: calculation, a1: 'A1' });
	await page.evaluate(
		([sheet]) =>
			window.__canvas.setCell(
				sheet,
				'A1',
				'=steel.d * steel.tw - steel.tw^2 / 2'
			),
		[calculation]
	);
	await expect(chip(page, 'chip-steel-area')).toHaveText('38.00 in²');

	await page.evaluate(() => window.__canvas.renameName('steel.d', 'steel.depth'));
	await expect(chip(page, 'chip-steel-d')).toHaveText('20 in');
	await page.evaluate(() => window.__canvas.renameName('steel.depth', 'steel.d'));

	const workbook = page.getByRole('complementary', { name: 'Attached workbook' });
	await workbook.getByRole('button', { name: 'Add workbook tab' }).click();
	await expect(workbook.getByRole('tab', { name: 'Sheet 4' })).toBeVisible();
	await workbook.getByLabel('Active tab name').fill('Notes');
	await workbook.getByRole('button', { name: 'Rename' }).click();
	await expect(workbook.getByRole('tab', { name: 'Notes' })).toBeVisible();
	await workbook.getByRole('button', { name: 'Delete' }).click();
	await expect(workbook.getByRole('tab', { name: 'Notes' })).toHaveCount(0);
	await page.getByTestId('undo').click();
	await expect(workbook.getByRole('tab', { name: 'Notes' })).toBeVisible();
	await page.getByTestId('redo').click();
	await expect(workbook.getByRole('tab', { name: 'Notes' })).toHaveCount(0);

	await waitSaved(page);
	await page.reload();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await expect(chip(page, 'chip-steel-area')).toHaveText('38.00 in²');
	expect(await page.evaluate(() => window.__canvas.sheetIds().length)).toBe(3);
	expect(await page.evaluate(() => window.__canvas.getRawCell('sheet-steel-calculation', 'A1')?.f)).toBeFalsy();

	const axe = await new AxeBuilder({ page }).analyze();
	expect(axe.violations).toEqual([]);

	await page.getByTestId('back').click();
	const row = page.getByTestId('doc-row').filter({ hasText: 'Steel beam check' }).first();
	await expect(row.getByTestId('storage-status')).toContainText('Base v1 · Local changes');
	await row.getByTestId('delete').click();
	await row.getByRole('button', { name: 'Confirm trash' }).click();
	await page.getByRole('tab', { name: /Trash/ }).click();
	const trashed = page.getByTestId('doc-row').filter({ hasText: 'Steel beam check' }).first();
	await trashed.getByRole('button', { name: 'Restore' }).click();
	await page.getByRole('tab', { name: /Live/ }).click();
	await page.locator(`[data-testid="doc-link"][href="${docPath}"]`).click();
	await expect(page).toHaveURL(docUrl);
	await expect(chip(page, 'chip-steel-area')).toHaveText('38.00 in²');
	await page.getByTestId('back').click();
	await page.evaluate(() => window.__documentIndex.clearPersistenceActivity());
	await row.getByTestId('discard').click();
	await row.getByTestId('confirm-discard').click();
	await expect(row.getByTestId('storage-status')).toContainText(
		'Cloud only · Not downloaded to this device'
	);
	expect(
		await page.evaluate(() =>
			window.__documentIndex
				.persistenceActivity()
				.filter((activity) => activity.target === 'cloud' && activity.access === 'write')
		)
	).toEqual([]);

	expect(consoleErrors).toEqual([]);
});

test('route gate redirects signed-out visitors', async ({ browser }) => {
	const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
	const page = await context.newPage();
	await page.goto('/app');
	await expect(page).toHaveURL(/\/signin\?next=%2Fapp/);
	await context.close();
});

test('static equations keep the last safe preview for invalid and untrusted TeX', async ({ page }) => {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.getByTestId('slot-insert-equation').last().click();
	const source = page.getByLabel('TeX source').last();
	await source.fill('x^2');
	await source.press('Control+Enter');
	await expect(page.locator('[data-equation-block] .katex')).toContainText('x');

	await source.fill('\\href{javascript:alert(1)}{click}');
	await source.press('Control+Enter');
	await expect(page.locator('[data-equation-block] a')).toHaveCount(0);
	await source.fill('\\notacommand{');
	await source.press('Control+Enter');
	await expect(page.locator('[data-equation-block] [role="alert"]')).toBeVisible();
	await expect(page.locator('[data-equation-block] .katex')).toContainText('click');
});
