import type { MacroDictionary } from 'mathlive';
import {
	escapeTexText,
	listPublishedValues,
	publishedValueToTex,
	resolvePublishedTarget,
	type DocumentGraph,
	type EquationPayload,
	type EquationSegment,
	type PublishedValue
} from '../engine';

/** One stable-reference macro used by a MathLive editing projection. */
export interface EquationReferenceMacro {
	name: string;
	segment: Extract<EquationSegment, { kind: 'reference' }>;
	broken: boolean;
	label: string;
}

/** Complete MathLive projection for one persisted equation payload. */
export interface EquationMathfieldModel {
	latex: string;
	macros: MacroDictionary;
	references: EquationReferenceMacro[];
}

/** One published-value occurrence in the human-authored equation source. */
export interface EquationSourceReference {
	label: string;
	segment: Extract<EquationSegment, { kind: 'reference' }>;
}

/** Human-authored source projection with stable references kept out of band. */
export interface EquationSourceModel {
	source: string;
	references: EquationSourceReference[];
}

function letters(index: number): string {
	let value = index;
	let result = '';
	do {
		result = String.fromCharCode(97 + (value % 26)) + result;
		value = Math.floor(value / 26) - 1;
	} while (value >= 0);
	return result;
}

/** Return the deterministic MathLive macro name for one reference occurrence. */
export function equationReferenceMacroName(index: number): string {
	return `octoref${letters(index)}`;
}

/** Resolve one reference's current editable presentation without changing identity. */
export function equationReferencePresentation(
	segment: Extract<EquationSegment, { kind: 'reference' }>,
	graph: DocumentGraph
): { definition: string; broken: boolean; label: string } {
	const resolved = resolvePublishedTarget(graph, segment.nodeId);
	if (!resolved) {
		const label = `Missing: ${segment.fallback.name}`;
		return {
			definition: `\\class{octo-equation-reference-broken}{\\text{${escapeTexText(label)}}}`,
			broken: true,
			label
		};
	}
	const name =
		resolved.publishedNode.name ?? resolved.targetNode.name ?? segment.fallback.name;
	return {
		definition: `\\class{octo-equation-reference}{${publishedValueToTex(
			resolved.targetNode.value,
			resolved.publishedNode.publication?.unit
		)}}`,
		broken: false,
		label: name
	};
}

/**
 * Project persisted equation segments into MathLive LaTeX.
 *
 * Reference macros are immutable editing atoms. Their names are projection
 * details only; the returned reference map restores stable IDs after edits.
 */
export function equationMathfieldModel(
	payload: EquationPayload,
	graph: DocumentGraph
): EquationMathfieldModel {
	const macros: MacroDictionary = {};
	const references: EquationReferenceMacro[] = [];
	let referenceIndex = 0;
	const latex = payload.segments
		.map((segment) => {
			if (segment.kind === 'latex') return segment.latex;
			const name = equationReferenceMacroName(referenceIndex++);
			const presentation = equationReferencePresentation(segment, graph);
			macros[name] = {
				def: presentation.definition,
				captureSelection: true
			};
			references.push({
				name,
				segment: structuredClone(segment),
				broken: presentation.broken,
				label: presentation.label
			});
			// The empty group terminates the macro before an authored letter.
			return `\\${name}{}`;
		})
		.join('');
	return { latex, macros, references };
}

function mergeLatexSegments(segments: EquationSegment[]): EquationSegment[] {
	const merged: EquationSegment[] = [];
	for (const segment of segments) {
		const previous = merged.at(-1);
		if (segment.kind === 'latex' && previous?.kind === 'latex') {
			previous.latex += segment.latex;
		} else {
			merged.push(structuredClone(segment));
		}
	}
	return merged.length > 0 ? merged : [{ kind: 'latex', latex: '' }];
}

/**
 * Restore persisted segments from edited MathLive LaTeX using the stable
 * reference map produced by `equationMathfieldModel`.
 */
export function equationPayloadFromMathfield(
	latex: string,
	references: readonly EquationReferenceMacro[]
): EquationPayload {
	if (references.length === 0) {
		return { version: 1, segments: [{ kind: 'latex', latex }] };
	}
	const byName = new Map(references.map((reference) => [reference.name, reference.segment]));
	const names = [...byName.keys()].sort((left, right) => right.length - left.length);
	const matcher = new RegExp(`\\\\(${names.join('|')})(?:\\{\\})?`, 'g');
	const segments: EquationSegment[] = [];
	let cursor = 0;
	for (const match of latex.matchAll(matcher)) {
		const index = match.index ?? 0;
		if (index > cursor) segments.push({ kind: 'latex', latex: latex.slice(cursor, index) });
		const reference = byName.get(match[1]);
		if (reference) segments.push(structuredClone(reference));
		cursor = index + match[0].length;
	}
	if (cursor < latex.length) segments.push({ kind: 'latex', latex: latex.slice(cursor) });
	return { version: 1, segments: mergeLatexSegments(segments) };
}

/**
 * Project an equation into readable TeX-like source.
 *
 * Published values use `\value{name}` while their stable node IDs remain in
 * the returned reference map, so implementation-only MathLive macros never
 * leak into the source editor.
 */
export function equationSourceModel(
	payload: EquationPayload,
	graph: DocumentGraph
): EquationSourceModel {
	const references: EquationSourceReference[] = [];
	const source = payload.segments
		.map((segment) => {
			if (segment.kind === 'latex') return segment.latex;
			const label = equationReferencePresentation(segment, graph).label.replace(/^Missing: /, '');
			references.push({ label, segment: structuredClone(segment) });
			return `\\value{${label}}`;
		})
		.join('');
	return { source, references };
}

/**
 * Restore persisted segments from readable equation source.
 *
 * Existing labels recover their out-of-band stable IDs. A newly authored
 * `\value{name}` token resolves only when that exact value is published;
 * otherwise it remains ordinary TeX and is reported by the renderer.
 */
export function equationPayloadFromSource(
	source: string,
	references: readonly EquationSourceReference[],
	graph: DocumentGraph
): EquationPayload {
	const existing = new Map<string, EquationSourceReference>();
	for (const reference of references) existing.set(reference.label, reference);
	const published = new Map(listPublishedValues(graph).map((value) => [value.name, value]));
	const matcher = /\\value\{([^{}]+)\}/g;
	const segments: EquationSegment[] = [];
	let cursor = 0;
	for (const match of source.matchAll(matcher)) {
		const index = match.index ?? 0;
		if (index > cursor) segments.push({ kind: 'latex', latex: source.slice(cursor, index) });
		const label = match[1];
		const known = existing.get(label);
		const selected = published.get(label);
		if (known) {
			segments.push(structuredClone(known.segment));
		} else if (selected) {
			segments.push(equationReferenceFromPublishedValue(selected));
		} else {
			segments.push({ kind: 'latex', latex: match[0] });
		}
		cursor = index + match[0].length;
	}
	if (cursor < source.length) segments.push({ kind: 'latex', latex: source.slice(cursor) });
	return { version: 1, segments: mergeLatexSegments(segments) };
}

/** Create a stable equation reference segment from a picker result. */
export function equationReferenceFromPublishedValue(
	value: PublishedValue
): Extract<EquationSegment, { kind: 'reference' }> {
	return {
		kind: 'reference',
		nodeId: value.id,
		fallback: { name: value.name, sheetId: value.sheetId, cell: value.cell }
	};
}
