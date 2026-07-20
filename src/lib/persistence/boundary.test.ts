import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * IMPLEMENTATION_PLAN.md §11 rule 2, enforced by CI instead of review
 * vigilance: `convex` and `convex-svelte` may be imported ONLY under
 * src/lib/persistence/ and src/convex/ — no UI component talks to the backend
 * directly. This is the grep from the V1-4-1 acceptance criteria, as a test.
 */

const SRC = resolve(import.meta.dirname, '../../');
const ALLOWED_DIRS = [resolve(SRC, 'convex'), resolve(SRC, 'lib/persistence')];
const SCANNED_EXTENSIONS = ['.ts', '.js', '.svelte'];

function listSourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (ALLOWED_DIRS.some((allowed) => path === allowed)) continue;
		if (statSync(path).isDirectory()) {
			out.push(...listSourceFiles(path));
		} else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
			out.push(path);
		}
	}
	return out;
}

/** Every import specifier in a file: static, side-effect, and dynamic imports. */
function importSpecifiers(source: string): string[] {
	const patterns = [
		/from\s+['"]([^'"]+)['"]/g, // import … from '…' / export … from '…'
		/^\s*import\s+['"]([^'"]+)['"]/gm, // side-effect import '…'
		/import\s*\(\s*['"]([^'"]+)['"]/g // dynamic import('…')
	];
	return patterns.flatMap((re) => [...source.matchAll(re)].map((m) => m[1]));
}

/** True when a specifier reaches convex, convex-svelte, or src/convex. */
function violates(file: string, spec: string): boolean {
	if (spec === 'convex' || spec.startsWith('convex/')) return true;
	if (spec === 'convex-svelte' || spec.startsWith('convex-svelte/')) return true;
	// Relative or $lib-aliased paths that resolve into src/convex.
	const base = spec.startsWith('$lib')
		? spec.replace('$lib', resolve(SRC, 'lib'))
		: spec.startsWith('.')
			? resolve(dirname(file), spec)
			: null;
	if (base === null) return false;
	const normalized = resolve(base);
	return (
		normalized === resolve(SRC, 'convex') || normalized.startsWith(resolve(SRC, 'convex') + sep)
	);
}

describe('import boundary (IMPLEMENTATION_PLAN.md §11 rule 2)', () => {
	const files = listSourceFiles(SRC);

	it('scans a meaningful portion of the tree', () => {
		// Guard against the walker silently scanning nothing.
		expect(files.length).toBeGreaterThan(10);
		expect(files.some((f) => f.endsWith('.svelte'))).toBe(true);
	});

	it('finds zero convex imports outside src/lib/persistence/ and src/convex/', () => {
		const offences: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			for (const spec of importSpecifiers(source)) {
				if (violates(file, spec)) offences.push(`${file} imports "${spec}"`);
			}
		}
		expect(offences).toEqual([]);
	});
});
