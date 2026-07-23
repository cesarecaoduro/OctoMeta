import { describe, expect, it } from 'vitest';
import type { DocumentSummary } from '../persistence';
import type { LocalWorkspaceSummary } from '../persistence/local';
import { buildDocumentIndex } from './document-index';

const stats = { blocks: 1, tabs: 1, nodes: 2, bytes: 128 };

function cloud(documentId: string, title: string, revision: number): DocumentSummary {
	return {
		_id: documentId as DocumentSummary['_id'],
		title,
		blocksOrder: [],
		undoCursor: 0,
		revision,
		bundleHash: `hash-${revision}`,
		stats,
		createdAt: 10,
		updatedAt: 20
	};
}

function local(
	documentId: string,
	workspaceId = 'main',
	overrides: Partial<LocalWorkspaceSummary> = {}
): LocalWorkspaceSummary {
	return {
		accountId: 'account-a',
		documentId,
		workspaceId,
		workspace: workspaceId === 'main' ? { kind: 'main' } : { kind: 'branch', name: workspaceId },
		title: `Local ${documentId}`,
		generation: 1,
		stats,
		createdAt: 30,
		updatedAt: 40,
		...overrides
	};
}

describe('unified document index', () => {
	it('distinguishes local-only, downloaded cloud-backed, and cloud-only documents', () => {
		const entries = buildDocumentIndex(
			[cloud('cloud-backed', 'Cloud backed', 7), cloud('cloud-only', 'Cloud only', 2)],
			[
				local('local-only'),
				local('cloud-backed', 'main', {
					title: 'Locally titled',
					generation: 5,
					cloudBase: { version: 7, bundleHash: 'hash-7', generation: 4 }
				})
			]
		);

		expect(entries).toMatchObject([
			{
				documentId: 'cloud-backed',
				title: 'Locally titled',
				availability: 'cloud-backed',
				cloud: { version: 7 },
				local: { baseVersion: 7, hasChanges: true }
			},
			{
				documentId: 'local-only',
				availability: 'local-only',
				cloud: null,
				local: { generation: 1 }
			},
			{
				documentId: 'cloud-only',
				availability: 'cloud-only',
				cloud: { version: 2 },
				local: null
			}
		]);
	});

	it('groups device-local branches beneath the parent and reports their base state', () => {
		const entries = buildDocumentIndex(
			[cloud('document-1', 'Beam check', 6)],
			[
				local('document-1'),
				local('document-1', 'branch-b', {
					workspace: { kind: 'branch', name: 'Option B' },
					generation: 3,
					cloudBase: { version: 4, bundleHash: 'hash-4', generation: 3 }
				}),
				local('document-1', 'branch-a', {
					workspace: { kind: 'branch', name: 'Option A' },
					generation: 2,
					cloudBase: { version: 4, bundleHash: 'hash-4', generation: 1 }
				})
			]
		);

		expect(entries[0].branches).toEqual([
			expect.objectContaining({ name: 'Option A', baseVersion: 4, hasChanges: true }),
			expect.objectContaining({ name: 'Option B', baseVersion: 4, hasChanges: false })
		]);
	});

	it('does not fabricate a cloud base or clean state for migrated working copies', () => {
		const [entry] = buildDocumentIndex(
			[cloud('legacy-document', 'Legacy cloud title', 9)],
			[local('legacy-document', 'main', { generation: 3 })]
		);

		expect(entry).toMatchObject({
			availability: 'cloud-backed',
			cloud: { version: 9 },
			local: { generation: 3, hasChanges: null }
		});
		expect(entry.local?.baseVersion).toBeUndefined();
	});
});
