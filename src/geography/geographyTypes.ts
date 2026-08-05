import type { Vec3 } from '../geometry/vector3';

export const CONTINENTAL_GEOGRAPHY_VERSION = 1;
export const CONTINENT_COLOR_COUNT = 6;
export const MAX_PERSISTED_CONTINENT_CAP_RADIUS = 1.55;

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

/**
 * A fixed intrinsic raster allocated before the note solver runs.  Owner
 * indexes use the same stable, lexicographic folder order as `continents`;
 * `-1` is ocean.  Persisting this compact raster makes the exact coastlines
 * portable through Obsidian Sync instead of re-inferring land from cities.
 */
export interface PersistedDirectoryTerritory {
	readonly subdivision: number;
	readonly folderKeys: readonly string[];
	readonly ownerByCell: readonly number[];
}

export interface DirectoryTerritorySource {
	readonly subdivision: number;
	readonly folderKeys: readonly string[];
	readonly ownerByCell: ArrayLike<number>;
}

export interface PersistedContinentalGeography {
	readonly version: typeof CONTINENTAL_GEOGRAPHY_VERSION;
	readonly continents: readonly PersistedContinent[];
	/**
	 * Non-continent notes eligible for a small land patch. Orphans may be
	 * omitted entirely and remain visible as cities over open water.
	 */
	readonly islandNodeIds: readonly string[];
	readonly territory?: PersistedDirectoryTerritory;
}
