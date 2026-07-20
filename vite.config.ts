import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
			// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		})
	],

	test: {
		projects: [
			{
				// Engine tests are pure TypeScript with no DOM; adapters get their own path in V1-3.
				test: {
					name: 'engine',
					include: ['src/lib/engine/**/*.test.ts'],
					environment: 'node'
				}
			},
			{
				// Univer adapter tests (V1-3-1): pure mapping + graph-sync logic. The
				// Univer runtime itself is exercised by Playwright, so plain node here.
				test: {
					name: 'adapters',
					include: ['src/lib/adapters/**/*.test.ts'],
					environment: 'node'
				}
			},
			{
				// Persistence unit tests (codec, serializer, saver, import boundary) — plain node.
				test: {
					name: 'persistence',
					include: ['src/lib/persistence/**/*.test.ts'],
					exclude: ['src/lib/persistence/**/*.convex.test.ts'],
					environment: 'node'
				}
			},
			{
				// Editor tests (V1-5-1): pure-JSON block mapping + blockOp sync over a
				// real DocumentGraph — no DOM, so plain node.
				test: {
					name: 'editor',
					include: ['src/lib/editor/**/*.test.ts'],
					environment: 'node'
				}
			},
			{
				// Convex function tests via convex-test — edge-runtime mirrors the
				// Convex JS runtime (convex-test requirement); includes the V1-4-1
				// reproducibility CI gate (IMPLEMENTATION_PLAN.md §11 rule 6).
				test: {
					name: 'convex',
					include: ['src/lib/persistence/**/*.convex.test.ts'],
					environment: 'edge-runtime',
					server: { deps: { inline: ['convex-test'] } }
				}
			}
		]
	}
});
