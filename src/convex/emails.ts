import { Resend, vOnEmailEventArgs } from '@convex-dev/resend';
import { components, internal } from './_generated/api';
import { internalMutation } from './_generated/server';

/**
 * Shared Resend client for the whole app. Every email OctoMeta sends goes
 * through this instance so queueing, batching, retries, and idempotency are
 * handled in one place.
 *
 * octometa.app is verified in Resend, so testMode is off: real addresses
 * can be enqueued.
 */
export const resend: Resend = new Resend(components.resend, {
	testMode: false,
	onEmailEvent: internal.emails.handleEmailEvent
});

/** Sender used for all transactional email. */
export const FROM_ADDRESS = 'OctoMeta <waitlist@octometa.app>';

/** Recipient for internal notifications (new waitlist signups). */
export const NOTIFY_ADDRESS = 'cesare.caoduro@gmail.com';

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
