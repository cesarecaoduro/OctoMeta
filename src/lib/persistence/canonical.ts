import { fastHash } from '../engine';

/** Canonical JSON limits shared by the client and Convex mutation. */
export const SNAPSHOT_BYTE_LIMIT = 750 * 1024;
export const BUNDLE_BYTE_LIMIT = 4 * 1024 * 1024;

/**
 * Serialize strict JSON with sorted object keys. Unlike JSON.stringify this
 * rejects undefined, cycles, non-finite numbers, and custom prototypes so a
 * checksum cannot silently describe a different payload than Convex stores.
 */
export function canonicalJson(value: unknown): string {
	const ancestors = new Set<object>();
	const visit = (current: unknown): string => {
		if (current === null) return 'null';
		if (typeof current === 'string' || typeof current === 'boolean') {
			return JSON.stringify(current);
		}
		if (typeof current === 'number') {
			if (!Number.isFinite(current)) throw new Error('canonical JSON requires finite numbers');
			return JSON.stringify(current);
		}
		if (typeof current !== 'object') {
			throw new Error(`canonical JSON rejects ${typeof current}`);
		}
		if (ancestors.has(current)) throw new Error('canonical JSON rejects cycles');
		ancestors.add(current);
		try {
			if (Array.isArray(current)) return `[${current.map(visit).join(',')}]`;
			const prototype = Object.getPrototypeOf(current);
			if (prototype !== Object.prototype && prototype !== null) {
				throw new Error('canonical JSON rejects custom prototypes');
			}
			const record = current as Record<string, unknown>;
			const fields = Object.keys(record)
				.sort()
				.map((key) => `${JSON.stringify(key)}:${visit(record[key])}`);
			return `{${fields.join(',')}}`;
		} finally {
			ancestors.delete(current);
		}
	};
	return visit(value);
}

/** UTF-8 byte count of canonical JSON. */
export function canonicalBytes(value: unknown): number {
	return new TextEncoder().encode(canonicalJson(value)).byteLength;
}

/** Deterministic checksum for one Univer workbook snapshot. */
export function workbookSnapshotHash(snapshot: unknown): string {
	return fastHash(canonicalJson(snapshot));
}

/** Deterministic checksum tying graph rows, manifest, and snapshot together. */
export function documentBundleHash(
	graph: unknown,
	workbookManifest: unknown,
	snapshotHash: string
): string {
	return fastHash(canonicalJson({ graph, workbookManifest, snapshotHash }));
}
