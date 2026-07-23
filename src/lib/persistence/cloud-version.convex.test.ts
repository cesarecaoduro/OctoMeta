import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { DocumentGraph } from '../engine';
import {
	buildCloudVersionReview,
	cloudVersionOperationInputHash
} from './cloud-version';
import { createEmptyWorkbookSnapshot } from './workbook-snapshot';
import { serializeLocalGraph } from './local';
import type { LocalWorkingCopyRecord } from './local';

const modules = import.meta.glob(['../../convex/**/*.ts', '../../convex/**/_generated/*.js']);
const OWNER = { subject: 'owner-a', issuer: 'https://test.octometa' };
const backend = () => convexTest(schema, modules).withIdentity(OWNER);
const DOCUMENT_ID = '01K123456789ABCDEFGHJKMNPQ';

function workingCopy(): LocalWorkingCopyRecord {
	const graph = new DocumentGraph();
	return {
		accountId: OWNER.subject,
		documentId: DOCUMENT_ID,
		workspaceId: 'main',
		workspace: { kind: 'main' },
		generation: 1,
		content: {
			title: 'First cloud document',
			graph: serializeLocalGraph(graph),
			workbookSnapshot: createEmptyWorkbookSnapshot(DOCUMENT_ID, 'First cloud document', graph.workbook)
		},
		createdAt: 1,
		updatedAt: 1
	};
}

async function saveArgs(record = workingCopy(), operationId = 'operation-1') {
	const review = await buildCloudVersionReview(record);
	const input = {
		publicDocumentId: record.documentId,
		expectedHeadNumber: review.expectedHeadNumber,
		expectedHeadHash: review.expectedHeadHash,
		operationId,
		message: null,
		bundleHash: review.bundleHash
	};
	return {
		...input,
		operationInputHash: await cloudVersionOperationInputHash(input),
		bundle: review.bundle
	};
}

describe('immutable cloud versions', () => {
	it('publishes a local-only document as immutable version 1 in one authored snapshot row', async () => {
		const t = backend();
		const result = await t.mutation(api.documentVersions.save, await saveArgs());

		expect(result).toMatchObject({
			status: 'created',
			version: 1,
			bundleHash: expect.stringMatching(/^[a-f0-9]{64}$/)
		});
		const loaded = await t.query(api.documentVersions.loadHead, {
			publicDocumentId: DOCUMENT_ID
		});
		expect(loaded).toMatchObject({
			state: 'live',
			document: { documentId: DOCUMENT_ID, title: 'First cloud document' },
			version: { versionNumber: 1, chunkCount: 1 },
			bundle: { schemaVersion: 1, title: 'First cloud document' }
		});
		await t.run(async (ctx) => {
			const chunks = await ctx.db.query('snapshotChunks').collect();
			expect(chunks).toHaveLength(1);
			expect(new TextDecoder().decode(chunks[0].bytes)).not.toMatch(
				/undo|selection|activity|drawer|preference|history/i
			);
		});
	});

	it('advances exactly one version and creates none when authored content is unchanged', async () => {
		const t = backend();
		const firstRecord = workingCopy();
		const first = await t.mutation(api.documentVersions.save, await saveArgs(firstRecord));
		const cleanRecord = {
			...firstRecord,
			cloudBase: {
				version: first.version,
				bundleHash: first.bundleHash,
				generation: firstRecord.generation
			}
		};
		const unchanged = await t.mutation(
			api.documentVersions.save,
			await saveArgs(cleanRecord, 'operation-2')
		);
		const changedRecord = {
			...cleanRecord,
			generation: 2,
			content: { ...cleanRecord.content, title: 'Changed cloud document' }
		};
		const changed = await t.mutation(
			api.documentVersions.save,
			await saveArgs(changedRecord, 'operation-3')
		);

		expect(unchanged).toMatchObject({ status: 'unchanged', version: 1 });
		expect(changed).toMatchObject({ status: 'created', version: 2 });
		await t.run(async (ctx) => {
			expect(await ctx.db.query('documentVersions').collect()).toHaveLength(2);
		});
	});

	it('returns the original receipt for a matching retry and rejects operation ID reuse', async () => {
		const t = backend();
		const args = await saveArgs();
		const first = await t.mutation(api.documentVersions.save, args);
		expect(await t.mutation(api.documentVersions.save, args)).toEqual(first);

		const changedInput = {
			...args,
			message: 'Different retry input',
			operationInputHash: await cloudVersionOperationInputHash({
				publicDocumentId: args.publicDocumentId,
				expectedHeadNumber: args.expectedHeadNumber,
				expectedHeadHash: args.expectedHeadHash,
				operationId: args.operationId,
				message: 'Different retry input',
				bundleHash: args.bundleHash
			})
		};
		await expect(
			t.mutation(api.documentVersions.save, changedInput)
		).rejects.toThrow('OPERATION_INPUT_MISMATCH');
	});

	it('rejects a stale expected head before creating another version', async () => {
		const t = backend();
		await t.mutation(api.documentVersions.save, await saveArgs());
		await expect(
			t.mutation(
				api.documentVersions.save,
				await saveArgs(workingCopy(), 'stale-unchanged-operation')
			)
		).rejects.toThrow('HEAD_CONFLICT:1');
		const stale = workingCopy();
		stale.content.title = 'Stale local title';

		await expect(
			t.mutation(api.documentVersions.save, await saveArgs(stale, 'operation-2'))
		).rejects.toThrow('HEAD_CONFLICT:1');
		await t.run(async (ctx) => {
			expect(await ctx.db.query('documentVersions').collect()).toHaveLength(1);
		});
	});

	it('splits larger authored bundles into contiguous hash-verified chunks', async () => {
		const t = backend();
		const record = workingCopy();
		record.content.graph.authored.blocksOrder = ['large-block'];
		record.content.graph.authored.blocks = [
			{
				id: 'large-block',
				docId: DOCUMENT_ID,
				type: 'text',
				position: 0,
				pm: { type: 'paragraph', text: 'x'.repeat(760 * 1024) }
			}
		];
		const result = await t.mutation(
			api.documentVersions.save,
			await saveArgs(record, 'large-operation')
		);

		expect(result).toMatchObject({ status: 'created', version: 1 });
		const loaded = await t.query(api.documentVersions.loadHead, {
			publicDocumentId: DOCUMENT_ID
		});
		expect(loaded).toMatchObject({
			state: 'live',
			version: { chunkCount: 2 },
			bundle: { graph: { blocksOrder: ['large-block'] } }
		});
		await t.run(async (ctx) => {
			const chunks = await ctx.db.query('snapshotChunks').collect();
			expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1]);
			expect(chunks.every((chunk) => /^[a-f0-9]{64}$/.test(chunk.chunkHash))).toBe(true);
		});
	});

	it('blocks a bundle that references an unavailable asset', async () => {
		const t = backend();
		const record = workingCopy();
		record.content.graph.authored.blocksOrder = ['missing-image'];
		record.content.graph.authored.blocks = [
			{
				id: 'missing-image',
				docId: DOCUMENT_ID,
				type: 'image',
				position: 0,
				image: { storageId: 'missing-storage-id' }
			}
		];

		await expect(
			t.mutation(
				api.documentVersions.save,
				await saveArgs(record, 'missing-asset-operation')
			)
		).rejects.toThrow('MISSING_ASSET');
		await t.run(async (ctx) => {
			expect(await ctx.db.query('documents').collect()).toEqual([]);
			expect(await ctx.db.query('documentVersions').collect()).toEqual([]);
		});
	});
});
