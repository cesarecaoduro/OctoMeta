/** Recovery guidance for one failed local durability transaction. */
export interface LocalStorageFailure {
	kind: 'quota' | 'transaction';
	title: string;
	guidance: string;
}

/** Convert browser storage errors into stable, actionable owner guidance. */
export function describeLocalStorageFailure(error: unknown): LocalStorageFailure {
	const candidate =
		typeof error === 'object' && error !== null
			? (error as { name?: unknown; code?: unknown })
			: null;
	const quota =
		candidate?.name === 'QuotaExceededError' ||
		candidate?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
		candidate?.code === 22 ||
		candidate?.code === 1014;
	if (quota) {
		return {
			kind: 'quota',
			title: 'Device storage is full',
			guidance:
				'Free device storage, then retry. Keep this tab open until Stored on this device returns.'
		};
	}
	return {
		kind: 'transaction',
		title: 'Device save did not complete',
		guidance:
			'Retry the local save. Keep this tab open until Stored on this device returns.'
	};
}
