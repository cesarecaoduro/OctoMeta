import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	waitlist: defineTable({
		email: v.string(),
		name: v.optional(v.string()),
		role: v.optional(v.string()),
		firm: v.optional(v.string()),
		tool: v.optional(v.string()),
		source: v.string(),
		// EmailId returned by the Resend component for the confirmation email,
		// and the latest delivery status reported by the webhook.
		confirmationEmailId: v.optional(v.string()),
		confirmationStatus: v.optional(v.string())
	})
		.index('by_email', ['email'])
		.index('by_confirmation_email_id', ['confirmationEmailId'])
});
