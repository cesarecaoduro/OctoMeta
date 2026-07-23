import type { DocumentGraph } from './graph';
import { resolvePublishedTarget } from './graph';
import type { NodeId, TypedValue } from './types';

/** Searchable read model for one published scalar workbook value. */
export interface PublishedValue {
	id: NodeId;
	name: string;
	label?: string;
	unit?: string;
	description?: string;
	value: TypedValue;
	sheetId: string;
	sheet: string;
	cell: string;
}

/** One current consumer disclosed before a published value is removed. */
export interface PublishedValueUse {
	kind:
		| 'document-reference'
		| 'equation-reference'
		| 'workbook-formula'
		| 'graph-dependent';
	id: string;
	label: string;
}

/**
 * List resolved published values matching a case-insensitive query.
 *
 * Search covers the semantic name, optional metadata, source sheet, and cell.
 * Prefix name matches rank first, followed by semantic-name order.
 */
export function listPublishedValues(
	graph: DocumentGraph,
	query = ''
): PublishedValue[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const values: PublishedValue[] = [];
	for (const node of graph.nodes.values()) {
		if (node.kind !== 'namedOutput' || !node.name) continue;
		const resolved = resolvePublishedTarget(graph, node.id);
		const cellRef = resolved?.targetNode.cellRef;
		if (!resolved || !cellRef) continue;
		const sheet = graph.sheet(cellRef.sheetId);
		if (!sheet) continue;
		const publication = node.publication;
		const value: PublishedValue = {
			id: node.id,
			name: node.name,
			...(publication?.label !== undefined && { label: publication.label }),
			...(publication?.unit !== undefined && { unit: publication.unit }),
			...(publication?.description !== undefined && {
				description: publication.description
			}),
			value: structuredClone(resolved.targetNode.value),
			sheetId: cellRef.sheetId,
			sheet: sheet.name,
			cell: cellRef.a1
		};
		const haystack = [
			value.name,
			value.label,
			value.unit,
			value.description,
			value.sheet,
			value.cell
		]
			.filter((part): part is string => part !== undefined)
			.join(' ')
			.toLocaleLowerCase();
		if (!normalizedQuery || haystack.includes(normalizedQuery)) values.push(value);
	}
	return values.sort((left, right) => {
		const leftPrefix = left.name.toLocaleLowerCase().startsWith(normalizedQuery) ? 0 : 1;
		const rightPrefix = right.name.toLocaleLowerCase().startsWith(normalizedQuery) ? 0 : 1;
		return leftPrefix - rightPrefix || left.name.localeCompare(right.name);
	});
}

/**
 * Return every current Document, Equation, and Workbook consumer of a
 * published value. The result is stable and human-readable for removal review.
 */
export function publishedValueUses(
	graph: DocumentGraph,
	publicationId: NodeId
): PublishedValueUse[] {
	const uses: PublishedValueUse[] = [];
	for (const chip of graph.chips.values()) {
		if (chip.nodeId !== publicationId) continue;
		uses.push({
			kind: 'document-reference',
			id: chip.id,
			label: `Document block ${chip.blockId}`
		});
	}
	for (const block of graph.blocks.values()) {
		if (block.equation?.mode !== 'bound' || block.equation.nodeId !== publicationId) continue;
		uses.push({
			kind: 'equation-reference',
			id: block.id,
			label: `Equation block ${block.id}`
		});
	}
	for (const dependentId of graph.dependentsOf(publicationId)) {
		const dependent = graph.nodes.get(dependentId);
		if (!dependent) continue;
		if (!dependent.cellRef) {
			uses.push({
				kind: 'graph-dependent',
				id: dependent.id,
				label: dependent.blockId
					? `Graph expression in block ${dependent.blockId}`
					: `Graph expression ${dependent.id}`
			});
			continue;
		}
		const sheet = graph.sheet(dependent.cellRef.sheetId);
		uses.push({
			kind: 'workbook-formula',
			id: dependent.id,
			label: `${sheet?.name ?? dependent.cellRef.sheetId} · ${dependent.cellRef.a1}`
		});
	}
	const rank: Record<PublishedValueUse['kind'], number> = {
		'document-reference': 0,
		'equation-reference': 1,
		'workbook-formula': 2,
		'graph-dependent': 3
	};
	return uses.sort(
		(left, right) =>
			rank[left.kind] - rank[right.kind] ||
			left.label.localeCompare(right.label) ||
			left.id.localeCompare(right.id)
	);
}
