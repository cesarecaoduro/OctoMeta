import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalWorkingCopyContent } from './repository';
import { createLocalAutosave } from './autosave';

function content(title: string): LocalWorkingCopyContent {
	return {
		title,
		graph: {
			authored: {
				blocksOrder: [],
				workbookManifest: { sheets: [{ id: 'sheet-1', name: 'Sheet 1', position: 0 }] },
				nodes: [],
				blocks: [],
				chips: []
			},
			history: { undoCursor: 0, undoLog: [] }
		},
		workbookSnapshot: { id: 'document-1' }
	};
}

describe('local autosave', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('coalesces accepted edits for 500 ms but commits within a 2 second dirty interval', async () => {
		const commit = vi.fn(async (expectedGeneration: number) => expectedGeneration + 1);
		const capture = vi.fn(() => content('Captured'));
		const autosave = createLocalAutosave({
			initialGeneration: 1,
			capture,
			commit,
			delayMs: 500,
			maxDelayMs: 2_000
		});

		autosave.schedule();
		for (let elapsed = 400; elapsed <= 1_600; elapsed += 400) {
			await vi.advanceTimersByTimeAsync(400);
			autosave.schedule();
		}
		await vi.advanceTimersByTimeAsync(399);
		expect(commit).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);

		expect(capture).toHaveBeenCalledTimes(1);
		expect(commit).toHaveBeenCalledWith(1, content('Captured'));
		expect(autosave.state).toBe('idle');
		expect(autosave.generation).toBe(2);
	});

	it('keeps a failed transaction visible until a later transaction succeeds', async () => {
		const commit = vi
			.fn<(expectedGeneration: number) => Promise<number>>()
			.mockRejectedValueOnce(new Error('quota exceeded'))
			.mockResolvedValueOnce(2);
		const states: string[] = [];
		const autosave = createLocalAutosave({
			initialGeneration: 1,
			capture: () => content('Retryable'),
			commit,
			delayMs: 500,
			maxDelayMs: 2_000,
			onState: (state) => states.push(state)
		});

		autosave.schedule();
		await vi.advanceTimersByTimeAsync(500);
		expect(autosave.state).toBe('error');
		expect(autosave.lastError).toEqual(new Error('quota exceeded'));

		autosave.schedule();
		expect(autosave.state).toBe('error');
		await vi.advanceTimersByTimeAsync(500);
		expect(autosave.state).toBe('idle');
		expect(states).toEqual(['pending', 'saving', 'error', 'saving', 'idle']);
	});

	it('drains a newer dirty generation before a teardown flush resolves', async () => {
		let finishFirst!: (generation: number) => void;
		const firstCommit = new Promise<number>((resolve) => (finishFirst = resolve));
		const commit = vi
			.fn<(expectedGeneration: number) => Promise<number>>()
			.mockReturnValueOnce(firstCommit)
			.mockImplementation(async (expectedGeneration) => expectedGeneration + 1);
		const autosave = createLocalAutosave({
			initialGeneration: 0,
			capture: () => content('Drain before close'),
			commit,
			delayMs: 500,
			maxDelayMs: 2_000
		});

		autosave.schedule();
		await vi.advanceTimersByTimeAsync(500);
		expect(commit).toHaveBeenCalledTimes(1);

		autosave.schedule();
		const flushed = autosave.flush();
		finishFirst(1);
		await flushed;

		expect(commit).toHaveBeenCalledTimes(2);
		expect(commit.mock.calls.map(([generation]) => generation)).toEqual([0, 1]);
		expect(autosave.generation).toBe(2);
	});
});
