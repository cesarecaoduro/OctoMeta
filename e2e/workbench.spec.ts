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

async function failWorkspaceWritesWithQuota(page: Page): Promise<void> {
	await page.evaluate(() => {
		const originalPut = IDBObjectStore.prototype.put;
		Object.assign(window, {
			__restoreIndexedDbPut: () => {
				IDBObjectStore.prototype.put = originalPut;
			}
		});
		IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
			if (this.name === 'workspaces') {
				throw new DOMException('Device quota is full.', 'QuotaExceededError');
			}
			return originalPut.apply(this, args);
		};
	});
}

async function restoreWorkspaceWrites(page: Page): Promise<void> {
	await page.evaluate(() => {
		(window as typeof window & { __restoreIndexedDbPut(): void }).__restoreIndexedDbPut();
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
	await expect(page.locator('.tiptap')).toBeFocused();
	await page.keyboard.type('Local narrative survives reload');
	await expect(page.locator('.tiptap')).toContainText('Local narrative survives reload');
	await expect(page.locator('.trace')).not.toHaveClass(/active/);
	await expect(page.getByTestId('save-state')).toHaveText('Saving locally…');

	await page.waitForFunction(() => window.__canvas.sheetsMounted(), null, { timeout: 30_000 });
	const [sheetId] = await page.evaluate(() => window.__canvas.sheetIds());
	await page.evaluate(([sheet]) => window.__canvas.setCell(sheet, 'A1', 42), [sheetId]);
	await expect(page.locator('.trace')).toHaveClass(/active/);
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

test('a second tab is read-only until cooperative takeover flushes the active generation', async ({
	page
}) => {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	const documentUrl = page.url();

	const secondTab = await page.context().newPage();
	await secondTab.goto(documentUrl);
	await expect(secondTab.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await expect(secondTab.getByTestId('editor')).toHaveAttribute('data-editable', 'false');
	await expect(secondTab.getByTestId('lease-status')).toContainText(
		'open for editing in another tab'
	);

	await page.getByTestId('slot-insert-text').last().click();
	await page.keyboard.type('Flushed before takeover');
	await secondTab.getByRole('button', { name: 'Take over editing' }).click();

	await expect(secondTab.getByTestId('editor')).toHaveAttribute('data-editable', 'true', {
		timeout: 30_000
	});
	await expect(secondTab.locator('.tiptap')).toContainText('Flushed before takeover');
	await expect(page.getByTestId('editor')).toHaveAttribute('data-editable', 'false');
	await secondTab.close();
});

test('the active tab keeps storing generations after a read-only tab opens', async ({ page }) => {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.getByTestId('slot-insert-text').last().click();
	await expect(page.locator('.tiptap')).toBeFocused();
	await page.keyboard.type('C');
	await waitSaved(page);

	const secondTab = await page.context().newPage();
	await secondTab.goto(page.url());
	await expect(secondTab.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await expect(secondTab.getByTestId('editor')).toHaveAttribute('data-editable', 'false');
	await expect(secondTab.locator('.tiptap')).toContainText('C');
	const readonlyRuntime = await secondTab.evaluate(() => {
		const marker = crypto.randomUUID();
		Object.assign(window, { __readonlyRuntimeMarker: marker });
		return marker;
	});

	await page.bringToFront();
	await page.locator('.tiptap').click();
	await page.keyboard.type('iao');
	await expect(page.locator('.tiptap')).toContainText('Ciao');
	await waitSaved(page);
	await expect(page.getByTestId('storage-recovery')).toHaveCount(0);
	await expect.poll(async () => (await durableWorkingCopy(page)).content.graph.authored.blocks)
		.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					pm: expect.objectContaining({
						content: expect.arrayContaining([
							expect.objectContaining({ text: expect.stringContaining('Ciao') })
						])
					})
				})
			])
		);
	await expect(secondTab.locator('.tiptap')).toContainText('Ciao');
	await expect(secondTab.getByTestId('editor')).toHaveAttribute('data-editable', 'false');

	await page.waitForFunction(() => window.__canvas.sheetsMounted(), null, { timeout: 30_000 });
	const [sheetId] = await page.evaluate(() => window.__canvas.sheetIds());
	await page.evaluate(([sheet]) => window.__canvas.setCell(sheet, 'A1', 42), [sheetId]);
	await waitSaved(page);
	await expect
		.poll(() => secondTab.evaluate(([sheet]) => window.__canvas.graphDisplay(sheet, 'A1'), [sheetId]))
		.toBe(42);

	expect(
		await secondTab.evaluate(
			() => (window as typeof window & { __readonlyRuntimeMarker?: string }).__readonlyRuntimeMarker
		)
	).toBe(readonlyRuntime);
	await secondTab.close();
});

test('takeover stays read-only when the active generation cannot be stored', async ({ page }) => {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	const secondTab = await page.context().newPage();
	await secondTab.goto(page.url());
	await expect(secondTab.getByTestId('editor')).toHaveAttribute('data-editable', 'false');

	await failWorkspaceWritesWithQuota(page);
	await page.getByTestId('slot-insert-text').last().click();
	await page.keyboard.type('Must remain with the active owner');
	await expect(page.getByTestId('save-state')).toHaveAttribute('data-save-state', 'error');

	await secondTab.getByRole('button', { name: 'Take over editing' }).click();
	await expect(secondTab.getByTestId('editor')).toHaveAttribute('data-editable', 'false');
	await expect(secondTab.getByTestId('lease-status')).toContainText(
		'Takeover was not completed'
	);
	await expect(page.getByTestId('editor')).toHaveAttribute('data-editable', 'true');

	await restoreWorkspaceWrites(page);
	await page.getByRole('button', { name: 'Retry local save' }).click();
	await waitSaved(page);
	await secondTab.close();
});

test('unsupported edit locking opens the working copy read-only with actionable guidance', async ({
	page
}) => {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	const documentUrl = page.url();

	await page.context().addInitScript(() => {
		Object.defineProperty(navigator, 'locks', {
			configurable: true,
			value: undefined
		});
	});
	const unsupportedTab = await page.context().newPage();
	await unsupportedTab.goto(documentUrl);

	await expect(unsupportedTab.getByTestId('editor')).toHaveAttribute(
		'data-editable',
		'false'
	);
	await expect(unsupportedTab.getByTestId('lease-status')).toContainText(
		'browser that supports Web Locks and BroadcastChannel'
	);
	await expect(
		unsupportedTab.getByRole('button', { name: 'Take over editing' })
	).toHaveCount(0);
	await unsupportedTab.close();
});

test('a previously opened owner working copy remains editable across an offline reload', async ({
	page
}) => {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await expect
		.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length > 0))
		.toBe(true);
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (navigator.serviceWorker.controller) return;
		await new Promise<void>((resolve) => {
			navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
				once: true
			});
		});
	});
	await expect
		.poll(() =>
			page.evaluate(async () => {
				for (const cacheName of await caches.keys()) {
					if (!cacheName.startsWith('octometa-owner-pages-')) continue;
					if (await (await caches.open(cacheName)).match(location.href)) return true;
				}
				return false;
			})
		)
		.toBe(true);

	await page.context().setOffline(true);
	await expect(page.getByText('Offline. Changes continue to save on this device.')).toBeVisible();
	await page.getByTestId('slot-insert-text').last().click();
	await expect(page.locator('.tiptap')).toBeFocused();
	await page.keyboard.type('Offline owner work survives reload');
	await expect(page.locator('.tiptap')).toContainText('Offline owner work survives reload');
	await waitSaved(page);
	await page.reload();

	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await expect(page.getByTestId('editor')).toHaveAttribute('data-editable', 'true');
	await expect(page.locator('.tiptap')).toContainText('Offline owner work survives reload');
	await page.evaluate(() => window.__canvas.clearPersistenceActivity());
	await page.context().setOffline(false);
	await page.waitForTimeout(750);
	expect(
		await page.evaluate(() =>
			window.__canvas
				.persistenceActivity()
				.filter((activity) => activity.target === 'cloud' && activity.access === 'write')
		)
	).toEqual([]);
});

test('a quota failure never reports durability and offers a successful retry', async ({
	page
}) => {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await waitSaved(page);
	await failWorkspaceWritesWithQuota(page);

	await page.getByTestId('slot-insert-text').last().click();
	await page.keyboard.type('Work that still needs a durable transaction');
	await expect(page.getByTestId('save-state')).toHaveAttribute('data-save-state', 'error');
	await expect(page.getByTestId('save-state')).not.toHaveText('Stored on this device');
	await expect(page.getByTestId('storage-recovery')).toContainText(
		'Free device storage, then retry'
	);

	await restoreWorkspaceWrites(page);
	await page.getByRole('button', { name: 'Retry local save' }).click();
	await waitSaved(page);
	await expect(page.getByTestId('storage-recovery')).toHaveCount(0);
});

test('the unified index manages a local document without cloud calls', async ({ page }) => {
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
				.filter((activity) => activity.target === 'cloud')
		)
	).toEqual([]);
});

test('the document index reads cloud collections only when their view needs them', async ({
	page
}) => {
	const authRequests: string[] = [];
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (url.pathname.startsWith('/api/auth/')) authRequests.push(url.pathname);
	});
	await page.goto('/app');
	await expect(page.getByTestId('new-doc')).toBeEnabled();
	await expect
		.poll(() =>
			page.evaluate(() =>
				window.__documentIndex
					.persistenceActivity()
					.filter(
						(activity) =>
							activity.target === 'cloud' &&
							activity.access === 'read' &&
							activity.phase === 'succeeded'
					)
					.map((activity) => activity.operation)
			)
		)
		.toEqual(['documents.list']);

	await page.waitForTimeout(1_000);
	expect(
		await page.evaluate(() =>
			window.__documentIndex
				.persistenceActivity()
				.filter(
					(activity) =>
						activity.operation === 'documents.list' && activity.phase === 'succeeded'
				)
		)
	).toHaveLength(1);
	expect(authRequests).toEqual(['/api/auth/get-session', '/api/auth/convex/token']);
	const settledAuthRequests = [...authRequests];
	await page.waitForTimeout(1_000);
	expect(authRequests).toEqual(settledAuthRequests);

	await page.getByRole('tab', { name: /Trash/ }).click();
	await expect
		.poll(() =>
			page.evaluate(() =>
				window.__documentIndex
					.persistenceActivity()
					.filter(
						(activity) =>
							activity.operation === 'documents.listTrash' &&
							activity.phase === 'succeeded'
					)
					.length
			)
		)
		.toBe(1);

	await page.getByRole('tab', { name: /Live/ }).click();
	await page.getByRole('tab', { name: /Trash/ }).click();
	await page.waitForTimeout(500);
	expect(
		await page.evaluate(() =>
			window.__documentIndex
				.persistenceActivity()
				.filter(
					(activity) =>
						activity.operation === 'documents.listTrash' && activity.phase === 'succeeded'
				)
		)
	).toHaveLength(1);
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

	await expect(page.locator('[data-u-comp][tabindex="1"]')).toHaveCount(0);
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
