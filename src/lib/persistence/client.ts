/**
 * The typed persistence facade over Convex — the ONLY way UI code talks to
 * the backend (IMPLEMENTATION_PLAN.md §11 rule 2: `convex` imports live in
 * src/lib/persistence/ + src/convex/ and nowhere else). Framework-free: takes
 * a ConvexClient; Svelte-context helpers live in svelte.ts.
 */

import type { ConvexClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { DocumentGraph } from '../engine';
import type { LoadedRows } from './serialize';
import { serializeGraph } from './serialize';
import { documentBundleHash, workbookSnapshotHash } from './canonical';
import {
	observePersistence,
	type PersistenceAccess,
	type PersistenceActivityObserver,
	type PersistenceOperation
} from './activity';

/** A persisted document's id. Opaque string outside this layer. */
export type DocumentId = Id<'documents'>;

/** Document list entry (`documents.list`), newest-updated first. */
export interface DocumentSummary {
	_id: DocumentId;
	title: string;
	blocksOrder: string[];
	undoCursor: number;
	revision: number;
	bundleHash: string;
	deletedAt?: number;
	stats: { blocks: number; tabs: number; nodes: number; bytes: number };
	createdAt: number;
	updatedAt: number;
}

/** Everything `documents.load` returns for one document, hydration-ready. */
export interface LoadedDocument extends LoadedRows {
	document: DocumentSummary;
	workbookSnapshot: {
		revision: number;
		snapshotHash: string;
		snapshot: unknown;
		updatedAt: number;
	};
}

/** Fail-closed load state returned by the ownership/integrity boundary. */
export type DocumentLoadState =
	| ({ state: 'live' } & LoadedDocument)
	| { state: 'trashed'; document: DocumentSummary }
	| { state: 'missing' }
	| { state: 'unauthorized' }
	| { state: 'integrity-error'; reason: string };

/** The persistence surface V1-5 consumes. All methods resolve when the backend confirms. */
export interface Persistence {
	/** Create an empty document with the given title; returns its id. */
	createDocument(title: string): Promise<DocumentId>;
	/** List all documents, most recently updated first. */
	listDocuments(): Promise<DocumentSummary[]>;
	/** List recoverable trashed documents. */
	listTrash(): Promise<DocumentSummary[]>;
	/** Rename a document. */
	renameDocument(docId: DocumentId, title: string): Promise<void>;
	/** Move a document to recoverable trash. */
	deleteDocument(docId: DocumentId): Promise<void>;
	/** Restore a trashed document. */
	restoreDocument(docId: DocumentId): Promise<void>;
	/** Permanently remove one trashed document. */
	deleteForever(docId: DocumentId): Promise<void>;
	/** Permanently remove all owned trash in bounded batches. */
	emptyTrash(): Promise<number>;
	/** Atomic compare-and-swap save of graph, manifest, and workbook snapshot. */
	saveDocument(
		docId: DocumentId,
		graph: DocumentGraph,
		workbookSnapshot?: unknown
	): Promise<number>;
	/** Load one typed document state. Live payloads can be fed to `hydrateGraph`. */
	loadDocument(docId: DocumentId): Promise<DocumentLoadState>;
	/** Upload, validate, and claim an image for one live owned document. */
	uploadFile(docId: DocumentId, file: Blob): Promise<string>;
	/** Resolve a storageId to a serving URL, or null when the file no longer exists. */
	fileUrl(storageId: string): Promise<string | null>;
}

/** Optional operational observer for the connected cloud facade. */
export interface PersistenceOptions {
	observe?: PersistenceActivityObserver;
}

/** Build the persistence facade over a connected ConvexClient. */
export function createPersistence(client: ConvexClient, options: PersistenceOptions = {}): Persistence {
	const revisions = new Map<DocumentId, number>();
	const tracked = <T>(
		operation: PersistenceOperation,
		access: PersistenceAccess,
		run: () => Promise<T>
	): Promise<T> =>
		observePersistence(
			options.observe,
			{ target: 'cloud', operation, access },
			run
		);
	return {
		createDocument: (title) =>
			tracked('documents.create', 'write', () =>
				client.mutation(api.documents.create, { title })
			),
		listDocuments: () =>
			tracked(
				'documents.list',
				'read',
				async () => (await client.query(api.documents.list, {})) as DocumentSummary[]
			),
		listTrash: () =>
			tracked(
				'documents.listTrash',
				'read',
				async () => (await client.query(api.documents.listTrash, {})) as DocumentSummary[]
			),
		renameDocument: (docId, title) =>
			tracked('documents.rename', 'write', async () => {
				await client.mutation(api.documents.rename, { docId, title });
			}),
		deleteDocument: (docId) =>
			tracked('documents.trash', 'write', async () => {
				await client.mutation(api.documents.trash, { docId });
			}),
		restoreDocument: (docId) =>
			tracked('documents.restore', 'write', async () => {
				await client.mutation(api.documents.restore, { docId });
			}),
		deleteForever: (docId) =>
			tracked('documents.remove', 'write', async () => {
				await client.mutation(api.documents.remove, { docId });
			}),
		emptyTrash: () =>
			tracked('documents.emptyTrash', 'write', async () => {
				let total = 0;
				for (;;) {
					const result = await client.mutation(api.documents.emptyTrash, {});
					total += result.deleted;
					if (!result.hasMore) return total;
				}
			}),
		saveDocument: (docId, graph, providedSnapshot) =>
			tracked('documents.save', 'write', async () => {
				const { workbookManifest, ...graphPayload } = serializeGraph(graph);
				const workbookSnapshot =
					providedSnapshot ?? freshWorkbookSnapshot(String(docId), workbookManifest);
				const snapshotHash = workbookSnapshotHash(workbookSnapshot);
				const bundleHash = documentBundleHash(graphPayload, workbookManifest, snapshotHash);
				const result = await client.mutation(api.documents.save, {
					docId,
					expectedRevision: revisions.get(docId) ?? 0,
					graph: graphPayload,
					workbookManifest,
					workbookSnapshot,
					snapshotHash,
					bundleHash
				});
				revisions.set(docId, result.revision);
				return result.revision;
			}),
		loadDocument: (docId) =>
			tracked('documents.load', 'read', async () => {
				const result = (await client.query(api.documents.load, {
					docId
				})) as DocumentLoadState;
				if (result.state === 'live') revisions.set(docId, result.document.revision);
				return result;
			}),
		uploadFile: (docId, file) =>
			tracked('files.upload', 'write', async () => {
				// Standard Convex upload flow: short-lived URL, POST the bytes, read
				// back the storageId. The URL protocol is a Convex detail — it stays
				// inside this layer.
				const uploadUrl = await client.mutation(api.files.generateUploadUrl, {});
				const response = await fetch(uploadUrl, {
					method: 'POST',
					headers: { 'Content-Type': file.type || 'application/octet-stream' },
					body: file
				});
				if (!response.ok) throw new Error(`upload failed: HTTP ${response.status}`);
				const { storageId } = (await response.json()) as { storageId: string };
				await client.action(api.files.claimUpload, {
					docId,
					storageId: storageId as Id<'_storage'>
				});
				return storageId;
			}),
		fileUrl: (storageId) =>
			tracked('files.resolveUrl', 'read', () =>
				client.query(api.files.getUrl, { storageId: storageId as Id<'_storage'> })
			)
	};
}

function freshWorkbookSnapshot(
	unitId: string,
	manifest: DocumentGraph['workbook']
): Record<string, unknown> {
	return {
		id: unitId,
		name: unitId,
		sheetOrder: manifest.sheets.map((sheet) => sheet.id),
		sheets: Object.fromEntries(
			manifest.sheets.map((sheet) => [
				sheet.id,
				{ id: sheet.id, name: sheet.name, cellData: {} }
			])
		)
	};
}
