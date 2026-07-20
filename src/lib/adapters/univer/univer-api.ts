/**
 * V1-3-1 — every Univer API the adapter touches, wrapped once. Univer is
 * pre-1.0 (0.25.1 exact pin) and churns; keeping each call behind a thin named
 * wrapper makes version bumps a one-file change (IMPLEMENTATION_PLAN.md V1-3-1
 * item d). This module is the ONLY place with runtime `@univerjs` imports
 * outside type positions.
 *
 * All runtime imports are dynamic so pages importing this module still SSR
 * cleanly (docs/v1-0-findings.md, proof a); the grid mounts after hydration.
 *
 * Boot-order landmine (docs/v1-0-findings.md, landmine 1): the facade's
 * register-function service exists only once the lifecycle reaches `Steady`,
 * and snapshots referencing custom functions evaluate before registration.
 * `createUniverSheet` therefore calls `setInitialFormulaComputing(NO_CALCULATION)`
 * BEFORE creating the workbook and resolves only after `Steady`; callers then
 * register functions and trigger one explicit recalc (`recalcAllFormulas`).
 */

import type { FUniver, ICellData, IWorkbookData } from '@univerjs/presets';

/** Univer command/mutation ids the adapter listens for (0.25.1). */
const SET_RANGE_VALUES_MUTATION = 'sheet.mutation.set-range-values';
const INSERT_DEFINED_NAME_COMMAND = 'sheet.command.insert-defined-name';
const SET_DEFINED_NAME_COMMAND = 'sheet.command.set-defined-name';
const REMOVE_DEFINED_NAME_COMMAND = 'sheet.command.remove-defined-name';

/** Minimal disposable shape shared by all Univer subscriptions. */
export interface Disposable {
	dispose(): void;
}

/** A live Univer sheet instance (one workbook unit, reached `Steady`). */
export interface UniverSheetHandle {
	/** The Univer facade for this instance. */
	api: FUniver;
	/** Dispose the whole Univer instance (canvases, DI container, workers). */
	dispose(): void;
}

/** Options for `createUniverSheet`. */
export interface CreateUniverSheetOptions {
	/** DOM element the grid mounts into. */
	container: HTMLElement;
	/** Workbook unit id (stable per sheet block). */
	unitId: string;
	/** Display name for a fresh workbook (ignored when a snapshot is given). */
	name?: string;
	/** Snapshot to rehydrate from (`IWorkbookData`), or null for a fresh sheet. */
	snapshot?: IWorkbookData | null;
}

/**
 * Create one Univer instance with the sheets-core preset, initial formula
 * computing OFF (`NO_CALCULATION`, set before workbook creation), and resolve
 * once the lifecycle reaches `Steady` so the formula facade is safe to use.
 */
export async function createUniverSheet(opts: CreateUniverSheetOptions): Promise<UniverSheetHandle> {
	const [{ createUniver, LocaleType, mergeLocales }, presetModule, locale] = await Promise.all([
		import('@univerjs/presets'),
		import('@univerjs/preset-sheets-core'),
		import('@univerjs/preset-sheets-core/locales/en-US'),
		import('@univerjs/preset-sheets-core/lib/index.css')
	]);
	const { UniverSheetsCorePreset, CalculationMode } = presetModule;

	const { univer, univerAPI } = createUniver({
		locale: LocaleType.EN_US,
		locales: { [LocaleType.EN_US]: mergeLocales(locale.default) },
		presets: [UniverSheetsCorePreset({ container: opts.container })]
	});

	// Landmine 1 part one: snapshots must not self-evaluate before our custom
	// functions are registered. Must run before `createWorkbook`.
	univerAPI.getFormula().setInitialFormulaComputing(CalculationMode.NO_CALCULATION);

	univerAPI.createWorkbook(
		opts.snapshot ?? { id: opts.unitId, name: opts.name ?? opts.unitId }
	);

	// Landmine 1 part two: wait for `Steady` before touching the formula facade
	// (earlier access throws a redi DI error).
	await new Promise<void>((resolve) => {
		const disposable = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, (p) => {
			if ((p as { stage: number }).stage === univerAPI.Enum.LifecycleStages.Steady) {
				disposable.dispose();
				resolve();
			}
		});
	});

	return { api: univerAPI, dispose: () => univer.dispose() };
}

// ---------------------------------------------------------------------------
// Formula facade
// ---------------------------------------------------------------------------

/** One function to register into Univer's formula engine. */
export interface SheetFunction {
	name: string;
	description: string;
	/** Args arrive as primitives or 2D arrays (ranges); result must be primitive. */
	fn: (...args: unknown[]) => number | string | boolean;
}

/**
 * Register custom functions through the facade (`getFormula().registerFunction`,
 * the V1-0-3-chosen mechanism). Call only after `Steady`. Registering a name
 * Univer already has overrides its executor — harmless here because Univer's
 * recalc is demoted to display and never computes graph cells.
 */
export function registerSheetFunctions(api: FUniver, fns: SheetFunction[]): Disposable[] {
	const formula = api.getFormula();
	return fns.map((f) =>
		formula.registerFunction(f.name, (...args: unknown[]) => f.fn(...args), f.description)
	);
}

/** Trigger one explicit full recalculation (post-registration, landmine 1). */
export function recalcAllFormulas(api: FUniver): void {
	api.getFormula().executeCalculation();
}

// ---------------------------------------------------------------------------
// Cell IO
// ---------------------------------------------------------------------------

function rangeOf(api: FUniver, a1: string) {
	return api.getActiveWorkbook()?.getActiveSheet()?.getRange(a1) ?? null;
}

/** Read a cell's displayed value. */
export function readCellValue(api: FUniver, a1: string): unknown {
	return rangeOf(api, a1)?.getValue() ?? null;
}

/** Read a cell's raw data (`v`, `f`, ...). */
export function readCellData(api: FUniver, a1: string): ICellData | null {
	return rangeOf(api, a1)?.getCellData() ?? null;
}

/**
 * How a settled display value is styled in the grid (DESIGN.md §3: accent is
 * the "computed value" color; `--error` marks typed graph errors). `null`
 * resets to the plain ink of a typed input.
 */
export type CellDisplayStyle = 'computed' | 'error' | null;

/* Inline hex twins of the CSS tokens — Univer styles cells by value, not var(). */
const STYLE_COLORS: Record<Exclude<CellDisplayStyle, null>, string> = {
	computed: '#6C5CE7', // --accent (graph violet, tokens.css)
	error: '#C42B1C' // --error
};

/**
 * Write a settled display value into a cell, clearing any formula (`f`),
 * shared-formula id (`si`), and rich text (`p`) — Univer's null-clears
 * convention. This is the projection write: the graph computed the value,
 * Univer only displays it. `style` colors the cell so calculated values read
 * as calculated (accent) and errors as errors.
 */
export function writeCellDisplay(
	api: FUniver,
	a1: string,
	value: number | string | null,
	style: CellDisplayStyle = null
): void {
	const s = style === null ? null : { cl: { rgb: STYLE_COLORS[style] } };
	rangeOf(api, a1)?.setValue({ v: value, f: null, si: null, p: null, s } as ICellData);
}

/**
 * Write raw user-style input into a cell (test hooks and programmatic edits):
 * `=...` becomes a formula payload, anything else a plain value. Goes through
 * the same command pipeline as typing, so the adapter's edit listener fires.
 */
export function writeCellInput(api: FUniver, a1: string, input: number | string | boolean): void {
	const range = rangeOf(api, a1);
	if (!range) return;
	if (typeof input === 'string' && input.startsWith('=')) {
		range.setValue({ f: input } as ICellData);
	} else {
		range.setValue(input as number | string);
	}
}

// ---------------------------------------------------------------------------
// Change subscriptions
// ---------------------------------------------------------------------------

/** One changed cell from a set-range-values mutation. */
export interface ChangedCell {
	row: number;
	col: number;
	/** The written cell payload; null means the cell was cleared outright. */
	data: ICellData | null;
}

interface SetRangeValuesParams {
	unitId?: string;
	subUnitId?: string;
	cellValue?: Record<string, Record<string, ICellData | null>>;
}

/**
 * Subscribe to user-driven cell value changes (`sheet.mutation.set-range-values`).
 * Univer-internal writes are filtered out: formula-engine result write-backs
 * (`fromFormula`) and local-only mutations never reach the callback. The
 * adapter's own display writes are its callers' concern (see the `applying`
 * guard in adapter.ts).
 */
export function onCellValuesChanged(
	api: FUniver,
	cb: (cells: ChangedCell[]) => void
): Disposable {
	return api.onCommandExecuted((command, options) => {
		if (command.id !== SET_RANGE_VALUES_MUTATION) return;
		const opts = options as { fromFormula?: boolean; onlyLocal?: boolean } | undefined;
		if (opts?.fromFormula || opts?.onlyLocal) return;
		const params = command.params as SetRangeValuesParams | undefined;
		if (!params?.cellValue) return;
		const cells: ChangedCell[] = [];
		for (const [rowKey, cols] of Object.entries(params.cellValue)) {
			if (!cols) continue;
			for (const [colKey, data] of Object.entries(cols)) {
				cells.push({ row: Number(rowKey), col: Number(colKey), data: data ?? null });
			}
		}
		if (cells.length > 0) cb(cells);
	});
}

/**
 * Subscribe to every workbook MODEL mutation (command ids `sheet.mutation.*`):
 * cell writes, column widths, row heights, styles — anything that changes what
 * a snapshot would serialize. Selection moves and other operations do not
 * fire. V1-5-2 uses this to mark the document dirty so grid chrome persists
 * through the debounced saver.
 */
export function onWorkbookMutated(api: FUniver, cb: () => void): Disposable {
	return api.onCommandExecuted((command) => {
		if (command.id.startsWith('sheet.mutation.')) cb();
	});
}

/** The anchor cell (0-based row/col) of a selection change. */
export interface SelectionAnchor {
	row: number;
	col: number;
}

/**
 * Subscribe to selection changes on the active workbook (facade
 * `onSelectionChange`, wrapping Univer's `selectionMoveEnd$`). Reports the
 * anchor cell of the last range, or null when the selection empties. Read-only
 * — V1-5-5's provenance inspector listens; nothing here writes. Fires for
 * programmatic selections too (Univer seeds A1 during mount): filtering user
 * intent is the caller's concern (see adapter.ts `onSelect`).
 */
export function onSelectionChanged(
	api: FUniver,
	cb: (anchor: SelectionAnchor | null) => void
): Disposable {
	const workbook = api.getActiveWorkbook();
	if (!workbook) return { dispose: () => {} };
	return workbook.onSelectionChange((selections) => {
		const last = selections[selections.length - 1];
		cb(last ? { row: last.startRow, col: last.startColumn } : null);
	});
}

/** A defined-name lifecycle event lifted from Univer's command stream. */
export interface DefinedNameChange {
	type: 'insert' | 'update' | 'remove';
	/** Univer's stable defined-name id (rename-safe key). */
	id: string;
	name: string;
	/** Raw ref string, e.g. `Sheet1!$A$1` (see cell-text `refStringToA1`). */
	ref: string;
}

interface DefinedNameParams {
	id?: string;
	name?: string;
	formulaOrRefString?: string;
}

/**
 * Subscribe to defined-name creation/rename/deletion commands — the Univer
 * side of the named-range lift (SCHEMA.md §8: sheet blocks lift named ranges
 * into NamedOutputNodes).
 */
export function onDefinedNameChanged(
	api: FUniver,
	cb: (change: DefinedNameChange) => void
): Disposable {
	return api.onCommandExecuted((command) => {
		const type =
			command.id === INSERT_DEFINED_NAME_COMMAND
				? ('insert' as const)
				: command.id === SET_DEFINED_NAME_COMMAND
					? ('update' as const)
					: command.id === REMOVE_DEFINED_NAME_COMMAND
						? ('remove' as const)
						: null;
		if (!type) return;
		const params = command.params as DefinedNameParams | undefined;
		if (!params?.id || typeof params.name !== 'string') return;
		cb({ type, id: params.id, name: params.name, ref: params.formulaOrRefString ?? '' });
	});
}

// ---------------------------------------------------------------------------
// Defined names (programmatic entry points; commands flow back through
// `onDefinedNameChanged`, keeping one lift path)
// ---------------------------------------------------------------------------

/** Create a defined name pointing at a cell of the active workbook. */
export function insertSheetDefinedName(api: FUniver, name: string, a1: string): void {
	api.getActiveWorkbook()?.insertDefinedName(name, a1);
}

/** Rename an existing defined name. Returns false when the name is unknown. */
export function renameSheetDefinedName(api: FUniver, oldName: string, newName: string): boolean {
	const defined = api.getActiveWorkbook()?.getDefinedName(oldName);
	if (!defined) return false;
	defined.setName(newName);
	return true;
}

/** Delete a defined name. Returns false when the name is unknown. */
export function removeSheetDefinedName(api: FUniver, name: string): boolean {
	const defined = api.getActiveWorkbook()?.getDefinedName(name);
	if (!defined) return false;
	defined.delete();
	return true;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/** Serialize the active workbook (`IWorkbookData`), or null before mount. */
export function saveWorkbookSnapshot(api: FUniver): IWorkbookData | null {
	return api.getActiveWorkbook()?.save() ?? null;
}
