import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentGraph } from '../../engine';
import { serializeLocalGraph } from './serialization';
import {
	GenerationConflictError,
	createLocalWorkspaceRepository,
	deleteLocalWorkspaceDatabase
} from './repository';

const databases: string[] = [];

function databaseName(): string {
	const name = `octometa-local-test-${crypto.randomUUID()}`;
	databases.push(name);
	return name;
}

function content(title: string) {
	const graph = new DocumentGraph();
	return {
		title,
		graph: serializeLocalGraph(graph),
		workbookSnapshot: {
			id: 'document-1',
			sheetOrder: ['sheet-1'],
			sheets: { 'sheet-1': { id: 'sheet-1', name: 'Sheet 1' } }
		}
	};
}

afterEach(async () => {
	await Promise.all(databases.splice(0).map(deleteLocalWorkspaceDatabase));
});

describe('local workspace repository', () => {
	it('commits and lists account-scoped working copies', async () => {
		const repository = createLocalWorkspaceRepository({
			databaseName: databaseName(),
			now: () => 1_000
		});

		const committed = await repository.commit({
			accountId: 'account-a',
			documentId: 'document-1',
			workspaceId: 'main',
			expectedGeneration: 0,
			content: content('Local calculation')
		});

		expect(committed.generation).toBe(1);
		expect(await repository.load('account-a', 'document-1', 'main')).toMatchObject({
			accountId: 'account-a',
			documentId: 'document-1',
			workspaceId: 'main',
			generation: 1,
			content: { title: 'Local calculation' }
		});
		expect(await repository.listDocuments('account-a')).toMatchObject([
			{
				documentId: 'document-1',
				title: 'Local calculation',
				generation: 1,
				updatedAt: 1_000
			}
		]);
		expect(await repository.listDocuments('account-b')).toEqual([]);
		repository.close();
	});

	it('rejects a stale generation without replacing the durable working copy', async () => {
		const repository = createLocalWorkspaceRepository({ databaseName: databaseName() });
		const first = await repository.commit({
			accountId: 'account-a',
			documentId: 'document-1',
			workspaceId: 'main',
			expectedGeneration: 0,
			content: content('Generation one')
		});
		expect(first.generation).toBe(1);

		await expect(
			repository.commit({
				accountId: 'account-a',
				documentId: 'document-1',
				workspaceId: 'main',
				expectedGeneration: 0,
				content: content('Stale replacement')
			})
		).rejects.toBeInstanceOf(GenerationConflictError);

		expect(await repository.load('account-a', 'document-1', 'main')).toMatchObject({
			generation: 1,
			content: { title: 'Generation one' }
		});
		repository.close();
	});

	it('keeps the previous working copy and summary when a transaction aborts', async () => {
		const activity: Array<{ phase: string }> = [];
		const repository = createLocalWorkspaceRepository({
			databaseName: databaseName(),
			observe: (event) => activity.push(event)
		});
		await repository.commit({
			accountId: 'account-a',
			documentId: 'document-1',
			workspaceId: 'main',
			expectedGeneration: 0,
			content: content('Durable generation')
		});

		await expect(
			repository.commit({
				accountId: 'account-a',
				documentId: 'document-1',
				workspaceId: 'main',
				expectedGeneration: 1,
				content: { ...content('Cannot be cloned'), workbookSnapshot: () => undefined }
			})
		).rejects.toBeDefined();

		expect(await repository.load('account-a', 'document-1', 'main')).toMatchObject({
			generation: 1,
			content: { title: 'Durable generation' }
		});
		expect(await repository.listDocuments('account-a')).toMatchObject([
			{ generation: 1, title: 'Durable generation' }
		]);
		expect(activity.filter((event) => event.phase === 'failed')).toHaveLength(1);
		repository.close();
	});
});
