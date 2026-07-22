/**
 * Framework-neutral orchestration for one editable working copy. The
 * controller owns the mutation/history/save choreography while TipTap,
 * Univer, Svelte, and Convex stay behind injected ports.
 */

import type {
	CommitResult,
	DocumentGraph,
	GraphMutation,
	MutationError,
	Result
} from '../engine';
import type { PersistenceActivity, PersistenceActivityLog } from '../persistence/activity';
import type { DocumentId, Persistence } from '../persistence/client';
import { createDocumentSaver, type DocumentSaver, type SaveState } from '../persistence/saver';

/** Minimal graph session required by the workspace controller. */
export interface WorkspaceGraphPort {
	readonly doc: DocumentGraph;
	commit(mutation: GraphMutation): Result<CommitResult, MutationError>;
	undo(): Result<CommitResult, MutationError>;
	redo(): Result<CommitResult, MutationError>;
}

/** Editor projection operations needed at history and persistence boundaries. */
export interface WorkspaceProjectionPort {
	flushPendingChanges(): void;
	renderSettledState(): void;
}

/** Options for one behavior-preserving workspace controller. */
export interface WorkspaceControllerOptions {
	docId: DocumentId;
	graph: WorkspaceGraphPort;
	cloud: Pick<Persistence, 'saveDocument'>;
	projection: WorkspaceProjectionPort;
	workbookSnapshot(): unknown;
	activity: PersistenceActivityLog;
	onSaveState?(state: SaveState): void;
	saveDelayMs?: number;
}

/** The single orchestration seam consumed by the workbench route. */
export interface WorkspaceController {
	commit(mutation: GraphMutation): Result<CommitResult, MutationError>;
	markChanged(): void;
	undo(): boolean;
	redo(): boolean;
	flush(): Promise<void>;
	dispose(): void;
	persistenceActivity(): PersistenceActivity[];
	clearPersistenceActivity(): void;
}

/**
 * Create a workspace controller over existing graph, projection, and cloud
 * ports. This ticket intentionally preserves the current cloud-save cadence;
 * later local-first slices can replace the save port without changing UI
 * mutation choreography.
 */
export function createWorkspaceController(
	options: WorkspaceControllerOptions
): WorkspaceController {
	const saver: DocumentSaver = createDocumentSaver(
		options.cloud,
		options.docId,
		options.graph.doc,
		{
			...(options.saveDelayMs !== undefined && { delayMs: options.saveDelayMs }),
			onState: options.onSaveState,
			workbookSnapshot: options.workbookSnapshot
		}
	);

	const applyHistory = (direction: 'undo' | 'redo'): boolean => {
		options.projection.flushPendingChanges();
		const result = direction === 'undo' ? options.graph.undo() : options.graph.redo();
		if (!result.ok) return false;
		options.projection.renderSettledState();
		saver.scheduleSave();
		return true;
	};

	return {
		commit(mutation): Result<CommitResult, MutationError> {
			const result = options.graph.commit(mutation);
			if (!result.ok) return result;
			saver.scheduleSave();
			return result;
		},
		markChanged(): void {
			saver.scheduleSave();
		},
		undo(): boolean {
			return applyHistory('undo');
		},
		redo(): boolean {
			return applyHistory('redo');
		},
		async flush(): Promise<void> {
			options.projection.flushPendingChanges();
			await saver.flush();
		},
		dispose(): void {
			saver.dispose();
		},
		persistenceActivity(): PersistenceActivity[] {
			return options.activity.snapshot();
		},
		clearPersistenceActivity(): void {
			options.activity.clear();
		}
	};
}
