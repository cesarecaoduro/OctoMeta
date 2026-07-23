import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { observePersistence, type PersistenceActivityObserver } from '../activity';
import type { LocalGraphSnapshot } from './serialization';

const DATABASE_NAME = 'octometa-browser-workspace';
const DATABASE_VERSION = 2;

/** The role one browser-local working copy plays beneath a document. */
export type LocalWorkspaceDescriptor =
	| { kind: 'main' }
	| { kind: 'branch'; name: string };

/** Authored counts retained with a cloud base for later change summaries. */
export interface LocalCloudSnapshotSummary {
	blocks: number;
	nodes: number;
	sheets: number;
	assets: number;
}

/** Immutable cloud generation from which a local working copy began. */
export interface LocalCloudBase {
	version: number;
	bundleHash: string;
	generation: number;
	summary?: LocalCloudSnapshotSummary;
}

/** Authored content and unified history captured in one durable generation. */
export interface LocalWorkingCopyContent {
	title: string;
	graph: LocalGraphSnapshot;
	workbookSnapshot: unknown;
}

/** Exact immutable cloud-save input retained until its acknowledgement commits locally. */
export interface PendingCloudVersionOperation {
	operationId: string;
	operationInputHash: string;
	capturedGeneration: number;
	expectedHeadNumber: number;
	expectedHeadHash: string | null;
	bundleJson: string;
	bundleHash: string;
	message?: string;
	createdAt: number;
}

/** One account-scoped browser working copy. */
export interface LocalWorkingCopyRecord {
	accountId: string;
	documentId: string;
	workspaceId: string;
	workspace: LocalWorkspaceDescriptor;
	generation: number;
	cloudBase?: LocalCloudBase;
	pendingCloudOperation?: PendingCloudVersionOperation;
	content: LocalWorkingCopyContent;
	createdAt: number;
	updatedAt: number;
}

/** Lightweight browser-local document entry used by the unified index. */
export interface LocalWorkspaceSummary {
	accountId: string;
	documentId: string;
	workspaceId: string;
	workspace: LocalWorkspaceDescriptor;
	title: string;
	generation: number;
	cloudBase?: LocalCloudBase;
	stats: { blocks: number; tabs: number; nodes: number; bytes: number };
	createdAt: number;
	updatedAt: number;
}

/** Backwards-compatible name for callers that list only main working copies. */
export type LocalDocumentSummary = LocalWorkspaceSummary;

/** Input for one expected-generation working-copy transaction. */
export interface CommitLocalWorkingCopyInput {
	accountId: string;
	documentId: string;
	workspaceId: string;
	workspace?: LocalWorkspaceDescriptor;
	expectedGeneration: number;
	cloudBase?: Omit<LocalCloudBase, 'generation'>;
	content: LocalWorkingCopyContent;
}

/** Input for durably staging an immutable explicit cloud-version attempt. */
export interface StageCloudVersionInput {
	accountId: string;
	documentId: string;
	workspaceId: string;
	expectedGeneration: number;
	operation: PendingCloudVersionOperation;
}

/** Input for applying a confirmed cloud head without replacing newer authored content. */
export interface AcknowledgeCloudVersionInput {
	accountId: string;
	documentId: string;
	workspaceId: string;
	operationId: string;
	version: number;
	bundleHash: string;
	summary: LocalCloudSnapshotSummary;
}

/** Input for copying one main working copy into a new local-only document. */
export interface DuplicateLocalDocumentInput {
	accountId: string;
	sourceDocumentId: string;
	documentId: string;
	title: string;
}

/** Raised when another writer has already advanced a working copy. */
export class GenerationConflictError extends Error {
	constructor(
		readonly expectedGeneration: number,
		readonly actualGeneration: number
	) {
		super(
			`Local working copy generation changed: expected ${expectedGeneration}, found ${actualGeneration}.`
		);
		this.name = 'GenerationConflictError';
	}
}

interface LocalWorkspaceDatabase extends DBSchema {
	workspaces: {
		key: [accountId: string, documentId: string, workspaceId: string];
		value: LocalWorkingCopyRecord;
	};
	documentSummaries: {
		key: [accountId: string, documentId: string];
		value: Omit<LocalWorkspaceSummary, 'workspaceId' | 'workspace'>;
		indexes: { byAccount: string };
	};
	workspaceSummaries: {
		key: [accountId: string, documentId: string, workspaceId: string];
		value: LocalWorkspaceSummary;
		indexes: { byAccount: string };
	};
}

/** Account-scoped IndexedDB operations consumed by document routes. */
export interface LocalWorkspaceRepository {
	/** Atomically replace authored content and undo state when the durable generation matches. */
	commit(input: CommitLocalWorkingCopyInput): Promise<LocalWorkingCopyRecord>;
	/** Persist the exact retry input before the first cloud request. */
	stageCloudVersion(input: StageCloudVersionInput): Promise<LocalWorkingCopyRecord>;
	/** Mark only the operation's captured generation as the new cloud base. */
	acknowledgeCloudVersion(input: AcknowledgeCloudVersionInput): Promise<LocalWorkingCopyRecord>;
	/** Load one account-owned working copy, or `null` when it has not been created locally. */
	load(
		accountId: string,
		documentId: string,
		workspaceId: string
	): Promise<LocalWorkingCopyRecord | null>;
	/** List browser-local document summaries belonging to exactly one account. */
	listDocuments(accountId: string): Promise<LocalDocumentSummary[]>;
	/** List every main and branch working copy belonging to exactly one account. */
	listWorkspaces(accountId: string): Promise<LocalWorkspaceSummary[]>;
	/** Copy one main working copy into a new local-only document with fresh history. */
	duplicateDocument(input: DuplicateLocalDocumentInput): Promise<LocalWorkingCopyRecord>;
	/** Remove every browser-local working copy for one document. */
	discardDocument(accountId: string, documentId: string): Promise<number>;
	/** Close this repository's shared IndexedDB connection. */
	close(): void;
}

/** Options for a browser-local repository connection. */
export interface LocalWorkspaceRepositoryOptions {
	databaseName?: string;
	now?: () => number;
	observe?: PersistenceActivityObserver;
}

function openLocalDatabase(name: string): Promise<IDBPDatabase<LocalWorkspaceDatabase>> {
	let opened: IDBPDatabase<LocalWorkspaceDatabase> | undefined;
	return openDB<LocalWorkspaceDatabase>(name, DATABASE_VERSION, {
		async upgrade(database, oldVersion, _newVersion, transaction) {
			if (!database.objectStoreNames.contains('workspaces')) {
				database.createObjectStore('workspaces');
			}
			if (!database.objectStoreNames.contains('documentSummaries')) {
				const summaries = database.createObjectStore('documentSummaries');
				summaries.createIndex('byAccount', 'accountId');
			}
			if (!database.objectStoreNames.contains('workspaceSummaries')) {
				const summaries = database.createObjectStore('workspaceSummaries');
				summaries.createIndex('byAccount', 'accountId');
			}
			if (oldVersion === 1) {
				let cursor = await transaction.objectStore('documentSummaries').openCursor();
				while (cursor) {
					const legacy = cursor.value;
					const summary: LocalWorkspaceSummary = {
						...legacy,
						workspaceId: 'main',
						workspace: { kind: 'main' }
					};
					await transaction
						.objectStore('workspaceSummaries')
						.put(summary, [summary.accountId, summary.documentId, 'main']);
					cursor = await cursor.continue();
				}
			}
		},
		blocking() {
			// Release old connections promptly so a future schema upgrade is not blocked.
			opened?.close();
		}
	}).then((database) => {
		opened = database;
		return database;
	});
}

function workspaceDescriptor(
	workspaceId: string,
	provided?: LocalWorkspaceDescriptor
): LocalWorkspaceDescriptor {
	return provided ?? (workspaceId === 'main' ? { kind: 'main' } : { kind: 'branch', name: workspaceId });
}

function normalizeRecord(record: LocalWorkingCopyRecord): LocalWorkingCopyRecord {
	return {
		...record,
		workspace: workspaceDescriptor(record.workspaceId, record.workspace)
	};
}

function statsFor(content: LocalWorkingCopyContent): LocalWorkspaceSummary['stats'] {
	return {
		blocks: content.graph.authored.blocks.length,
		tabs: content.graph.authored.workbookManifest.sheets.length,
		nodes: content.graph.authored.nodes.length,
		bytes: new TextEncoder().encode(JSON.stringify(content)).byteLength
	};
}

function summaryFor(record: LocalWorkingCopyRecord): LocalWorkspaceSummary {
	return {
		accountId: record.accountId,
		documentId: record.documentId,
		workspaceId: record.workspaceId,
		workspace: record.workspace,
		title: record.content.title,
		generation: record.generation,
		...(record.cloudBase ? { cloudBase: record.cloudBase } : {}),
		stats: statsFor(record.content),
		createdAt: record.createdAt,
		updatedAt: record.updatedAt
	};
}

function duplicateContent(
	content: LocalWorkingCopyContent,
	documentId: string,
	title: string
): LocalWorkingCopyContent {
	const duplicated = structuredClone(content);
	duplicated.title = title;
	duplicated.graph.authored.blocks = duplicated.graph.authored.blocks.map((block) => ({
		...block,
		docId: documentId
	}));
	duplicated.graph.history = { undoCursor: 0, undoLog: [] };
	if (
		typeof duplicated.workbookSnapshot === 'object' &&
		duplicated.workbookSnapshot !== null &&
		!Array.isArray(duplicated.workbookSnapshot)
	) {
		duplicated.workbookSnapshot = {
			...(duplicated.workbookSnapshot as Record<string, unknown>),
			id: documentId,
			name: title
		};
	}
	return duplicated;
}

/** Create an IndexedDB-backed repository without opening the database until first use. */
export function createLocalWorkspaceRepository(
	options: LocalWorkspaceRepositoryOptions = {}
): LocalWorkspaceRepository {
	const databaseName = options.databaseName ?? DATABASE_NAME;
	const now = options.now ?? Date.now;
	let databasePromise: Promise<IDBPDatabase<LocalWorkspaceDatabase>> | null = null;
	let openedDatabase: IDBPDatabase<LocalWorkspaceDatabase> | null = null;
	const database = (): Promise<IDBPDatabase<LocalWorkspaceDatabase>> => {
		databasePromise ??= openLocalDatabase(databaseName).then((opened) => {
			openedDatabase = opened;
			return opened;
		});
		return databasePromise;
	};
	const listWorkspaceSummaries = (accountId: string): Promise<LocalWorkspaceSummary[]> =>
		observePersistence(
			options.observe,
			{ target: 'local', access: 'read', operation: 'workspace.list' },
			async () => {
				const rows = await (await database()).getAllFromIndex(
					'workspaceSummaries',
					'byAccount',
					accountId
				);
				return rows.sort(
					(left, right) =>
						right.updatedAt - left.updatedAt ||
						left.documentId.localeCompare(right.documentId) ||
						left.workspaceId.localeCompare(right.workspaceId)
				);
			}
		);

	return {
		commit: (input) =>
			observePersistence(
				options.observe,
				{ target: 'local', access: 'write', operation: 'workspace.commit' },
				async () => {
					const db = await database();
					const transaction = db.transaction(
						['workspaces', 'workspaceSummaries'],
						'readwrite'
					);
					const key: [string, string, string] = [
						input.accountId,
						input.documentId,
						input.workspaceId
					];
					const currentRow = await transaction.objectStore('workspaces').get(key);
					const current = currentRow ? normalizeRecord(currentRow) : undefined;
					const actualGeneration = current?.generation ?? 0;
					if (actualGeneration !== input.expectedGeneration) {
						transaction.abort();
						await transaction.done.catch(() => {});
						throw new GenerationConflictError(input.expectedGeneration, actualGeneration);
					}

					const timestamp = now();
					const record: LocalWorkingCopyRecord = {
						accountId: input.accountId,
						documentId: input.documentId,
						workspaceId: input.workspaceId,
						workspace: workspaceDescriptor(input.workspaceId, input.workspace ?? current?.workspace),
						generation: actualGeneration + 1,
						...(input.cloudBase
							? {
								cloudBase: {
									...input.cloudBase,
									generation: actualGeneration + 1
								}
							}
								: current?.cloudBase
									? { cloudBase: current.cloudBase }
									: {}),
						...(current?.pendingCloudOperation
							? { pendingCloudOperation: current.pendingCloudOperation }
							: {}),
						content: input.content,
						createdAt: current?.createdAt ?? timestamp,
						updatedAt: timestamp
					};
					const summary = summaryFor(record);

					try {
						await Promise.all([
							transaction.objectStore('workspaces').put(record, key),
							transaction
								.objectStore('workspaceSummaries')
								.put(summary, key)
						]);
						await transaction.done;
					} catch (error) {
						await transaction.done.catch(() => {});
						throw error;
					}
					return record;
				}
			),
		stageCloudVersion: (input) =>
			observePersistence(
				options.observe,
				{ target: 'local', access: 'write', operation: 'workspace.stageCloudVersion' },
				async () => {
					const db = await database();
					const transaction = db.transaction('workspaces', 'readwrite');
					const key: [string, string, string] = [
						input.accountId,
						input.documentId,
						input.workspaceId
					];
					const row = await transaction.store.get(key);
					if (!row) throw new Error('LOCAL_WORKING_COPY_NOT_FOUND');
					const current = normalizeRecord(row);
					if (current.generation !== input.expectedGeneration) {
						transaction.abort();
						await transaction.done.catch(() => {});
						throw new GenerationConflictError(input.expectedGeneration, current.generation);
					}
					if (
						current.pendingCloudOperation &&
						current.pendingCloudOperation.operationId !== input.operation.operationId
					) {
						throw new Error('PENDING_CLOUD_OPERATION');
					}
					const record: LocalWorkingCopyRecord = {
						...current,
						pendingCloudOperation: structuredClone(input.operation)
					};
					await transaction.store.put(record, key);
					await transaction.done;
					return record;
				}
			),
		acknowledgeCloudVersion: (input) =>
			observePersistence(
				options.observe,
				{ target: 'local', access: 'write', operation: 'workspace.acknowledgeCloudVersion' },
				async () => {
					const db = await database();
					const transaction = db.transaction(
						['workspaces', 'workspaceSummaries'],
						'readwrite'
					);
					const key: [string, string, string] = [
						input.accountId,
						input.documentId,
						input.workspaceId
					];
					const row = await transaction.objectStore('workspaces').get(key);
					if (!row) throw new Error('LOCAL_WORKING_COPY_NOT_FOUND');
					const current = normalizeRecord(row);
					const operation = current.pendingCloudOperation;
					if (!operation || operation.operationId !== input.operationId) {
						throw new Error('PENDING_CLOUD_OPERATION_MISMATCH');
					}
					if (operation.bundleHash !== input.bundleHash) {
						throw new Error('CLOUD_ACKNOWLEDGEMENT_HASH_MISMATCH');
					}
					const { pendingCloudOperation: _pending, ...withoutPending } = current;
					const record: LocalWorkingCopyRecord = {
						...withoutPending,
						cloudBase: {
							version: input.version,
							bundleHash: input.bundleHash,
							generation: operation.capturedGeneration,
							summary: structuredClone(input.summary)
						}
					};
					await Promise.all([
						transaction.objectStore('workspaces').put(record, key),
						transaction.objectStore('workspaceSummaries').put(summaryFor(record), key)
					]);
					await transaction.done;
					return record;
				}
			),
		load: (accountId, documentId, workspaceId) =>
			observePersistence(
				options.observe,
				{ target: 'local', access: 'read', operation: 'workspace.load' },
				async () => {
					const record = await (await database()).get('workspaces', [
						accountId,
						documentId,
						workspaceId
					]);
					return record ? normalizeRecord(record) : null;
				}
			),
		listDocuments: async (accountId) =>
			(await listWorkspaceSummaries(accountId)).filter((row) => row.workspace.kind === 'main'),
		listWorkspaces: listWorkspaceSummaries,
		duplicateDocument: (input) =>
			observePersistence(
				options.observe,
				{ target: 'local', access: 'write', operation: 'workspace.duplicate' },
				async () => {
					const db = await database();
					const transaction = db.transaction(['workspaces', 'workspaceSummaries'], 'readwrite');
					const source = await transaction.objectStore('workspaces').get([
						input.accountId,
						input.sourceDocumentId,
						'main'
					]);
					if (!source) throw new Error('LOCAL_WORKING_COPY_NOT_FOUND');
					const key: [string, string, string] = [input.accountId, input.documentId, 'main'];
					if (await transaction.objectStore('workspaces').get(key)) {
						throw new Error('LOCAL_DOCUMENT_ALREADY_EXISTS');
					}
					const timestamp = now();
					const record: LocalWorkingCopyRecord = {
						accountId: input.accountId,
						documentId: input.documentId,
						workspaceId: 'main',
						workspace: { kind: 'main' },
						generation: 1,
						content: duplicateContent(source.content, input.documentId, input.title),
						createdAt: timestamp,
						updatedAt: timestamp
					};
					await Promise.all([
						transaction.objectStore('workspaces').put(record, key),
						transaction.objectStore('workspaceSummaries').put(summaryFor(record), key)
					]);
					await transaction.done;
					return record;
				}
			),
		discardDocument: (accountId, documentId) =>
			observePersistence(
				options.observe,
				{ target: 'local', access: 'write', operation: 'workspace.discard' },
				async () => {
					const db = await database();
					const transaction = db.transaction(['workspaces', 'workspaceSummaries'], 'readwrite');
					const summaries = await transaction
						.objectStore('workspaceSummaries')
						.index('byAccount')
						.getAll(accountId);
					const matches = summaries.filter((summary) => summary.documentId === documentId);
					await Promise.all(
						matches.flatMap((summary) => {
							const key: [string, string, string] = [accountId, documentId, summary.workspaceId];
							return [
								transaction.objectStore('workspaces').delete(key),
								transaction.objectStore('workspaceSummaries').delete(key)
							];
						})
					);
					await transaction.done;
					return matches.length;
				}
			),
		close(): void {
			if (!databasePromise) return;
			openedDatabase?.close();
			void databasePromise.then((db) => db.close());
			openedDatabase = null;
			databasePromise = null;
		}
	};
}

/** Delete a named local workspace database. Intended for isolated tests and explicit cleanup. */
export async function deleteLocalWorkspaceDatabase(name: string): Promise<void> {
	await deleteDB(name);
}
