/**
 * Persistence activity is safe operational metadata for the workspace seam.
 * It records where an operation ran and whether it read or wrote, never the
 * document title, formula, workbook cells, asset bytes, or operation args.
 */

/** Persistence substrates visible to the workspace controller. */
export type PersistenceTarget = 'local' | 'cloud';

/** Whether an operation observes or changes product state. */
export type PersistenceAccess = 'read' | 'write';

/** Lifecycle emitted around one logical persistence operation. */
export type PersistencePhase = 'started' | 'succeeded' | 'failed';

/** A logical persistence operation name, stable enough for tests and telemetry. */
export type PersistenceOperation =
	| 'documents.create'
	| 'documents.list'
	| 'documents.listTrash'
	| 'documents.rename'
	| 'documents.trash'
	| 'documents.restore'
	| 'documents.remove'
	| 'documents.emptyTrash'
	| 'documents.save'
	| 'documents.load'
	| 'files.upload'
	| 'files.resolveUrl'
	| 'workspace.load'
	| 'workspace.list'
	| 'workspace.commit';

/** One metadata-only activity notification. */
export interface PersistenceActivityEvent {
	target: PersistenceTarget;
	access: PersistenceAccess;
	operation: PersistenceOperation;
	phase: PersistencePhase;
}

/** An activity event with deterministic log identity and time. */
export interface PersistenceActivity extends PersistenceActivityEvent {
	sequence: number;
	at: number;
}

/** Observer accepted by persistence adapters. */
export type PersistenceActivityObserver = (event: PersistenceActivityEvent) => void;

/** Framework-neutral, bounded-by-session activity log used by the workspace seam. */
export interface PersistenceActivityLog {
	readonly observe: PersistenceActivityObserver;
	snapshot(): PersistenceActivity[];
	clear(): void;
}

/**
 * Create an in-memory activity log. The caller owns its lifetime; production
 * code should scope it to one workspace session rather than treating it as an
 * application-wide audit log.
 */
export function createPersistenceActivityLog(
	now: () => number = Date.now
): PersistenceActivityLog {
	let sequence = 0;
	const activities: PersistenceActivity[] = [];
	return {
		observe(event): void {
			activities.push({ ...event, sequence: ++sequence, at: now() });
		},
		snapshot(): PersistenceActivity[] {
			return activities.map((activity) => ({ ...activity }));
		},
		clear(): void {
			activities.length = 0;
		}
	};
}

/** Run one logical operation and emit balanced lifecycle activity. */
export async function observePersistence<T>(
	observer: PersistenceActivityObserver | undefined,
	event: Omit<PersistenceActivityEvent, 'phase'>,
	run: () => Promise<T>
): Promise<T> {
	observer?.({ ...event, phase: 'started' });
	try {
		const result = await run();
		observer?.({ ...event, phase: 'succeeded' });
		return result;
	} catch (error) {
		observer?.({ ...event, phase: 'failed' });
		throw error;
	}
}
