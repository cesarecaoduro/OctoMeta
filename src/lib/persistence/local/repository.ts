import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { observePersistence, type PersistenceActivityObserver } from '../activity';
import type { LocalGraphSnapshot } from './serialization';

const DATABASE_NAME = 'octometa-browser-workspace';
const DATABASE_VERSION = 1;

/** Authored content and unified history captured in one durable generation. */
export interface LocalWorkingCopyContent {
	title: string;
	graph: LocalGraphSnapshot;
	workbookSnapshot: unknown;
}

/** One account-scoped browser working copy. */
export interface LocalWorkingCopyRecord {
	accountId: string;
	documentId: string;
	workspaceId: string;
	generation: number;
	content: LocalWorkingCopyContent;
	createdAt: number;
	updatedAt: number;
}

/** Lightweight browser-local document entry used by the unified index. */
export interface LocalDocumentSummary {
	accountId: string;
	documentId: string;
	title: string;
	generation: number;
	stats: { blocks: number; tabs: number; nodes: number; bytes: number };
	createdAt: number;
	updatedAt: number;
}

/** Input for one expected-generation working-copy transaction. */
export interface CommitLocalWorkingCopyInput {
	accountId: string;
	documentId: string;
	workspaceId: string;
	expectedGeneration: number;
	content: LocalWorkingCopyContent;
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
		value: LocalDocumentSummary;
		indexes: { byAccount: string };
	};
}

/** Account-scoped IndexedDB operations consumed by document routes. */
export interface LocalWorkspaceRepository {
	/** Atomically replace authored content and undo state when the durable generation matches. */
	commit(input: CommitLocalWorkingCopyInput): Promise<LocalWorkingCopyRecord>;
	/** Load one account-owned working copy, or `null` when it has not been created locally. */
	load(
		accountId: string,
		documentId: string,
		workspaceId: string
	): Promise<LocalWorkingCopyRecord | null>;
	/** List browser-local document summaries belonging to exactly one account. */
	listDocuments(accountId: string): Promise<LocalDocumentSummary[]>;
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
		upgrade(database) {
			if (!database.objectStoreNames.contains('workspaces')) {
				database.createObjectStore('workspaces');
			}
			if (!database.objectStoreNames.contains('documentSummaries')) {
				const summaries = database.createObjectStore('documentSummaries');
				summaries.createIndex('byAccount', 'accountId');
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

	return {
		commit: (input) =>
			observePersistence(
				options.observe,
				{ target: 'local', access: 'write', operation: 'workspace.commit' },
				async () => {
					const db = await database();
					const transaction = db.transaction(
						['workspaces', 'documentSummaries'],
						'readwrite'
					);
					const key: [string, string, string] = [
						input.accountId,
						input.documentId,
						input.workspaceId
					];
					const current = await transaction.objectStore('workspaces').get(key);
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
						generation: actualGeneration + 1,
						content: input.content,
						createdAt: current?.createdAt ?? timestamp,
						updatedAt: timestamp
					};
					const summary: LocalDocumentSummary = {
						accountId: input.accountId,
						documentId: input.documentId,
						title: input.content.title,
						generation: record.generation,
						stats: {
							blocks: input.content.graph.authored.blocks.length,
							tabs: input.content.graph.authored.workbookManifest.sheets.length,
							nodes: input.content.graph.authored.nodes.length,
							bytes: new TextEncoder().encode(JSON.stringify(input.content)).byteLength
						},
						createdAt: record.createdAt,
						updatedAt: timestamp
					};

					try {
						await Promise.all([
							transaction.objectStore('workspaces').put(record, key),
							transaction
								.objectStore('documentSummaries')
								.put(summary, [input.accountId, input.documentId])
						]);
						await transaction.done;
					} catch (error) {
						await transaction.done.catch(() => {});
						throw error;
					}
					return record;
				}
			),
		load: (accountId, documentId, workspaceId) =>
			observePersistence(
				options.observe,
				{ target: 'local', access: 'read', operation: 'workspace.load' },
				async () =>
					(await (await database()).get('workspaces', [accountId, documentId, workspaceId])) ??
					null
			),
		listDocuments: (accountId) =>
			observePersistence(
				options.observe,
				{ target: 'local', access: 'read', operation: 'workspace.list' },
				async () => {
					const rows = await (await database()).getAllFromIndex(
						'documentSummaries',
						'byAccount',
						accountId
					);
					return rows.sort(
						(left, right) =>
							right.updatedAt - left.updatedAt ||
							left.documentId.localeCompare(right.documentId)
					);
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
