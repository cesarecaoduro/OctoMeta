import { describe, expect, it, vi } from 'vitest';
import { createPersistenceActivityLog, observePersistence } from './activity';

describe('persistence activity', () => {
	it('distinguishes local commits from cloud reads and writes without payloads', () => {
		const log = createPersistenceActivityLog(() => 42);
		log.observe({
			target: 'local',
			access: 'write',
			operation: 'workspace.commit',
			phase: 'succeeded'
		});
		log.observe({
			target: 'cloud',
			access: 'read',
			operation: 'documents.load',
			phase: 'started'
		});

		expect(log.snapshot()).toEqual([
			{
				sequence: 1,
				at: 42,
				target: 'local',
				access: 'write',
				operation: 'workspace.commit',
				phase: 'succeeded'
			},
			{
				sequence: 2,
				at: 42,
				target: 'cloud',
				access: 'read',
				operation: 'documents.load',
				phase: 'started'
			}
		]);
	});

	it('emits balanced success and failure lifecycle events', async () => {
		const observe = vi.fn();
		await expect(
			observePersistence(
				observe,
				{ target: 'cloud', access: 'write', operation: 'documents.save' },
				async () => 7
			)
		).resolves.toBe(7);
		await expect(
			observePersistence(
				observe,
				{ target: 'cloud', access: 'read', operation: 'documents.load' },
				async () => {
					throw new Error('offline');
				}
			)
		).rejects.toThrow('offline');

		expect(observe.mock.calls.map(([event]) => event.phase)).toEqual([
			'started',
			'succeeded',
			'started',
			'failed'
		]);
	});

	it('returns copies and can clear the current session', () => {
		const log = createPersistenceActivityLog();
		log.observe({
			target: 'cloud',
			access: 'read',
			operation: 'documents.list',
			phase: 'succeeded'
		});
		const snapshot = log.snapshot();
		snapshot[0].phase = 'failed';
		expect(log.snapshot()[0].phase).toBe('succeeded');
		log.clear();
		expect(log.snapshot()).toEqual([]);
	});
});
