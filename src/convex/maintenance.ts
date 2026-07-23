import { v } from 'convex/values';
import {
	action,
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { internal } from './_generated/api';

declare const process: { env: Record<string, string | undefined> };

const LOCK_KEY = 'product-write-lock';
const RESET_BATCH = 100;
const COUNT_CAP = 4_096;
const RESET_STAGES = [
	'graphNodes',
	'blocks',
	'undoLog',
	'chipBindings',
	'workbookSnapshots',
	'documents'
] as const;
type ResetStage = (typeof RESET_STAGES)[number];

/** Counts returned by the development reset dry run and final verification. */
export interface ResetCounts {
	documents: number;
	graphNodes: number;
	blocks: number;
	undoLog: number;
	chipBindings: number;
	workbookSnapshots: number;
	assets: number;
	rootStorage: number;
	truncated: boolean;
}

/**
 * CLI-only development reset entry point.
 *
 * This function is intentionally absent from browser persistence code. It
 * refuses every environment except an explicitly configured development/test
 * deployment, requires a deployment-specific token and irreversible-backup
 * acknowledgement, and holds the product write lock until zero-row
 * verification succeeds.
 */
export const developmentReset = action({
	args: {
		token: v.string(),
		dryRun: v.boolean(),
		acknowledgeBackup: v.string()
	},
	handler: async (ctx, args): Promise<{ dryRun: boolean; before: ResetCounts; after: ResetCounts }> => {
		assertResetAuthority(args.token, args.acknowledgeBackup);
		const before = await ctx.runQuery(internal.maintenance.countResetRows, {});
		if (args.dryRun) return { dryRun: true, before, after: before };

		await ctx.runMutation(internal.maintenance.beginReset, {});
		try {
			for (;;) {
				const assets = await ctx.runQuery(internal.maintenance.nextAssetBatch, {});
				if (assets.length === 0) break;
				for (const asset of assets) await ctx.storage.delete(asset.storageId);
				await ctx.runMutation(internal.maintenance.deleteAssetBatch, {
					assetIds: assets.map((asset) => asset.assetId)
				});
			}
			for (;;) {
				const storageIds = await ctx.runQuery(internal.maintenance.nextRootStorageBatch, {});
				if (storageIds.length === 0) break;
				for (const storageId of storageIds) await ctx.storage.delete(storageId);
			}
			for (const stage of RESET_STAGES) {
				for (;;) {
					const deleted = await ctx.runMutation(internal.maintenance.deleteResetBatch, {
						stage
					});
					if (deleted === 0) break;
				}
			}
			const after = await ctx.runMutation(internal.maintenance.finishReset, {});
			return { dryRun: false, before, after };
		} catch (cause) {
			// Fail closed: the lock deliberately remains held for inspection.
			throw new Error(
				`RESET_FAILED_MAINTENANCE_REMAINS_LOCKED:${
					cause instanceof Error ? cause.message : String(cause)
				}`
			);
		}
	}
});

/** Count allowlisted product rows and root storage; waitlist/auth/component data is excluded. */
export const countResetRows = internalQuery({
	args: {},
	handler: async (ctx): Promise<ResetCounts> => readResetCounts(ctx)
});

/** Atomically acquire the singleton product-write lock. */
export const beginReset = internalMutation({
	args: {},
	handler: async (ctx) => {
		const existing = await ctx.db
			.query('maintenance')
			.withIndex('by_key', (q) => q.eq('key', LOCK_KEY))
			.unique();
		if (existing?.locked) throw new Error('MAINTENANCE_ALREADY_LOCKED');
		const now = Date.now();
		if (existing) {
			await ctx.db.patch(existing._id, {
				locked: true,
				operation: 'development-reset',
				startedAt: now,
				updatedAt: now
			});
		} else {
			await ctx.db.insert('maintenance', {
				key: LOCK_KEY,
				locked: true,
				operation: 'development-reset',
				startedAt: now,
				updatedAt: now
			});
		}
	}
});

/** Return one locked-reset asset batch without changing durable state. */
export const nextAssetBatch = internalQuery({
	args: {},
	handler: async (ctx) => {
		await requireResetLock(ctx);
		const assets = await ctx.db.query('assets').take(RESET_BATCH);
		return assets.map((asset) => ({ assetId: asset._id, storageId: asset.storageId }));
	}
});

/** Return one locked batch of root file-storage objects, including orphaned legacy files. */
export const nextRootStorageBatch = internalQuery({
	args: {},
	handler: async (ctx) => {
		await requireResetLock(ctx);
		const files = await ctx.db.system.query('_storage').take(RESET_BATCH);
		return files.map((file) => file._id);
	}
});

/** Delete asset ownership rows only after their storage objects were removed. */
export const deleteAssetBatch = internalMutation({
	args: { assetIds: v.array(v.id('assets')) },
	handler: async (ctx, { assetIds }) => {
		await requireResetLock(ctx);
		for (const assetId of assetIds) {
			if (await ctx.db.get(assetId)) await ctx.db.delete(assetId);
		}
	}
});

/** Delete one bounded batch from a single allowlisted product table. */
export const deleteResetBatch = internalMutation({
	args: {
		stage: v.union(
			v.literal('graphNodes'),
			v.literal('blocks'),
			v.literal('undoLog'),
			v.literal('chipBindings'),
			v.literal('workbookSnapshots'),
			v.literal('documents')
		)
	},
	handler: async (ctx, { stage }): Promise<number> => {
		await requireResetLock(ctx);
		const rows =
			stage === 'graphNodes'
				? await ctx.db.query('graphNodes').take(RESET_BATCH)
				: stage === 'blocks'
					? await ctx.db.query('blocks').take(RESET_BATCH)
					: stage === 'undoLog'
						? await ctx.db.query('undoLog').take(RESET_BATCH)
						: stage === 'chipBindings'
							? await ctx.db.query('chipBindings').take(RESET_BATCH)
							: stage === 'workbookSnapshots'
								? await ctx.db.query('workbookSnapshots').take(RESET_BATCH)
								: await ctx.db.query('documents').take(RESET_BATCH);
		for (const row of rows) await ctx.db.delete(row._id);
		return rows.length;
	}
});

/** Atomically verify zero product state and delete the singleton reset lock. */
export const finishReset = internalMutation({
	args: {},
	handler: async (ctx): Promise<ResetCounts> => {
		const lock = await requireResetLock(ctx);
		const after = await readResetCounts(ctx);
		if (Object.entries(after).some(([key, count]) => key !== 'truncated' && count !== 0)) {
			throw new Error('RESET_VERIFICATION_FAILED');
		}
		await ctx.db.delete(lock._id);
		return after;
	}
});

async function readResetCounts(
	ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>
): Promise<ResetCounts> {
	const count = async (
		table:
			| 'documents'
			| 'graphNodes'
			| 'blocks'
			| 'undoLog'
			| 'chipBindings'
			| 'workbookSnapshots'
			| 'assets'
	): Promise<{ count: number; truncated: boolean }> => {
		const rows = await ctx.db.query(table).take(COUNT_CAP + 1);
		return { count: Math.min(rows.length, COUNT_CAP), truncated: rows.length > COUNT_CAP };
	};
	const [documents, graphNodes, blocks, undoLog, chipBindings, workbookSnapshots, assets] =
		await Promise.all([
			count('documents'),
			count('graphNodes'),
			count('blocks'),
			count('undoLog'),
			count('chipBindings'),
			count('workbookSnapshots'),
			count('assets')
		]);
	const rootStorageRows = await ctx.db.system.query('_storage').take(COUNT_CAP + 1);
	const rootStorage = {
		count: Math.min(rootStorageRows.length, COUNT_CAP),
		truncated: rootStorageRows.length > COUNT_CAP
	};
	return {
		documents: documents.count,
		graphNodes: graphNodes.count,
		blocks: blocks.count,
		undoLog: undoLog.count,
		chipBindings: chipBindings.count,
		workbookSnapshots: workbookSnapshots.count,
		assets: assets.count,
		rootStorage: rootStorage.count,
		truncated: [
			documents,
			graphNodes,
			blocks,
			undoLog,
			chipBindings,
			workbookSnapshots,
			assets,
			rootStorage
		].some((result) => result.truncated)
	};
}

function assertResetAuthority(token: string, acknowledgement: string): void {
	validateResetAuthority({
		environment: process.env.RESET_ENVIRONMENT,
		expectedToken: process.env.DEV_RESET_TOKEN,
		token,
		acknowledgement
	});
}

/** Inputs to the pure reset-authority validator used by the CLI action. */
export interface ResetAuthority {
	environment: string | undefined;
	expectedToken: string | undefined;
	token: string;
	acknowledgement: string;
}

/**
 * Validate reset authorization without reading global state.
 *
 * Exported separately so the production refusal, deployment-token check, and
 * irreversible acknowledgement remain directly testable.
 */
export function validateResetAuthority(authority: ResetAuthority): void {
	if (authority.environment !== 'development' && authority.environment !== 'test') {
		throw new Error('RESET_REFUSED_OUTSIDE_DEVELOPMENT');
	}
	if (!authority.expectedToken || authority.token !== authority.expectedToken) {
		throw new Error('RESET_TOKEN_INVALID');
	}
	if (authority.acknowledgement !== 'IRREVERSIBLE BACKUP CONFIRMED') {
		throw new Error('RESET_BACKUP_ACKNOWLEDGEMENT_REQUIRED');
	}
}

async function requireResetLock(
	ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>
) {
	const lock = await ctx.db
		.query('maintenance')
		.withIndex('by_key', (query) => query.eq('key', LOCK_KEY))
		.unique();
	if (!lock?.locked) throw new Error('RESET_LOCK_REQUIRED');
	return lock;
}
