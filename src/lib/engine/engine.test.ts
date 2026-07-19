import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * V1-1-1 acceptance: the engine is pure TypeScript with zero imports from
 * outside `src/lib/engine/` (IMPLEMENTATION_PLAN.md §4). Tests are exempt —
 * they import vitest and node builtins — but production modules may only
 * import relatively, within this directory.
 */
describe('engine boundary', () => {
	const dir = import.meta.dirname;
	const modules = readdirSync(dir).filter(
		(f) => f.endsWith('.ts') && !f.endsWith('.test.ts')
	);

	it('has the V1-1 modules', () => {
		expect(modules).toEqual(
			expect.arrayContaining(['types.ts', 'node.ts', 'units.ts', 'formula.ts', 'registry.ts'])
		);
	});

	it.each(modules)('%s imports only from within engine/', (file) => {
		const source = readFileSync(join(dir, file), 'utf8');
		const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
		for (const spec of specifiers) {
			expect(spec, `${file} imports "${spec}"`).toMatch(/^\.\/[a-z]+$/);
		}
	});
});
