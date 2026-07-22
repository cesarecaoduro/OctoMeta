/**
 * Public surface of the persistence layer. UI code imports from here (or the
 * sibling modules) — never from `convex`, `convex-svelte`, or
 * `src/convex/_generated` directly (IMPLEMENTATION_PLAN.md §11 rule 2,
 * enforced by boundary.test.ts).
 */

export * from './codec';
export * from './serialize';
export * from './activity';
export * from './client';
export * from './saver';
export * from './svelte';
