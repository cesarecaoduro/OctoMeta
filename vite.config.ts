import adapter from '@sveltejs/adapter-vercel';
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

			adapter: adapter(),
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					// Univer's icon font is embedded in its pinned core stylesheet.
					// Keep data: limited to fonts; application fonts remain self-hosted.
					'font-src': ['self', 'data:'],
					'img-src': ['self', 'data:', 'blob:', 'https://*.convex.cloud'],
					'connect-src': [
						'self',
						'https://*.convex.cloud',
						'wss://*.convex.cloud',
						'https://*.convex.site'
					],
					'worker-src': ['self', 'blob:'],
					'object-src': ['none'],
					'base-uri': ['none'],
					'frame-ancestors': ['none'],
					'form-action': ['self']
				}
			}
		})
	],

	test: {
		projects: [
			{
				// Workspace orchestration is pure TypeScript over injected graph,
				// projection, and persistence ports; browser wiring stays in Playwright.
				test: {
					name: 'workspace',
					include: ['src/lib/workspace/**/*.test.ts'],
					environment: 'node'
				}
			},
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
				// Shared interface contracts are pure and consumed by every route.
				test: {
					name: 'ui',
					include: ['src/lib/ui/**/*.test.ts'],
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
