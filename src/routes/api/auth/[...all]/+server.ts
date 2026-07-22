import { createSvelteKitHandler } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import type { RequestHandler } from './$types';

const authHandlers = createSvelteKitHandler();

/**
 * A navigation can cancel Better Auth's upstream Convex request after the
 * browser has already left the page. Treat that client cancellation as a
 * closed request instead of surfacing a misleading server error.
 */
const ignoreClientAbort =
	(handler: RequestHandler): RequestHandler =>
	async (event) => {
		try {
			return await handler(event);
		} catch (cause) {
			if (cause instanceof Error && cause.name === 'AbortError') {
				return new Response(null, { status: 499 });
			}
			throw cause;
		}
	};

export const GET = ignoreClientAbort(authHandlers.GET);
export const POST = ignoreClientAbort(authHandlers.POST);
