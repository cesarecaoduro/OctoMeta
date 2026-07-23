import type { PersistedAuthoredGraph } from './serialize';
import type {
	LocalCloudSnapshotSummary,
	LocalWorkingCopyRecord,
	LocalWorkspaceRepository,
	PendingCloudVersionOperation
} from './local';
import { localGraphRows } from './local';
import { canonicalJson } from './canonical';
import { sha256Hex } from './cloud-integrity';

/** Schema version for immutable authored cloud snapshots. */
export const CLOUD_BUNDLE_SCHEMA_VERSION = 1;

/** One canonical immutable authored snapshot. Browser-only state cannot fit this shape. */
export interface CloudVersionBundle {
	schemaVersion: typeof CLOUD_BUNDLE_SCHEMA_VERSION;
	title: string;
	graph: PersistedAuthoredGraph;
	workbookSnapshot: unknown;
}

/** Saveable review warning shown before version creation. */
export interface CloudVersionWarning {
	kind: 'broken-references' | 'incomplete-calculations';
	count: number;
	message: string;
}

/** Integrity problem that prevents version creation. */
export interface CloudVersionBlocker {
	kind: 'corrupt-bundle' | 'missing-assets';
	count: number;
	message: string;
}

/** Observable review state consumed by every responsive Save new version surface. */
export interface CloudVersionReview {
	nextVersion: number;
	source: string;
	capturedGeneration: number;
	expectedHeadNumber: number;
	expectedHeadHash: string | null;
	summary: LocalCloudSnapshotSummary & {
		changes: LocalCloudSnapshotSummary | null;
		generations: number;
	};
	warnings: CloudVersionWarning[];
	blockers: CloudVersionBlocker[];
	bundle: CloudVersionBundle;
	bundleJson: string;
	bundleHash: string;
	byteLength: number;
	message?: string;
}

/** Fields bound into a persistent operation receipt independently from the bundle bytes. */
export interface CloudVersionOperationHashInput {
	publicDocumentId: string;
	expectedHeadNumber: number;
	expectedHeadHash: string | null;
	operationId: string;
	message: string | null;
	bundleHash: string;
}

/** Exact public cloud operation submitted through the persistence facade. */
export interface SaveCloudVersionInput extends CloudVersionOperationHashInput {
	operationInputHash: string;
	bundleJson: string;
}

/** Confirmed result of an explicit immutable-version operation. */
export interface SaveCloudVersionResult {
	status: 'created' | 'unchanged';
	version: number;
	versionId?: string;
	bundleHash: string;
}

/** Staged progress visible in the Save new version review surface. */
export type CloudVersionProgress =
	| { stage: 'preparing' }
	| { stage: 'assets' }
	| { stage: 'version' }
	| { stage: 'complete'; version: number; dirtyAfterSave: boolean }
	| { stage: 'error'; message: string };

/** Result returned to the workbench after cloud and local acknowledgement complete. */
export type CloudVersionOutcome = SaveCloudVersionResult & { dirtyAfterSave: boolean };

/** Ports and stable identity for one working copy's explicit cloud-version controller. */
export interface CloudVersionControllerOptions {
	accountId: string;
	documentId: string;
	workspaceId: string;
	repository: Pick<
		LocalWorkspaceRepository,
		'load' | 'stageCloudVersion' | 'acknowledgeCloudVersion'
	>;
	flushLocal(): Promise<void>;
	cloud: { saveCloudVersion(input: SaveCloudVersionInput): Promise<SaveCloudVersionResult> };
	createOperationId?: () => string;
	now?: () => number;
	onProgress?: (progress: CloudVersionProgress) => void;
}

/** Public behavior consumed by the workbench Save new version flow. */
export interface CloudVersionController {
	/** Flush and review one settled durable local generation. */
	prepare(): Promise<CloudVersionReview>;
	/** Persist retry input, create or reuse the cloud version, then acknowledge its captured base. */
	save(review: CloudVersionReview, message?: string): Promise<CloudVersionOutcome>;
}

/** Hash the normalized explicit-save input used to detect incompatible operation retries. */
export function cloudVersionOperationInputHash(
	input: CloudVersionOperationHashInput
): Promise<string> {
	return sha256Hex(
		canonicalJson({
			publicDocumentId: input.publicDocumentId,
			expectedHeadNumber: input.expectedHeadNumber,
			expectedHeadHash: input.expectedHeadHash,
			operationId: input.operationId,
			message: input.message,
			bundleHash: input.bundleHash
		})
	);
}

function cloudBundle(record: LocalWorkingCopyRecord): CloudVersionBundle {
	const rows = localGraphRows(record.content.graph);
	return {
		schemaVersion: CLOUD_BUNDLE_SCHEMA_VERSION,
		title: record.content.title,
		graph: {
			blocksOrder: [...rows.document.blocksOrder],
			workbookManifest: structuredClone(record.content.graph.authored.workbookManifest),
			nodes: rows.nodes,
			blocks: rows.blocks.map(({ docId: _docId, ...block }) => block),
			chips: rows.chips
		},
		workbookSnapshot: authoredWorkbookSnapshot(record.content.workbookSnapshot)
	};
}

const LOCAL_WORKBOOK_KEYS = new Set([
	'activeSheetId',
	'focused',
	'resources',
	'redoStack',
	'scrollLeft',
	'scrollTop',
	'selection',
	'selections',
	'undoStack',
	'viewport',
	'zoomRatio'
]);

/**
 * Copy only authored workbook JSON while structurally removing local view,
 * selection, history, and opaque plugin state at every nesting level.
 */
export function authoredWorkbookSnapshot(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(authoredWorkbookSnapshot);
	if (!value || typeof value !== 'object') return value;
	const authored: Record<string, unknown> = {};
	for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
		if (LOCAL_WORKBOOK_KEYS.has(key)) continue;
		authored[key] = authoredWorkbookSnapshot(nested);
	}
	return authored;
}

/** Count authored bundle elements for review and later Main comparisons. */
export function cloudVersionSnapshotSummary(
	bundle: CloudVersionBundle
): LocalCloudSnapshotSummary {
	const assets = new Set(
		bundle.graph.blocks
			.map((block) => block.image?.storageId)
			.filter((storageId): storageId is string => Boolean(storageId))
	);
	return {
		blocks: bundle.graph.blocks.length,
		nodes: bundle.graph.nodes.length,
		sheets: bundle.graph.workbookManifest.sheets.length,
		assets: assets.size
	};
}

function changedCounts(
	current: LocalCloudSnapshotSummary,
	base: LocalCloudSnapshotSummary
): LocalCloudSnapshotSummary {
	return {
		blocks: current.blocks - base.blocks,
		nodes: current.nodes - base.nodes,
		sheets: current.sheets - base.sheets,
		assets: current.assets - base.assets
	};
}

function warningState(
	nodes: Array<{ value: unknown }>
): CloudVersionWarning[] {
	let brokenReferences = 0;
	let incompleteCalculations = 0;
	for (const node of nodes) {
		const value = node.value as { kind?: unknown; code?: unknown };
		if (value.kind !== 'error') continue;
		if (value.code === '#REF!') brokenReferences += 1;
		else incompleteCalculations += 1;
	}
	const warnings: CloudVersionWarning[] = [];
	if (brokenReferences > 0) {
		warnings.push({
			kind: 'broken-references',
			count: brokenReferences,
			message: `${brokenReferences} broken reference${brokenReferences === 1 ? '' : 's'} will remain visible.`
		});
	}
	if (incompleteCalculations > 0) {
		warnings.push({
			kind: 'incomplete-calculations',
			count: incompleteCalculations,
			message: `${incompleteCalculations} calculation${incompleteCalculations === 1 ? '' : 's'} remain incomplete.`
		});
	}
	return warnings;
}

function blockerState(bundle: CloudVersionBundle): CloudVersionBlocker[] {
	const missingAssets = bundle.graph.blocks.filter(
		(block) => block.type === 'image' && !block.image?.storageId
	).length;
	const blockers: CloudVersionBlocker[] = [];
	if (missingAssets > 0) {
		blockers.push({
			kind: 'missing-assets',
			count: missingAssets,
			message: `${missingAssets} image asset${missingAssets === 1 ? ' is' : 's are'} missing. Restore or remove the affected image before saving.`
		});
	}
	const sheetIds = bundle.graph.workbookManifest.sheets.map((sheet) => sheet.id);
	const snapshot = bundle.workbookSnapshot as {
		sheetOrder?: unknown;
		sheets?: Record<string, unknown>;
	};
	if (
		!Array.isArray(snapshot?.sheetOrder) ||
		!snapshot.sheets ||
		JSON.stringify(snapshot.sheetOrder) !== JSON.stringify(sheetIds)
	) {
		blockers.push({
			kind: 'corrupt-bundle',
			count: 1,
			message: 'The Workbook snapshot does not match the authored sheet list.'
		});
	}
	return blockers;
}

/** Build the exact authored snapshot and user-visible review for one durable generation. */
export async function buildCloudVersionReview(
	record: LocalWorkingCopyRecord
): Promise<CloudVersionReview> {
	const bundle = cloudBundle(record);
	const bundleJson = canonicalJson(bundle);
	return assembleReview({
		record,
		bundle,
		bundleJson,
		bundleHash: await sha256Hex(bundleJson),
		capturedGeneration: record.generation,
		expectedHeadNumber: record.cloudBase?.version ?? 0,
		expectedHeadHash: record.cloudBase?.bundleHash ?? null
	});
}

async function pendingReview(
	record: LocalWorkingCopyRecord,
	operation: PendingCloudVersionOperation
): Promise<CloudVersionReview> {
	const bundle = JSON.parse(operation.bundleJson) as CloudVersionBundle;
	if (
		canonicalJson(bundle) !== operation.bundleJson ||
		(await sha256Hex(operation.bundleJson)) !== operation.bundleHash
	) {
		throw new Error('PENDING_CLOUD_OPERATION_CORRUPT');
	}
	return assembleReview({
		record,
		bundle,
		bundleJson: operation.bundleJson,
		bundleHash: operation.bundleHash,
		capturedGeneration: operation.capturedGeneration,
		expectedHeadNumber: operation.expectedHeadNumber,
		expectedHeadHash: operation.expectedHeadHash,
		message: operation.message
	});
}

function assembleReview(input: {
	record: LocalWorkingCopyRecord;
	bundle: CloudVersionBundle;
	bundleJson: string;
	bundleHash: string;
	capturedGeneration: number;
	expectedHeadNumber: number;
	expectedHeadHash: string | null;
	message?: string;
}): CloudVersionReview {
	const { record, bundle, bundleJson } = input;
	const currentSummary = cloudVersionSnapshotSummary(bundle);
	const baseSummary = record.cloudBase?.summary ?? (record.cloudBase ? null : {
		blocks: 0,
		nodes: 0,
		sheets: 0,
		assets: 0
	});
	return {
		nextVersion: input.expectedHeadNumber + 1,
		source:
			record.workspace.kind === 'branch'
				? `Branch “${record.workspace.name}”`
				: 'Working copy',
		capturedGeneration: input.capturedGeneration,
		expectedHeadNumber: input.expectedHeadNumber,
		expectedHeadHash: input.expectedHeadHash,
		summary: {
			...currentSummary,
			changes: baseSummary ? changedCounts(currentSummary, baseSummary) : null,
			generations: Math.max(
				0,
				input.capturedGeneration - (record.cloudBase?.generation ?? 0)
			)
		},
		warnings: warningState(bundle.graph.nodes),
		blockers: blockerState(bundle),
		bundle,
		bundleJson,
		bundleHash: input.bundleHash,
		byteLength: new TextEncoder().encode(bundleJson).byteLength,
		...(input.message ? { message: input.message } : {})
	};
}

function pendingInput(operation: PendingCloudVersionOperation, documentId: string): SaveCloudVersionInput {
	return {
		publicDocumentId: documentId,
		expectedHeadNumber: operation.expectedHeadNumber,
		expectedHeadHash: operation.expectedHeadHash,
		operationId: operation.operationId,
		operationInputHash: operation.operationInputHash,
		message: operation.message ?? null,
		bundleHash: operation.bundleHash,
		bundleJson: operation.bundleJson
	};
}

/** Create the retry-safe controller for one working copy's explicit cloud publication flow. */
export function createCloudVersionController(
	options: CloudVersionControllerOptions
): CloudVersionController {
	const now = options.now ?? Date.now;
	const createOperationId = options.createOperationId ?? (() => crypto.randomUUID());
	const load = async (): Promise<LocalWorkingCopyRecord> => {
		const record = await options.repository.load(
			options.accountId,
			options.documentId,
			options.workspaceId
		);
		if (!record) throw new Error('LOCAL_WORKING_COPY_NOT_FOUND');
		return record;
	};

	return {
		async prepare(): Promise<CloudVersionReview> {
			await options.flushLocal();
			const record = await load();
			return record.pendingCloudOperation
				? pendingReview(record, record.pendingCloudOperation)
				: buildCloudVersionReview(record);
		},
		async save(review, rawMessage = ''): Promise<CloudVersionOutcome> {
			if (review.blockers.length > 0) throw new Error('CLOUD_VERSION_BLOCKED');
			const message = rawMessage.trim();
			if (message.length > 500) throw new Error('VERSION_MESSAGE_TOO_LONG');
			options.onProgress?.({ stage: 'preparing' });
			try {
				let record = await load();
				let operation = record.pendingCloudOperation;
				if (!operation) {
					const operationId = createOperationId();
					const hashInput: CloudVersionOperationHashInput = {
						publicDocumentId: options.documentId,
						expectedHeadNumber: review.expectedHeadNumber,
						expectedHeadHash: review.expectedHeadHash,
						operationId,
						message: message || null,
						bundleHash: review.bundleHash
					};
					operation = {
						operationId,
						operationInputHash: await cloudVersionOperationInputHash(hashInput),
						capturedGeneration: review.capturedGeneration,
						expectedHeadNumber: review.expectedHeadNumber,
						expectedHeadHash: review.expectedHeadHash,
						bundleJson: review.bundleJson,
						bundleHash: review.bundleHash,
						...(message ? { message } : {}),
						createdAt: now()
					};
					record = await options.repository.stageCloudVersion({
						accountId: options.accountId,
						documentId: options.documentId,
						workspaceId: options.workspaceId,
						expectedGeneration: review.capturedGeneration,
						operation
					});
					operation = record.pendingCloudOperation!;
				}
				const input = pendingInput(operation, options.documentId);
				options.onProgress?.({ stage: 'assets' });
				options.onProgress?.({ stage: 'version' });
				const result = await options.cloud.saveCloudVersion(input);
				const acknowledged = await options.repository.acknowledgeCloudVersion({
					accountId: options.accountId,
					documentId: options.documentId,
					workspaceId: options.workspaceId,
					operationId: operation.operationId,
					version: result.version,
					bundleHash: result.bundleHash,
					summary: {
						blocks: review.summary.blocks,
						nodes: review.summary.nodes,
						sheets: review.summary.sheets,
						assets: review.summary.assets
					}
				});
				const dirtyAfterSave =
					acknowledged.generation > (acknowledged.cloudBase?.generation ?? 0);
				options.onProgress?.({
					stage: 'complete',
					version: result.version,
					dirtyAfterSave
				});
				return { ...result, dirtyAfterSave };
			} catch (error) {
				options.onProgress?.({
					stage: 'error',
					message: error instanceof Error ? error.message : 'Cloud version save failed.'
				});
				throw error;
			}
		}
	};
}
