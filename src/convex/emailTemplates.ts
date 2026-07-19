/**
 * Markup for transactional email, kept separate from waitlist.ts so the
 * mutation logic isn't crowded by HTML. Tokens (colors, type) are inlined
 * as literal values, mirroring DESIGN.md §3, since email clients don't
 * support CSS custom properties.
 */

const INK = '#0B0B0C';
const GREY_1 = '#55555A';
const GREY_2 = '#9A9AA0';
const GREY_3 = '#E4E4E1';
const GREY_4 = '#F1F1EF';
const PAPER = '#FAFAF9';
const SURFACE = '#FFFFFF';
const ACCENT = '#0B5FFF';

const FONT_DISPLAY = "'Inter Tight',Helvetica,Arial,sans-serif";
const FONT_BODY = "Inter,Helvetica,Arial,sans-serif";
const FONT_MONO = "'JetBrains Mono',SFMono-Regular,Consolas,monospace";

// Same construction as static/favicon.svg and the compact Logo.svelte glyph
// (the mark shown in the NavBar and footer below 24px), with static colors
// in place of currentColor/var(--accent) for email-client compatibility.
const MARK_SVG = `<svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="OctoMeta">
<g stroke="${INK}" stroke-width="1.8" stroke-linecap="round">
<path d="M 13.05 10.85 C 9.09 14.67, 6.5 18.5, 6.5 23.5"/>
<path d="M 16.00 12.10 C 16.00 17.60, 16 22, 16 27"/>
<path d="M 18.95 10.85 C 22.91 14.67, 25.5 18.5, 25.5 23.5"/>
</g>
<circle cx="16" cy="8" r="4.6" fill="${INK}"/>
<circle cx="6.5" cy="23.5" r="2.1" fill="${INK}"/>
<circle cx="16" cy="27" r="2.1" fill="${INK}"/>
<circle cx="25.5" cy="23.5" r="2.1" fill="${ACCENT}"/>
</svg>`;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Waitlist confirmation email, HTML variant. Table-based layout for email
 * client compatibility, carrying the same mark, palette, and type used
 * across the marketing site so the email reads as the same product.
 */
export function waitlistConfirmationHtml(name?: string): string {
	const greeting = name ? `Hi ${escapeHtml(name.trim())},` : 'Hi,';
	return `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${SURFACE};border:1px solid ${GREY_3};border-radius:12px;">
<tr><td style="padding:28px 40px;border-bottom:1px solid ${GREY_3};">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;">${MARK_SVG}</td>
<td style="vertical-align:middle;padding-left:9px;font-family:${FONT_DISPLAY};font-weight:600;font-size:17px;letter-spacing:-0.02em;color:${INK};">OctoMeta</td>
</tr></table>
</td></tr>
<tr><td style="padding:40px 40px 32px;">
<div style="font-family:${FONT_MONO};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${GREY_2};margin:0 0 14px;">Early access</div>
<h1 style="margin:0 0 18px;font-family:${FONT_DISPLAY};font-weight:600;font-size:26px;line-height:1.25;letter-spacing:-0.02em;color:${INK};">You're on the list.</h1>
<p style="margin:0 0 4px;font-family:${FONT_BODY};font-size:16px;line-height:1.6;color:${GREY_1};">${greeting}</p>
<p style="margin:0 0 24px;font-family:${FONT_BODY};font-size:16px;line-height:1.6;color:${GREY_1};">You're on the OctoMeta waitlist. A new node just entered the graph.</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 28px;">
<tr><td style="padding:0 0 10px;font-family:${FONT_BODY};font-size:15px;line-height:1.5;color:${GREY_1};">
<span style="color:${ACCENT};">&#8226;</span>&nbsp; Testing invites roll out in cohorts, prioritised by role and use case.
</td></tr>
<tr><td style="font-family:${FONT_BODY};font-size:15px;line-height:1.5;color:${GREY_1};">
<span style="color:${ACCENT};">&#8226;</span>&nbsp; One email when your invite is ready. Nothing else, no marketing lists.
</td></tr>
</table>
<p style="margin:0;font-family:${FONT_BODY};font-size:15px;color:${GREY_2};">&mdash; The OctoMeta team</p>
</td></tr>
<tr><td style="padding:18px 40px;border-top:1px solid ${GREY_3};background:${GREY_4};border-radius:0 0 12px 12px;">
<p style="margin:0;font-family:${FONT_MONO};font-size:11px;color:${GREY_2};">OctoMeta &middot; The living engineering document</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Waitlist confirmation email, plain-text fallback for clients that skip HTML. */
export function waitlistConfirmationText(name?: string): string {
	const greeting = name ? `Hi ${name.trim()},` : 'Hi,';
	return `${greeting}

You're on the OctoMeta waitlist. A new node just entered the graph.

- Testing invites roll out in cohorts, prioritised by role and use case.
- One email when your invite is ready. Nothing else, no marketing lists.

— The OctoMeta team
OctoMeta · The living engineering document`;
}

/** Fields captured on the waitlist form, forwarded to the internal notification email. */
export interface WaitlistSignupDetails {
	email: string;
	name?: string;
	role?: string;
	firm?: string;
	tool?: string;
	source?: string;
}

function notificationRows(details: WaitlistSignupDetails): Array<[string, string]> {
	const rows: Array<[string, string]> = [['Email', details.email]];
	if (details.name) rows.push(['Name', details.name]);
	if (details.role) rows.push(['Role', details.role]);
	if (details.firm) rows.push(['Firm size', details.firm]);
	if (details.tool) rows.push(['Today uses', details.tool]);
	rows.push(['Source', details.source ?? 'landing']);
	return rows;
}

/**
 * Internal notification sent to NOTIFY_ADDRESS whenever a new address joins
 * the waitlist, so signups don't require checking the Convex dashboard.
 */
export function waitlistNotificationHtml(details: WaitlistSignupDetails): string {
	const rowsHtml = notificationRows(details)
		.map(
			([label, value]) => `
<tr>
<td style="padding:10px 0;border-top:1px solid ${GREY_3};font-family:${FONT_MONO};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${GREY_2};width:110px;vertical-align:top;">${escapeHtml(label)}</td>
<td style="padding:10px 0;border-top:1px solid ${GREY_3};font-family:${FONT_BODY};font-size:15px;color:${INK};vertical-align:top;">${escapeHtml(value)}</td>
</tr>`
		)
		.join('');

	return `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${SURFACE};border:1px solid ${GREY_3};border-radius:12px;">
<tr><td style="padding:28px 40px;border-bottom:1px solid ${GREY_3};">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;">${MARK_SVG}</td>
<td style="vertical-align:middle;padding-left:9px;font-family:${FONT_DISPLAY};font-weight:600;font-size:17px;letter-spacing:-0.02em;color:${INK};">OctoMeta</td>
</tr></table>
</td></tr>
<tr><td style="padding:32px 40px 40px;">
<div style="font-family:${FONT_MONO};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};margin:0 0 14px;">New signup</div>
<h1 style="margin:0 0 20px;font-family:${FONT_DISPLAY};font-weight:600;font-size:22px;line-height:1.25;letter-spacing:-0.02em;color:${INK};">A new node entered the graph.</h1>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rowsHtml}</table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Internal notification email, plain-text fallback. */
export function waitlistNotificationText(details: WaitlistSignupDetails): string {
	const lines = notificationRows(details).map(([label, value]) => `${label}: ${value}`);
	return `New OctoMeta waitlist signup

${lines.join('\n')}`;
}
