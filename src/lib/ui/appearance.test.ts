import { describe, expect, it } from 'vitest';
import {
	APPEARANCE_STORAGE_KEY,
	normalizeAppearance,
	resolveAppearance
} from './appearance';

describe('appearance preference', () => {
	it('resolves system, light, and dark without mechanically changing explicit choices', () => {
		expect(resolveAppearance('system', false)).toBe('light');
		expect(resolveAppearance('system', true)).toBe('dark');
		expect(resolveAppearance('light', true)).toBe('light');
		expect(resolveAppearance('dark', false)).toBe('dark');
	});

	it('accepts only supported persisted values', () => {
		expect(normalizeAppearance('system')).toBe('system');
		expect(normalizeAppearance('light')).toBe('light');
		expect(normalizeAppearance('dark')).toBe('dark');
		expect(normalizeAppearance('sepia')).toBe('system');
		expect(normalizeAppearance(null)).toBe('system');
		expect(APPEARANCE_STORAGE_KEY).toBe('octometa:appearance');
	});
});
