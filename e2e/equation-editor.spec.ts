import { expect, test, type Page } from '@playwright/test';

async function createDocumentWithPublishedValue(
	page: Page,
	cell: string,
	value: number,
	name: string,
	unit?: string
): Promise<void> {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.waitForFunction(() => window.__canvas.sheetsMounted(), null, { timeout: 30_000 });
	const [sheetId] = await page.evaluate(() => window.__canvas.sheetIds());
	await page.evaluate(
		([sheet, a1, input]) => {
			window.__canvas.setCell(sheet, a1, input);
			window.__canvas.activateCell(sheet, a1);
		},
		[sheetId, cell, value] as const
	);
	const showWorkbook = page.getByRole('button', { name: 'Show Workbook' });
	if (await showWorkbook.isVisible()) await showWorkbook.click();
	await page.getByRole('button', { name: 'Published values' }).click();
	const manager = page.getByRole('dialog', { name: 'Published values' });
	await manager.getByLabel('Semantic name').fill(name);
	if (unit) {
		const unitPicker = manager.getByRole('combobox', { name: /Unit/ });
		await unitPicker.fill(unit);
		await unitPicker.press('ArrowDown');
		await unitPicker.press('Enter');
	}
	await manager.getByRole('button', { name: 'Publish selected cell' }).click();
	await manager.getByRole('button', { name: 'Close published values' }).click();
}

test('visual equation typing and reference controls retain focus without an Apply step', async ({
	page
}) => {
	await createDocumentWithPublishedValue(page, 'A1', 20, 'steel.d', 'in');
	await page.getByTestId('slot-insert-equation').last().click();

	const equation = page.locator('[data-equation-block]').first();
	const mathfield = equation.getByRole('textbox', { name: 'Equation', exact: true });
	await mathfield.click();
	await expect(mathfield).toBeFocused();
	await page.keyboard.press('End');
	await page.keyboard.type('+1');
	await expect(mathfield).toBeFocused();
	await expect(equation).toHaveAttribute('data-equation-version', '1');
	await expect(mathfield).toBeVisible();

	await equation.getByRole('button', { name: 'Insert value' }).click();
	const picker = equation.getByRole('dialog', { name: 'Insert published value' });
	await expect(picker.getByRole('searchbox', { name: 'Search published values' })).toBeFocused();
	await picker.getByRole('searchbox', { name: 'Search published values' }).fill('steel.d');
	await picker.getByRole('searchbox', { name: 'Search published values' }).press('ArrowDown');
	const option = picker.getByRole('option', { name: /steel\.d/ });
	await expect(option).toBeFocused();
	const [sheetId] = await page.evaluate(() => window.__canvas.sheetIds());
	await page.evaluate(([sheet]) => window.__canvas.setCell(sheet, 'A1', 21), [sheetId]);
	await expect(option).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(mathfield).toBeFocused();
	const reference = equation.locator('[data-equation-reference]');
	await expect(reference).toHaveCount(1);
	await reference.focus();
	await page.evaluate(([sheet]) => window.__canvas.setCell(sheet, 'A1', 22), [sheetId]);
	await expect(reference).toBeFocused();
	await expect
		.poll(() =>
			mathfield.evaluate((field) =>
				(field as HTMLElement & { getValue: (format: string) => string }).getValue(
					'latex-expanded'
				)
			)
		)
		.toContain('22\\,in');
	await mathfield.click();
	await mathfield.press('Control+Enter');
	await expect(mathfield).not.toBeFocused();
	await expect(equation).toHaveAttribute('data-equation-version', '1');
});

test('Escape restores the edit-session start while invalid intermediate math stays editable', async ({
	page
}) => {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.getByTestId('slot-insert-equation').last().click();

	const equation = page.locator('[data-equation-block]').last();
	const mathfield = equation.getByRole('textbox', { name: 'Equation', exact: true });
	await mathfield.click();
	await page.keyboard.type('x+');
	await expect(mathfield).toBeFocused();
	await expect(equation.getByRole('alert')).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(mathfield).not.toBeFocused();
	await equation.getByRole('button', { name: 'Edit source' }).click();
	await expect(equation.getByRole('textbox', { name: 'Equation source' })).toHaveValue('');
});

test('asterisk authors scalar multiplication without changing explicit dot products', async ({
	page
}) => {
	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.getByTestId('slot-insert-equation').last().click();

	const equation = page.locator('[data-equation-block]').last();
	const mathfield = equation.getByRole('textbox', { name: 'Equation', exact: true });
	await mathfield.click();
	await page.keyboard.type('2*3');
	await equation.getByRole('button', { name: 'Edit source' }).click();
	const source = equation.getByRole('textbox', { name: 'Equation source' });
	await expect(source).toHaveValue(/^2\\times\s*3$/);

	await source.fill('2\\cdot 3');
	await equation.getByRole('button', { name: 'Use visual editor' }).click();
	await equation.getByRole('button', { name: 'Edit source' }).click();
	await expect(source).toHaveValue(/^2\\cdot\s*3$/);
});

test('renaming, unpublishing, and repairing a reference preserve the authored equation', async ({
	page
}) => {
	await createDocumentWithPublishedValue(page, 'A1', 20, 'beam.depth');
	const [sheetId] = await page.evaluate(() => window.__canvas.sheetIds());
	await page.evaluate(
		([sheet]) => {
			window.__canvas.setCell(sheet, 'A2', 10);
			window.__canvas.activateCell(sheet, 'A2');
		},
		[sheetId]
	);
	await page.getByRole('button', { name: 'Published values' }).click();
	let manager = page.getByRole('dialog', { name: 'Published values' });
	await manager.getByLabel('Semantic name').fill('beam.width');
	await manager.getByRole('button', { name: 'Publish selected cell' }).click();
	await manager.getByRole('button', { name: 'Close published values' }).click();

	await page.getByTestId('slot-insert-equation').last().click();
	const equation = page.locator('[data-equation-block]').last();
	await equation.getByRole('textbox', { name: 'Equation', exact: true }).click();
	await page.keyboard.type('A=');
	await equation.getByRole('button', { name: 'Insert value' }).click();
	await equation
		.getByRole('dialog', { name: 'Insert published value' })
		.getByRole('option', { name: /beam\.depth/ })
		.click();
	await expect(equation.locator('[data-equation-reference]')).toContainText('beam.depth');

	await page.getByRole('button', { name: 'Published values' }).click();
	manager = page.getByRole('dialog', { name: 'Published values' });
	await manager.getByPlaceholder('Search name, label, sheet, or cell').fill('beam.depth');
	await manager.getByRole('row', { name: /beam\.depth/ }).click();
	await manager.getByLabel('Semantic name').fill('beam.overallDepth');
	await manager.getByRole('button', { name: 'Save changes' }).click();
	await manager.getByRole('button', { name: 'Close published values' }).click();
	await expect(equation.locator('[data-equation-reference]')).toContainText('beam.overallDepth');

	await page.getByRole('button', { name: 'Published values' }).click();
	manager = page.getByRole('dialog', { name: 'Published values' });
	await manager.getByPlaceholder('Search name, label, sheet, or cell').fill('beam.overallDepth');
	await manager.getByRole('row', { name: /beam\.overallDepth/ }).click();
	await manager.getByRole('button', { name: 'Unpublish…' }).click();
	await manager.getByRole('button', { name: 'Confirm unpublish' }).click();
	await manager.getByRole('button', { name: 'Close published values' }).click();
	await expect(equation.locator('[data-equation-reference]')).toContainText(
		'Missing: beam.overallDepth'
	);

	await equation.locator('[data-equation-reference]').click();
	const repair = equation.getByRole('dialog', { name: 'Replace published value' });
	await repair.getByRole('searchbox', { name: 'Search published values' }).fill('beam.width');
	await repair.getByRole('option', { name: /beam\.width/ }).click();
	await expect(equation.locator('[data-equation-reference]')).toContainText('beam.width');
	await equation.getByRole('button', { name: 'Edit source' }).click();
	const source = equation.getByRole('textbox', { name: 'Equation source' });
	await expect(source).toHaveValue('A=\\value{beam.width}');
	await expect(source).not.toHaveValue(/octoref/);
});
