import { cronJobs } from 'convex/server';
import { components, internal } from './_generated/api';
import { internalMutation } from './_generated/server';

const crons = cronJobs();

crons.interval('Remove old emails from the resend component', { hours: 1 }, internal.crons.cleanupResend);
crons.interval('Purge expired document trash', { hours: 6 }, internal.documents.purgeExpired);
crons.interval('Retry and clean document assets', { hours: 1 }, internal.files.cleanupAssets);

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Clears finalized emails from the Resend component on its recommended schedule. */
export const cleanupResend = internalMutation({
	args: {},
	handler: async (ctx) => {
		await ctx.scheduler.runAfter(0, components.resend.lib.cleanupOldEmails, {
			olderThan: ONE_WEEK_MS
		});
		await ctx.scheduler.runAfter(0, components.resend.lib.cleanupAbandonedEmails, {
			// Abandoned emails generally indicate a bug, so keep them longer.
			olderThan: 4 * ONE_WEEK_MS
		});
	}
});

export default crons;
