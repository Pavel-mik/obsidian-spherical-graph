import {
	hashToSignedUnitFloat,
	hashToUnitFloat,
} from '../geometry/deterministicHash';
import {
	exponentialMap,
	geodesicDistance,
} from '../geometry/sphericalGeometry';
import {
	crossVec3,
	normalizeVec3,
	orthogonalUnitVec3,
	scaleVec3,
	type Vec3,
} from '../geometry/vector3';

export interface OrganicCapPlacement {
	readonly position: Vec3;
	readonly maximumDistance: number;
}

export interface SamplingTerritory {
	readonly center: Vec3;
	readonly radius: number;
}

class PointProximityIndex {
	private readonly cells = new Map<string, Vec3[]>();
	private readonly cellSize: number;

	constructor(private readonly searchAngle: number) {
		this.cellSize = Math.max(
			1e-4,
			2 * Math.sin(Math.max(1e-4, searchAngle) / 2),
		);
	}

	private coordinate(value: number): number {
		return Math.floor((value + 1) / this.cellSize);
	}

	private key(x: number, y: number, z: number): string {
		return `${x}|${y}|${z}`;
	}

	add(point: Vec3): void {
		const key = this.key(
			this.coordinate(point[0]),
			this.coordinate(point[1]),
			this.coordinate(point[2]),
		);
		const cell = this.cells.get(key);
		if (cell === undefined) {
			this.cells.set(key, [point]);
		} else {
			cell.push(point);
		}
	}

	nearestDistance(point: Vec3): number {
		const centerX = this.coordinate(point[0]);
		const centerY = this.coordinate(point[1]);
		const centerZ = this.coordinate(point[2]);
		const chordRange = 2 * Math.sin(this.searchAngle / 2);
		const cellRange = Math.max(
			1,
			Math.ceil(chordRange / this.cellSize),
		);
		let nearest = this.searchAngle;
		for (let dx = -cellRange; dx <= cellRange; dx += 1) {
			for (let dy = -cellRange; dy <= cellRange; dy += 1) {
				for (let dz = -cellRange; dz <= cellRange; dz += 1) {
					const cell = this.cells.get(
						this.key(
							centerX + dx,
							centerY + dy,
							centerZ + dz,
						),
					);
					if (cell === undefined) {
						continue;
					}
					for (const other of cell) {
						nearest = Math.min(
							nearest,
							geodesicDistance(point, other),
						);
					}
				}
			}
		}
		return nearest;
	}
}

function organicBoundaryScale(phase: number, seed: number): number {
	const firstPhase =
		hashToSignedUnitFloat(seed, 0xb01) * Math.PI;
	const secondPhase =
		hashToSignedUnitFloat(seed, 0xb02) * Math.PI;
	const detailPhase =
		hashToSignedUnitFloat(seed, 0xb03) * Math.PI;
	return Math.max(
		0.52,
		Math.min(
			0.96,
			0.77 +
				Math.sin(phase * 2 + firstPhase) * 0.1 +
				Math.sin(phase * 3 + secondPhase) * 0.075 +
				Math.sin(phase * 7 + detailPhase) * 0.045,
		),
	);
}

function randomCapCandidate(
	center: Vec3,
	radius: number,
	seed: number,
	nodeIndex: number,
	attempt: number,
): OrganicCapPlacement {
	const phase =
		hashToUnitFloat(seed, nodeIndex, attempt, 0xc4f) * Math.PI * 2;
	const maximumDistance = radius * organicBoundaryScale(phase, seed);
	const areaFraction = hashToUnitFloat(
		seed,
		nodeIndex,
		attempt,
		0xa2e,
	);
	const angularRadius = Math.acos(
		1 -
			areaFraction *
				(1 - Math.cos(maximumDistance * 0.84)),
	);
	const tangentX = orthogonalUnitVec3(center, seed);
	const tangentY = normalizeVec3(crossVec3(center, tangentX));
	const direction = normalizeVec3([
		tangentX[0] * Math.cos(phase) + tangentY[0] * Math.sin(phase),
		tangentX[1] * Math.cos(phase) + tangentY[1] * Math.sin(phase),
		tangentX[2] * Math.cos(phase) + tangentY[2] * Math.sin(phase),
	]);
	return {
		position: exponentialMap(
			center,
			scaleVec3(direction, angularRadius),
		),
		maximumDistance,
	};
}

export function organicCapPlacements(
	center: Vec3,
	nodeIndices: readonly number[],
	radius: number,
	seed: number,
): readonly OrganicCapPlacement[] {
	const placements: OrganicCapPlacement[] = [];
	const capArea = 2 * Math.PI * (1 - Math.cos(radius));
	const expectedSpacing = Math.max(
		0.018,
		Math.sqrt(capArea / Math.max(1, nodeIndices.length)) * 0.72,
	);
	const proximity = new PointProximityIndex(expectedSpacing * 1.45);
	const candidateCount = Math.min(
		18,
		Math.max(8, Math.round(Math.sqrt(nodeIndices.length) * 1.5)),
	);
	for (const nodeIndex of nodeIndices) {
		let best = randomCapCandidate(
			center,
			radius,
			seed,
			nodeIndex,
			0,
		);
		let bestScore = Number.NEGATIVE_INFINITY;
		for (let attempt = 0; attempt < candidateCount; attempt += 1) {
			const candidate = randomCapCandidate(
				center,
				radius,
				seed,
				nodeIndex,
				attempt,
			);
			const nearestDistance = proximity.nearestDistance(
				candidate.position,
			);
			const organicBias =
				0.88 +
				hashToUnitFloat(
					seed,
					nodeIndex,
					attempt,
					0xb57,
				) *
					0.24;
			const boundaryDistance = geodesicDistance(
				center,
				candidate.position,
			);
			const boundaryPenalty =
				Math.max(
					0,
					boundaryDistance /
							Math.max(1e-6, candidate.maximumDistance) -
						0.72,
				) * radius * 0.08;
			const score =
				nearestDistance * organicBias - boundaryPenalty;
			if (score > bestScore) {
				bestScore = score;
				best = candidate;
			}
		}
		placements.push(best);
		proximity.add(best.position);
	}
	return placements;
}

function randomSpherePoint(
	seed: number,
	nodeIndex: number,
	attempt: number,
): Vec3 {
	const y =
		hashToSignedUnitFloat(seed, nodeIndex, attempt, 0x0a91);
	const phase =
		hashToUnitFloat(seed, nodeIndex, attempt, 0x0a92) *
		Math.PI *
		2;
	const radial = Math.sqrt(Math.max(0, 1 - y * y));
	return [
		radial * Math.cos(phase),
		y,
		radial * Math.sin(phase),
	];
}

export function randomOceanOrphanPoints(
	nodeIndices: readonly number[],
	groups: readonly SamplingTerritory[],
	seed: number,
): ReadonlyMap<number, Vec3> {
	const result = new Map<number, Vec3>();
	const desiredSeparation = Math.min(
		0.22,
		Math.max(
			0.035,
			0.32 *
				Math.sqrt(
					(4 * Math.PI) / Math.max(1, nodeIndices.length),
				),
		),
	);
	const proximity = new PointProximityIndex(
		desiredSeparation * 1.35,
	);
	for (const nodeIndex of nodeIndices) {
		let best = randomSpherePoint(seed, nodeIndex, 0);
		let bestScore = Number.NEGATIVE_INFINITY;
		for (let attempt = 0; attempt < 48; attempt += 1) {
			const candidate = randomSpherePoint(
				seed,
				nodeIndex,
				attempt,
			);
			let seaClearance = Math.PI;
			for (const group of groups) {
				seaClearance = Math.min(
					seaClearance,
					geodesicDistance(candidate, group.center) -
						group.radius,
				);
			}
			const nearestDistance = proximity.nearestDistance(candidate);
			const randomThreshold =
				desiredSeparation *
				(0.72 +
					hashToUnitFloat(
						seed,
						nodeIndex,
						attempt,
						0x0a93,
					) *
						0.28);
			const score =
				Math.min(nearestDistance, desiredSeparation * 1.35) +
				Math.min(0.3, seaClearance) * 0.28 +
				hashToUnitFloat(
					seed,
					nodeIndex,
					attempt,
					0x0a94,
				) *
					desiredSeparation *
					0.18;
			if (score > bestScore) {
				bestScore = score;
				best = candidate;
			}
			if (
				seaClearance >= 0.045 &&
				nearestDistance >= randomThreshold
			) {
				best = candidate;
				break;
			}
		}
		result.set(nodeIndex, best);
		proximity.add(best);
	}
	return result;
}
