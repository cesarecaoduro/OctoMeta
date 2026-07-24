import { expect, test } from '@playwright/test';

test('workbook stays behind a skeleton until the live grid is ready', async ({ page }) => {
	await page.addInitScript(() => {
		const observe = () => {
			const state = window as typeof window & { __workbookSkeletonSeen?: boolean };
			const inspect = () => {
				if (document.querySelector('[data-testid="workbook-skeleton"]')) {
					state.__workbookSkeletonSeen = true;
				}
			};
			inspect();
			new MutationObserver(inspect).observe(document.body, { childList: true, subtree: true });
		};
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', observe, { once: true });
		} else {
			observe();
		}
	});

	await page.goto('/app');
	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');

	expect(
		await page.evaluate(
			() =>
				(window as typeof window & { __workbookSkeletonSeen?: boolean })
					.__workbookSkeletonSeen
		)
	).toBe(true);
	await expect(page.getByText('Starting workbook…')).toHaveCount(0);

	const showWorkbook = page.getByRole('button', { name: 'Show Workbook' });
	if (await showWorkbook.isVisible()) await showWorkbook.click();
	await expect(page.getByTestId('workbook-skeleton')).toHaveCount(0);
	await expect(page.getByTestId('workbook-grid')).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as typeof window & {
						__canvas?: { sheetsMounted: () => boolean };
					}).__canvas?.sheetsMounted() ?? false
			)
		)
		.toBe(true);
});

test('session checks keep a stable application shell', async ({ page }) => {
	await page.addInitScript(() => {
		const observe = () => {
			const state = window as typeof window & {
				__sessionSkeletonSeen?: boolean;
				__sessionSkeletonShell?: string;
			};
			const inspect = () => {
				const skeleton = document.querySelector<HTMLElement>(
					'[data-testid="session-skeleton"]'
				);
				if (skeleton) {
					state.__sessionSkeletonSeen = true;
					state.__sessionSkeletonShell = skeleton.dataset.shell;
				}
			};
			inspect();
			new MutationObserver(inspect).observe(document.body, { childList: true, subtree: true });
		};
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', observe, { once: true });
		} else {
			observe();
		}
	});

	await page.goto('/app');
	await expect(page.getByTestId('new-doc')).toBeEnabled();

	expect(
		await page.evaluate(
			() =>
				(window as typeof window & { __sessionSkeletonSeen?: boolean })
					.__sessionSkeletonSeen
		)
	).toBe(true);
	await expect(page.getByText('Authenticating workspace…')).toHaveCount(0);

	await page.getByTestId('new-doc').click();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	await page.reload();
	await expect(page.getByTestId('editor')).toHaveAttribute('data-ready', 'true');
	expect(
		await page.evaluate(
			() =>
				(window as typeof window & { __sessionSkeletonShell?: string })
					.__sessionSkeletonShell
		)
	).toBe('workbench');
});
