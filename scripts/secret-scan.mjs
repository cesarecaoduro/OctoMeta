import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const candidates = execFileSync(
	'git',
	['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
	{ encoding: 'utf8' }
)
	.split('\0')
	.filter(Boolean)
	.filter((path) => !path.endsWith('pnpm-lock.yaml'));

const signatures = [
	['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
	['GitHub token', /\bgh[opsu]_[A-Za-z0-9]{36,}\b/],
	['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
	['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
	['Resend API key', /\bre_[A-Za-z0-9]{24,}\b/],
	['Stripe live key', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/],
	['Vercel token assignment', /\bVERCEL_TOKEN\s*=\s*["']?[A-Za-z0-9_-]{20,}/],
	['Convex deploy key assignment', /\bCONVEX_DEPLOY_KEY\s*=\s*["']?\S{20,}/]
];

const findings = [];
for (const path of candidates) {
	let text;
	try {
		text = readFileSync(path, 'utf8');
	} catch {
		continue;
	}
	for (const [label, pattern] of signatures) {
		const match = pattern.exec(text);
		if (match) {
			const line = text.slice(0, match.index).split('\n').length;
			findings.push(`${path}:${line} ${label}`);
		}
	}
}

if (findings.length > 0) {
	console.error(`Potential committed secrets found:\n${findings.join('\n')}`);
	process.exit(1);
}

console.log(`Secret scan passed (${candidates.length} tracked or untracked files).`);
