import {
	GraphDataService,
	type GraphBuildSourceSnapshot,
} from './GraphDataService';
import type { GraphData, GraphFilterOptions } from './graphTypes';

declare const self: DedicatedWorkerGlobalScope;

export interface GraphBuildWorkerRequest {
	readonly type: 'build';
	readonly requestId: string;
	readonly source: GraphBuildSourceSnapshot;
	readonly filters: Partial<GraphFilterOptions>;
}

export type GraphBuildWorkerResponse =
	| {
			readonly type: 'completed';
			readonly requestId: string;
			readonly graph: GraphData;
	  }
	| {
			readonly type: 'error';
			readonly requestId: string;
			readonly message: string;
	  };

self.addEventListener('message', (event: MessageEvent<unknown>) => {
	const request = event.data as Partial<GraphBuildWorkerRequest>;
	if (
		request.type !== 'build' ||
		typeof request.requestId !== 'string' ||
		request.source === undefined
	) {
		return;
	}
	try {
		const graph = GraphDataService.fromSnapshot(request.source).buildGraph(
			request.filters,
		);
		self.postMessage({
			type: 'completed',
			requestId: request.requestId,
			graph,
		} satisfies GraphBuildWorkerResponse);
	} catch (error) {
		self.postMessage({
			type: 'error',
			requestId: request.requestId,
			message:
				error instanceof Error
					? error.message
					: 'The vault graph could not be built.',
		} satisfies GraphBuildWorkerResponse);
	} finally {
		self.close();
	}
});
