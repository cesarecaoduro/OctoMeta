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

async function seedVersionOneSummary(name: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.open(name, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore('workspaces');
			const summaries = request.result.createObjectStore('documentSummaries');
			summaries.createIndex('byAccount', 'accountId');
		};
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const transaction = database.transaction('documentSummaries', 'readwrite');
			transaction.objectStore('documentSummaries').put(
				{
					accountId: 'account-a',
					documentId: 'legacy-document',
					title: 'Legacy local document',
					generation: 3,
					stats: { blocks: 1, tabs: 1, nodes: 0, bytes: 100 },
					createdAt: 10,
					updatedAt: 20
				},
				['account-a', 'legacy-document']
			);
			transaction.onerror = () => reject(transaction.error);
			transaction.oncomplete = () => {
				database.close();
				resolve();
			};
		};
	});
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
	it('migrates version-one document summaries into main workspace summaries', async () => {
		const name = databaseName();
		await seedVersionOneSummary(name);
		const repository = createLocalWorkspaceRepository({ databaseName: name });

		expect(await repository.listWorkspaces('account-a')).toMatchObject([
			{
				documentId: 'legacy-document',
				workspaceId: 'main',
				workspace: { kind: 'main' },
				generation: 3
			}
		]);
		repository.close();
	});

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

	it('preserves a cloud base while later local generations become dirty', async () => {
		const repository = createLocalWorkspaceRepository({ databaseName: databaseName() });
		await repository.commit({
			accountId: 'account-a',
			documentId: 'document-1',
			workspaceId: 'main',
			expectedGeneration: 0,
			cloudBase: { version: 4, bundleHash: 'cloud-hash' },
			content: content('Downloaded calculation')
		});
		await repository.commit({
			accountId: 'account-a',
			documentId: 'document-1',
			workspaceId: 'main',
			expectedGeneration: 1,
			content: content('Locally edited calculation')
		});

		expect(await repository.listWorkspaces('account-a')).toMatchObject([
			{
				documentId: 'document-1',
				workspaceId: 'main',
				generation: 2,
				cloudBase: { version: 4, bundleHash: 'cloud-hash', generation: 1 }
			}
		]);
		repository.close();
	});

	it('persists one retryable cloud operation and acknowledges only its captured generation', async () => {
		const repository = createLocalWorkspaceRepository({ databaseName: databaseName() });
		await repository.commit({
			accountId: 'account-a',
			documentId: 'document-1',
			workspaceId: 'main',
			expectedGeneration: 0,
			content: content('Captured generation')
		});
		await repository.stageCloudVersion({
			accountId: 'account-a',
			documentId: 'document-1',
			workspaceId: 'main',
			expectedGeneration: 1,
			operation: {
				operationId: 'operation-1',
				operationInputHash: 'input-hash',
				capturedGeneration: 1,
				expectedHeadNumber: 0,
				expectedHeadHash: null,
				bundleJson: '{"schemaVersion":1}',
				bundleHash: 'bundle-hash',
				message: 'First cloud version',
				createdAt: 100
			}
		});
		await repository.commit({
			accountId: 'account-a',
			documentId: 'document-1',
			workspaceId: 'main',
			expectedGeneration: 1,
			content: content('Edited during upload')
		});

		await repository.acknowledgeCloudVersion({
			accountId: 'account-a',
			documentId: 'document-1',
			workspaceId: 'main',
			operationId: 'operation-1',
			version: 1,
			bundleHash: 'bundle-hash',
			summary: { blocks: 0, nodes: 0, sheets: 1, assets: 0 }
		});

		expect(await repository.load('account-a', 'document-1', 'main')).toMatchObject({
			generation: 2,
			cloudBase: {
				version: 1,
				bundleHash: 'bundle-hash',
				generation: 1,
				summary: { blocks: 0, nodes: 0, sheets: 1, assets: 0 }
			},
			content: { title: 'Edited during upload' }
		});
		expect(
			(await repository.load('account-a', 'document-1', 'main'))?.pendingCloudOperation
		).toBeUndefined();
		repository.close();
	});

	it('lists device-local branches independently beneath their document', async () => {
		const repository = createLocalWorkspaceRepository({ databaseName: databaseName() });
		await repository.commit({
			accountId: 'account-a',
			documentId: 'document-1',
			workspaceId: 'main',
			expectedGeneration: 0,
			content: content('Main calculation')
		});
		await repository.commit({
			accountId: 'account-a',
			documentId: 'document-1',
			workspaceId: 'branch-option-b',
			workspace: { kind: 'branch', name: 'Option B' },
			expectedGeneration: 0,
			content: content('Main calculation')
		});

		expect(await repository.listWorkspaces('account-a')).toMatchObject([
			{ workspaceId: 'branch-option-b', workspace: { kind: 'branch', name: 'Option B' } },
			{ workspaceId: 'main', workspace: { kind: 'main' } }
		]);
		repository.close();
	});

	it('duplicates a local document with independent identity and fresh history', async () => {
		const repository = createLocalWorkspaceRepository({ databaseName: databaseName() });
		const source = content('Source calculation');
		source.graph.authored.blocks.push({
			id: 'block-1',
			docId: 'document-1',
			type: 'text',
			position: 0
		});
		source.graph.history.undoCursor = 1;
		source.graph.history.undoLog.push({
			seq: 1,
			mutation: { op: 'blockOp', action: 'remove', blockId: 'block-1' },
			inverse: [{ op: 'blockOp', action: 'remove', blockId: 'block-1' }],
			actor: { kind: 'human' },
			at: 1
		});
		await repository.commit({
			accountId: 'account-a',
			documentId: 'document-1',
			workspaceId: 'main',
			expectedGeneration: 0,
			content: source
		});

		await repository.duplicateDocument({
			accountId: 'account-a',
			sourceDocumentId: 'document-1',
			documentId: 'document-2',
			title: 'Source calculation copy'
		});

		expect(await repository.load('account-a', 'document-2', 'main')).toMatchObject({
			generation: 1,
			content: {
				title: 'Source calculation copy',
				graph: {
					authored: { blocks: [{ docId: 'document-2' }] },
					history: { undoCursor: 0, undoLog: [] }
				},
				workbookSnapshot: { id: 'document-2', name: 'Source calculation copy' }
			}
		});
		repository.close();
	});

	it('discards all local workspaces for one document without touching another document', async () => {
		const repository = createLocalWorkspaceRepository({ databaseName: databaseName() });
		for (const [documentId, workspaceId] of [
			['document-1', 'main'],
			['document-1', 'branch-a'],
			['document-2', 'main']
		] as const) {
			await repository.commit({
				accountId: 'account-a',
				documentId,
				workspaceId,
				...(workspaceId === 'main'
					? {}
					: { workspace: { kind: 'branch' as const, name: 'Branch A' } }),
				expectedGeneration: 0,
				content: content(documentId)
			});
		}

		await expect(repository.discardDocument('account-a', 'document-1')).resolves.toBe(2);
		expect(await repository.listWorkspaces('account-a')).toMatchObject([
			{ documentId: 'document-2', workspaceId: 'main' }
		]);
		repository.close();
	});
});
