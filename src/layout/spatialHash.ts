import { readVec3 } from '../geometry/vector3';

export type NearbyPairVisitor = (first: number, second: number) => void;

export class SphericalSpatialHash {
	private readonly cellSize: number;
	private readonly cells = new Map<string, number[]>();

	constructor(cellSize: number) {
		if (!Number.isFinite(cellSize) || cellSize <= 0) {
			throw new RangeError('Spatial-hash cell size must be positive.');
		}
		this.cellSize = cellSize;
	}

	private coordinate(value: number): number {
		return Math.floor((value + 1) / this.cellSize);
	}

	private key(x: number, y: number, z: number): string {
		return `${x}|${y}|${z}`;
	}

	rebuild(positions: ArrayLike<number>): void {
		if (positions.length % 3 !== 0) {
			throw new RangeError(
				'Position buffer length must be divisible by three.',
			);
		}
		this.cells.clear();
		for (let index = 0; index < positions.length / 3; index += 1) {
			const position = readVec3(positions, index);
			const key = this.key(
				this.coordinate(position[0]),
				this.coordinate(position[1]),
				this.coordinate(position[2]),
			);
			const cell = this.cells.get(key);
			if (cell === undefined) {
				this.cells.set(key, [index]);
			} else {
				cell.push(index);
			}
		}
	}

	forEachPairWithinAngle(
		positions: ArrayLike<number>,
		maximumAngle: number,
		movableMask: ArrayLike<number> | undefined,
		visitor: NearbyPairVisitor,
	): number {
		if (!Number.isFinite(maximumAngle) || maximumAngle <= 0) {
			return 0;
		}
		const nodeCount = positions.length / 3;
		if (movableMask !== undefined && movableMask.length !== nodeCount) {
			throw new RangeError('Movable mask must have one value per node.');
		}
		this.rebuild(positions);
		const chordDistance = 2 * Math.sin(Math.min(Math.PI, maximumAngle) / 2);
		const chordSquared = chordDistance * chordDistance;
		const neighborRange = Math.max(
			1,
			Math.ceil(chordDistance / this.cellSize),
		);
		let pairCount = 0;

		for (let first = 0; first < nodeCount; first += 1) {
			const position = readVec3(positions, first);
			const cellX = this.coordinate(position[0]);
			const cellY = this.coordinate(position[1]);
			const cellZ = this.coordinate(position[2]);
			for (let dx = -neighborRange; dx <= neighborRange; dx += 1) {
				for (let dy = -neighborRange; dy <= neighborRange; dy += 1) {
					for (let dz = -neighborRange; dz <= neighborRange; dz += 1) {
						const candidates = this.cells.get(
							this.key(cellX + dx, cellY + dy, cellZ + dz),
						);
						if (candidates === undefined) {
							continue;
						}
						for (const second of candidates) {
							if (
								second <= first ||
								((movableMask?.[first] ?? 1) === 0 &&
									(movableMask?.[second] ?? 1) === 0)
							) {
								continue;
							}
							const other = readVec3(positions, second);
							const x = position[0] - other[0];
							const y = position[1] - other[1];
							const z = position[2] - other[2];
							if (x * x + y * y + z * z <= chordSquared) {
								visitor(first, second);
								pairCount += 1;
							}
						}
					}
				}
			}
		}
		return pairCount;
	}
}
