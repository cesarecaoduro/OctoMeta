/** Content-driven workbench modes defined by DESIGN.md §3.2. */
export type AdaptiveMode = 'compact' | 'regular' | 'expanded';

/**
 * Shared mode transitions. These are content viability thresholds, not device
 * breakpoints: compact supports one 320px workspace, regular supports a
 * comfortable document, and expanded supports document plus workbook.
 */
export const ADAPTIVE_THRESHOLDS = {
	regular: 680,
	expanded: 1080
} as const;

/** Select the workbench mode for the width actually available to its container. */
export function adaptiveModeForWidth(width: number): AdaptiveMode {
	if (width >= ADAPTIVE_THRESHOLDS.expanded) return 'expanded';
	if (width >= ADAPTIVE_THRESHOLDS.regular) return 'regular';
	return 'compact';
}
