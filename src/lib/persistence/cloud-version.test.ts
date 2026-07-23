import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import type { GraphNode } from '../engine';
import type { LocalWorkingCopyRecord } from './local';
import {
	buildCloudVersionReview,
	createCloudVersionController,
	type CloudVersionProgress
} from './cloud-version';
import {
	createLocalWorkspaceRepository,
	deleteLocalWorkspaceDatabase
} from './local';

function node(id: string, code?: '#REF!' | '#VALUE!'): GraphNode {
	return {
		id,
		kind: code ? 'error' : 'input',
		value: code
			? { kind: 'error', code, message: code === '#REF!' ? 'Missing target' : 'Incomplete formula', origin: id }
			: { kind: 'scalar', value: 4 },
		inputs: [],
		contentHash: `hash-${id}`,
		provenance: { authoredBy: 'human', authoredAt: 1 }
	};
}

function workingCopy(): LocalWorkingCopyRecord {
	return {
		accountId: 'owner-a',
		documentId: '01K123456789ABCDEFGHJKMNPQ',
		workspaceId: 'main',
		workspace: { kind: 'main' },
		generation: 3,
		content: {
			title: 'Beam check',
			graph: {
				authored: {
					blocksOrder: ['intro'],
					workbookManifest: {
						sheets: [{ id: 'sheet-1', name: 'Sheet 1', position: 0 }]
					},
					nodes: [node('span'), node('broken', '#REF!'), node('draft', '#VALUE!')],
					blocks: [
						{
							id: 'intro',
							docId: '01K123456789ABCDEFGHJKMNPQ',
							type: 'text',
							position: 0,
							pm: { type: 'paragraph' }
						}
					],
					chips: []
				},
				history: {
					undoCursor: 2,
					undoLog: [
						{
							seq: 1,
							mutation: { op: 'setInput', id: 'span', value: { kind: 'scalar', value: 4 } },
							inverse: [],
							actor: { kind: 'human' },
							at: 1
						}
					]
				}
			},
			workbookSnapshot: {
				id: '01K123456789ABCDEFGHJKMNPQ',
				sheetOrder: ['sheet-1'],
				sheets: { 'sheet-1': { id: 'sheet-1', name: 'Sheet 1', cellData: {} } }
			}
		},
		createdAt: 1,
		updatedAt: 2
	};
}

describe('cloud version review', () => {
	it('shows version 1, authored changes, and saveable calculation warnings without local state', async () => {
		const review = await buildCloudVersionReview(workingCopy());

		expect(review).toMatchObject({
			nextVersion: 1,
			source: 'Working copy',
			capturedGeneration: 3,
			summary: { blocks: 1, nodes: 3, sheets: 1, assets: 0 },
			warnings: [
				{ kind: 'broken-references', count: 1 },
				{ kind: 'incomplete-calculations', count: 1 }
			],
			blockers: []
		});
		expect(review.bundle).toMatchObject({
			schemaVersion: 1,
			title: 'Beam check',
			graph: {
				blocksOrder: ['intro'],
				workbookManifest: { sheets: [{ id: 'sheet-1' }] }
			}
		});
		expect(JSON.stringify(review.bundle)).not.toMatch(
			/undo|selection|activity|drawer|preference|history/i
		);
		expect(review.bundleHash).toMatch(/^[a-f0-9]{64}$/);
	});

	it('keeps edits made during the cloud request dirty after acknowledging the captured generation', async () => {
		const databaseName = `cloud-version-${crypto.randomUUID()}`;
		const repository = createLocalWorkspaceRepository({ databaseName });
		const initial = workingCopy();
		await repository.commit({
			accountId: initial.accountId,
			documentId: initial.documentId,
			workspaceId: initial.workspaceId,
			expectedGeneration: 0,
			content: initial.content
		});
		const progress: CloudVersionProgress[] = [];
		const controller = createCloudVersionController({
			accountId: initial.accountId,
			documentId: initial.documentId,
			workspaceId: initial.workspaceId,
			repository,
			flushLocal: async () => {},
			createOperationId: () => 'operation-1',
			onProgress: (state) => progress.push(state),
			cloud: {
				saveCloudVersion: async (input) => {
					expect(
						(await repository.load(initial.accountId, initial.documentId, 'main'))
							?.pendingCloudOperation
					).toMatchObject({
						operationId: 'operation-1',
						operationInputHash: input.operationInputHash,
						capturedGeneration: 1
					});
					await repository.commit({
						accountId: initial.accountId,
						documentId: initial.documentId,
						workspaceId: 'main',
						expectedGeneration: 1,
						content: { ...initial.content, title: 'Edited during upload' }
					});
					return {
						status: 'created',
						version: 1,
						versionId: `${initial.documentId}:v1`,
						bundleHash: input.bundleHash
					};
				}
			}
		});

		const review = await controller.prepare();
		const outcome = await controller.save(review, 'First version');

		expect(outcome).toMatchObject({ status: 'created', version: 1, dirtyAfterSave: true });
		expect(progress).toEqual([
			{ stage: 'preparing' },
			{ stage: 'assets' },
			{ stage: 'version' },
			{ stage: 'complete', version: 1, dirtyAfterSave: true }
		]);
		expect(await repository.load(initial.accountId, initial.documentId, 'main')).toMatchObject({
			generation: 2,
			cloudBase: { version: 1, generation: 1 },
			content: { title: 'Edited during upload' }
		});
		repository.close();
		await deleteLocalWorkspaceDatabase(databaseName);
	});
});
