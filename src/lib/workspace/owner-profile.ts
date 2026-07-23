const OWNER_ACCOUNT_KEY = 'octometa:last-owner-account';

/** Remember the authenticated owner whose device-local namespace may reopen offline. */
export function rememberOwnerAccount(accountId: string): void {
	if (typeof localStorage === 'undefined' || accountId.length === 0) return;
	localStorage.setItem(OWNER_ACCOUNT_KEY, accountId);
}

/** Return the last authenticated owner recorded by this browser workspace. */
export function rememberedOwnerAccount(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(OWNER_ACCOUNT_KEY);
}

/** Resolve a session identity, optionally falling back to the device-trusted offline profile. */
export function resolveOwnerAccount(
	sessionAccountId?: string | null,
	allowRemembered = true
): string | null {
	if (sessionAccountId) {
		rememberOwnerAccount(sessionAccountId);
		return sessionAccountId;
	}
	return allowRemembered ? rememberedOwnerAccount() : null;
}

/** Remove the device-trusted profile when the user explicitly signs out. */
export function forgetOwnerAccount(): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(OWNER_ACCOUNT_KEY);
}
