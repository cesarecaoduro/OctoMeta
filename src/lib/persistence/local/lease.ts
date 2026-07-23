/** Browser-visible state of one working-copy edit lease. */
export type WorkspaceLeaseState =
	| 'acquiring'
	| 'owner'
	| 'readonly'
	| 'taking-over'
	| 'unsupported';

/** Status presented by the workbench while coordinating browser tabs. */
export interface WorkspaceLeaseStatus {
	state: WorkspaceLeaseState;
	activeTabId?: string;
	message?: string;
}

/** Inputs required to coordinate one account-scoped working copy. */
export interface WorkspaceLeaseOptions {
	accountId: string;
	documentId: string;
	workspaceId: string;
	flush(): Promise<void>;
	onStatus?(status: WorkspaceLeaseStatus): void;
	/** Observe a newer generation only after the editing tab stores it durably. */
	onStoredGeneration?(generation: number): void;
}

/** Cooperative edit-lease operations consumed by the workbench. */
export interface WorkspaceLease {
	/** Acquire the lease when available, otherwise settle into read-only mode. */
	start(): Promise<WorkspaceLeaseStatus>;
	/** Ask the current editor to flush and release before waiting for ownership. */
	requestTakeover(): Promise<boolean>;
	/** Notify read-only peers that this owner stored a newer local generation. */
	announceStoredGeneration(generation: number): void;
	/** Release browser resources and any edit lease held by this tab. */
	dispose(): void;
	/** Most recent browser-visible lease status. */
	readonly status: WorkspaceLeaseStatus;
}

type LeaseMessage =
	| { type: 'owner-query'; senderId: string }
	| { type: 'owner-active'; senderId: string }
	| { type: 'generation-stored'; senderId: string; generation: number }
	| { type: 'takeover-request'; senderId: string; requestId: string }
	| { type: 'takeover-ready'; senderId: string; requestId: string }
	| { type: 'takeover-denied'; senderId: string; requestId: string; message: string };

function leaseScope(options: WorkspaceLeaseOptions): string {
	return [options.accountId, options.documentId, options.workspaceId]
		.map((part) => `${part.length}:${part}`)
		.join('|');
}

function deferred<T>(): {
	promise: Promise<T>;
	resolve(value: T): void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

class BrowserWorkspaceLease implements WorkspaceLease {
	readonly #options: WorkspaceLeaseOptions;
	readonly #tabId = crypto.randomUUID();
	readonly #lockName: string;
	readonly #locks: LockManager | null;
	readonly #channel: BroadcastChannel | null;
	#status: WorkspaceLeaseStatus = { state: 'acquiring' };
	#started = false;
	#disposed = false;
	#releaseHeldLock: (() => void) | null = null;
	#lockRequest: Promise<unknown> | null = null;
	#takeoverAbort: AbortController | null = null;
	#takeover:
		| {
				requestId: string;
				promise: Promise<boolean>;
				resolve(acquired: boolean): void;
		  }
		| null = null;
	#handoffInFlight = false;

	constructor(options: WorkspaceLeaseOptions) {
		this.#options = options;
		const scope = leaseScope(options);
		this.#lockName = `octometa-edit:${scope}`;
		this.#locks =
			typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : null;
		let channel: BroadcastChannel | null = null;
		if (typeof BroadcastChannel !== 'undefined') {
			try {
				channel = new BroadcastChannel(`octometa-edit:${scope}`);
			} catch {
				channel = null;
			}
		}
		this.#channel = channel;
		if (channel) {
			channel.addEventListener('message', (event: MessageEvent<LeaseMessage>) => {
				void this.#receive(event.data);
			});
		}
	}

	get status(): WorkspaceLeaseStatus {
		return this.#status;
	}

	#setStatus(status: WorkspaceLeaseStatus): void {
		if (this.#disposed) return;
		this.#status = status;
		this.#options.onStatus?.(status);
	}

	#post(message: LeaseMessage): void {
		this.#channel?.postMessage(message);
	}

	async #acquireIfAvailable(): Promise<boolean> {
		if (!this.#locks) return false;
		const inspected = deferred<boolean>();
		const request = this.#locks.request(
			this.#lockName,
			{ mode: 'exclusive', ifAvailable: true },
			async (lock) => {
				if (!lock || this.#disposed) {
					inspected.resolve(false);
					return;
				}
				const held = deferred<void>();
				this.#releaseHeldLock = () => held.resolve();
				this.#setStatus({ state: 'owner' });
				this.#post({ type: 'owner-active', senderId: this.#tabId });
				inspected.resolve(true);
				await held.promise;
				this.#releaseHeldLock = null;
			}
		);
		this.#lockRequest = request;
		const acquired = await inspected.promise;
		if (!acquired) {
			await request;
			if (this.#lockRequest === request) this.#lockRequest = null;
		}
		return acquired;
	}

	async #release(nextStatus: WorkspaceLeaseState): Promise<void> {
		const request = this.#lockRequest;
		this.#releaseHeldLock?.();
		if (request) await request;
		if (this.#lockRequest === request) this.#lockRequest = null;
		this.#setStatus({ state: nextStatus });
	}

	async #receive(message: LeaseMessage): Promise<void> {
		if (
			this.#disposed ||
			!message ||
			typeof message !== 'object' ||
			message.senderId === this.#tabId
		) {
			return;
		}
		if (message.type === 'owner-query' && this.#status.state === 'owner') {
			this.#post({ type: 'owner-active', senderId: this.#tabId });
			return;
		}
		if (message.type === 'owner-active' && this.#status.state !== 'owner') {
			this.#setStatus({ ...this.#status, activeTabId: message.senderId });
			return;
		}
		if (
			message.type === 'generation-stored' &&
			this.#status.state !== 'owner' &&
			Number.isSafeInteger(message.generation) &&
			message.generation > 0
		) {
			this.#options.onStoredGeneration?.(message.generation);
			return;
		}
		if (
			message.type === 'takeover-request' &&
			this.#status.state === 'owner' &&
			!this.#handoffInFlight
		) {
			this.#handoffInFlight = true;
			try {
				await this.#options.flush();
				await this.#release('readonly');
				this.#setStatus({ state: 'readonly', activeTabId: message.senderId });
				this.#post({
					type: 'takeover-ready',
					senderId: this.#tabId,
					requestId: message.requestId
				});
			} catch {
				this.#post({
					type: 'takeover-denied',
					senderId: this.#tabId,
					requestId: message.requestId,
					message:
						'Takeover was not completed because the active tab could not store its latest changes. Retry after the active tab resolves its device-save error.'
				});
			} finally {
				this.#handoffInFlight = false;
			}
			return;
		}
		if (
			message.type === 'takeover-denied' &&
			this.#takeover?.requestId === message.requestId
		) {
			this.#takeoverAbort?.abort();
			this.#takeoverAbort = null;
			const pending = this.#takeover;
			this.#takeover = null;
			this.#setStatus({
				state: 'readonly',
				activeTabId: message.senderId,
				message: message.message
			});
			pending.resolve(false);
		}
	}

	async start(): Promise<WorkspaceLeaseStatus> {
		if (this.#started) return this.#status;
		this.#started = true;
		if (!this.#locks || !this.#channel) {
			this.#setStatus({
				state: 'unsupported',
				message:
					'This browser cannot safely coordinate editing tabs. Open this working copy in a browser that supports Web Locks and BroadcastChannel.'
			});
			return this.#status;
		}
		this.#setStatus({ state: 'acquiring' });
		if (!(await this.#acquireIfAvailable())) {
			this.#setStatus({ state: 'readonly' });
			this.#post({ type: 'owner-query', senderId: this.#tabId });
		}
		return this.#status;
	}

	async requestTakeover(): Promise<boolean> {
		if (this.#disposed || !this.#locks || !this.#channel) return false;
		if (this.#status.state === 'owner') return true;
		if (this.#takeover) return this.#takeover.promise;
		if (await this.#acquireIfAvailable()) return true;

		const requestId = crypto.randomUUID();
		const result = deferred<boolean>();
		const abort = new AbortController();
		this.#takeoverAbort = abort;
		this.#takeover = {
			requestId,
			promise: result.promise,
			resolve: result.resolve
		};
		this.#setStatus({ state: 'taking-over', activeTabId: this.#status.activeTabId });
		this.#post({ type: 'takeover-request', senderId: this.#tabId, requestId });
		const request = this.#locks.request(
			this.#lockName,
			{ mode: 'exclusive', signal: abort.signal },
			async (lock) => {
				if (!lock || this.#disposed) return;
				const held = deferred<void>();
				this.#releaseHeldLock = () => held.resolve();
				this.#takeoverAbort = null;
				const pending = this.#takeover;
				this.#takeover = null;
				this.#setStatus({ state: 'owner' });
				this.#post({ type: 'owner-active', senderId: this.#tabId });
				pending?.resolve(true);
				await held.promise;
				this.#releaseHeldLock = null;
			}
		);
		this.#lockRequest = request.catch((error: unknown) => {
			if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
		});
		return result.promise;
	}

	announceStoredGeneration(generation: number): void {
		if (
			this.#disposed ||
			this.#status.state !== 'owner' ||
			!Number.isSafeInteger(generation) ||
			generation < 1
		) {
			return;
		}
		this.#post({ type: 'generation-stored', senderId: this.#tabId, generation });
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#takeoverAbort?.abort();
		this.#takeoverAbort = null;
		this.#takeover?.resolve(false);
		this.#takeover = null;
		this.#releaseHeldLock?.();
		this.#channel?.close();
	}
}

/** Create a Web Locks and BroadcastChannel coordinator for one working copy. */
export function createWorkspaceLease(options: WorkspaceLeaseOptions): WorkspaceLease {
	return new BrowserWorkspaceLease(options);
}
