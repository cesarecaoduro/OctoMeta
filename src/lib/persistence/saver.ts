/**
 * Debounced document saver (IMPLEMENTATION_PLAN.md V1-4-1). The document
 * shell (V1-5-1) calls `scheduleSave()` whenever a commit settles; after
 * `delayMs` of quiet the whole graph — nodes + blocks + blocksOrder + undo
 * log + cursor + chips — is serialized and saved in one `documents.save`
 * call. Full-save-every-time is deliberate (optimize when it hurts, V2-6).
 *
 * Guarantees, kept deliberately simple:
 * - Serialization happens at save time, so the latest graph state wins.
 * - Saves never overlap; edits during a save trigger a follow-up save.
 * - `flush()` saves now (kill-the-tab / navigation path) and resolves when
 *   everything scheduled so far is on the server.
 * - A failed save keeps the dirty flag, reports `error` state, and retries on
 *   the next `scheduleSave()`/`flush()`.
 */

import type { DocumentGraph } from '../engine';
import type { DocumentId, Persistence } from './client';

/** Save lifecycle, for the V1-5-1 save-state indicator. */
export type SaveState = 'idle' | 'pending' | 'saving' | 'error';

export interface DocumentSaver {
	/** Note that the graph changed; (re)start the debounce timer. */
	scheduleSave(): void;
	/** Save immediately, skipping the debounce. Resolves once persisted; rejects on save failure. */
	flush(): Promise<void>;
	/** Cancel any pending save and stop the saver for good. */
	dispose(): void;
	/** Current lifecycle state. */
	readonly state: SaveState;
	/** The last save error, cleared by the next successful save. */
	readonly lastError: unknown;
}

/** Default quiet period before a scheduled save fires. */
export const DEFAULT_SAVE_DELAY_MS = 500;

/**
 * Create a debounced saver bound to one document and its live graph.
 * `onState` (optional) fires on every lifecycle transition — wire the
 * save-state indicator to it.
 */
export function createDocumentSaver(
	persistence: Pick<Persistence, 'saveDocument'>,
	docId: DocumentId,
	graph: DocumentGraph,
	opts?: { delayMs?: number; onState?: (state: SaveState) => void }
): DocumentSaver {
	const delayMs = opts?.delayMs ?? DEFAULT_SAVE_DELAY_MS;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let inFlight: Promise<void> | null = null;
	let dirty = false;
	let disposed = false;
	let state: SaveState = 'idle';
	let lastError: unknown = null;

	const setState = (next: SaveState): void => {
		if (state === next) return;
		state = next;
		opts?.onState?.(next);
	};

	const clearTimer = (): void => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};

	/** Drain the dirty flag; loops so edits made mid-save get a follow-up save. */
	const run = async (): Promise<void> => {
		while (dirty && !disposed) {
			dirty = false;
			setState('saving');
			try {
				await persistence.saveDocument(docId, graph);
				lastError = null;
			} catch (error) {
				lastError = error;
				dirty = true; // retry on the next schedule/flush
				setState('error');
				throw error;
			}
		}
		setState(dirty ? 'pending' : 'idle');
	};

	/** Start (or join) the single in-flight drain. */
	const kick = (): Promise<void> => {
		if (!inFlight) {
			inFlight = run().finally(() => {
				inFlight = null;
			});
		}
		return inFlight;
	};

	return {
		scheduleSave(): void {
			if (disposed) return;
			dirty = true;
			if (state !== 'saving') setState('pending');
			clearTimer();
			timer = setTimeout(() => {
				timer = null;
				// Swallow here: errors surface via state/lastError and on flush().
				void kick().catch(() => {});
			}, delayMs);
		},
		async flush(): Promise<void> {
			if (disposed) return;
			clearTimer();
			if (!dirty && !inFlight) return;
			await kick();
		},
		dispose(): void {
			disposed = true;
			clearTimer();
		},
		get state() {
			return state;
		},
		get lastError() {
			return lastError;
		}
	};
}
