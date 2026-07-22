import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { resend } from './emails';
import { authComponent, createAuth } from './auth';

const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

// Resend delivery-event webhook. Point the webhook in the Resend dashboard at
// https://<deployment>.convex.site/resend-webhook (email.* events) and set
// RESEND_WEBHOOK_SECRET in the Convex deployment.
http.route({
	path: '/resend-webhook',
	method: 'POST',
	handler: httpAction(async (ctx, req) => {
		return await resend.handleResendEventWebhook(ctx, req);
	})
});

export default http;
