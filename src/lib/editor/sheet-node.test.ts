import { describe, expect, it } from 'vitest';
import { isUndoRedoChord } from './sheet-node';

/**
 * V1-5-2 — the in-grid undo interception contract: exactly the page's
 * undo/redo chords are captured (and routed to engine history); everything
 * else falls through to Univer.
 */

const chord = (key: string, mods: Partial<KeyboardEvent> = {}) =>
	isUndoRedoChord({ key, metaKey: false, ctrlKey: false, shiftKey: false, ...mods } as KeyboardEvent);

describe('isUndoRedoChord', () => {
	it('Mod-z is undo (meta or ctrl)', () => {
		expect(chord('z', { metaKey: true })).toEqual({ undo: true, redo: false });
		expect(chord('z', { ctrlKey: true })).toEqual({ undo: true, redo: false });
		expect(chord('Z', { metaKey: true })).toEqual({ undo: true, redo: false });
	});

	it('Mod-Shift-z and Ctrl-y are redo', () => {
		expect(chord('z', { metaKey: true, shiftKey: true })).toEqual({ undo: false, redo: true });
		expect(chord('Z', { ctrlKey: true, shiftKey: true })).toEqual({ undo: false, redo: true });
		expect(chord('y', { ctrlKey: true })).toEqual({ undo: false, redo: true });
	});

	it('plain typing and non-chords fall through to the grid', () => {
		expect(chord('z')).toEqual({ undo: false, redo: false });
		expect(chord('y', { metaKey: true })).toEqual({ undo: false, redo: false });
		expect(chord('a', { metaKey: true })).toEqual({ undo: false, redo: false });
		expect(chord('Enter')).toEqual({ undo: false, redo: false });
	});
});
