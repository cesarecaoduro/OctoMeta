import { describe, expect, it } from 'vitest';
import { ADAPTIVE_THRESHOLDS, adaptiveModeForWidth } from './adaptive-layout';

describe('adaptive layout', () => {
	it('changes mode on both sides of each content-driven transition', () => {
		expect(adaptiveModeForWidth(320)).toBe('compact');
		expect(adaptiveModeForWidth(ADAPTIVE_THRESHOLDS.regular - 1)).toBe('compact');
		expect(adaptiveModeForWidth(ADAPTIVE_THRESHOLDS.regular)).toBe('regular');
		expect(adaptiveModeForWidth(ADAPTIVE_THRESHOLDS.expanded - 1)).toBe('regular');
		expect(adaptiveModeForWidth(ADAPTIVE_THRESHOLDS.expanded)).toBe('expanded');
	});
});
