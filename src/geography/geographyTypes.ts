import type { Vec3 } from '../geometry/vector3';

export const CONTINENTAL_GEOGRAPHY_VERSION = 1;
export const CONTINENT_COLOR_COUNT = 6;

export interface DetectedContinent {
	readonly id: string;
	readonly memberIndices: readonly number[];
	readonly memberNodeIds: readonly string[];
	readonly stability: number;
	readonly conductance: number;
	readonly score: number;
}

export interface CommunityDetectionResult {
	readonly continents: readonly DetectedContinent[];
	readonly islandNodeIndices: readonly number[];
	readonly assignmentByNode: Int32Array;
}

export interface PersistedContinent {
	readonly id: string;
	readonly label: string;
	readonly nodeIds: readonly string[];
	readonly center: Vec3;
	readonly capRadius: number;
	readonly colorIndex: number;
	readonly stability: number;
	readonly conductance: number;
}

export interface PersistedContinentalGeography {
	readonly version: typeof CONTINENTAL_GEOGRAPHY_VERSION;
	readonly continents: readonly PersistedContinent[];
	readonly islandNodeIds: readonly string[];
}

export interface ContinentLayoutPlan {
	readonly detection: CommunityDetectionResult;
	readonly continents: readonly PersistedContinent[];
	readonly assignmentByNode: Int32Array;
	readonly centers: Float32Array;
	readonly capRadii: Float32Array;
}

export interface GeographySolverConstraints {
	/** `-1` denotes a free island node. */
	readonly assignmentByNode: Int32Array;
	/** Packed normalized center vectors in continent order. */
	readonly centers: Float32Array;
	/** Maximum intrinsic radius for each reserved continent cap. */
	readonly capRadii: Float32Array;
	readonly boundaryStrength: number;
}
