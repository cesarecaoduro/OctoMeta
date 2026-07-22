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
	const saveDocument = vi.fn(async () => 1);
	const projection = {
		flushPendingChanges: vi.fn(),
		renderSettledState: vi.fn()
	};
	const workbookSnapshot = vi.fn(() => ({ id: 'snapshot' }));
	const activity = createPersistenceActivityLog();
	const controller = createWorkspaceController({
		docId: DOC_ID,
		graph: session,
		cloud: { saveDocument },
		projection,
		workbookSnapshot,
		activity,
		saveDelayMs: 100
	});
	return { controller, graph, saveDocument, projection, workbookSnapshot, activity };
}

describe('workspace controller', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('routes successful mutations through graph settlement and the existing save cadence', async () => {
		const { controller, graph, saveDocument, workbookSnapshot } = setup();
		expect(controller.commit(addTextMutation()).ok).toBe(true);
		expect(graph.blocksOrder).toHaveLength(1);
		expect(saveDocument).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(100);
		expect(workbookSnapshot).toHaveBeenCalledTimes(1);
		expect(saveDocument).toHaveBeenCalledWith(DOC_ID, graph, { id: 'snapshot' });
	});

	it('does not schedule persistence when the graph rejects a mutation', async () => {
		const graph = new DocumentGraph();
		const session = createGraphSession({ doc: graph, docId: DOC_ID });
		const saveDocument = vi.fn(async () => 1);
		const controller = createWorkspaceController({
			docId: DOC_ID,
			graph: session,
			cloud: { saveDocument },
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
		expect(saveDocument).not.toHaveBeenCalled();
	});

	it('coordinates projection flush, history, render, and persistence', async () => {
		const { controller, graph, saveDocument, projection } = setup();
		controller.commit(addTextMutation());
		await controller.flush();
		expect(saveDocument).toHaveBeenCalledTimes(1);

		expect(controller.undo()).toBe(true);
		expect(projection.flushPendingChanges).toHaveBeenCalledTimes(2);
		expect(projection.renderSettledState).toHaveBeenCalledTimes(1);
		expect(graph.blocksOrder).toEqual([]);
		await controller.flush();

		expect(controller.redo()).toBe(true);
		expect(projection.renderSettledState).toHaveBeenCalledTimes(2);
		expect(graph.blocksOrder).toHaveLength(1);
		await controller.flush();
		expect(saveDocument).toHaveBeenCalledTimes(3);
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
