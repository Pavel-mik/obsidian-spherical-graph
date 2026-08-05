import type { GraphData } from '../graph/graphTypes';
import type {
	DirectoryTerritorySource,
	PersistedContinentalGeography,
} from './geographyTypes';
import { createPersistedContinentalGeography } from './postLayoutGeography';

declare const self: DedicatedWorkerGlobalScope;

export interface GeographyWorkerRequest {
	readonly type: 'build-geography';
	readonly requestId: string;
	readonly graph: GraphData;
	readonly positions: Float32Array;
	readonly seed: number;
	readonly previous?: PersistedContinentalGeography;
	readonly territory?: DirectoryTerritorySource & { readonly ownerByCell: Int32Array };
}

export type GeographyWorkerResponse =
	| {
			readonly type: 'completed';
			readonly requestId: string;
			readonly geography: PersistedContinentalGeography;
	  }
	| {
			readonly type: 'error';
			readonly requestId: string;
			readonly message: string;
	  };

self.addEventListener('message', (event: MessageEvent<unknown>) => {
	const request = event.data as Partial<GeographyWorkerRequest>;
	if (
		request.type !== 'build-geography' ||
		typeof request.requestId !== 'string' ||
		request.graph === undefined ||
		!(request.positions instanceof Float32Array)
	) {
		return;
	}
	try {
		const geography = createPersistedContinentalGeography(
			request.graph,
			request.positions,
			request.seed ?? 0,
			request.previous,
			request.territory,
		);
		self.postMessage({
			type: 'completed',
			requestId: request.requestId,
			geography,
		} satisfies GeographyWorkerResponse);
	} catch (error) {
		self.postMessage({
			type: 'error',
			requestId: request.requestId,
			message:
				error instanceof Error
					? error.message
					: 'The continental geography could not be built.',
		} satisfies GeographyWorkerResponse);
	} finally {
		self.close();
	}
});
