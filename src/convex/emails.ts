import { Resend, vOnEmailEventArgs } from '@convex-dev/resend';
import { components, internal } from './_generated/api';
import { internalMutation } from './_generated/server';

/**
 * Shared Resend client for the whole app. Every email OctoMeta sends goes
 * through this instance so queueing, batching, retries, and idempotency are
 * handled in one place.
 *
 * testMode is left at its default (true) until a sending domain is verified
 * in Resend: only `*@resend.dev` test addresses can be enqueued. Flip it to
 * false once the domain is live and RESEND_API_KEY is set in the deployment.
 */
export const resend: Resend = new Resend(components.resend, {
	onEmailEvent: internal.emails.handleEmailEvent
});

/** Sender used for all transactional email until the real domain is verified. */
export const FROM_ADDRESS = 'OctoMeta <onboarding@resend.dev>';

/**
 * Webhook-driven status updates (delivered, bounced, complained, …).
 * Mirrors the latest event onto the matching waitlist row so the signup
 * record always reflects what happened to its confirmation email.
 */
export const handleEmailEvent = internalMutation({
	args: vOnEmailEventArgs,
	handler: async (ctx, { id, event }) => {
		const signup = await ctx.db
			.query('waitlist')
			.withIndex('by_confirmation_email_id', (q) => q.eq('confirmationEmailId', id))
			.unique();
		if (signup) {
			await ctx.db.patch(signup._id, { confirmationStatus: event.type });
		}
	}
});
