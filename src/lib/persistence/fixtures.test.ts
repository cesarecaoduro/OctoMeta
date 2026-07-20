import { describe, expect, it } from 'vitest';
import { format, resolvePublishedTarget } from '../engine';
import { buildSteelDemoFixture } from './fixtures';

describe('steel release fixture', () => {
	it('builds the locked report values and three-tab workbook', () => {
		const { graph, title } = buildSteelDemoFixture();

		expect(title).toBe('Steel beam check');
		expect(graph.workbook.sheets.map(({ name }) => name)).toEqual([
			'Input',
			'Calculation',
			'Output'
		]);

		const areaAlias = graph.resolveRef({ name: 'section.A' });
		const rtAlias = graph.resolveRef({ name: 'section.rt' });
		expect(areaAlias).toBeDefined();
		expect(rtAlias).toBeDefined();
		expect(format(graph.nodes.get(areaAlias!)!.value, { digits: 2, unit: 'in²' })).toBe(
			'38.00 in²'
		);
		expect(format(graph.nodes.get(rtAlias!)!.value, { digits: 3, unit: 'in' })).toBe(
			'2.115 in'
		);

		const areaTarget = resolvePublishedTarget(graph, areaAlias!);
		expect(areaTarget?.targetNode.cellRef).toEqual({
			sheetId: 'sheet-steel-output',
			a1: 'A1'
		});
		expect(graph.blocks.get('block-steel-area-equation')?.type).toBe('equation');
		expect(graph.chips.size).toBe(7);
	});
});
