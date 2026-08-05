import { hashNumbers } from '../geometry/deterministicHash';
import {
	dotVec3,
	normalizeVec3,
	orthogonalUnitVec3,
	readVec3,
	writeVec3,
	type Vec3,
} from '../geometry/vector3';
import { createIntrinsicSphericalGrid } from '../geography/sphericalGrid';

const BUCKET_SIZE = 0.11;

export interface DirectoryTerritoryConstraintInput {
	readonly subdivision: number;
	readonly ownerByCell: Int32Array;
	readonly ownerCount: number;
}

function bucketCoordinate(value: number): number {
	return Math.floor((value + 1) / BUCKET_SIZE);
}

function bucketKey(x: number, y: number, z: number): string {
	return `${x}:${y}:${z}`;
}

export class DirectoryTerritoryConstraint {
	private readonly grid;
	private readonly ownerByCell: Int32Array;
	private readonly cellsByOwner: readonly (readonly number[])[];
	private readonly boundaryCellsByOwner: readonly (readonly number[])[];
	private readonly buckets: ReadonlyMap<string, readonly number[]>;

	constructor(input: DirectoryTerritoryConstraintInput) {
		this.grid = createIntrinsicSphericalGrid(input.subdivision);
		if (
			this.grid.vertices.length !== input.ownerByCell.length ||
			!Number.isSafeInteger(input.ownerCount) ||
			input.ownerCount < 0
		) {
			throw new RangeError('Invalid directory territory constraint.');
		}
		this.ownerByCell = input.ownerByCell.slice();
		const cellsByOwner = Array.from(
			{ length: input.ownerCount },
			() => [] as number[],
		);
		const boundaryCellsByOwner = Array.from(
			{ length: input.ownerCount },
			() => [] as number[],
		);
		const mutableBuckets = new Map<string, number[]>();
		for (let cell = 0; cell < this.grid.vertices.length; cell += 1) {
			const point = this.grid.vertices[cell];
			const owner = this.ownerByCell[cell] ?? -1;
			if (point === undefined || owner >= input.ownerCount) {
				throw new RangeError('Territory raster contains an invalid owner.');
			}
			if (owner >= 0) {
				cellsByOwner[owner]?.push(cell);
				if (
					(this.grid.neighbors[cell] ?? []).some(
						(neighbor) => (this.ownerByCell[neighbor] ?? -1) !== owner,
					)
				) {
					boundaryCellsByOwner[owner]?.push(cell);
				}
			}
			const key = bucketKey(
				bucketCoordinate(point[0]),
				bucketCoordinate(point[1]),
				bucketCoordinate(point[2]),
			);
			const entries = mutableBuckets.get(key);
			if (entries === undefined) {
				mutableBuckets.set(key, [cell]);
			} else {
				entries.push(cell);
			}
		}
		this.cellsByOwner = cellsByOwner;
		this.boundaryCellsByOwner = boundaryCellsByOwner;
		this.buckets = mutableBuckets;
	}

	private nearestCell(point: Vec3): number {
		const centerX = bucketCoordinate(point[0]);
		const centerY = bucketCoordinate(point[1]);
		const centerZ = bucketCoordinate(point[2]);
		let bestCell = -1;
		let bestDot = Number.NEGATIVE_INFINITY;
		for (let dx = -1; dx <= 1; dx += 1) {
			for (let dy = -1; dy <= 1; dy += 1) {
				for (let dz = -1; dz <= 1; dz += 1) {
					for (const cell of this.buckets.get(
						bucketKey(centerX + dx, centerY + dy, centerZ + dz),
					) ?? []) {
						const candidate = this.grid.vertices[cell];
						if (candidate === undefined) {
							continue;
						}
						const similarity = dotVec3(point, candidate);
						if (similarity > bestDot) {
							bestDot = similarity;
							bestCell = cell;
						}
					}
				}
			}
		}
		if (bestCell >= 0) {
			return bestCell;
		}
		for (let cell = 0; cell < this.grid.vertices.length; cell += 1) {
			const candidate = this.grid.vertices[cell];
			if (candidate === undefined) {
				continue;
			}
			const similarity = dotVec3(point, candidate);
			if (similarity > bestDot) {
				bestDot = similarity;
				bestCell = cell;
			}
		}
		return Math.max(0, bestCell);
	}

	private nearestOwnedCell(
		point: Vec3,
		owner: number,
		boundaryOnly: boolean,
	): number | undefined {
		const boundary = this.boundaryCellsByOwner[owner] ?? [];
		const cells = boundaryOnly && boundary.length > 0
			? boundary
			: this.cellsByOwner[owner] ?? [];
		let bestCell: number | undefined;
		let bestDot = Number.NEGATIVE_INFINITY;
		for (const cell of cells) {
			const candidate = this.grid.vertices[cell];
			if (candidate === undefined) {
				continue;
			}
			const similarity = dotVec3(point, candidate);
			if (similarity > bestDot) {
				bestDot = similarity;
				bestCell = cell;
			}
		}
		return bestCell;
	}

	addForces(
		positions: Float32Array,
		folderIndexByNode: Int32Array,
		movableMask: Uint8Array,
		forces: Float64Array,
		strength: number,
		effectiveSeed: number,
	): void {
		for (let nodeIndex = 0; nodeIndex < folderIndexByNode.length; nodeIndex += 1) {
			const owner = folderIndexByNode[nodeIndex] ?? -1;
			if (owner < 0 || movableMask[nodeIndex] !== 1) {
				continue;
			}
			const point = normalizeVec3(readVec3(positions, nodeIndex));
			const cell = this.nearestCell(point);
			if ((this.ownerByCell[cell] ?? -1) === owner) {
				continue;
			}
			const targetCell = this.nearestOwnedCell(point, owner, false);
			const target = targetCell === undefined
				? undefined
				: this.grid.vertices[targetCell];
			if (target === undefined) {
				continue;
			}
			const dot = Math.max(-1, Math.min(1, dotVec3(point, target)));
			let tangentX = target[0] - dot * point[0];
			let tangentY = target[1] - dot * point[1];
			let tangentZ = target[2] - dot * point[2];
			let length = Math.hypot(tangentX, tangentY, tangentZ);
			if (length <= 1e-10) {
				const fallback = orthogonalUnitVec3(
					point,
					hashNumbers(effectiveSeed, owner, nodeIndex, 0x7e22),
				);
				[tangentX, tangentY, tangentZ] = fallback;
				length = 1;
			}
			const angle = Math.acos(dot);
			const magnitude = Math.max(0.08, strength) * (0.3 + angle * 5);
			const offset = nodeIndex * 3;
			forces[offset] = (forces[offset] ?? 0) + tangentX / length * magnitude;
			forces[offset + 1] = (forces[offset + 1] ?? 0) + tangentY / length * magnitude;
			forces[offset + 2] = (forces[offset + 2] ?? 0) + tangentZ / length * magnitude;
		}
	}

	projectPositions(
		positions: Float32Array,
		folderIndexByNode: Int32Array,
		movableMask?: Uint8Array,
		coastalPortScores?: Float32Array,
		preferCoast = false,
	): void {
		for (let nodeIndex = 0; nodeIndex < folderIndexByNode.length; nodeIndex += 1) {
			const owner = folderIndexByNode[nodeIndex] ?? -1;
			if (owner < 0 || (movableMask !== undefined && movableMask[nodeIndex] !== 1)) {
				continue;
			}
			const point = normalizeVec3(readVec3(positions, nodeIndex));
			const wantsCoast =
				preferCoast && (coastalPortScores?.[nodeIndex] ?? 0) > 0;
			const cell = this.nearestCell(point);
			if (!wantsCoast && (this.ownerByCell[cell] ?? -1) === owner) {
				continue;
			}
			const targetCell = this.nearestOwnedCell(point, owner, wantsCoast);
			const target = targetCell === undefined
				? undefined
				: this.grid.vertices[targetCell];
			if (target === undefined) {
				continue;
			}
			writeVec3(
				positions,
				nodeIndex,
				normalizeVec3([
					target[0] * 0.985 + point[0] * 0.015,
					target[1] * 0.985 + point[1] * 0.015,
					target[2] * 0.985 + point[2] * 0.015,
				]),
			);
		}
	}
}
