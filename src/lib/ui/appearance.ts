/** User-selectable application appearance. */
export type AppearancePreference = 'system' | 'light' | 'dark';

/** Resolved appearance applied to the document. */
export type ResolvedAppearance = Exclude<AppearancePreference, 'system'>;

/** Stable browser key shared by marketing, authentication, and the app. */
export const APPEARANCE_STORAGE_KEY = 'octometa:appearance';

/** Return a safe appearance value for untrusted persisted input. */
export function normalizeAppearance(value: string | null): AppearancePreference {
	return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

/** Resolve a preference against the current operating-system appearance. */
export function resolveAppearance(
	preference: AppearancePreference,
	systemPrefersDark: boolean
): ResolvedAppearance {
	return preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;
}

/** Apply the semantic appearance attributes consumed by global design tokens. */
export function applyAppearance(
	root: HTMLElement,
	preference: AppearancePreference,
	systemPrefersDark: boolean
): ResolvedAppearance {
	const resolved = resolveAppearance(preference, systemPrefersDark);
	root.dataset.appearancePreference = preference;
	root.dataset.appearance = resolved;
	root.style.colorScheme = resolved;
	return resolved;
}
