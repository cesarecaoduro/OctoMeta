/**
 * One live Univer workbook bound to one document graph. All cell operations
 * carry an explicit immutable SheetId; the active tab is presentation state,
 * never an ownership shortcut.
 */

import type { IWorkbookData, IWorksheetData } from '@univerjs/presets';
import type {
	CellRef,
	SheetId,
	SheetMeta,
	SheetProjection,
	TypedValue
} from '../../engine';
import {
	booleanValue,
	printFormula,
	scalar,
	stringValue,
	ulid
} from '../../engine';
import {
	DefinedNameBook,
	a1FromRowCol,
	classifyCellInput,
	formatCellDisplay,
	refStringToCellRef,
	type ClassifiedEdit
} from './cell-text';
import {
	applyCellEdit,
	nodesForSheet,
	publishCellName,
	renamePublishedName,
	unpublishName,
	type GraphSession
} from './graph-sync';
import {
	activateWorkbookSheet,
	activateWorkbookCell,
	createUniverSheet,
	deleteWorkbookSheet,
	insertWorkbookDefinedName,
	insertWorkbookSheet,
	listWorkbookDefinedNames,
	onCellValuesChanged,
	onDefinedNameChanged,
	onSelectionChanged,
	onWorkbookMutated,
	readSheetCellData,
	readSheetCellValue,
	recalcAllFormulas,
	registerSheetFunctions,
	removeSheetDefinedName,
	renameSheetDefinedName,
	renameWorkbookSheet,
	saveWorkbookSnapshot,
	writeSheetCellDisplay,
	writeSheetCellInput,
	type CellDisplayStyle,
	type ChangedCell,
	type Disposable,
	type UniverSheetHandle
} from './univer-api';

/** Options for mounting the document's single workbook projection. */
export interface WorkbookAdapterOptions {
	session: GraphSession;
	container: HTMLElement;
	unitId?: string;
	name?: string;
	snapshot?: IWorkbookData | null;
}

/** Result returned by tab commands exposed to the UI. */
export type WorkbookCommandResult =
	| { ok: true; sheetId: SheetId }
	| { ok: false; message: string };

/** The selected graph-aware cell rendered by the custom formula line. */
export interface WorkbookSelection {
	sheetId: SheetId;
	a1: string;
	text: string;
}

/** Public projection API used by the workbook drawer and browser tests. */
export interface WorkbookAdapter {
	readonly unitId: string;
	getCell(sheetId: SheetId, a1: string): unknown;
	getRawCell(sheetId: SheetId, a1: string): { v?: unknown; f?: unknown } | null;
	setCellText(sheetId: SheetId, a1: string, input: number | string | boolean): void;
	activateSheet(sheetId: SheetId): boolean;
	/** Activate and select a cell, used by report error deep-links. */
	activateCell(sheetId: SheetId, a1: string): boolean;
	addSheet(name?: string): WorkbookCommandResult;
	renameSheet(sheetId: SheetId, name: string): WorkbookCommandResult;
	deleteSheet(sheetId: SheetId): WorkbookCommandResult;
	publishName(sheetId: SheetId, a1: string, name: string): boolean;
	renameName(oldName: string, newName: string): boolean;
	deleteName(name: string): boolean;
	selection(): WorkbookSelection | null;
	saveSnapshot(): IWorkbookData | null;
	onMutated(cb: () => void): () => void;
	onSelect(cb: (selection: WorkbookSelection) => void): () => void;
	dispose(): void;
}

/**
 * Mount the one-workbook projection, hydrate named-range state, and connect
 * all graph settles and user edits without consulting the active tab.
 */
export async function attachWorkbookAdapter(
	opts: WorkbookAdapterOptions
): Promise<WorkbookAdapter> {
	const { session, container } = opts;
	const unitId = opts.unitId ?? session.docId;
	const handle: UniverSheetHandle = await createUniverSheet({
		container,
		unitId,
		name: opts.name,
		snapshot: opts.snapshot,
		sheets: session.doc.workbook.sheets
	});
	const api = handle.api;
	const disposables: Disposable[] = [];
	const removedSheets = new Map<SheetId, Partial<IWorksheetData>>();
	const selectListeners = new Set<(selection: WorkbookSelection) => void>();

	disposables.push(
		...registerSheetFunctions(
			api,
			session.registry.list().map((signature) => ({
				name: signature.name,
				description: `OctoMeta ${signature.origin} function ${signature.name}`,
				fn: (...args: unknown[]) =>
					formatCellDisplay(
						session.registry.call(signature.name, bridgeArgs(args), { nodeId: '' })
					)
			}))
		)
	);
	recalcAllFormulas(api);

	let applying = false;
	let selected: CellRef | null = null;
	const boundCells = new Map<string, CellRef>();

	const displayStyle = (node: { formula?: unknown; value: TypedValue }): CellDisplayStyle =>
		node.value.kind === 'error' ? 'error' : node.formula ? 'computed' : null;

	const writeDisplays = (
		writes: [SheetId, string, number | string | null, CellDisplayStyle][]
	): void => {
		applying = true;
		try {
			for (const [sheetId, a1, value, style] of writes) {
				writeSheetCellDisplay(api, sheetId, a1, value, style);
			}
		} finally {
			applying = false;
		}
	};

	const paintAll = (): void => {
		const writes: [SheetId, string, number | string, CellDisplayStyle][] = [];
		for (const sheet of session.doc.workbook.sheets) {
			for (const node of nodesForSheet(session, sheet.id)) {
				if (!node.cellRef) continue;
				boundCells.set(node.id, node.cellRef);
				writes.push([
					node.cellRef.sheetId,
					node.cellRef.a1,
					formatCellDisplay(node.value),
					displayStyle(node)
				]);
			}
		}
		if (writes.length > 0) writeDisplays(writes);
	};

	const reconcileSheets = (): void => {
		const wanted = new Map(session.doc.workbook.sheets.map((sheet) => [sheet.id, sheet]));
		const workbook = saveWorkbookSnapshot(api);
		for (const sheetId of workbook?.sheetOrder ?? []) {
			if (!wanted.has(sheetId)) {
				const data = workbook?.sheets[sheetId];
				if (data) removedSheets.set(sheetId, structuredClone(data));
				deleteWorkbookSheet(api, sheetId);
			}
		}
		for (const sheet of session.doc.workbook.sheets) {
			const existing = api.getActiveWorkbook()?.getSheetBySheetId(sheet.id);
			if (!existing) {
				insertWorkbookSheet(api, sheet, removedSheets.get(sheet.id));
			} else if (existing.getSheetName() !== sheet.name) {
				renameWorkbookSheet(api, sheet.id, sheet.name);
			}
		}
	};

	reconcileSheets();
	paintAll();

	const offSettle = session.onSettle((result) => {
		reconcileSheets();
		const ids = new Set([...result.affected, ...result.evaluated, ...result.cyclic]);
		const writes: [SheetId, string, number | string | null, CellDisplayStyle][] = [];
		for (const id of ids) {
			const node = session.doc.nodes.get(id);
			if (!node?.cellRef) continue;
			boundCells.set(id, node.cellRef);
			writes.push([
				node.cellRef.sheetId,
				node.cellRef.a1,
				formatCellDisplay(node.value),
				displayStyle(node)
			]);
		}
		for (const [id, ref] of boundCells) {
			if (session.doc.nodes.has(id)) continue;
			boundCells.delete(id);
			writes.push([ref.sheetId, ref.a1, null, null]);
		}
		if (writes.length > 0) writeDisplays(writes);
	});

	disposables.push(
		onCellValuesChanged(api, (cells) => {
			if (applying) return;
			const captured = cells.map((cell) => ({ ...cell }));
			queueMicrotask(() => processEdits(captured));
		})
	);

	function processEdits(cells: ChangedCell[]): void {
		for (const cell of cells) {
			const touchesContent =
				cell.data === null || 'v' in cell.data || 'f' in cell.data || 'p' in cell.data;
			if (!touchesContent) continue;
			const a1 = a1FromRowCol(cell.row, cell.col);
			const outcome = applyCellEdit(
				session,
				cell.sheetId,
				a1,
				classifyCellInput(cell.data)
			);
			if (outcome.kind === 'rejected') {
				writeDisplays([[cell.sheetId, a1, outcome.display, 'error']]);
			} else if (outcome.kind === 'applied') {
				const node = session.doc.nodes.get(outcome.nodeId);
				if (node) {
					writeDisplays([
						[cell.sheetId, a1, formatCellDisplay(node.value), displayStyle(node)]
					]);
				}
			}
		}
	}

	const sheetIdForName = (name: string): SheetId | undefined =>
		session.doc.workbook.sheets.find((sheet) => sheet.name === name)?.id;
	const book = new DefinedNameBook();
	for (const defined of listWorkbookDefinedNames(api)) {
		book.recordInsert(
			defined.id,
			defined.name,
			refStringToCellRef(defined.ref, sheetIdForName)
		);
	}
	disposables.push(
		onDefinedNameChanged(api, (change) => {
			const captured = { ...change };
			queueMicrotask(() => {
				const cellRef = refStringToCellRef(captured.ref, sheetIdForName);
				switch (captured.type) {
					case 'insert':
						book.recordInsert(captured.id, captured.name, cellRef);
						if (cellRef) {
							publishCellName(
								session,
								cellRef.sheetId,
								cellRef.a1,
								captured.name,
								seedFromCell(cellRef)
							);
						}
						return;
					case 'update': {
						const previous = book.recordUpdate(captured.id, captured.name, cellRef);
						if (!previous) {
							if (cellRef) {
								publishCellName(
									session,
									cellRef.sheetId,
									cellRef.a1,
									captured.name,
									seedFromCell(cellRef)
								);
							}
							return;
						}
						if (previous.name !== captured.name) {
							renamePublishedName(session, previous.name, captured.name);
						}
						if (
							cellRef &&
							(cellRef.sheetId !== previous.cellRef?.sheetId ||
								cellRef.a1 !== previous.cellRef?.a1)
						) {
							publishCellName(
								session,
								cellRef.sheetId,
								cellRef.a1,
								captured.name,
								seedFromCell(cellRef)
							);
						}
						return;
					}
					case 'remove': {
						const previous = book.recordRemove(captured.id);
						unpublishName(session, previous?.name ?? captured.name);
					}
				}
			});
		})
	);

	function seedFromCell(ref: CellRef): TypedValue | undefined {
		const edit: ClassifiedEdit = classifyCellInput(
			readSheetCellData(api, ref.sheetId, ref.a1)
		);
		if (edit.kind !== 'value') return undefined;
		if (typeof edit.value === 'object') return edit.value;
		if (typeof edit.value === 'number') return scalar(edit.value);
		if (typeof edit.value === 'boolean') return booleanValue(edit.value);
		return stringValue(edit.value);
	}

	function currentSelection(): WorkbookSelection | null {
		if (!selected) return null;
		const nodeId = session.doc.resolveRef(selected);
		const node = nodeId ? session.doc.nodes.get(nodeId) : undefined;
		return {
			...selected,
			text: node?.formula
				? `=${printFormula(node.formula)}`
				: node
					? String(formatCellDisplay(node.value))
					: ''
		};
	}

	function emitSelection(): void {
		const selection = currentSelection();
		if (selection) for (const listener of selectListeners) listener(selection);
	}

	disposables.push(
		onSelectionChanged(api, (anchor) => {
			if (!anchor || applying) return;
			selected = {
				sheetId: anchor.sheetId,
				a1: a1FromRowCol(anchor.row, anchor.col)
			};
			emitSelection();
		})
	);

	const sheetProjection = (sheetId: SheetId): SheetProjection => {
		const snapshot = saveWorkbookSnapshot(api);
		const active = api.getActiveWorkbook()?.getActiveSheet().getSheetId() === sheetId;
		return {
			version: 1,
			sheetId,
			wasActive: active,
			snapshot: structuredClone(snapshot?.sheets[sheetId] ?? {})
		};
	};

	return {
		unitId,
		getCell: (sheetId, a1) => readSheetCellValue(api, sheetId, a1),
		getRawCell: (sheetId, a1) => readSheetCellData(api, sheetId, a1),
		setCellText: (sheetId, a1, input) =>
			writeSheetCellInput(api, sheetId, a1, input),
		activateSheet: (sheetId) => activateWorkbookSheet(api, sheetId),
		activateCell: (sheetId, a1) => {
			if (!activateWorkbookCell(api, sheetId, a1)) return false;
			selected = { sheetId, a1 };
			emitSelection();
			return true;
		},
		addSheet: (name) => {
			const position = session.doc.workbook.sheets.length;
			const sheetId = ulid();
			const result = session.commit({
				op: 'workbookOp',
				action: 'add',
				sheet: { id: sheetId, name: name ?? `Sheet ${position + 1}`, position },
				activate: true
			});
			if (!result.ok) return { ok: false, message: result.error.message };
			reconcileSheets();
			activateWorkbookSheet(api, sheetId);
			return { ok: true, sheetId };
		},
		renameSheet: (sheetId, name) => {
			const result = session.commit({ op: 'workbookOp', action: 'rename', sheetId, name });
			return result.ok
				? { ok: true, sheetId }
				: { ok: false, message: result.error.message };
		},
		deleteSheet: (sheetId) => {
			const projection = sheetProjection(sheetId);
			const result = session.commit({
				op: 'workbookOp',
				action: 'remove',
				sheetId,
				projection
			});
			return result.ok
				? { ok: true, sheetId }
				: { ok: false, message: result.error.message };
		},
		publishName: (sheetId, a1, name) =>
			insertWorkbookDefinedName(api, name, sheetId, a1),
		renameName: (oldName, newName) => renameSheetDefinedName(api, oldName, newName),
		deleteName: (name) => removeSheetDefinedName(api, name),
		selection: currentSelection,
		saveSnapshot: () => saveWorkbookSnapshot(api),
		onMutated: (cb) => {
			const disposable = onWorkbookMutated(api, () => {
				if (!applying) cb();
			});
			disposables.push(disposable);
			return () => disposable.dispose();
		},
		onSelect: (cb) => {
			selectListeners.add(cb);
			const value = currentSelection();
			if (value) cb(value);
			return () => selectListeners.delete(cb);
		},
		dispose: () => {
			offSettle();
			for (const disposable of disposables) disposable.dispose();
			selectListeners.clear();
			handle.dispose();
		}
	};
}

function bridgeArgs(args: unknown[]): TypedValue[] {
	const out: TypedValue[] = [];
	const push = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) push(item);
		} else if (typeof value === 'number') out.push(scalar(value));
		else if (typeof value === 'boolean') out.push(booleanValue(value));
		else if (typeof value === 'string') out.push(stringValue(value));
		else if (value === null || value === undefined) out.push(scalar(0));
		else out.push(stringValue(String(value)));
	};
	for (const arg of args) push(arg);
	return out;
}
