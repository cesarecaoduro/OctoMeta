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
import { createEmptyWorkbookSnapshot } from './workbook-snapshot';
import {
	observePersistence,
	type PersistenceAccess,
	type PersistenceActivityObserver,
	type PersistenceOperation
} from './activity';
import type {
	SaveCloudVersionInput,
	SaveCloudVersionResult,
	CloudVersionBundle
} from './cloud-version';

declare const documentIdBrand: unique symbol;

/** Stable product document identity; Convex row IDs remain private to this adapter. */
export type DocumentId = string & { readonly [documentIdBrand]: 'DocumentId' };

const convexDocumentId = (documentId: DocumentId): Id<'documents'> =>
	documentId as unknown as Id<'documents'>;

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
	/** Create version 1 or the next immutable Main version from exact staged authored bytes. */
	saveCloudVersion(input: SaveCloudVersionInput): Promise<SaveCloudVersionResult>;
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
			tracked(
				'documents.create',
				'write',
				async () =>
					(await client.mutation(api.documents.create, { title })) as unknown as DocumentId
			),
		listDocuments: () =>
			tracked(
				'documents.list',
				'read',
				async () =>
					(await client.query(api.documents.list, {})) as unknown as DocumentSummary[]
			),
		listTrash: () =>
			tracked(
				'documents.listTrash',
				'read',
				async () =>
					(await client.query(api.documents.listTrash, {})) as unknown as DocumentSummary[]
			),
		renameDocument: (docId, title) =>
			tracked('documents.rename', 'write', async () => {
				await client.mutation(api.documents.rename, { docId: String(docId), title });
			}),
		deleteDocument: (docId) =>
			tracked('documents.trash', 'write', async () => {
				await client.mutation(api.documents.trash, { docId: String(docId) });
			}),
		restoreDocument: (docId) =>
			tracked('documents.restore', 'write', async () => {
				await client.mutation(api.documents.restore, { docId: String(docId) });
			}),
		deleteForever: (docId) =>
			tracked('documents.remove', 'write', async () => {
				await client.mutation(api.documents.remove, { docId: String(docId) });
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
					providedSnapshot ??
					createEmptyWorkbookSnapshot(String(docId), String(docId), workbookManifest);
				const snapshotHash = workbookSnapshotHash(workbookSnapshot);
				const bundleHash = documentBundleHash(graphPayload, workbookManifest, snapshotHash);
				const result = await client.mutation(api.documents.save, {
					docId: convexDocumentId(docId),
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
		saveCloudVersion: (input) =>
			tracked('versions.save', 'write', async () => {
				const bundle = JSON.parse(input.bundleJson) as CloudVersionBundle;
				return await client.mutation(api.documentVersions.save, {
					publicDocumentId: input.publicDocumentId,
					expectedHeadNumber: input.expectedHeadNumber,
					expectedHeadHash: input.expectedHeadHash,
					operationId: input.operationId,
					operationInputHash: input.operationInputHash,
					message: input.message,
					bundleHash: input.bundleHash,
					bundle
				});
			}),
		loadDocument: (docId) =>
			tracked('documents.load', 'read', async () => {
				const versioned = await client.query(api.documentVersions.loadHead, {
					publicDocumentId: String(docId)
				});
				if (versioned.state === 'live') {
					const bundle = versioned.bundle;
					revisions.set(docId, versioned.version.versionNumber);
					return {
						state: 'live' as const,
						document: {
							_id: docId,
							title: versioned.document.title,
							blocksOrder: bundle.graph.blocksOrder,
							undoCursor: 0,
							revision: versioned.version.versionNumber,
							bundleHash: versioned.version.bundleHash,
							stats: versioned.document.stats,
							createdAt: versioned.document.createdAt,
							updatedAt: versioned.document.updatedAt
						},
						nodes: bundle.graph.nodes,
						blocks: bundle.graph.blocks,
						undoLog: [],
						chips: bundle.graph.chips,
						workbookSnapshot: {
							revision: versioned.version.versionNumber,
							snapshotHash: versioned.version.bundleHash,
							snapshot: bundle.workbookSnapshot,
							updatedAt: versioned.version.createdAt
						}
					} satisfies DocumentLoadState;
				}
				if (versioned.state === 'integrity-error') return versioned;
				if (versioned.state === 'trashed') {
					return {
						state: 'trashed' as const,
						document: {
							_id: docId,
							title: versioned.document.title,
							blocksOrder: [],
							undoCursor: 0,
							revision: versioned.document.mainVersionNumber,
							bundleHash: versioned.document.mainHash,
							deletedAt: versioned.document.deletedAt,
							stats: versioned.document.stats,
							createdAt: versioned.document.createdAt,
							updatedAt: versioned.document.updatedAt
						}
					} satisfies DocumentLoadState;
				}
				if (versioned.state === 'missing') return { state: 'missing' as const };
				const result = (await client.query(api.documents.load, {
					docId: String(docId)
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
					docId: convexDocumentId(docId),
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
