import type { Handle } from '@sveltejs/kit';
import { getToken } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { withServerConvexToken } from '$lib/persistence/server';

/** Make the request's Better Auth JWT available to server-side Convex calls. */
export const handle: Handle = async ({ event, resolve }) => {
	const token = getToken(event.cookies);
	event.locals.token = token;
	return withServerConvexToken(token, async () => {
		// Proxy responses can expose an immutable Fetch Headers guard. Re-wrap
		// the response so application security headers can be applied uniformly.
		const resolved = await resolve(event);
		const response = new Response(resolved.body, resolved);
		response.headers.set('X-Content-Type-Options', 'nosniff');
		response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
		response.headers.set(
			'Permissions-Policy',
			'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()'
		);
		response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
		return response;
	});
};
