import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { validateResetAuthority } from '../../convex/maintenance';
import schema from '../../convex/schema';
import {
	DocumentGraph,
	commit,
	commitRedo,
	commitUndo,
	createBuiltinRegistry,
	scalar
} from '../engine';
import {
	documentBundleHash,
	workbookSnapshotHash
} from './canonical';
import { FIXTURE_BUILDERS, buildBeamFixture, buildBranchFixture } from './fixtures';
import { hydrateGraph, serializeGraph } from './serialize';

const modules = import.meta.glob(['../../convex/**/*.ts', '../../convex/**/_generated/*.js']);
const backend = () => convexTest(schema, modules);
const OWNER_A = { subject: 'owner-a', issuer: 'https://test.octometa' };
const OWNER_B = { subject: 'owner-b', issuer: 'https://test.octometa' };
const ownedBackend = () => backend().withIdentity(OWNER_A);
const HUMAN = { kind: 'human' } as const;

function prepareWorkbook(graph: DocumentGraph): void {
	for (const node of graph.nodes.values()) {
		const sheetId = node.cellRef?.sheetId;
		if (!sheetId || graph.sheet(sheetId)) continue;
		graph.insertSheet({
			id: sheetId,
			name: `Sheet ${graph.workbook.sheets.length + 1}`,
			position: graph.workbook.sheets.length
		});
	}
}

function saveBundle(graph: DocumentGraph, docId: string, expectedRevision = 0) {
	prepareWorkbook(graph);
	const { workbookManifest, ...payload } = serializeGraph(graph);
	const workbookSnapshot = {
		id: docId,
		name: docId,
		sheetOrder: workbookManifest.sheets.map((sheet) => sheet.id),
		sheets: Object.fromEntries(
			workbookManifest.sheets.map((sheet) => [
				sheet.id,
				{ id: sheet.id, name: sheet.name, cellData: {} }
			])
		)
	};
	const snapshotHash = workbookSnapshotHash(workbookSnapshot);
	return {
		expectedRevision,
		graph: payload,
		workbookManifest,
		workbookSnapshot,
		snapshotHash,
		bundleHash: documentBundleHash(payload, workbookManifest, snapshotHash)
	};
}

async function saveFixture(
	t: ReturnType<typeof ownedBackend>,
	fixture: { title: string; graph: DocumentGraph }
) {
	const docId = await t.mutation(api.documents.create, { title: fixture.title });
	await t.mutation(api.documents.save, { docId, ...saveBundle(fixture.graph, String(docId)) });
	return docId;
}

function expectLive<T extends { state: string }>(
	result: T
): asserts result is Extract<T, { state: 'live' }> {
	expect(result.state).toBe('live');
}

describe('owned document lifecycle', () => {
	it('rejects unauthenticated access and isolates owners', async () => {
		const root = backend();
		await expect(root.mutation(api.documents.create, { title: 'No owner' })).rejects.toThrow(
			'UNAUTHENTICATED'
		);
		const t = root.withIdentity(OWNER_A);
		const docId = await t.mutation(api.documents.create, { title: 'Private' });
		expect((await t.query(api.documents.list, {})).map((doc) => doc.title)).toEqual(['Private']);
		const foreign = root.withIdentity(OWNER_B);
		expect(await foreign.query(api.documents.list, {})).toEqual([]);
		expect(await foreign.query(api.documents.load, { docId })).toEqual({ state: 'unauthorized' });
		await expect(
			foreign.mutation(api.documents.rename, { docId, title: 'Stolen' })
		).rejects.toThrow('UNAUTHORIZED');
	});

	it('create, rename, trash, restore, and permanent delete', async () => {
		const t = ownedBackend();
		const docId = await t.mutation(api.documents.create, { title: 'Doc A' });
		await t.mutation(api.documents.rename, { docId, title: 'Doc B' });
		await t.mutation(api.documents.trash, { docId });
		expect(await t.query(api.documents.list, {})).toEqual([]);
		expect((await t.query(api.documents.load, { docId })).state).toBe('trashed');
		await expect(
			t.mutation(api.documents.save, {
				docId,
				...saveBundle(buildBeamFixture().graph, String(docId))
			})
		).rejects.toThrow('DOCUMENT_TRASHED');
		await t.mutation(api.documents.restore, { docId });
		expect((await t.query(api.documents.list, {}))[0].title).toBe('Doc B');
		await t.mutation(api.documents.trash, { docId });
		await t.mutation(api.documents.remove, { docId });
		expect(await t.query(api.documents.load, { docId })).toEqual({ state: 'missing' });
	});

	it('uses a strict 30-day purge cutoff and remains idempotent', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		vi.useFakeTimers();
		vi.setSystemTime(now);
		try {
			const t = ownedBackend();
			const boundary = await t.mutation(api.documents.create, { title: 'Boundary' });
			const expired = await t.mutation(api.documents.create, { title: 'Expired' });
			await t.run(async (ctx) => {
				await ctx.db.patch(boundary, {
					deletedAt: now - 30 * 24 * 60 * 60 * 1_000,
					updatedAt: now
				});
				await ctx.db.patch(expired, {
					deletedAt: now - 30 * 24 * 60 * 60 * 1_000 - 1,
					updatedAt: now
				});
			});
			expect(await t.mutation(internal.documents.purgeExpired, {})).toBe(1);
			expect((await t.query(api.documents.load, { docId: boundary })).state).toBe('trashed');
			expect(await t.query(api.documents.load, { docId: expired })).toEqual({ state: 'missing' });
			expect(await t.mutation(internal.documents.purgeExpired, {})).toBe(0);
			expect(await t.mutation(api.documents.emptyTrash, {})).toMatchObject({ deleted: 1 });
			expect(await t.mutation(api.documents.emptyTrash, {})).toMatchObject({ deleted: 0 });
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not select or reschedule a full page of live documents', async () => {
		const t = ownedBackend();
		for (let index = 0; index < 26; index += 1) {
			await t.mutation(api.documents.create, { title: `Live ${index + 1}` });
		}

		expect(await t.mutation(internal.documents.purgeExpired, {})).toBe(0);
		expect(await t.query(api.documents.list, {})).toHaveLength(26);
		expect(
			await t.run(async (ctx) => await ctx.db.system.query('_scheduled_functions').collect())
		).toEqual([]);
	});
});

describe('development reset safety', () => {
	it('refuses production, invalid tokens, and missing backup acknowledgement', () => {
		const valid = {
			environment: 'development',
			expectedToken: 'deployment-specific-token',
			token: 'deployment-specific-token',
			acknowledgement: 'IRREVERSIBLE BACKUP CONFIRMED'
		};
		expect(() => validateResetAuthority(valid)).not.toThrow();
		expect(() =>
			validateResetAuthority({ ...valid, environment: 'production' })
		).toThrow('RESET_REFUSED_OUTSIDE_DEVELOPMENT');
		expect(() => validateResetAuthority({ ...valid, token: 'wrong' })).toThrow(
			'RESET_TOKEN_INVALID'
		);
		expect(() => validateResetAuthority({ ...valid, acknowledgement: 'yes' })).toThrow(
			'RESET_BACKUP_ACKNOWLEDGEMENT_REQUIRED'
		);
	});

	it('counts the allowlist, blocks product writes, deletes in stages, and unlocks after zero rows', async () => {
		const t = ownedBackend();
		await t.mutation(api.documents.create, { title: 'Reset me' });
		await t.run(async (ctx) => {
			await ctx.storage.store(new Blob(['orphaned product file'], { type: 'text/plain' }));
		});
		expect(await t.query(internal.maintenance.countResetRows, {})).toMatchObject({
			documents: 1,
			workbookSnapshots: 1,
			assets: 0,
			rootStorage: 1,
			truncated: false
		});

		await t.mutation(internal.maintenance.beginReset, {});
		await expect(t.mutation(internal.maintenance.finishReset, {})).rejects.toThrow(
			'RESET_VERIFICATION_FAILED'
		);
		await expect(
			t.mutation(api.documents.create, { title: 'Blocked during reset' })
		).rejects.toThrow('MAINTENANCE_MODE');
		expect(
			await t.mutation(internal.maintenance.deleteResetBatch, {
				stage: 'workbookSnapshots'
			})
		).toBe(1);
		expect(
			await t.mutation(internal.maintenance.deleteResetBatch, { stage: 'documents' })
		).toBe(1);
		const storageIds = await t.query(internal.maintenance.nextRootStorageBatch, {});
		expect(storageIds).toHaveLength(1);
		await t.run(async (ctx) => {
			for (const storageId of storageIds) await ctx.storage.delete(storageId);
		});
		expect(await t.query(internal.maintenance.countResetRows, {})).toEqual({
			documents: 0,
			graphNodes: 0,
			blocks: 0,
			undoLog: 0,
				chipBindings: 0,
				workbookSnapshots: 0,
				documentVersions: 0,
				snapshotChunks: 0,
				assets: 0,
			rootStorage: 0,
			truncated: false
		});
		await expect(t.mutation(internal.maintenance.finishReset, {})).resolves.toMatchObject({
			documents: 0,
			rootStorage: 0,
			truncated: false
		});
		expect(await t.run(async (ctx) => await ctx.db.query('maintenance').collect())).toEqual([]);
		await expect(t.mutation(api.documents.create, { title: 'Writable again' })).resolves.toBeTruthy();
	});

	it('runs the guarded reset end to end without deleting waitlist data', async () => {
		vi.stubEnv('RESET_ENVIRONMENT', 'test');
		vi.stubEnv('DEV_RESET_TOKEN', 'test-reset-token');
		try {
			const t = ownedBackend();
			await t.mutation(api.documents.create, { title: 'Delete this product data' });
			await t.run(async (ctx) => {
				await ctx.db.insert('waitlist', {
					email: 'preserve@example.com',
					source: 'reset-test'
				});
				await ctx.storage.store(new Blob(['delete this orphan'], { type: 'text/plain' }));
			});

			const result = await t.action(api.maintenance.developmentReset, {
				token: 'test-reset-token',
				dryRun: false,
				acknowledgeBackup: 'IRREVERSIBLE BACKUP CONFIRMED'
			});

			expect(result.after).toMatchObject({
				documents: 0,
				rootStorage: 0,
				truncated: false
			});
			expect(
				await t.run(async (ctx) => await ctx.db.query('waitlist').collect())
			).toMatchObject([{ email: 'preserve@example.com', source: 'reset-test' }]);
			expect(await t.run(async (ctx) => await ctx.db.query('maintenance').collect())).toEqual([]);
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

describe('owned asset lifecycle', () => {
	async function store(
		t: ReturnType<typeof ownedBackend>,
		contentType = 'image/png',
		size = 16
	) {
		const bytes = new Uint8Array(size);
		const signatures: Record<string, number[]> = {
			'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
			'image/jpeg': [0xff, 0xd8, 0xff],
			'image/gif': [...new TextEncoder().encode('GIF89a')],
			'image/webp': [...new TextEncoder().encode('RIFF0000WEBP')]
		};
		bytes.set(signatures[contentType] ?? []);
		return await t.run(async (ctx) => {
			return await ctx.storage.store(new Blob([bytes], { type: contentType }));
		});
	}

	it('requires auth and rejects unsupported or oversized bytes', async () => {
		await expect(backend().mutation(api.files.generateUploadUrl, {})).rejects.toThrow(
			'UNAUTHENTICATED'
		);
		const t = ownedBackend();
		const docId = await t.mutation(api.documents.create, { title: 'Assets' });
		const textId = await store(t, 'text/plain');
		await expect(t.action(api.files.claimUpload, { docId, storageId: textId })).rejects.toThrow(
			'UNSUPPORTED_IMAGE_TYPE'
		);
		const largeId = await store(t, 'image/png', 10 * 1024 * 1024 + 1);
		await expect(t.action(api.files.claimUpload, { docId, storageId: largeId })).rejects.toThrow(
			'IMAGE_TOO_LARGE'
		);
	});

	it('isolates serving/claims by owner and rejects forged bundle references', async () => {
		const root = backend();
		const owner = root.withIdentity(OWNER_A);
		const foreign = root.withIdentity(OWNER_B);
		const docId = await owner.mutation(api.documents.create, { title: 'Owner asset' });
		const foreignDocId = await foreign.mutation(api.documents.create, { title: 'Foreign' });
		const storageId = await store(owner);
		await owner.action(api.files.claimUpload, { docId, storageId });
		expect(await owner.query(api.files.getUrl, { storageId })).toMatch(/^https?:/);
		expect(await foreign.query(api.files.getUrl, { storageId })).toBeNull();
		await expect(
			foreign.action(api.files.claimUpload, { docId: foreignDocId, storageId })
		).rejects.toThrow('ASSET_ALREADY_CLAIMED');

		const forged = new DocumentGraph();
		commit(
			forged,
			{
				op: 'blockOp',
				action: 'add',
				blockId: 'image',
				block: {
					docId: String(docId),
					type: 'image',
					image: { storageId: 'forged-storage-id' }
				}
			},
			HUMAN,
			{ registry: createBuiltinRegistry() }
		);
		await expect(
			owner.mutation(api.documents.save, {
				docId,
				...saveBundle(forged, String(docId))
			})
		).rejects.toThrow('INVALID_ASSET_ID');
	});

	it('retains undo-only references, then durably deletes unreachable assets', async () => {
		const t = ownedBackend();
		const docId = await t.mutation(api.documents.create, { title: 'Undo asset' });
		const storageId = await store(t);
		await t.action(api.files.claimUpload, { docId, storageId });
		const graph = new DocumentGraph();
		commit(
			graph,
			{
				op: 'blockOp',
				action: 'add',
				blockId: 'image',
				block: {
					docId: String(docId),
					type: 'image',
					image: { storageId: String(storageId) }
				}
			},
			HUMAN,
			{ registry: createBuiltinRegistry() }
		);
		commit(
			graph,
			{ op: 'blockOp', action: 'remove', blockId: 'image' },
			HUMAN,
			{ registry: createBuiltinRegistry() }
		);
		await t.mutation(api.documents.save, { docId, ...saveBundle(graph, String(docId)) });
		await t.run(async (ctx) => {
			const asset = await ctx.db
				.query('assets')
				.withIndex('by_storage', (q) => q.eq('storageId', storageId))
				.unique();
			expect(asset?.state).toBe('claimed');
		});

		graph.undoLog = [];
		graph.undoCursor = 0;
		await t.mutation(api.documents.save, {
			docId,
			...saveBundle(graph, String(docId), 1)
		});
		await t.mutation(internal.files.cleanupAssets, {});
		await t.run(async (ctx) => {
			expect(
				await ctx.db
					.query('assets')
					.withIndex('by_storage', (q) => q.eq('storageId', storageId))
					.unique()
			).toBeNull();
			expect(await ctx.db.system.get('_storage', storageId)).toBeNull();
		});
	});

	it('advances reachable pages so an unreachable tail is eventually deleted', async () => {
		const now = Date.UTC(2026, 6, 21, 12);
		vi.useFakeTimers();
		vi.setSystemTime(now);
		try {
			const t = ownedBackend();
			const docId = await t.mutation(api.documents.create, { title: 'Reachability cursor' });
			const storageIds: Id<'_storage'>[] = [];
			for (let index = 0; index < 51; index += 1) storageIds.push(await store(t));
			const old = now - 2 * 60 * 60 * 1_000;
			await t.run(async (ctx) => {
				for (const [index, storageId] of storageIds.entries()) {
					await ctx.db.insert('assets', {
						storageId,
						ownerId: OWNER_A.subject,
						docId,
						contentType: 'image/png',
						size: 16,
						state: 'claimed',
						createdAt: old,
						claimedAt: old,
						lastReachabilityCheckedAt: old + index,
						deleteAttempts: 0
					});
					if (index < 50) {
						await ctx.db.insert('blocks', {
							docId,
							blockId: `reachable-${index}`,
							type: 'image',
							position: index,
							image: { storageId: String(storageId) }
						});
					}
				}
			});

			expect(await t.mutation(internal.files.cleanupAssets, {})).toEqual({
				deleted: 0,
				failed: 0,
				inspected: 50,
				queued: 0
			});
			expect(
				await t.run(async (ctx) => await ctx.db.system.query('_scheduled_functions').collect())
			).toEqual([]);

			expect(await t.mutation(internal.files.cleanupAssets, {})).toEqual({
				deleted: 0,
				failed: 0,
				inspected: 1,
				queued: 1
			});
			await t.run(async (ctx) => {
				const tail = await ctx.db
					.query('assets')
					.withIndex('by_storage', (query) => query.eq('storageId', storageIds[50]))
					.unique();
				expect(tail?.state).toBe('pendingDeletion');
			});

			expect(await t.mutation(internal.files.cleanupAssets, {})).toMatchObject({ deleted: 1 });
			await t.run(async (ctx) => {
				expect(
					await ctx.db
						.query('assets')
						.withIndex('by_storage', (query) => query.eq('storageId', storageIds[50]))
						.unique()
				).toBeNull();
				expect(await ctx.db.system.get('_storage', storageIds[50])).toBeNull();
			});
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('atomic reproducibility bundle', () => {
	it.each(FIXTURE_BUILDERS.map((build) => [build().title, build] as const))(
		'%s reloads with identical node hashes and workbook manifest',
		async (_title, build) => {
			const t = ownedBackend();
			const fixture = build();
			const docId = await saveFixture(t, fixture);
			const loaded = await t.query(api.documents.load, { docId });
			expectLive(loaded);
			const { graph, mismatches } = hydrateGraph(loaded, { registry: fixture.registry });
			expect(mismatches).toEqual([]);
			expect(graph.nodes.size).toBe(fixture.graph.nodes.size);
			expect(graph.workbook).toEqual(fixture.graph.workbook);
			for (const [id, node] of fixture.graph.nodes) {
				expect(JSON.parse(JSON.stringify(graph.nodes.get(id))), id).toEqual(
					JSON.parse(JSON.stringify(node))
				);
			}
		}
	);

	it('preserves quantities and error values', async () => {
		const t = ownedBackend();
		const fixture = buildBranchFixture();
		const docId = await saveFixture(t, fixture);
		const loaded = await t.query(api.documents.load, { docId });
		expectLive(loaded);
		const { graph } = hydrateGraph(loaded, { registry: fixture.registry });
		expect(graph.nodes.get('node-branch-bad')?.value).toMatchObject({
			kind: 'error',
			code: '#VALUE!'
		});
		expect(graph.nodes.get('node-branch-q')?.value).toMatchObject({
			kind: 'quantity',
			unit: { Θ: 0 }
		});
	});

	it('rejects a stale revision without changing graph or workbook rows', async () => {
		const t = ownedBackend();
		const fixture = buildBeamFixture();
		const docId = await saveFixture(t, fixture);
		const before = await t.query(api.documents.load, { docId });
		expectLive(before);
		commit(
			fixture.graph,
			{ op: 'setInput', id: 'node-beam-span', value: scalar(99) },
			HUMAN,
			{ registry: fixture.registry }
		);
		await expect(
			t.mutation(api.documents.save, {
				docId,
				...saveBundle(fixture.graph, String(docId), 0)
			})
		).rejects.toThrow('REVISION_CONFLICT:1');
		const after = await t.query(api.documents.load, { docId });
		expect(after).toEqual(before);
	});

	it('fails closed when persisted workbook bytes are corrupted', async () => {
		const t = ownedBackend();
		const docId = await saveFixture(t, buildBeamFixture());
		await t.run(async (ctx) => {
			const row = await ctx.db
				.query('workbookSnapshots')
				.withIndex('by_doc', (q) => q.eq('docId', docId))
				.unique();
			await ctx.db.patch(row!._id, { snapshot: { corrupted: true } });
		});
		expect((await t.query(api.documents.load, { docId })).state).toBe('integrity-error');
	});

	it('undo and redo history survives reload', async () => {
		const t = ownedBackend();
		const fixture = buildBeamFixture();
		const opts = { registry: fixture.registry };
		commit(fixture.graph, { op: 'setInput', id: 'node-beam-span', value: scalar(7) }, HUMAN, opts);
		commit(fixture.graph, { op: 'setInput', id: 'node-beam-w', value: scalar(15) }, HUMAN, opts);
		commitUndo(fixture.graph, opts);
		const docId = await saveFixture(t, fixture);
		const loaded = await t.query(api.documents.load, { docId });
		expectLive(loaded);
		const { graph } = hydrateGraph(loaded, opts);
		expect(commitUndo(graph, opts).ok).toBe(true);
		expect(commitRedo(graph, opts).ok).toBe(true);
		expect(commitRedo(graph, opts).ok).toBe(true);
	});

	it('purge cascades through every product child table', async () => {
		const t = ownedBackend();
		const docId = await saveFixture(t, buildBeamFixture());
		await t.mutation(api.documents.trash, { docId });
		await t.mutation(api.documents.remove, { docId });
		await t.run(async (ctx) => {
			for (const table of [
				'graphNodes',
				'blocks',
				'undoLog',
				'chipBindings',
				'workbookSnapshots',
				'documentVersions',
				'snapshotChunks'
			] as const) {
				expect(await ctx.db.query(table).collect(), table).toEqual([]);
			}
		});
	});
});
