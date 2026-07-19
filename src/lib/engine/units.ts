/**
 * V1-1-2 — the quantity/units layer (SCHEMA.md §2, IMPLEMENTATION_PLAN.md V1-1-2).
 *
 * Quantities are stored canonically in SI base magnitudes; `Dimension.display`
 * carries the preferred display unit. Display-unit conversion never changes
 * the stored value. Dimensional mismatches surface as `#UNIT!` error values.
 * Feet-inch is explicitly out of scope (PRD §5.6).
 */

import {
	type Dimension,
	type TypedValue,
	errorValue,
	isError,
	isNumeric,
	isQuantity,
	isScalar,
	quantity,
	scalar
} from './types';

// ---------------------------------------------------------------------------
// Dimension algebra
// ---------------------------------------------------------------------------

/** The all-zero exponent vector (dimensionless). */
export const DIMENSIONLESS: Dimension = { L: 0, M: 0, T: 0, I: 0, Θ: 0, N: 0, J: 0 };

const EXPONENT_KEYS = ['L', 'M', 'T', 'I', 'Θ', 'N', 'J'] as const;

/** Build a Dimension from a sparse exponent map (missing exponents are 0). */
export function dim(partial: Partial<Dimension>): Dimension {
	const d: Dimension = { ...DIMENSIONLESS };
	for (const k of EXPONENT_KEYS) {
		const v = partial[k];
		if (typeof v === 'number') d[k] = v;
	}
	if (typeof partial.display === 'string') d.display = partial.display;
	return d;
}

/** True when the exponent vectors match. `display` is ignored: it is presentation, not physics. */
export function dimEq(a: Dimension, b: Dimension): boolean {
	return EXPONENT_KEYS.every((k) => a[k] === b[k]);
}

/** True when every exponent is zero. */
export function isDimensionless(d: Dimension): boolean {
	return EXPONENT_KEYS.every((k) => d[k] === 0);
}

/** Exponent-vector sum: the dimension of a product. */
export function dimMul(a: Dimension, b: Dimension): Dimension {
	const d: Dimension = { ...DIMENSIONLESS };
	for (const k of EXPONENT_KEYS) d[k] = a[k] + b[k];
	return d;
}

/** Exponent-vector difference: the dimension of a quotient. */
export function dimDiv(a: Dimension, b: Dimension): Dimension {
	const d: Dimension = { ...DIMENSIONLESS };
	for (const k of EXPONENT_KEYS) d[k] = a[k] - b[k];
	return d;
}

/** Exponent-vector scaling: the dimension of a power (n = 0.5 for square root). */
export function dimPow(a: Dimension, n: number): Dimension {
	const d: Dimension = { ...DIMENSIONLESS };
	for (const k of EXPONENT_KEYS) d[k] = a[k] * n;
	return d;
}

// ---------------------------------------------------------------------------
// Unit table (SI + common engineering)
// ---------------------------------------------------------------------------

interface UnitDef {
	dim: Dimension;
	/** canonical = display * factor + offset */
	factor: number;
	offset?: number;
}

const L = dim({ L: 1 });
const M = dim({ M: 1 });
const T = dim({ T: 1 });
const FORCE = dim({ M: 1, L: 1, T: -2 });
const PRESSURE = dim({ M: 1, L: -1, T: -2 });
const ENERGY = dim({ M: 1, L: 2, T: -2 });
const POWER = dim({ M: 1, L: 2, T: -3 });

const UNITS: Record<string, UnitDef> = {
	// length
	m: { dim: L, factor: 1 },
	mm: { dim: L, factor: 1e-3 },
	cm: { dim: L, factor: 1e-2 },
	km: { dim: L, factor: 1e3 },
	// mass
	kg: { dim: M, factor: 1 },
	g: { dim: M, factor: 1e-3 },
	t: { dim: M, factor: 1e3 },
	// time
	s: { dim: T, factor: 1 },
	ms: { dim: T, factor: 1e-3 },
	min: { dim: T, factor: 60 },
	h: { dim: T, factor: 3600 },
	// electric current · amount · luminous intensity
	A: { dim: dim({ I: 1 }), factor: 1 },
	mol: { dim: dim({ N: 1 }), factor: 1 },
	cd: { dim: dim({ J: 1 }), factor: 1 },
	// temperature (°C is affine; offset applies only as a lone unit, see parseUnit)
	K: { dim: dim({ Θ: 1 }), factor: 1 },
	'°C': { dim: dim({ Θ: 1 }), factor: 1, offset: 273.15 },
	degC: { dim: dim({ Θ: 1 }), factor: 1, offset: 273.15 },
	// force
	N: { dim: FORCE, factor: 1 },
	kN: { dim: FORCE, factor: 1e3 },
	MN: { dim: FORCE, factor: 1e6 },
	// pressure / stress
	Pa: { dim: PRESSURE, factor: 1 },
	kPa: { dim: PRESSURE, factor: 1e3 },
	MPa: { dim: PRESSURE, factor: 1e6 },
	GPa: { dim: PRESSURE, factor: 1e9 },
	// energy · power · frequency
	J: { dim: ENERGY, factor: 1 },
	kJ: { dim: ENERGY, factor: 1e3 },
	W: { dim: POWER, factor: 1 },
	kW: { dim: POWER, factor: 1e3 },
	Hz: { dim: dim({ T: -1 }), factor: 1 },
	// angle (dimensionless by SI convention)
	rad: { dim: DIMENSIONLESS, factor: 1 },
	deg: { dim: DIMENSIONLESS, factor: Math.PI / 180 }
};

/** True when `symbol` is a known unit symbol (exact case). */
export function isUnitSymbol(symbol: string): boolean {
	return Object.prototype.hasOwnProperty.call(UNITS, symbol);
}

// ---------------------------------------------------------------------------
// Unit-expression parsing
// ---------------------------------------------------------------------------

/** A parsed unit expression: dimension plus the affine map to canonical SI. */
export interface ParsedUnit {
	dim: Dimension;
	factor: number;
	offset: number;
}

const SUPERSCRIPTS: Record<string, string> = {
	'⁰': '0',
	'¹': '1',
	'²': '2',
	'³': '3',
	'⁴': '4',
	'⁵': '5',
	'⁶': '6',
	'⁷': '7',
	'⁸': '8',
	'⁹': '9',
	'⁻': '-'
};

function normalizeSuperscripts(text: string): string {
	let out = '';
	let prevSuper = false;
	for (const ch of text) {
		const sub = SUPERSCRIPTS[ch];
		if (sub !== undefined) {
			if (!prevSuper) out += '^';
			out += sub;
			prevSuper = true;
		} else {
			out += ch;
			prevSuper = false;
		}
	}
	return out;
}

/**
 * Normalize a unit expression for storage/printing: `*`→`·`, spaces stripped.
 * Purely textual — does not validate.
 */
export function normalizeUnitText(text: string): string {
	return text.replace(/\*/g, '·').replace(/\s+/g, '');
}

const TERM_RE = /^([A-Za-z°]+?)(?:\^?(-?\d+))?$/;

/**
 * Parse a unit expression — `kN`, `m2`, `m²`, `kN·m`, `kN*m`, `m/s^2`, `°C` —
 * into a dimension and the affine map to canonical SI. Left-associative over
 * `·`/`*`/`/`; exponents as `^n`, trailing digits, or superscripts.
 * Returns null when the text is not a valid unit expression.
 */
export function parseUnit(text: string): ParsedUnit | null {
	const src = normalizeSuperscripts(normalizeUnitText(text));
	if (src === '') return null;
	const parts = src.split(/([·/])/);
	let d = DIMENSIONLESS;
	let factor = 1;
	let sign = 1;
	let termCount = 0;
	let loneOffset = 0;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === '·') {
			sign = 1;
			continue;
		}
		if (part === '/') {
			sign = -1;
			continue;
		}
		const m = TERM_RE.exec(part);
		if (!m) return null;
		const def = UNITS[m[1]];
		if (!def) return null;
		const exp = sign * (m[2] === undefined ? 1 : Number(m[2]));
		d = dimMul(d, dimPow(def.dim, exp));
		factor *= def.factor ** exp;
		termCount++;
		// Affine units (°C) only make sense standing alone with exponent 1;
		// inside compounds they behave as their linear part (K).
		if (def.offset !== undefined && exp === 1) loneOffset = def.offset;
	}
	if (termCount === 0) return null;
	const offset = termCount === 1 && parts.length === 1 ? loneOffset : 0;
	return { dim: { ...d }, factor, offset };
}

// ---------------------------------------------------------------------------
// Quantity parsing & display
// ---------------------------------------------------------------------------

const QUANTITY_RE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*?)\s*$/;

/**
 * Parse `"5 kN"` → quantity (canonical SI magnitude + Dimension with display),
 * `"5"` → scalar, invalid text → `#VALUE!`/`#UNIT!` error value.
 */
export function parseQuantity(text: string): TypedValue {
	const m = QUANTITY_RE.exec(text);
	if (!m) return errorValue('#VALUE!', `not a number: "${text}"`);
	const value = Number(m[1]);
	const unitText = m[2];
	if (unitText === '') return scalar(value);
	const parsed = parseUnit(unitText);
	if (!parsed) return errorValue('#UNIT!', `unknown unit "${unitText}"`);
	return quantity(value * parsed.factor + parsed.offset, {
		...parsed.dim,
		display: normalizeUnitText(unitText)
	});
}

const SUPER_DIGITS: Record<string, string> = {
	'0': '⁰',
	'1': '¹',
	'2': '²',
	'3': '³',
	'4': '⁴',
	'5': '⁵',
	'6': '⁶',
	'7': '⁷',
	'8': '⁸',
	'9': '⁹',
	'-': '⁻',
	'.': '·' // fractional exponents are rare; rendered as best effort
};

function superscript(n: number): string {
	if (n === 1) return '';
	return String(n)
		.split('')
		.map((c) => SUPER_DIGITS[c] ?? c)
		.join('');
}

const SI_SYMBOLS: [keyof Dimension, string][] = [
	['M', 'kg'],
	['L', 'm'],
	['T', 's'],
	['I', 'A'],
	['Θ', 'K'],
	['N', 'mol'],
	['J', 'cd']
];

/**
 * Canonical SI label for a dimension: `m/s²`, `kg·m⁻¹·s⁻²` (all-superscript
 * form when the denominator has several terms), `''` when dimensionless.
 */
export function siUnitString(d: Dimension): string {
	const pos = SI_SYMBOLS.filter(([k]) => (d[k] as number) > 0);
	const neg = SI_SYMBOLS.filter(([k]) => (d[k] as number) < 0);
	if (pos.length === 0 && neg.length === 0) return '';
	if (neg.length > 1 || pos.length === 0) {
		return SI_SYMBOLS.filter(([k]) => (d[k] as number) !== 0)
			.map(([k, sym]) => sym + superscript(d[k] as number))
			.join('·');
	}
	const num = pos.map(([k, sym]) => sym + superscript(d[k] as number)).join('·');
	if (neg.length === 0) return num;
	const [k, sym] = neg[0];
	return `${num}/${sym}${superscript(-(d[k] as number))}`;
}

/** Display label for a dimension: its preferred display unit, else the SI label. */
export function dimLabel(d: Dimension): string {
	return d.display ?? siUnitString(d);
}

function trimNumber(value: number): string {
	if (!Number.isFinite(value)) return String(value);
	return String(Number(value.toPrecision(12)));
}

/**
 * Render a value for display. For quantities: convert the canonical magnitude
 * into `opts.unit` (or the stored display unit, or the SI label) and append the
 * label. `digits` fixes decimal places. Dimension-mismatched units yield `#UNIT!`.
 */
export function format(v: TypedValue, opts?: { unit?: string; digits?: number }): string {
	switch (v.kind) {
		case 'error':
			return v.code;
		case 'string':
			return v.value;
		case 'boolean':
			return v.value ? 'TRUE' : 'FALSE';
		case 'table':
			return `[table ${v.rows.length}×${v.columns.length}]`;
		case 'geometry':
			return v.handle;
		case 'scalar':
		case 'quantity':
			break;
	}
	const unitText = opts?.unit ?? (isQuantity(v) ? v.unit.display : undefined);
	const d = isQuantity(v) ? v.unit : DIMENSIONLESS;
	let displayValue = v.value;
	let label = '';
	if (unitText !== undefined) {
		const parsed = parseUnit(unitText);
		if (!parsed || !dimEq(parsed.dim, d)) return '#UNIT!';
		displayValue = (v.value - parsed.offset) / parsed.factor;
		label = normalizeUnitText(unitText);
	} else {
		label = siUnitString(d);
	}
	const num =
		opts?.digits !== undefined ? displayValue.toFixed(opts.digits) : trimNumber(displayValue);
	return label === '' ? num : `${num} ${label}`;
}

/**
 * Display-unit conversion: same canonical value, new preferred unit.
 * Rejects unknown units and dimension mismatches with `#UNIT!`.
 */
export function convert(v: TypedValue, unit: string): TypedValue {
	if (isError(v)) return v;
	if (!isNumeric(v)) return errorValue('#VALUE!', `cannot convert a ${v.kind} to "${unit}"`);
	const parsed = parseUnit(unit);
	if (!parsed) return errorValue('#UNIT!', `unknown unit "${unit}"`);
	const d = isQuantity(v) ? v.unit : DIMENSIONLESS;
	if (!dimEq(parsed.dim, d)) {
		return errorValue('#UNIT!', `cannot convert [${dimLabel(d)}] to "${unit}"`);
	}
	return quantity(v.value, { ...parsed.dim, display: normalizeUnitText(unit) });
}

// ---------------------------------------------------------------------------
// Quantity arithmetic (scalar = dimensionless quantity)
// ---------------------------------------------------------------------------

function dimOf(v: Extract<TypedValue, { kind: 'scalar' | 'quantity' }>): Dimension {
	return isQuantity(v) ? v.unit : DIMENSIONLESS;
}

/** Collapse to scalar when dimensionless — a ratio is explicitly a bare number. */
function makeNumeric(value: number, d: Dimension, display?: string): TypedValue {
	if (isDimensionless(d) && display === undefined) return scalar(value);
	return quantity(value, display === undefined ? { ...d } : { ...d, display });
}

function nonNumeric(v: TypedValue): TypedValue {
	if (isError(v)) return v;
	return errorValue('#VALUE!', `expected a number, got ${v.kind}`);
}

/** Composed display for a product, when both operands carry simple displays. */
function mulDisplay(a: Dimension, b: Dimension): string | undefined {
	if (a.display && b.display) return `${a.display}·${b.display}`;
	if (a.display && isDimensionless(b)) return a.display;
	if (b.display && isDimensionless(a)) return b.display;
	return undefined;
}

/** Composed display for a quotient; unsafe when the denominator is compound. */
function divDisplay(a: Dimension, b: Dimension): string | undefined {
	if (b.display && /[·/*]/.test(b.display)) return undefined;
	if (a.display && b.display) return `${a.display}/${b.display}`;
	if (a.display && isDimensionless(b)) return a.display;
	return undefined;
}

/** Add two numeric values. Dimensions must match, else `#UNIT!`. */
export function qAdd(a: TypedValue, b: TypedValue): TypedValue {
	if (!isNumeric(a)) return nonNumeric(a);
	if (!isNumeric(b)) return nonNumeric(b);
	const da = dimOf(a);
	const db = dimOf(b);
	if (!dimEq(da, db)) {
		return errorValue('#UNIT!', `cannot add [${dimLabel(da)}] and [${dimLabel(db)}]`);
	}
	return makeNumeric(a.value + b.value, da, da.display ?? db.display);
}

/** Subtract two numeric values. Dimensions must match, else `#UNIT!`. */
export function qSub(a: TypedValue, b: TypedValue): TypedValue {
	if (!isNumeric(a)) return nonNumeric(a);
	if (!isNumeric(b)) return nonNumeric(b);
	const da = dimOf(a);
	const db = dimOf(b);
	if (!dimEq(da, db)) {
		return errorValue('#UNIT!', `cannot subtract [${dimLabel(db)}] from [${dimLabel(da)}]`);
	}
	return makeNumeric(a.value - b.value, da, da.display ?? db.display);
}

/** Multiply two numeric values; dimensions compose. */
export function qMul(a: TypedValue, b: TypedValue): TypedValue {
	if (!isNumeric(a)) return nonNumeric(a);
	if (!isNumeric(b)) return nonNumeric(b);
	const da = dimOf(a);
	const db = dimOf(b);
	const rd = dimMul(da, db);
	// A dimensionless product is a bare number; composed displays don't apply.
	return makeNumeric(a.value * b.value, rd, isDimensionless(rd) ? undefined : mulDisplay(da, db));
}

/** Divide two numeric values; dimensions compose. Division by zero → `#VALUE!`. */
export function qDiv(a: TypedValue, b: TypedValue): TypedValue {
	if (!isNumeric(a)) return nonNumeric(a);
	if (!isNumeric(b)) return nonNumeric(b);
	if (b.value === 0) return errorValue('#VALUE!', 'division by zero');
	const da = dimOf(a);
	const db = dimOf(b);
	const rd = dimDiv(da, db);
	// A ratio of like dimensions is a bare number (SCHEMA.md §2).
	return makeNumeric(a.value / b.value, rd, isDimensionless(rd) ? undefined : divDisplay(da, db));
}

/**
 * Raise a numeric value to a dimensionless power; exponents scale
 * (`qPow(q, 0.5)` is the square root, so `sqrt(m²) → m`).
 */
export function qPow(a: TypedValue, n: TypedValue): TypedValue {
	if (!isNumeric(a)) return nonNumeric(a);
	if (!isNumeric(n)) return nonNumeric(n);
	if (isQuantity(n) && !isDimensionless(n.unit)) {
		return errorValue('#UNIT!', `exponent must be dimensionless, got [${dimLabel(n.unit)}]`);
	}
	const da = dimOf(a);
	if (a.value < 0 && !Number.isInteger(n.value)) {
		return errorValue('#VALUE!', 'fractional power of a negative number');
	}
	return makeNumeric(a.value ** n.value, dimPow(da, n.value));
}

/** Negate a numeric value. */
export function qNeg(a: TypedValue): TypedValue {
	if (!isNumeric(a)) return nonNumeric(a);
	return isScalar(a) ? scalar(-a.value) : quantity(-a.value, a.unit);
}

/** Absolute value of a numeric value. */
export function qAbs(a: TypedValue): TypedValue {
	if (!isNumeric(a)) return nonNumeric(a);
	return isScalar(a) ? scalar(Math.abs(a.value)) : quantity(Math.abs(a.value), a.unit);
}

/** Comparison operators shared with the formula grammar. */
export type CompareOp = '=' | '<' | '>' | '<=' | '>=' | '<>';

/**
 * Compare two values. Numeric comparisons require equal dimensions (`#UNIT!`);
 * `=`/`<>` also work on same-kind strings and booleans; anything else → `#VALUE!`.
 */
export function qCompare(op: CompareOp, a: TypedValue, b: TypedValue): TypedValue {
	if (isError(a)) return a;
	if (isError(b)) return b;
	if (isNumeric(a) && isNumeric(b)) {
		const da = dimOf(a);
		const db = dimOf(b);
		if (!dimEq(da, db)) {
			return errorValue('#UNIT!', `cannot compare [${dimLabel(da)}] and [${dimLabel(db)}]`);
		}
		return bool(compareNumbers(op, a.value, b.value));
	}
	if (a.kind === 'string' && b.kind === 'string') {
		if (op === '=') return bool(a.value === b.value);
		if (op === '<>') return bool(a.value !== b.value);
		return bool(compareNumbers(op, a.value < b.value ? -1 : a.value > b.value ? 1 : 0, 0));
	}
	if (a.kind === 'boolean' && b.kind === 'boolean' && (op === '=' || op === '<>')) {
		return bool(op === '=' ? a.value === b.value : a.value !== b.value);
	}
	return errorValue('#VALUE!', `cannot compare ${a.kind} ${op} ${b.kind}`);
}

function bool(v: boolean): TypedValue {
	return { kind: 'boolean', value: v };
}

function compareNumbers(op: CompareOp, a: number, b: number): boolean {
	switch (op) {
		case '=':
			return a === b;
		case '<>':
			return a !== b;
		case '<':
			return a < b;
		case '>':
			return a > b;
		case '<=':
			return a <= b;
		case '>=':
			return a >= b;
	}
}
