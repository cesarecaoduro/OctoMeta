/**
 * Svelte-context entry points for the persistence layer. These are the only
 * helpers UI components use — no component imports `convex`/`convex-svelte`
 * directly (IMPLEMENTATION_PLAN.md §11 rule 2, enforced by boundary.test.ts).
 * Both must be called during component initialization (they use Svelte
 * context under the hood).
 */

import { setupConvex, useConvexClient } from 'convex-svelte';
import { api } from '../../convex/_generated/api';
import type { Persistence } from './client';
import { createPersistence } from './client';

/**
 * Register the backend client in Svelte context. Call once, from the root
 * layout, with `PUBLIC_CONVEX_URL`.
 */
export function setupPersistence(url: string): void {
	setupConvex(url);
}

/** Get the document persistence facade from context (root layout must have called `setupPersistence`). */
export function usePersistence(): Persistence {
	return createPersistence(useConvexClient());
}

/** Waitlist signup fields (marketing site). */
export interface WaitlistJoinArgs {
	email: string;
	name?: string;
	role?: string;
	firm?: string;
	tool?: string;
	source?: string;
}

/**
 * Typed waitlist accessor for the marketing site. `join` is idempotent on
 * email and queues the confirmation email server-side.
 */
export function useWaitlist(): { join(args: WaitlistJoinArgs): Promise<{ id: string }> } {
	const client = useConvexClient();
	return {
		join: (args) => client.mutation(api.waitlist.join, args)
	};
}
