import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** Require a server-validated auth cookie before rendering product routes. */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.token) {
		const next = `${url.pathname}${url.search}`;
		redirect(303, `/signin?next=${encodeURIComponent(next)}`);
	}
};
