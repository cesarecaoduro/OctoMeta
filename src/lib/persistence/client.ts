/**
 * The typed persistence facade over Convex — the ONLY way UI code talks to
 * the backend (IMPLEMENTATION_PLAN.md §11 rule 2: `convex` imports live in
 * src/lib/persistence/ + src/convex/ and nowhere else). Framework-free: takes
 * a ConvexClient; Svelte-context helpers live in svelte.ts.
 */

import type { ConvexClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { ChipBinding, DocumentGraph } from '../engine';
import type { LoadedRows } from './serialize';
import { serializeGraph } from './serialize';

/** A persisted document's id. Opaque string outside this layer. */
export type DocumentId = Id<'documents'>;

/** Document list entry (`documents.list`), newest-updated first. */
export interface DocumentSummary {
	_id: DocumentId;
	title: string;
	blocksOrder: string[];
	undoCursor: number;
	createdAt: number;
	updatedAt: number;
}

/** Everything `documents.load` returns for one document, hydration-ready. */
export interface LoadedDocument extends LoadedRows {
	document: DocumentSummary;
	sheetSnapshots: { blockId: string; univerSnapshot: unknown; updatedAt: number }[];
}

/** The persistence surface V1-5 consumes. All methods resolve when the backend confirms. */
export interface Persistence {
	/** Create an empty document with the given title; returns its id. */
	createDocument(title: string): Promise<DocumentId>;
	/** List all documents, most recently updated first. */
	listDocuments(): Promise<DocumentSummary[]>;
	/** Rename a document. */
	renameDocument(docId: DocumentId, title: string): Promise<void>;
	/** Delete a document and all its rows (nodes, blocks, undo log, chips, snapshots). */
	deleteDocument(docId: DocumentId): Promise<void>;
	/** Full save: nodes + blocks + blocksOrder + undo log + cursor + chips, wipe-and-replace. */
	saveDocument(docId: DocumentId, graph: DocumentGraph): Promise<void>;
	/** Load every row of a document, or null when it does not exist. Feed to `hydrateGraph`. */
	loadDocument(docId: DocumentId): Promise<LoadedDocument | null>;
	/** Insert or update the Univer snapshot for a sheet block. */
	upsertSheetSnapshot(docId: DocumentId, blockId: string, univerSnapshot: unknown): Promise<void>;
	/** Insert or update one chip binding. */
	upsertChip(docId: DocumentId, chip: ChipBinding): Promise<void>;
	/** Delete one chip binding (idempotent). */
	deleteChip(docId: DocumentId, chipId: string): Promise<void>;
	/** Upload file bytes to Convex storage; resolves to the storageId for `Block.image` (SCHEMA.md §8). */
	uploadFile(file: Blob): Promise<string>;
	/** Resolve a storageId to a serving URL, or null when the file no longer exists. */
	fileUrl(storageId: string): Promise<string | null>;
}

/** Build the persistence facade over a connected ConvexClient. */
export function createPersistence(client: ConvexClient): Persistence {
	return {
		createDocument: (title) => client.mutation(api.documents.create, { title }),
		listDocuments: () => client.query(api.documents.list, {}),
		renameDocument: async (docId, title) => {
			await client.mutation(api.documents.rename, { docId, title });
		},
		deleteDocument: async (docId) => {
			await client.mutation(api.documents.remove, { docId });
		},
		saveDocument: async (docId, graph) => {
			await client.mutation(api.documents.save, { docId, ...serializeGraph(graph) });
		},
		loadDocument: async (docId) =>
			(await client.query(api.documents.load, { docId })) as LoadedDocument | null,
		upsertSheetSnapshot: async (docId, blockId, univerSnapshot) => {
			await client.mutation(api.sheets.upsertSnapshot, { docId, blockId, univerSnapshot });
		},
		upsertChip: async (docId, chip) => {
			await client.mutation(api.chips.upsert, {
				docId,
				chipId: chip.id,
				blockId: chip.blockId,
				nodeId: chip.nodeId,
				...(chip.format !== undefined && { format: chip.format })
			});
		},
		deleteChip: async (docId, chipId) => {
			await client.mutation(api.chips.remove, { docId, chipId });
		},
		uploadFile: async (file) => {
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
			return storageId;
		},
		fileUrl: async (storageId) =>
			await client.query(api.files.getUrl, { storageId: storageId as Id<'_storage'> })
	};
}
