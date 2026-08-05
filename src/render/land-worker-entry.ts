import { buildLandSurfaceData } from './landGeometry';
import type { LandWorkerRequest, LandWorkerResponse } from './landWorkerProtocol';

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener('message', (event: MessageEvent<unknown>) => {
	const request = event.data as Partial<LandWorkerRequest>;
	if (
		request.type !== 'build-land' ||
		typeof request.requestId !== 'string' ||
		request.geography === undefined ||
		!(request.positions instanceof Float32Array) ||
		!(request.nodeDegrees instanceof Uint32Array)
	) {
		return;
	}
	try {
		const data = buildLandSurfaceData(
			request.geography,
			request.positions,
			request.radius ?? 1,
			request.seed ?? 0,
			request.detail ?? 24,
			request.edges ?? [],
			request.nodeDegrees,
		);
		const response: LandWorkerResponse = {
			type: 'completed',
			requestId: request.requestId,
			data,
		};
		self.postMessage(response, [
			data.positions.buffer,
			data.colorIndices.buffer,
			data.shades.buffer,
			data.beachPositions.buffer,
			data.coastPositions.buffer,
		]);
	} catch (error) {
		self.postMessage({
			type: 'error',
			requestId: request.requestId,
			message:
				error instanceof Error
					? error.message
					: 'The continent surface could not be built.',
		} satisfies LandWorkerResponse);
	} finally {
		self.close();
	}
});
