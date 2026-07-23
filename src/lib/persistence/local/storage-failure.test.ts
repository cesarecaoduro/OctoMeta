import { describe, expect, it } from 'vitest';
import { describeLocalStorageFailure } from './storage-failure';

describe('local storage failure guidance', () => {
	it('identifies quota exhaustion without claiming the generation is durable', () => {
		expect(
			describeLocalStorageFailure(
				new DOMException('The device quota is full.', 'QuotaExceededError')
			)
		).toEqual({
			kind: 'quota',
			title: 'Device storage is full',
			guidance:
				'Free device storage, then retry. Keep this tab open until Stored on this device returns.'
		});
	});

	it('gives transaction failures retry and export recovery guidance', () => {
		expect(
			describeLocalStorageFailure(new DOMException('The transaction aborted.', 'AbortError'))
		).toEqual({
			kind: 'transaction',
			title: 'Device save did not complete',
			guidance:
				'Retry the local save. Keep this tab open until Stored on this device returns.'
		});
	});
});
