import { describe, expect, it } from 'vitest';
import {
	ERR_CODES,
	type TypedValue,
	assertNever,
	booleanValue,
	contentHash,
	errorValue,
	fastHash,
	isBoolean,
	isError,
	isGeometry,
	isNumeric,
	isQuantity,
	isScalar,
	isString,
	isTable,
	quantity,
	scalar,
	stringValue,
	ulid
} from './types';
import { type GraphNode, type PendingChange, type Provenance, emptyProvenance } from './node';
import { dim } from './units';

describe('ulid (V1-1-1)', () => {
	it('generates 26-char Crockford base32 ids', () => {
		const id = ulid();
		expect(id).toHaveLength(26);
		expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	});

	it('is unique across many generations', () => {
		const ids = new Set(Array.from({ length: 1000 }, () => ulid()));
		expect(ids.size).toBe(1000);
	});

	it('sorts lexicographically by timestamp', () => {
		const a = ulid(1_000_000);
		const b = ulid(2_000_000);
		expect(a < b).toBe(true);
	});
});

describe('fastHash / contentHash (V1-1-1)', () => {
	it('is deterministic across calls', () => {
		expect(fastHash('octometa')).toBe(fastHash('octometa'));
		expect(contentHash('op', ['a', 'b'])).toBe(contentHash('op', ['a', 'b']));
	});

	it('changes with the operation id', () => {
		expect(contentHash('op1', ['a'])).not.toBe(contentHash('op2', ['a']));
	});

	it('is input-order-sensitive', () => {
		expect(contentHash('op', ['a', 'b'])).not.toBe(contentHash('op', ['b', 'a']));
	});

	it('does not collide on input-boundary shifts', () => {
		expect(contentHash('op', ['ab', 'c'])).not.toBe(contentHash('op', ['a', 'bc']));
	});

	it('hex-encodes to a fixed width', () => {
		expect(fastHash('')).toMatch(/^[0-9a-f]{16}$/);
		expect(fastHash('anything at all')).toMatch(/^[0-9a-f]{16}$/);
	});
});

describe('type guards (V1-1-1)', () => {
	const samples: TypedValue[] = [
		scalar(1),
		quantity(5000, dim({ M: 1, L: 1, T: -2, display: 'kN' })),
		stringValue('x'),
		booleanValue(true),
		{ kind: 'table', columns: [{ name: 'a', kind: 'scalar' }], rows: [[scalar(1)]] },
		{ kind: 'geometry', handle: 'geom:extrude:9f3a' },
		errorValue('#UNIT!', 'boom', 'node1')
	];

	it('covers every kind exhaustively', () => {
		for (const v of samples) {
			// The default branch must be unreachable — `assertNever` compiles only
			// if the switch covers the whole union.
			switch (v.kind) {
				case 'scalar':
					expect(isScalar(v)).toBe(true);
					break;
				case 'quantity':
					expect(isQuantity(v)).toBe(true);
					break;
				case 'string':
					expect(isString(v)).toBe(true);
					break;
				case 'boolean':
					expect(isBoolean(v)).toBe(true);
					break;
				case 'table':
					expect(isTable(v)).toBe(true);
					break;
				case 'geometry':
					expect(isGeometry(v)).toBe(true);
					break;
				case 'error':
					expect(isError(v)).toBe(true);
					break;
				default:
					assertNever(v);
			}
		}
	});

	it('numeric covers scalar and quantity only', () => {
		expect(samples.filter(isNumeric)).toHaveLength(2);
	});

	it('enumerates the full error taxonomy', () => {
		expect(ERR_CODES).toEqual([
			'#UNIT!',
			'#DIM!',
			'#CYCLE!',
			'#REF!',
			'#NAME?',
			'#GEOM!',
			'#VALUE!'
		]);
	});
});

describe('provenance & pending round-trip (V1-1-1)', () => {
	it('survives JSON serialization untouched', () => {
		const provenance: Provenance = {
			authoredBy: 'template',
			authorId: 'beam-template',
			authoredAt: 1_760_000_000_000,
			verifiedBy: 'reviewer-1',
			verifiedAt: 1_760_000_100_000
		};
		const pending: PendingChange = {
			diffId: 'diff-1',
			proposedBy: 'agent',
			proposed: { name: 'beam.span' },
			validation: { unit: true, type: true, geometry: false, messages: ['msg'] },
			status: 'proposed'
		};
		const node: GraphNode = {
			id: ulid(),
			kind: 'input',
			value: scalar(3),
			inputs: [],
			contentHash: contentHash('input:3', []),
			provenance,
			pending
		};
		const revived = JSON.parse(JSON.stringify(node)) as GraphNode;
		expect(revived).toEqual(node);
		expect(revived.provenance).toEqual(provenance);
		expect(revived.pending).toEqual(pending);
	});

	it('starts unauthored', () => {
		expect(emptyProvenance()).toEqual({ authoredBy: null });
	});
});
