import { convexClient } from '@convex-dev/better-auth/client/plugins';
import { createAuthClient } from 'better-auth/svelte';
import { magicLinkClient } from 'better-auth/client/plugins';

/** Browser auth client shared by sign-in controls and the Convex token bridge. */
export const authClient = createAuthClient({
	plugins: [convexClient(), magicLinkClient()]
});
