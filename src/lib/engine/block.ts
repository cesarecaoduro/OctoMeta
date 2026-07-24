/**
 * SCHEMA.md §8 — the document & block model as pure data types. Blocks are
 * layout containers: `position` is layout ONLY (evaluation never reads it,
 * SCHEMA.md §5). The document workbook is separate from report blocks; chips
 * bind prose to graph nodes by stable NodeId so bindings survive reordering.
 */

import type { BlockId, NodeId } from './types';

/** Final R1 report block union. Workbook tabs are not report blocks. */
export type BlockType = 'text' | 'heading' | 'image' | 'equation';

/** Every block type, for validation and iteration. */
export const BLOCK_TYPES: readonly BlockType[] = ['text', 'heading', 'image', 'equation'];

/** Maximum authored LaTeX stored across one equation's segments. */
export const MAX_EQUATION_LATEX_LENGTH = 10_000;

/** Maximum number of live references stored in one equation. */
export const MAX_EQUATION_REFERENCES = 64;

/** Display identity retained when a published value becomes unavailable. */
export interface EquationReferenceFallback {
	name: string;
	sheetId?: string;
	cell?: string;
}

/** One authored or stable-reference part of a visual equation. */
export type EquationSegment =
	| { kind: 'latex'; latex: string }
	| { kind: 'reference'; nodeId: NodeId; fallback: EquationReferenceFallback };

/**
 * Persisted payload for a visual equation.
 *
 * Versioning keeps the authored format migratable while segments preserve
 * published-value identity independently from rendered names and values.
 */
export interface EquationPayload {
	version: 1;
	segments: EquationSegment[];
}

/** Create an empty, editable equation payload. */
export function emptyEquation(): EquationPayload {
	return { version: 1, segments: [{ kind: 'latex', latex: '' }] };
}

/**
 * Validate the exact persisted visual-equation contract and its complexity
 * limits without requiring referenced publications to remain available.
 */
export function isEquationPayload(value: unknown): value is EquationPayload {
	if (!value || typeof value !== 'object') return false;
	const payload = value as Record<string, unknown>;
	if (
		Object.keys(payload).length !== 2 ||
		payload.version !== 1 ||
		!Array.isArray(payload.segments) ||
		payload.segments.length === 0 ||
		payload.segments.length > MAX_EQUATION_REFERENCES * 2 + 1
	) {
		return false;
	}
	let latexLength = 0;
	let references = 0;
	for (const segmentValue of payload.segments) {
		if (!segmentValue || typeof segmentValue !== 'object') return false;
		const segment = segmentValue as Record<string, unknown>;
		if (segment.kind === 'latex') {
			if (Object.keys(segment).length !== 2 || typeof segment.latex !== 'string') {
				return false;
			}
			latexLength += segment.latex.length;
			if (latexLength > MAX_EQUATION_LATEX_LENGTH) return false;
			continue;
		}
		if (
			segment.kind !== 'reference' ||
			Object.keys(segment).length !== 3 ||
			typeof segment.nodeId !== 'string' ||
			segment.nodeId.length === 0 ||
			segment.nodeId.length > 256 ||
			!segment.fallback ||
			typeof segment.fallback !== 'object'
		) {
			return false;
		}
		const fallback = segment.fallback as Record<string, unknown>;
		const fallbackKeys = Object.keys(fallback);
		if (
			fallbackKeys.length < 1 ||
			fallbackKeys.length > 3 ||
			fallbackKeys.some((key) => !['name', 'sheetId', 'cell'].includes(key)) ||
			typeof fallback.name !== 'string' ||
			fallback.name.length === 0 ||
			fallback.name.length > 256 ||
			(fallback.sheetId !== undefined &&
				(typeof fallback.sheetId !== 'string' || fallback.sheetId.length > 256)) ||
			(fallback.cell !== undefined &&
				(typeof fallback.cell !== 'string' || fallback.cell.length > 64))
		) {
			return false;
		}
		references += 1;
		if (references > MAX_EQUATION_REFERENCES) return false;
	}
	return true;
}

/**
 * Normalize persisted equation data into the current structured contract.
 *
 * Legacy static equations retain their TeX. Legacy bound equations become one
 * stable reference using the current published name when it is available.
 * Invalid values return null instead of silently becoming authored text.
 */
export function normalizeEquationPayload(
	value: unknown,
	resolveName?: (nodeId: NodeId) => string | undefined
): EquationPayload | null {
	if (isEquationPayload(value)) return structuredClone(value);
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const legacy = value as Record<string, unknown>;
	if (
		legacy.mode === 'static' &&
		Object.keys(legacy).length === 2 &&
		typeof legacy.tex === 'string' &&
		legacy.tex.length <= MAX_EQUATION_LATEX_LENGTH
	) {
		return { version: 1, segments: [{ kind: 'latex', latex: legacy.tex }] };
	}
	if (
		legacy.mode === 'bound' &&
		Object.keys(legacy).length === 3 &&
		typeof legacy.nodeId === 'string' &&
		legacy.nodeId.length > 0 &&
		['symbolic', 'substituted', 'result', 'steps'].includes(String(legacy.display))
	) {
		return {
			version: 1,
			segments: [
				{
					kind: 'reference',
					nodeId: legacy.nodeId,
					fallback: { name: resolveName?.(legacy.nodeId) ?? legacy.nodeId }
				}
			]
		};
	}
	return null;
}

/** One document block (SCHEMA.md §8). Type-specific payloads are optional. */
export interface Block {
	id: BlockId;
	docId: string;
	type: BlockType;
	/** Layout ONLY (SCHEMA.md §5) — denormalized copy of the blocksOrder index. */
	position: number;
	/** text/heading content (ProseMirror JSON; markdown is an input convention). */
	pm?: unknown;
	/** Image blocks: Convex file storage reference. */
	image?: { storageId: string; alt?: string; caption?: string };
	/** Equation blocks: versioned authored math and stable live-reference segments. */
	equation?: EquationPayload;
}

/** An inline value chip: binds a spot in prose to a graph node (SCHEMA.md §8). */
export interface ChipBinding {
	id: string;
	blockId: BlockId;
	nodeId: NodeId;
	format?: { digits?: number; unit?: string };
}
