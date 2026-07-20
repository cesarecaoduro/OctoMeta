/**
 * Convex value codec for engine-owned JSON (GraphNode values/formulas,
 * undo-log mutations). Two impedance mismatches are fixed here, in one place:
 *
 * 1. **Non-ASCII object keys.** Convex requires object field names to be
 *    ASCII (and not start with `_`/`$`). The engine's `Dimension` uses the SI
 *    temperature axis key `Θ` (SCHEMA.md §2), which Convex rejects. On the
 *    way in, every object key `Θ` is renamed to `THETA`; on the way out it is
 *    renamed back. This is safe because engine data has fixed, known object
 *    keys — `THETA` never occurs naturally (asserted at encode/decode time),
 *    and free-form user text only ever appears as *values*, never keys.
 *
 * 2. **`undefined` fields.** Convex has no `undefined`; optional fields are
 *    simply absent. Encoding drops undefined-valued keys (standard JSON
 *    semantics, matching the engine's `stableStringify`), so a round-tripped
 *    node compares deep-equal to `JSON.parse(JSON.stringify(node))`.
 */

/** The engine-side Dimension temperature key (non-ASCII, SCHEMA.md §2). */
const THETA = 'Θ'; // 'Θ'
/** Its Convex-safe stand-in. */
const THETA_ENCODED = 'THETA';

/**
 * Deep-encode an engine JSON value for Convex storage: rename `Θ` keys to
 * `THETA` and drop undefined-valued object fields. Arrays and primitives pass
 * through structurally unchanged.
 */
export function toConvexJson<T>(value: T): T {
	return walk(value, THETA, THETA_ENCODED) as T;
}

/** Deep-decode a Convex-stored value back to engine JSON: rename `THETA` keys to `Θ`. */
export function fromConvexJson<T>(value: unknown): T {
	return walk(value, THETA_ENCODED, THETA) as T;
}

function walk(value: unknown, fromKey: string, toKey: string): unknown {
	if (value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map((item) => walk(item, fromKey, toKey));
	const source = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, field] of Object.entries(source)) {
		if (field === undefined) continue; // JSON semantics: absent, not null
		if (key === toKey) {
			// A natural `THETA` (encode) or `Θ` (decode) key would round-trip
			// wrong. Engine data never produces either; fail loudly if it does.
			throw new Error(`codec: reserved key "${toKey}" already present in value`);
		}
		out[key === fromKey ? toKey : key] = walk(field, fromKey, toKey);
	}
	return out;
}
