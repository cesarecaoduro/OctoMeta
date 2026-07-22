import type { ConvexClient } from 'convex/browser';
import { describe, expect, it, vi } from 'vitest';
import { createPersistenceActivityLog } from './activity';
import { createPersistence, type DocumentId } from './client';

function fakeClient(overrides: Partial<ConvexClient> = {}): ConvexClient {
	return {
		query: vi.fn(async () => []),
		mutation: vi.fn(async () => undefined),
		action: vi.fn(async () => undefined),
		...overrides
	} as unknown as ConvexClient;
}

describe('cloud persistence activity', () => {
	it('reports actual logical cloud reads without exposing arguments', async () => {
		const log = createPersistenceActivityLog(() => 1);
		const persistence = createPersistence(fakeClient(), { observe: log.observe });
		await persistence.listDocuments();

		expect(log.snapshot()).toEqual([
			{
				sequence: 1,
				at: 1,
				target: 'cloud',
				access: 'read',
				operation: 'documents.list',
				phase: 'started'
			},
			{
				sequence: 2,
				at: 1,
				target: 'cloud',
				access: 'read',
				operation: 'documents.list',
				phase: 'succeeded'
			}
		]);
		expect(Object.keys(log.snapshot()[0]).sort()).toEqual([
			'access',
			'at',
			'operation',
			'phase',
			'sequence',
			'target'
		]);
	});

	it('reports failed logical cloud writes and preserves the original error', async () => {
		const failure = new Error('permission denied');
		const log = createPersistenceActivityLog();
		const persistence = createPersistence(
			fakeClient({ mutation: vi.fn(async () => Promise.reject(failure)) as never }),
			{ observe: log.observe }
		);

		await expect(
			persistence.renameDocument('document' as DocumentId, 'Private title')
		).rejects.toBe(failure);
		expect(log.snapshot().map(({ target, access, operation, phase }) => ({
			target,
			access,
			operation,
			phase
		}))).toEqual([
			{
				target: 'cloud',
				access: 'write',
				operation: 'documents.rename',
				phase: 'started'
			},
			{
				target: 'cloud',
				access: 'write',
				operation: 'documents.rename',
				phase: 'failed'
			}
		]);
	});
});
