/**
 * Public surface of the Univer adapter (V1-3-1). Hosts import from here —
 * never from module internals — and NOTHING outside `src/lib/adapters/univer/`
 * may import `@univerjs/*` (IMPLEMENTATION_PLAN.md §11 rule 2).
 */

export {
	DefinedNameBook,
	a1FromRowCol,
	cellRefFor,
	classifyCellInput,
	colToLetters,
	formatCellDisplay,
	lettersToCol,
	parseA1,
	refStringToA1,
	refStringToCellRef,
	refersToCell,
	renameNameRefs,
	type ClassifiedEdit,
	type DefinedNameRecord,
	type RawCellInput
} from './cell-text';

export {
	applyCellEdit,
	createGraphSession,
	ensureSheetBlock,
	nodeForCell,
	nodesForSheet,
	publishCellName,
	renamePublishedName,
	unpublishName,
	type CellEditOutcome,
	type GraphSession,
	type GraphSessionOptions,
	type NameOutcome
} from './graph-sync';

export {
	attachWorkbookAdapter,
	type WorkbookAdapter,
	type WorkbookAdapterOptions,
	type WorkbookCommandResult,
	type WorkbookSelection
} from './workbook-adapter';
