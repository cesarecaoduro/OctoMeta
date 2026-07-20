import { expect, test, type Page } from '@playwright/test';

/**
 * V1-5-1 acceptance (IMPLEMENTATION_PLAN.md §8): document list CRUD, markdown
 * authoring, image blocks (Convex file storage), reorder via blockOp, reload
 * restoring graph state, and engine-history undo spanning block ops.
 *
 * Runs against the shared dev deployment (PUBLIC_CONVEX_URL in .env.local):
 * every test creates its own fresh document and deletes it afterwards.
 */

const RUN_TAG = `e2e-editor-${Date.now().toString(36)}`;

/** 1×1 transparent PNG for programmatic uploads. */
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64'
);

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

/** Wait until the debounced saver reports everything persisted. */
async function waitSaved(page: Page): Promise<void> {
	await expect(page.getByTestId('save-state')).toHaveAttribute('data-save-state', 'idle', {
		timeout: 15_000
	});
}

const editor = (page: Page) => page.locator('.tiptap');
/** Top-level blocks only — insertion-slot widgets are chrome, not content. */
const blocks = (page: Page) => editor(page).locator('> *:not(.octo-insert-slot)');

test.afterEach(async ({ page }) => {
	// Clean up every document this test created (shared dev backend).
	while (createdIds.length > 0) {
		const id = createdIds.pop() as string;
		await page.goto('/app');
		const row = page
			.getByTestId('doc-row')
			.filter({ has: page.locator(`a[href="/app/${id}"]`) });
		if ((await row.count()) === 0) continue;
		await row.getByTestId('delete').click();
		await row.getByTestId('delete-confirm').click();
		await expect(row).toHaveCount(0);
	}
});

test('author text and headings with markdown shortcuts, insert an image, reload intact', async ({
	page
}) => {
	await createDoc(page);

	await editor(page).click();
	await page.keyboard.type('# Beam check');
	await page.keyboard.press('Enter');
	await page.keyboard.type('The load is **heavy** on this span.');
	await page.keyboard.press('Enter');
	await page.keyboard.type('- dead load');
	await page.keyboard.press('Enter');
	await page.keyboard.type('live load');

	await expect(editor(page).locator('h1')).toHaveText('Beam check');
	await expect(editor(page).locator('p strong')).toHaveText('heavy');
	await expect(editor(page).locator('ul li')).toHaveCount(2);

	// Image block: programmatic upload through the real toolbar input.
	await page.getByTestId('image-input').setInputFiles({
		name: 'section.png',
		mimeType: 'image/png',
		buffer: PNG
	});
	const img = editor(page).locator('figure[data-image-block] img');
	await expect(img).toHaveAttribute('src', /.+/, { timeout: 15_000 });

	await waitSaved(page);
	await page.reload();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');

	// Reload restores the document via loadDocument + hydrateGraph.
	await expect(editor(page).locator('h1')).toHaveText('Beam check');
	await expect(editor(page).locator('p strong')).toHaveText('heavy');
	await expect(editor(page).locator('ul li')).toHaveCount(2);
	await expect(editor(page).locator('figure[data-image-block] img')).toHaveAttribute(
		'src',
		/.+/,
		{ timeout: 15_000 }
	);
});

test('reorder blocks with the keyboard; order survives reload', async ({ page }) => {
	await createDoc(page);

	await editor(page).click();
	await page.keyboard.type('# Title');
	await page.keyboard.press('Enter');
	await page.keyboard.type('alpha');
	await page.keyboard.press('Enter');
	await page.keyboard.type('beta');

	// Caret sits in "beta": Alt-ArrowUp commits blockOp move (layout-only).
	await page.keyboard.press('Alt+ArrowUp');
	await expect(blocks(page).nth(1)).toHaveText('beta');
	await expect(blocks(page).nth(2)).toHaveText('alpha');

	// And once more from the toolbar: beta up to the very top.
	await page.getByTestId('move-up').click();
	await expect(blocks(page).nth(0)).toHaveText('beta');
	await expect(blocks(page).nth(1)).toHaveText('Title');

	await waitSaved(page);
	await page.reload();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await expect(blocks(page).nth(0)).toHaveText('beta');
	await expect(blocks(page).nth(1)).toHaveText('Title');
	await expect(blocks(page).nth(2)).toHaveText('alpha');
});

test('undo spans block ops: deleting a block restores through engine history', async ({
	page
}) => {
	await createDoc(page);

	await editor(page).click();
	await page.keyboard.type('first paragraph');
	await page.getByTestId('image-input').setInputFiles({
		name: 'detail.png',
		mimeType: 'image/png',
		buffer: PNG
	});
	const figure = editor(page).locator('figure[data-image-block]');
	await expect(figure.locator('img')).toHaveAttribute('src', /.+/, { timeout: 15_000 });
	await waitSaved(page);

	// Delete the image block (node selection + Backspace → blockOp remove).
	await figure.click();
	await page.keyboard.press('Backspace');
	await expect(figure).toHaveCount(0);

	// Cmd/Ctrl+Z runs commitUndo — the blockOp remove inverse restores the
	// whole block, image payload included.
	await page.keyboard.press('ControlOrMeta+z');
	await expect(figure).toHaveCount(1);
	await expect(figure.locator('img')).toHaveAttribute('src', /.+/, { timeout: 15_000 });

	// Redo removes it again; a final undo brings it back and persists.
	await editor(page).click();
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(figure).toHaveCount(0);
	await page.keyboard.press('ControlOrMeta+z');
	await expect(figure).toHaveCount(1);

	await waitSaved(page);
	await page.reload();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await expect(editor(page).locator('figure[data-image-block]')).toHaveCount(1);
	await expect(editor(page).locator('p').first()).toHaveText('first paragraph');
});

test('rename and delete a document from the list', async ({ page }) => {
	const id = await createDoc(page);
	const newTitle = `${RUN_TAG} renamed`;

	await page.goto('/app');
	const row = page
		.getByTestId('doc-row')
		.filter({ has: page.locator(`a[href="/app/${id}"]`) });
	await expect(row).toHaveCount(1);

	await row.getByTestId('rename').click();
	await page.getByTestId('rename-input').fill(newTitle);
	await page.getByTestId('rename-input').press('Enter');
	await expect(row.getByTestId('doc-link')).toHaveText(newTitle);

	// The editor page shows the new title too.
	await row.getByTestId('doc-link').click();
	await expect(page.getByTestId('doc-title')).toHaveText(newTitle);

	// Delete from the list (two-step confirm) — the row disappears.
	await page.goto('/app');
	await row.getByTestId('delete').click();
	await row.getByTestId('delete-confirm').click();
	await expect(row).toHaveCount(0);
	createdIds.pop(); // already deleted — skip afterEach cleanup for this doc
});
