import type { DocumentSummary } from '../persistence/client';
import type { LocalWorkspaceSummary } from '../persistence/local/repository';

/** Storage availability presented for one document in the unified index. */
export type DocumentAvailability = 'local-only' | 'cloud-backed' | 'cloud-only';

/** Browser-local state for a main working copy. */
export interface IndexedLocalState {
	generation: number;
	baseVersion?: number;
	hasChanges: boolean | null;
}

/** Authorized cloud metadata that does not imply content is downloaded. */
export interface IndexedCloudState {
	version: number;
}

/** One device-local branch grouped beneath its parent document. */
export interface IndexedDocumentBranch {
	workspaceId: string;
	name: string;
	generation: number;
	baseVersion?: number;
	hasChanges: boolean | null;
	updatedAt: number;
}

/** One parent row in the merged local/cloud document index. */
export interface IndexedDocument {
	documentId: DocumentSummary['_id'];
	title: string;
	availability: DocumentAvailability;
	cloud: IndexedCloudState | null;
	local: IndexedLocalState | null;
	branches: IndexedDocumentBranch[];
	stats: DocumentSummary['stats'];
	createdAt: number;
	updatedAt: number;
}

function localState(summary: LocalWorkspaceSummary): IndexedLocalState {
	return {
		generation: summary.generation,
		...(summary.cloudBase ? { baseVersion: summary.cloudBase.version } : {}),
		hasChanges: summary.cloudBase
			? summary.generation > summary.cloudBase.generation
			: null
	};
}

function branchState(summary: LocalWorkspaceSummary): IndexedDocumentBranch {
	const state = localState(summary);
	return {
		workspaceId: summary.workspaceId,
		name: summary.workspace.kind === 'branch' ? summary.workspace.name : summary.workspaceId,
		generation: state.generation,
		...(state.baseVersion !== undefined ? { baseVersion: state.baseVersion } : {}),
		hasChanges: state.hasChanges,
		updatedAt: summary.updatedAt
	};
}

/** Merge authorized cloud metadata and every account-scoped browser workspace. */
export function buildDocumentIndex(
	cloudDocuments: DocumentSummary[],
	localWorkspaces: LocalWorkspaceSummary[]
): IndexedDocument[] {
	const cloudByDocument = new Map(
		cloudDocuments.map((document) => [String(document._id), document])
	);
	const mainByDocument = new Map<string, LocalWorkspaceSummary>();
	const branchesByDocument = new Map<string, LocalWorkspaceSummary[]>();
	for (const workspace of localWorkspaces) {
		if (workspace.workspace.kind === 'main') {
			mainByDocument.set(workspace.documentId, workspace);
			continue;
		}
		const branches = branchesByDocument.get(workspace.documentId) ?? [];
		branches.push(workspace);
		branchesByDocument.set(workspace.documentId, branches);
	}

	const documentIds = new Set([
		...cloudByDocument.keys(),
		...mainByDocument.keys(),
		...branchesByDocument.keys()
	]);
	const entries: IndexedDocument[] = [];
	for (const documentId of documentIds) {
		const cloud = cloudByDocument.get(documentId);
		const main = mainByDocument.get(documentId);
		const branches = (branchesByDocument.get(documentId) ?? [])
			.map(branchState)
			.sort((left, right) => left.name.localeCompare(right.name));
		const availability: DocumentAvailability =
			cloud && main ? 'cloud-backed' : cloud ? 'cloud-only' : 'local-only';
		const fallback = branchesByDocument.get(documentId)?.[0];
		const localMetadata = main ?? fallback;
		if (!cloud && !localMetadata) continue;
		entries.push({
			documentId: (cloud?._id ?? documentId) as DocumentSummary['_id'],
			title: main?.title ?? cloud?.title ?? localMetadata!.title,
			availability,
			cloud: cloud ? { version: cloud.revision } : null,
			local: main ? localState(main) : null,
			branches,
			stats: main?.stats ?? cloud?.stats ?? localMetadata!.stats,
			createdAt: Math.min(
				...[cloud?.createdAt, main?.createdAt, localMetadata?.createdAt].filter(
					(value): value is number => value !== undefined
				)
			),
			updatedAt: Math.max(
				...[cloud?.updatedAt, main?.updatedAt, ...branches.map((branch) => branch.updatedAt)].filter(
					(value): value is number => value !== undefined
				)
			)
		});
	}

	return entries.sort(
		(left, right) =>
			right.updatedAt - left.updatedAt || String(left.documentId).localeCompare(String(right.documentId))
	);
}
