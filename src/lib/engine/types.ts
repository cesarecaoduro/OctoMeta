/**
 * SCHEMA.md §2 — the typed value system, plus the primitives every other
 * engine module builds on: ULID node ids, fast content hashing, and
 * exhaustive type guards. Pure TypeScript; nothing here may import from
 * outside `src/lib/engine/`.
 */

/** Stable node identity — a ULID, never positional (SCHEMA.md §3). */
export type NodeId = string;

/** Document block identity (SCHEMA.md §8). */
export type BlockId = string;

/** Stable workbook-tab identity, independent of its display name and position. */
export type SheetId = string;

/** The deterministic first tab used by empty in-memory documents and fixtures. */
export const DEFAULT_SHEET_ID: SheetId = 'sheet-1';

/** Canonical workbook-tab metadata owned by the document graph. */
export interface SheetMeta {
	id: SheetId;
	name: string;
	position: number;
}

/** Non-empty workbook tab manifest; positions always equal array indexes. */
export interface WorkbookManifest {
	sheets: SheetMeta[];
}

/**
 * Formula-demoted Univer state captured for an undoable tab removal.
 * The engine stores it in history but never interprets the opaque snapshot.
 */
export interface SheetProjection {
	version: 1;
	sheetId: SheetId;
	wasActive: boolean;
	snapshot: unknown;
}

/** Create a fresh one-tab workbook manifest for a new document graph. */
export function createDefaultWorkbook(): WorkbookManifest {
	return { sheets: [{ id: DEFAULT_SHEET_ID, name: 'Sheet 1', position: 0 }] };
}

/** Opaque geometry handle: `geom:<op>:<hash>` (SCHEMA.md §2; geometry itself is V2). */
export type GeomHandle = `geom:${string}:${string}`;

/** The complete error taxonomy (SCHEMA.md §11). */
export type ErrCode = '#UNIT!' | '#DIM!' | '#CYCLE!' | '#REF!' | '#NAME?' | '#GEOM!' | '#VALUE!';

/** Every error code, for iteration in tests and UI. */
export const ERR_CODES: readonly ErrCode[] = [
	'#UNIT!',
	'#DIM!',
	'#CYCLE!',
	'#REF!',
	'#NAME?',
	'#GEOM!',
	'#VALUE!'
];

/**
 * SI exponent vector + preferred display unit (SCHEMA.md §2).
 * L length · M mass · T time · I current · Θ temperature · N amount · J luminous.
 */
export interface Dimension {
	L: number;
	M: number;
	T: number;
	I: number;
	Θ: number;
	N: number;
	J: number;
	display?: string;
}

/** Column descriptor for table values. */
export interface ColumnDef {
	name: string;
	/** Expected cell kind; 'any' when the column is heterogeneous. */
	kind: TypedValue['kind'] | 'any';
}

/** A Univer-hosted cell address: stable workbook tab + A1 (or A1:B2 range) text. */
export type CellRef = { sheetId: SheetId; a1: string };

/**
 * The typed value system (SCHEMA.md §2). Quantities are the default numeric
 * type; a bare number is `scalar` only when explicitly dimensionless.
 * Errors are values: they flow through edges and render wherever the node projects.
 */
export type TypedValue =
	| { kind: 'scalar'; value: number }
	| { kind: 'quantity'; value: number; unit: Dimension }
	| { kind: 'string'; value: string }
	| { kind: 'boolean'; value: boolean }
	| { kind: 'table'; columns: ColumnDef[]; rows: TypedValue[][] }
	| { kind: 'geometry'; handle: GeomHandle }
	| { kind: 'error'; code: ErrCode; message: string; origin: NodeId };

/** The error member of the TypedValue union, for narrowed signatures. */
export type ErrorValue = Extract<TypedValue, { kind: 'error' }>;

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

/** Build a dimensionless scalar value. */
export function scalar(value: number): TypedValue {
	return { kind: 'scalar', value };
}

/** Build a quantity value (canonical SI magnitude + dimension). */
export function quantity(value: number, unit: Dimension): TypedValue {
	return { kind: 'quantity', value, unit };
}

/** Build a string value. */
export function stringValue(value: string): TypedValue {
	return { kind: 'string', value };
}

/** Build a boolean value. */
export function booleanValue(value: boolean): TypedValue {
	return { kind: 'boolean', value };
}

/**
 * Build an error value. `origin` is the first failing node (SCHEMA.md §11);
 * layers with no node context pass '' and the evaluator stamps the real id.
 */
export function errorValue(code: ErrCode, message: string, origin: NodeId = ''): ErrorValue {
	return { kind: 'error', code, message, origin };
}

// ---------------------------------------------------------------------------
// Type guards (exhaustive over TypedValue['kind'])
// ---------------------------------------------------------------------------

export function isScalar(v: TypedValue): v is Extract<TypedValue, { kind: 'scalar' }> {
	return v.kind === 'scalar';
}
export function isQuantity(v: TypedValue): v is Extract<TypedValue, { kind: 'quantity' }> {
	return v.kind === 'quantity';
}
export function isString(v: TypedValue): v is Extract<TypedValue, { kind: 'string' }> {
	return v.kind === 'string';
}
export function isBoolean(v: TypedValue): v is Extract<TypedValue, { kind: 'boolean' }> {
	return v.kind === 'boolean';
}
export function isTable(v: TypedValue): v is Extract<TypedValue, { kind: 'table' }> {
	return v.kind === 'table';
}
export function isGeometry(v: TypedValue): v is Extract<TypedValue, { kind: 'geometry' }> {
	return v.kind === 'geometry';
}
export function isError(v: TypedValue): v is ErrorValue {
	return v.kind === 'error';
}

/** Numeric = scalar or quantity, the kinds arithmetic lifts over. */
export function isNumeric(
	v: TypedValue
): v is Extract<TypedValue, { kind: 'scalar' | 'quantity' }> {
	return v.kind === 'scalar' || v.kind === 'quantity';
}

/** Compile-time exhaustiveness check for switches over `TypedValue['kind']`. */
export function assertNever(x: never): never {
	throw new Error(`Unreachable variant: ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------------------
// ULID (SCHEMA.md §3: NodeId is a stable ULID)
// ---------------------------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generate a 26-char Crockford-base32 ULID: 48-bit ms timestamp + 80 random
 * bits. Lexicographic order follows creation time.
 */
export function ulid(now: number = Date.now()): NodeId {
	let time = '';
	let t = now;
	for (let i = 0; i < 10; i++) {
		time = CROCKFORD[t % 32] + time;
		t = Math.floor(t / 32);
	}
	const bytes = new Uint8Array(10);
	crypto.getRandomValues(bytes);
	// 80 random bits → 16 base32 chars, 5 bits at a time.
	let rand = '';
	let acc = 0;
	let bits = 0;
	for (const b of bytes) {
		acc = (acc << 8) | b;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			rand += CROCKFORD[(acc >> bits) & 31];
			acc &= (1 << bits) - 1;
		}
	}
	return time + rand;
}

// ---------------------------------------------------------------------------
// Content hashing (SCHEMA.md §3: contentHash = hash(opId + inputHashes))
// ---------------------------------------------------------------------------

/**
 * Fast non-cryptographic 53-bit string hash (cyrb53), hex-encoded.
 * Deterministic across runs; used only for memoization, never security.
 */
export function fastHash(input: string, seed = 0): string {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let i = 0; i < input.length; i++) {
		const ch = input.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (
		(h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
	);
}

const HASH_SEP = '\u001f'; // unit separator: keeps ['ab','c'] distinct from ['a','bc']

/**
 * Memo key for a node: hash of its operation identity plus its inputs' hashes
 * **in order** — reordering inputs must change the hash (SCHEMA.md §3–4).
 */
export function contentHash(opId: string, inputHashes: readonly string[]): string {
	return fastHash(opId + HASH_SEP + inputHashes.join(HASH_SEP));
}
