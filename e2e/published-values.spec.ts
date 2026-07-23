import { expect, test } from '@playwright/test';

declare global {
	interface Window {
		__canvas: {
			sheetIds(): string[];
			sheetsMounted(): boolean;
			selection(): { sheetId: string; a1: string } | null;
			setCell(sheetId: string, a1: string, input: number | string | boolean): void;
			activateCell(sheetId: string, a1: string): boolean;
		};
	}
}

test('owner publishes a selected scalar cell with semantic metadata', async ({ page }) => {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.waitForFunction(() => window.__canvas.sheetsMounted(), null, { timeout: 30_000 });
	const [sheetId] = await page.evaluate(() => window.__canvas.sheetIds());
	await page.evaluate(([sheet]) => {
		window.__canvas.setCell(sheet, 'A1', 42);
		window.__canvas.activateCell(sheet, 'A1');
	}, [sheetId]);

	const showWorkbook = page.getByRole('button', { name: 'Show Workbook' });
	if (await showWorkbook.isVisible()) await showWorkbook.click();
	await page.getByRole('button', { name: 'Published values' }).click();
	const manager = page.getByRole('dialog', { name: 'Published values' });
	await expect(manager).toContainText('Sheet 1 · A1');
	await manager.getByLabel('Semantic name').fill('design.load');
	await manager.getByLabel(/Label/).fill('Design load');
	await manager.getByLabel(/Unit/).fill('kN');
	await manager.getByLabel(/Description/).fill('Serviceability load');
	await manager.getByRole('button', { name: 'Publish selected cell' }).click();

	const row = manager.getByRole('row', { name: /design\.load/ });
	await expect(row).toContainText('42');
	await expect(row).toContainText('kN');
	await expect(row).toContainText('Sheet 1 · A1');
});

test('owner searches, navigates, renames, and safely unpublishes a workbook value', async ({
	page
}) => {
	await page.goto('/app');
	await page.getByTestId('load-demo').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.waitForFunction(() => window.__canvas.sheetsMounted(), null, { timeout: 30_000 });

	const showWorkbook = page.getByRole('button', { name: 'Show Workbook' });
	if (await showWorkbook.isVisible()) await showWorkbook.click();
	await page.getByRole('button', { name: 'Published values' }).click();
	const manager = page.getByRole('dialog', { name: 'Published values' });
	await manager.getByPlaceholder('Search name, label, sheet, or cell').fill('steel.d');

	const publication = manager.getByRole('row', { name: /steel\.d/ });
	await expect(publication).toContainText('Input · A2');
	await publication.click();
	await expect
		.poll(() => page.evaluate(() => window.__canvas.selection()))
		.toMatchObject({ sheetId: 'sheet-steel-input', a1: 'A2' });

	await manager.getByLabel('Semantic name').fill('steel.depth');
	await manager.getByLabel(/Label/).fill('Section depth');
	await manager.getByLabel(/Unit/).fill('in');
	await manager.getByLabel(/Description/).fill('Overall section depth');
	await manager.getByRole('button', { name: 'Save changes' }).click();
	await expect(manager.getByRole('row', { name: /steel\.depth/ })).toContainText(
		'Section depth'
	);
	await expect(page.locator('[data-chip-id="chip-steel-d"]')).toHaveText('20 in');

	await manager.getByRole('button', { name: 'Unpublish…' }).click();
	await expect(manager).toContainText(/uses? will break/);
	await expect(manager).toContainText('Document block');
	await manager.getByRole('button', { name: 'Confirm unpublish' }).click();

	await expect(page.locator('[data-chip-id="chip-steel-d"]')).toHaveText('#REF!');
	await expect(manager.getByRole('row', { name: /steel\.depth/ })).toHaveCount(0);
});

test('empty Document and Equation reference pickers link to the Workbook publication action', async ({
	page
}) => {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');

	await page.getByTestId('slot-insert-text').last().click();
	await page.locator('.tiptap p').last().click();
	await expect(page.locator('.tiptap')).toBeFocused();
	await page.keyboard.type('@');
	const emptyPickerAction = page.getByRole('button', { name: 'Publish a workbook value' });
	await expect(emptyPickerAction).toBeVisible();
	await expect(page.locator('.octo-chip-picker-empty')).toContainText(
		'Select a Workbook cell'
	);
	await emptyPickerAction.click();
	await expect(page.getByRole('dialog', { name: 'Published values' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Parameters' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Close published values' }).click();

	await page.getByTestId('slot-insert-equation').last().click();
	await page.getByLabel('Equation source').last().selectOption('bound');
	await expect(page.getByRole('button', { name: 'Publish a workbook value' })).toBeVisible();
});
