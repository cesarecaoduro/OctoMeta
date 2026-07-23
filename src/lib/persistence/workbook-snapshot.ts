import type { WorkbookManifest } from '../engine';

/** Create the empty adapter snapshot paired with a new workbook manifest. */
export function createEmptyWorkbookSnapshot(
	unitId: string,
	name: string,
	manifest: WorkbookManifest
): Record<string, unknown> {
	return {
		id: unitId,
		name,
		sheetOrder: manifest.sheets.map((sheet) => sheet.id),
		sheets: Object.fromEntries(
			manifest.sheets.map((sheet) => [
				sheet.id,
				{ id: sheet.id, name: sheet.name, cellData: {} }
			])
		)
	};
}
