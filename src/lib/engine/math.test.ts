import { describe, expect, it } from 'vitest';
import { DocumentGraph, parseFormula } from '.';
import { equationToTex, escapeTexText, formulaToTex } from './math';

function ast(source: string) {
	const parsed = parseFormula(source, { sheetId: 'sheet-1' });
	if (!parsed.ok) throw new Error(parsed.message);
	return parsed.ast;
}

describe('formulaToTex', () => {
	it('preserves precedence and renders powers, fractions, and functions', () => {
		expect(formulaToTex(ast('=(A1 + 2) * B1^2 / 8'))).toBe(
			'\\frac{\\left(\\mathrm{A1} + 2\\right) \\cdot {\\mathrm{B1}}^{2}}{8}'
		);
		expect(formulaToTex(ast('=SQRT(A1)'))).toContain('\\operatorname{SQRT}');
	});

	it('escapes untrusted text commands', () => {
		expect(escapeTexText('<x>{a}_b')).toContain('\\{a\\}\\_b');
	});
});

describe('equationToTex', () => {
	it('round-trips authored source exactly and retains missing-reference intent', () => {
		const graph = new DocumentGraph();
		expect(
			equationToTex(
				{ version: 1, segments: [{ kind: 'latex', latex: String.raw`E = mc^2` }] },
				graph
			)
		).toBe(String.raw`E = mc^2`);
		expect(
			equationToTex(
				{
					version: 1,
					segments: [
						{
							kind: 'reference',
							nodeId: 'missing',
							fallback: { name: 'beam.capacity' }
						}
					]
				},
				graph
			)
		).toBe('\\text{Missing: beam.capacity}');
	});
});
