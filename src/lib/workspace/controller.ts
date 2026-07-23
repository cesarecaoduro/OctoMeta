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
import {
	createLocalAutosave,
	type CommitLocalGeneration,
	type LocalAutosave
} from '../persistence/local/autosave';
import { serializeLocalGraph } from '../persistence/local/serialization';
import type { SaveState } from '../persistence/saver';

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
	graph: WorkspaceGraphPort;
	title(): string;
	local: {
		initialGeneration: number;
		commit: CommitLocalGeneration;
	};
	projection: WorkspaceProjectionPort;
	workbookSnapshot(): unknown;
	activity: PersistenceActivityLog;
	onSaveState?(state: SaveState): void;
	/** Present local capture/transaction recovery without changing cloud state. */
	onLocalSaveError?(error: unknown | null): void;
	saveDelayMs?: number;
	maxSaveDelayMs?: number;
}

/** The single orchestration seam consumed by the workbench route. */
export interface WorkspaceController {
	commit(mutation: GraphMutation): Result<CommitResult, MutationError>;
	/** Commit an editor projection mutation already covered by `markChanged()`. */
	commitProjection(mutation: GraphMutation): Result<CommitResult, MutationError>;
	markChanged(): void;
	undo(): boolean;
	redo(): boolean;
	flush(): Promise<void>;
	dispose(): void;
	persistenceActivity(): PersistenceActivity[];
	clearPersistenceActivity(): void;
}

/**
 * Create a workspace controller over graph, projection, and local persistence
 * ports. Every successful authored/history mutation schedules one atomically
 * captured IndexedDB generation; cloud publication is intentionally absent.
 */
export function createWorkspaceController(
	options: WorkspaceControllerOptions
): WorkspaceController {
	const saver: LocalAutosave = createLocalAutosave({
		initialGeneration: options.local.initialGeneration,
		commit: options.local.commit,
		capture: () => {
			options.projection.flushPendingChanges();
			return {
				title: options.title(),
				graph: serializeLocalGraph(options.graph.doc),
				workbookSnapshot: options.workbookSnapshot()
			};
		},
		...(options.saveDelayMs !== undefined && { delayMs: options.saveDelayMs }),
		...(options.maxSaveDelayMs !== undefined && { maxDelayMs: options.maxSaveDelayMs }),
		onState: options.onSaveState,
		onError: options.onLocalSaveError
	});

	const applyHistory = (direction: 'undo' | 'redo'): boolean => {
		options.projection.flushPendingChanges();
		const result = direction === 'undo' ? options.graph.undo() : options.graph.redo();
		if (!result.ok) return false;
		options.projection.renderSettledState();
		saver.schedule();
		return true;
	};

	return {
		commit(mutation): Result<CommitResult, MutationError> {
			const result = options.graph.commit(mutation);
			if (!result.ok) return result;
			saver.schedule();
			return result;
		},
		commitProjection(mutation): Result<CommitResult, MutationError> {
			return options.graph.commit(mutation);
		},
		markChanged(): void {
			saver.schedule();
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
