import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DocumentGraph,
	createBuiltinRegistry,
	ulid,
	type GraphMutation
} from '../engine';
import { createGraphSession } from '../adapters/univer';
import { createPersistenceActivityLog } from '../persistence/activity';
import type { DocumentId } from '../persistence/client';
import { createWorkspaceController } from './controller';

const DOC_ID = 'workspace-controller-test' as DocumentId;

function addTextMutation(): GraphMutation {
	return {
		op: 'blockOp',
		action: 'add',
		blockId: ulid(),
		block: { docId: DOC_ID, type: 'text' },
		position: 0
	};
}

function setup() {
	const graph = new DocumentGraph();
	const session = createGraphSession({
		doc: graph,
		docId: DOC_ID,
		registry: createBuiltinRegistry()
	});
	const commitLocal = vi.fn(async (expectedGeneration: number) => expectedGeneration + 1);
	const projection = {
		flushPendingChanges: vi.fn(),
		renderSettledState: vi.fn()
	};
	const workbookSnapshot = vi.fn(() => ({ id: 'snapshot' }));
	const activity = createPersistenceActivityLog();
	const controller = createWorkspaceController({
		graph: session,
		title: () => 'Controller test',
		local: { initialGeneration: 0, commit: commitLocal },
		projection,
		workbookSnapshot,
		activity,
		saveDelayMs: 100
	});
	return { controller, graph, commitLocal, projection, workbookSnapshot, activity };
}

describe('workspace controller', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('captures authored, workbook, and unified undo state on the local save cadence', async () => {
		const { controller, graph, commitLocal, workbookSnapshot } = setup();
		expect(controller.commit(addTextMutation()).ok).toBe(true);
		expect(graph.blocksOrder).toHaveLength(1);
		expect(commitLocal).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(100);
		expect(workbookSnapshot).toHaveBeenCalledTimes(1);
		expect(commitLocal).toHaveBeenCalledWith(
			0,
			expect.objectContaining({
				title: 'Controller test',
				workbookSnapshot: { id: 'snapshot' },
				graph: expect.objectContaining({
					authored: expect.objectContaining({ blocksOrder: graph.blocksOrder }),
					history: expect.objectContaining({
						undoCursor: 1,
						undoLog: expect.arrayContaining([expect.objectContaining({ seq: 1 })])
					})
				})
			})
		);
	});

	it('does not schedule persistence when the graph rejects a mutation', async () => {
		const graph = new DocumentGraph();
		const session = createGraphSession({ doc: graph, docId: DOC_ID });
		const commitLocal = vi.fn(async (expectedGeneration: number) => expectedGeneration + 1);
		const controller = createWorkspaceController({
			graph: session,
			title: () => 'Rejected mutation',
			local: { initialGeneration: 0, commit: commitLocal },
			projection: { flushPendingChanges() {}, renderSettledState() {} },
			workbookSnapshot: () => ({}),
			activity: createPersistenceActivityLog(),
			saveDelayMs: 100
		});
		const missingMove: GraphMutation = {
			op: 'blockOp',
			action: 'move',
			blockId: 'missing',
			position: 0
		};
		expect(controller.commit(missingMove).ok).toBe(false);
		await vi.advanceTimersByTimeAsync(100);
		expect(commitLocal).not.toHaveBeenCalled();
	});

	it('flushes pending projection changes into every timed capture without a duplicate generation', async () => {
		const { controller, graph, commitLocal, projection } = setup();
		projection.flushPendingChanges.mockImplementationOnce(() => {
			expect(controller.commitProjection(addTextMutation()).ok).toBe(true);
		});

		controller.markChanged();
		await vi.advanceTimersByTimeAsync(100);

		expect(graph.blocksOrder).toHaveLength(1);
		expect(commitLocal).toHaveBeenCalledTimes(1);
		expect(commitLocal).toHaveBeenCalledWith(
			0,
			expect.objectContaining({
				graph: expect.objectContaining({
					authored: expect.objectContaining({ blocksOrder: graph.blocksOrder })
				})
			})
		);
	});

	it('coordinates projection flush, history, render, and persistence', async () => {
		const { controller, graph, commitLocal, projection } = setup();
		controller.commit(addTextMutation());
		await controller.flush();
		expect(commitLocal).toHaveBeenCalledTimes(1);

		expect(controller.undo()).toBe(true);
		expect(projection.flushPendingChanges).toHaveBeenCalledTimes(3);
		expect(projection.renderSettledState).toHaveBeenCalledTimes(1);
		expect(graph.blocksOrder).toEqual([]);
		await controller.flush();

		expect(controller.redo()).toBe(true);
		expect(projection.renderSettledState).toHaveBeenCalledTimes(2);
		expect(graph.blocksOrder).toHaveLength(1);
		await controller.flush();
		expect(commitLocal).toHaveBeenCalledTimes(3);
		expect(commitLocal.mock.calls.map(([generation]) => generation)).toEqual([0, 1, 2]);
	});

	it('exposes the shared persistence activity log through the workspace seam', () => {
		const { controller, activity } = setup();
		activity.observe({
			target: 'cloud',
			access: 'read',
			operation: 'documents.load',
			phase: 'succeeded'
		});
		expect(controller.persistenceActivity()).toMatchObject([
			{ target: 'cloud', access: 'read', operation: 'documents.load', phase: 'succeeded' }
		]);
		controller.clearPersistenceActivity();
		expect(controller.persistenceActivity()).toEqual([]);
	});
});
