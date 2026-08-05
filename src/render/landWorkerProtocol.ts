import type { RenderEdge, RenderGeography } from './renderTypes';
import type { LandSurfaceData } from './landGeometry';

export interface LandWorkerRequest {
	readonly type: 'build-land';
	readonly requestId: string;
	readonly geography: RenderGeography;
	readonly positions: Float32Array;
	readonly radius: number;
	readonly seed: number;
	readonly detail: number;
	readonly edges: readonly RenderEdge[];
	readonly nodeDegrees: Uint32Array;
}

export type LandWorkerResponse =
	| {
			readonly type: 'completed';
			readonly requestId: string;
			readonly data: LandSurfaceData;
	  }
	| {
			readonly type: 'error';
			readonly requestId: string;
			readonly message: string;
	  };
