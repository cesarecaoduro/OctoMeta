import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { betterAuth } from 'better-auth/minimal';
import { magicLink } from 'better-auth/plugins';
import type { DataModel } from './_generated/dataModel';
import { components } from './_generated/api';
import authConfig from './auth.config';
import { FROM_ADDRESS, resend } from './emails';
import { magicLinkHtml, magicLinkText } from './emailTemplates';

declare const process: { env: Record<string, string | undefined> };

/** Better Auth component client shared by auth routes and ownership helpers. */
export const authComponent = createClient<DataModel>(components.betterAuth);

/** Build the Better Auth server for the current Convex request context. */
export const createAuth = (ctx: GenericCtx<DataModel>) => {
	const trustedOrigins = [
		process.env.SITE_URL,
		...(process.env.AUTH_TRUSTED_ORIGINS ?? '').split(',')
	]
		.map((origin) => origin?.trim())
		.filter((origin): origin is string => Boolean(origin));
	const google =
		process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
			? {
					google: {
						clientId: process.env.GOOGLE_CLIENT_ID,
						clientSecret: process.env.GOOGLE_CLIENT_SECRET
					}
				}
			: undefined;
	return betterAuth({
		baseURL: process.env.SITE_URL,
		trustedOrigins,
		secret: process.env.BETTER_AUTH_SECRET,
		database: authComponent.adapter(ctx),
		emailAndPassword: { enabled: true, requireEmailVerification: false },
		...(google && { socialProviders: google }),
		plugins: [
			convex({ authConfig }),
			magicLink({
				sendMagicLink: async ({ email, url }) => {
					await resend.sendEmail(ctx as Parameters<typeof resend.sendEmail>[0], {
						from: FROM_ADDRESS,
						to: email,
						subject: 'Sign in to OctoMeta',
						html: magicLinkHtml(url),
						text: magicLinkText(url)
					});
				}
			})
		]
	});
};

export const { getAuthUser } = authComponent.clientApi();
