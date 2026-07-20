/**
 * Public surface of the editor layer (V1-5-1). Routes import from here —
 * `@tiptap/*`/ProseMirror stay inside this directory (IMPLEMENTATION_PLAN.md
 * §11 rule 2).
 */

export * from './blocks';
export * from './sync';
export * from './chips';
export * from './inspector';
export * from './create-editor';
export { EquationBlock, MAX_TEX_LENGTH } from './equation-node';
export { matchChipQuery } from './chip-picker';
export { type InsertableBlockType } from './insert-slots';
export { BlockChrome, blockTypeLabel } from './block-chrome';
