import { buildLandSurfaceData } from './landGeometry';
import { decorateLandRelief } from './reliefGeometry';
import { TerrainSurface } from './terrainSurface';
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
		const raw = buildLandSurfaceData(
			request.geography,
			request.positions,
			request.radius ?? 1,
			request.seed ?? 0,
			request.detail ?? 24,
			request.edges ?? [],
			request.nodeDegrees,
			request.countryDisplayTerritory,
		);
		const data=decorateLandRelief(raw,new TerrainSurface(request.geography,request.positions,request.seed??0,request.edges??[],request.nodeDegrees));
		const response: LandWorkerResponse = {
			type: 'completed',
			requestId: request.requestId,
			data,
		};
		self.postMessage(response, [
			...(data.occlusionTree?[data.occlusionTree.bounds.buffer,data.occlusionTree.nodes.buffer,data.occlusionTree.triangles.buffer]:[]),
			...[data.reliefPositions,data.reliefNormals,data.reliefElevations,data.reliefBeachPositions,data.coastalWallPositions,data.reliefCoastPositions,data.reliefBorderPositions,data.reliefShades,data.reliefCountryTints,data.reliefStrata].filter((v):v is Float32Array=>v!==undefined).map(v=>v.buffer),
			...(data.reliefColorIndices?[data.reliefColorIndices.buffer]:[]),
			data.positions.buffer,
			data.colorIndices.buffer,
			data.shades.buffer,
			...(data.countryTones === undefined ? [] : [data.countryTones.buffer]),
			...(data.countryTints === undefined ? [] : [data.countryTints.buffer]),
			data.beachPositions.buffer,
			data.coastPositions.buffer,
			...(data.coastInkPositions === undefined ? [] : [data.coastInkPositions.buffer]),
			...(data.countryBorderPositions === undefined ? [] : [data.countryBorderPositions.buffer]),
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
