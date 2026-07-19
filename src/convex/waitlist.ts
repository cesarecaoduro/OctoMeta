import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { FROM_ADDRESS, resend } from './emails';

/**
 * Join the early-access waitlist. Idempotent on email: signing up twice
 * updates the existing row instead of duplicating it. A confirmation email
 * is queued through the Resend component; if it cannot be enqueued (e.g.
 * test mode with a real address, missing API key) the signup is still saved.
 */
export const join = mutation({
	args: {
		email: v.string(),
		name: v.optional(v.string()),
		role: v.optional(v.string()),
		firm: v.optional(v.string()),
		tool: v.optional(v.string()),
		source: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const email = args.email.trim().toLowerCase();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			throw new Error('Invalid email address');
		}

		const fields = {
			name: args.name?.trim() || undefined,
			role: args.role || undefined,
			firm: args.firm || undefined,
			tool: args.tool || undefined,
			source: args.source ?? 'landing'
		};

		const existing = await ctx.db
			.query('waitlist')
			.withIndex('by_email', (q) => q.eq('email', email))
			.unique();

		const id = existing
			? (await ctx.db.patch(existing._id, fields), existing._id)
			: await ctx.db.insert('waitlist', { email, ...fields });

		// Only send the confirmation once per address.
		if (!existing?.confirmationEmailId) {
			try {
				const emailId = await resend.sendEmail(ctx, {
					from: FROM_ADDRESS,
					to: email,
					subject: "You're on the OctoMeta waitlist",
					html: confirmationHtml(fields.name),
					text: confirmationText(fields.name)
				});
				await ctx.db.patch(id, { confirmationEmailId: emailId, confirmationStatus: 'queued' });
			} catch {
				// Test mode or missing API key: the signup itself must never fail.
			}
		}

		return { id };
	}
});

function confirmationHtml(name?: string): string {
	const greeting = name ? `Hi ${name},` : 'Hi,';
	return `
<p>${greeting}</p>
<p>You're on the OctoMeta waitlist. A new node just entered the graph.</p>
<p>Testing invites roll out in cohorts, prioritised by role and use case.
We'll email you once when your invite is ready. Nothing else.</p>
<p>— The OctoMeta team</p>`.trim();
}

function confirmationText(name?: string): string {
	const greeting = name ? `Hi ${name},` : 'Hi,';
	return `${greeting}

You're on the OctoMeta waitlist. A new node just entered the graph.

Testing invites roll out in cohorts, prioritised by role and use case.
We'll email you once when your invite is ready. Nothing else.

— The OctoMeta team`;
}
