import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

declare global {
	interface Window {
		__canvas: {
			sheetIds(): string[];
			sheetsMounted(): boolean;
			getCell(sheetId: string, a1: string): unknown;
			getRawCell(sheetId: string, a1: string): { f?: unknown } | null;
			setCell(sheetId: string, a1: string, input: number | string | boolean): void;
			renameName(oldName: string, newName: string): boolean;
			selection(): { sheetId: string; a1: string } | null;
		};
	}
}

const chip = (page: Page, id: string) => page.locator(`[data-chip-id="${id}"]`);

async function waitSaved(page: Page): Promise<void> {
	await expect(page.getByTestId('save-state')).toHaveAttribute('data-save-state', 'idle', {
		timeout: 30_000
	});
}

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
	await page.evaluate(([sheet]) => window.__canvas.setCell(sheet, 'A2', '20 in'), [input]);
	await expect(chip(page, 'chip-steel-d')).toHaveText('20 in');
	await expect(chip(page, 'chip-steel-area')).toHaveText('38.00 in²');

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
	await row.getByTestId('delete').click();
	await row.getByRole('button', { name: 'Confirm trash' }).click();
	await page.getByRole('tab', { name: /Trash/ }).click();
	const trashed = page.getByTestId('doc-row').filter({ hasText: 'Steel beam check' }).first();
	await trashed.getByRole('button', { name: 'Restore' }).click();
	await page.getByRole('tab', { name: /Live/ }).click();
	await page.locator(`[data-testid="doc-link"][href="${docPath}"]`).click();
	await expect(page).toHaveURL(docUrl);
	await expect(chip(page, 'chip-steel-area')).toHaveText('38.00 in²');

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
