import type { SaveState } from '../saver';
import type { LocalWorkingCopyContent } from './repository';

/** The local persistence write used by the autosave scheduler. */
export type CommitLocalGeneration = (
	expectedGeneration: number,
	content: LocalWorkingCopyContent
) => Promise<number>;

/** Configuration for one working copy's local save cadence. */
export interface LocalAutosaveOptions {
	initialGeneration: number;
	capture(): LocalWorkingCopyContent;
	commit: CommitLocalGeneration;
	delayMs?: number;
	maxDelayMs?: number;
	onState?(state: SaveState): void;
	/** Report the current capture/transaction failure, clearing it after success. */
	onError?(error: unknown | null): void;
}

/** Autosave lifecycle consumed by the framework-neutral workspace controller. */
export interface LocalAutosave {
	/** Mark the working copy dirty and start its trailing and maximum timers. */
	schedule(): void;
	/** Commit all accepted changes immediately and wait for transaction completion. */
	flush(): Promise<void>;
	/** Cancel pending timers and reject future scheduling. */
	dispose(): void;
	readonly state: SaveState;
	readonly lastError: unknown;
	readonly generation: number;
}

/** Quiet time used to coalesce rapid accepted edits. */
export const DEFAULT_LOCAL_SAVE_DELAY_MS = 500;

/** Maximum time a continuously edited working copy may remain dirty. */
export const DEFAULT_LOCAL_SAVE_MAX_DELAY_MS = 2_000;

/**
 * Create a non-overlapping local autosave queue with a trailing delay, a
 * non-resetting maximum dirty interval, and generation-aware follow-up writes.
 */
export function createLocalAutosave(options: LocalAutosaveOptions): LocalAutosave {
	const delayMs = options.delayMs ?? DEFAULT_LOCAL_SAVE_DELAY_MS;
	const maxDelayMs = options.maxDelayMs ?? DEFAULT_LOCAL_SAVE_MAX_DELAY_MS;
	let trailingTimer: ReturnType<typeof setTimeout> | null = null;
	let maximumTimer: ReturnType<typeof setTimeout> | null = null;
	let inFlight: Promise<void> | null = null;
	let dirty = false;
	let disposed = false;
	let state: SaveState = 'idle';
	let lastError: unknown = null;
	let generation = options.initialGeneration;

	const setState = (next: SaveState): void => {
		if (state === next) return;
		state = next;
		options.onState?.(next);
	};

	const clearTimers = (): void => {
		if (trailingTimer !== null) clearTimeout(trailingTimer);
		if (maximumTimer !== null) clearTimeout(maximumTimer);
		trailingTimer = null;
		maximumTimer = null;
	};

	const run = async (): Promise<void> => {
		clearTimers();
		while (dirty && !disposed) {
			dirty = false;
			setState('saving');
			try {
				const captured = structuredClone(options.capture());
				generation = await options.commit(generation, captured);
				lastError = null;
				options.onError?.(null);
			} catch (error) {
				lastError = error;
				options.onError?.(error);
				dirty = true;
				clearTimers();
				setState('error');
				throw error;
			}
			// Edits accepted while IndexedDB was committing are already dirty.
			// Capture them immediately as the next fenced generation.
			clearTimers();
		}
		setState(dirty ? 'pending' : 'idle');
	};

	const kick = (): Promise<void> => {
		if (!inFlight) {
			inFlight = run().finally(() => {
				inFlight = null;
			});
		}
		return inFlight;
	};

	return {
		schedule(): void {
			if (disposed) return;
			dirty = true;
			if (state !== 'saving' && state !== 'error') setState('pending');
			if (trailingTimer !== null) clearTimeout(trailingTimer);
			trailingTimer = setTimeout(() => {
				trailingTimer = null;
				void kick().catch(() => {});
			}, delayMs);
			maximumTimer ??= setTimeout(() => {
				maximumTimer = null;
				void kick().catch(() => {});
			}, maxDelayMs);
		},
		async flush(): Promise<void> {
			if (disposed) return;
			clearTimers();
			if (!dirty && !inFlight) return;
			await kick();
		},
		dispose(): void {
			disposed = true;
			clearTimers();
		},
		get state() {
			return state;
		},
		get lastError() {
			return lastError;
		},
		get generation() {
			return generation;
		}
	};
}
