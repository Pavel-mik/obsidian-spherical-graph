import {
	clamp,
	dotVec3,
	normalizeVec3,
	readVec3,
} from '../geometry/vector3';
import {
	type IntrinsicSphericalGrid,
	mapPositionsToGrid,
} from './sphericalGrid';

export interface SphericalDensityField {
	readonly characteristicSpacing: number;
	readonly localSpacing: Float64Array;
	readonly density: Float64Array;
	readonly nodeCells: Int32Array;
	/**
	 * Per-node cartographic support. Zero-weight nodes retain a grid mapping
	 * for diagnostics, but do not affect spacing, density, or watershed size.
	 */
	readonly nodeWeights: Float64Array;
}

export interface SphericalWatershed {
	readonly basinByCell: Int32Array;
	readonly basinByNode: Int32Array;
	readonly peakDensityByBasin: Float64Array;
	readonly saddleDensityByBasin: Float64Array;
}

export interface WatershedOptions {
	readonly priorByNode?: Int32Array;
	readonly minimumBasinNodes: number;
	readonly shallowSaddleRatio?: number;
}

function insertNearest(distances: Float64Array, value: number): void {
	if (value >= (distances[distances.length - 1] ?? Number.POSITIVE_INFINITY)) {
		return;
	}
	let index = distances.length - 1;
	while (index > 0 && value < (distances[index - 1] ?? 0)) {
		distances[index] = distances[index - 1] ?? value;
		index -= 1;
	}
	distances[index] = value;
}

function median(values: readonly number[]): number {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[middle] ?? 0);
}

export function quantile(
	values: readonly number[] | Float64Array,
	amount: number,
): number {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((left, right) => left - right);
	const position = clamp(amount, 0, 1) * (sorted.length - 1);
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	const fraction = position - lower;
	return (
		(sorted[lower] ?? 0) * (1 - fraction) +
		(sorted[upper] ?? 0) * fraction
	);
}

function validatedNodeWeights(
	nodeCount: number,
	nodeWeights?: ArrayLike<number>,
): Float64Array {
	if (nodeWeights !== undefined && nodeWeights.length !== nodeCount) {
		throw new RangeError('Node weights must align with positions.');
	}
	const weights = new Float64Array(nodeCount);
	for (let index = 0; index < nodeCount; index += 1) {
		const value = nodeWeights?.[index] ?? 1;
		if (!Number.isFinite(value) || value < 0) {
			throw new RangeError('Node weights must be finite and non-negative.');
		}
		weights[index] = value;
	}
	return weights;
}

export function estimateNodeSpacing(
	positions: ArrayLike<number>,
	neighborRank = 6,
	nodeWeights?: ArrayLike<number>,
): {
	readonly characteristicSpacing: number;
	readonly localSpacing: Float64Array;
} {
	if (
		positions.length % 3 !== 0 ||
		!Number.isSafeInteger(neighborRank) ||
		neighborRank < 1
	) {
		throw new RangeError('Invalid positions or nearest-neighbor rank.');
	}
	const count = positions.length / 3;
	const weights = validatedNodeWeights(count, nodeWeights);
	const directions = Array.from({ length: count }, (_, index) =>
		normalizeVec3(readVec3(positions, index)),
	);
	const activeIndices = Array.from(
		{ length: count },
		(_, index) => index,
	).filter((index) => (weights[index] ?? 0) > 0);
	if (activeIndices.length <= 1) {
		const localSpacing = new Float64Array(count);
		localSpacing.fill(0.6);
		return {
			characteristicSpacing: 0.6,
			localSpacing,
		};
	}
	const retained = Math.min(neighborRank, activeIndices.length - 1);
	const nearest = Array.from({ length: count }, () => {
		const values = new Float64Array(retained);
		values.fill(Number.POSITIVE_INFINITY);
		return values;
	});
	for (
		let leftOffset = 0;
		leftOffset < activeIndices.length;
		leftOffset += 1
	) {
		const left = activeIndices[leftOffset];
		if (left === undefined) {
			continue;
		}
		const leftDirection = directions[left];
		if (leftDirection === undefined) {
			continue;
		}
		for (
			let rightOffset = leftOffset + 1;
			rightOffset < activeIndices.length;
			rightOffset += 1
		) {
			const right = activeIndices[rightOffset];
			if (right === undefined) {
				continue;
			}
			const rightDirection = directions[right];
			if (rightDirection === undefined) {
				continue;
			}
			const chordSquared = Math.max(
				0,
				2 * (1 - clamp(dotVec3(leftDirection, rightDirection), -1, 1)),
			);
			insertNearest(nearest[left] ?? new Float64Array(), chordSquared);
			insertNearest(nearest[right] ?? new Float64Array(), chordSquared);
		}
	}
	const localSpacing = new Float64Array(count);
	const finite: number[] = [];
	for (const index of activeIndices) {
		const chordSquared =
			nearest[index]?.[retained - 1] ?? Number.POSITIVE_INFINITY;
		const angle = Number.isFinite(chordSquared)
			? 2 *
				Math.asin(
					Math.min(1, Math.sqrt(Math.max(0, chordSquared)) / 2),
				)
			: 0.6;
		localSpacing[index] = angle;
		if (Number.isFinite(angle) && angle > 1e-6) {
			finite.push(angle);
		}
	}
	const characteristicSpacing = clamp(
		median(finite) || 0.6,
		0.035,
		0.7,
	);
	for (let index = 0; index < localSpacing.length; index += 1) {
		if ((weights[index] ?? 0) <= 0) {
			localSpacing[index] = characteristicSpacing;
			continue;
		}
		localSpacing[index] = clamp(
			localSpacing[index] || characteristicSpacing,
			characteristicSpacing * 0.5,
			characteristicSpacing * 2.2,
		);
	}
	return { characteristicSpacing, localSpacing };
}

function compactKernel(
	chordSquared: number,
	supportAngle: number,
): number {
	const supportChord = 2 * Math.sin(Math.min(Math.PI, supportAngle) / 2);
	const ratio = chordSquared / Math.max(1e-12, supportChord * supportChord);
	if (ratio >= 1) {
		return 0;
	}
	return (1 - ratio) ** 3;
}

export function evaluateAdaptiveDensity(
	grid: IntrinsicSphericalGrid,
	positions: ArrayLike<number>,
	nodeWeights?: ArrayLike<number>,
): SphericalDensityField {
	const weights = validatedNodeWeights(positions.length / 3, nodeWeights);
	const spacing = estimateNodeSpacing(positions, 6, weights);
	const nodeCells = mapPositionsToGrid(grid, positions);
	const directions = Array.from(
		{ length: positions.length / 3 },
		(_, index) => normalizeVec3(readVec3(positions, index)),
	);
	const density = new Float64Array(grid.vertices.length);
	for (let cell = 0; cell < grid.vertices.length; cell += 1) {
		const vertex = grid.vertices[cell];
		if (vertex === undefined) {
			continue;
		}
		let value = 0;
		for (let nodeIndex = 0; nodeIndex < directions.length; nodeIndex += 1) {
			const weight = weights[nodeIndex] ?? 0;
			if (weight <= 0) {
				continue;
			}
			const direction = directions[nodeIndex];
			if (direction === undefined) {
				continue;
			}
			const bandwidth = clamp(
				(spacing.localSpacing[nodeIndex] ??
					spacing.characteristicSpacing) * 0.82,
				spacing.characteristicSpacing * 0.55,
				spacing.characteristicSpacing * 1.45,
			);
			const chordSquared = Math.max(
				0,
				2 * (1 - clamp(dotVec3(vertex, direction), -1, 1)),
			);
			const fine =
				compactKernel(chordSquared, bandwidth * 2) /
				Math.max(1e-6, bandwidth * bandwidth);
			const coarseBandwidth = bandwidth * 1.9;
			const coarse =
				compactKernel(chordSquared, coarseBandwidth * 2.1) /
				Math.max(1e-6, coarseBandwidth * coarseBandwidth);
			value += (fine * 0.82 + coarse * 0.18) * weight;
		}
		density[cell] = value;
	}
	return {
		characteristicSpacing: spacing.characteristicSpacing,
		localSpacing: spacing.localSpacing,
		density,
		nodeCells,
		nodeWeights: weights,
	};
}

function initialWatershedRoots(
	grid: IntrinsicSphericalGrid,
	density: Float64Array,
): Int32Array {
	const next = new Int32Array(grid.vertices.length);
	for (let cell = 0; cell < grid.vertices.length; cell += 1) {
		let best = cell;
		let bestDensity = density[cell] ?? 0;
		for (const neighbor of grid.neighbors[cell] ?? []) {
			const neighborDensity = density[neighbor] ?? 0;
			if (
				neighborDensity > bestDensity + 1e-12 ||
				(Math.abs(neighborDensity - bestDensity) <= 1e-12 &&
					neighbor < best)
			) {
				best = neighbor;
				bestDensity = neighborDensity;
			}
		}
		next[cell] = best;
	}
	const roots = new Int32Array(next.length);
	for (let start = 0; start < next.length; start += 1) {
		let cursor = start;
		const path: number[] = [];
		while ((next[cursor] ?? cursor) !== cursor) {
			path.push(cursor);
			cursor = next[cursor] ?? cursor;
		}
		roots[start] = cursor;
		for (const visited of path) {
			next[visited] = cursor;
		}
	}
	return roots;
}

function dominantPrior(
	counts: ReadonlyMap<number, number> | undefined,
): number {
	let winner = -1;
	let winnerCount = 0;
	for (const [prior, count] of counts ?? []) {
		if (
			count > winnerCount ||
			(count === winnerCount && prior < winner)
		) {
			winner = prior;
			winnerCount = count;
		}
	}
	return winner;
}

export function buildSphericalWatershed(
	grid: IntrinsicSphericalGrid,
	field: SphericalDensityField,
	options: WatershedOptions,
): SphericalWatershed {
	const roots = initialWatershedRoots(grid, field.density);
	const basinNodeCounts = new Map<number, number>();
	const priorCounts = new Map<number, Map<number, number>>();
	for (let nodeIndex = 0; nodeIndex < field.nodeCells.length; nodeIndex += 1) {
		if ((field.nodeWeights[nodeIndex] ?? 0) <= 0) {
			continue;
		}
		const cell = field.nodeCells[nodeIndex] ?? 0;
		const root = roots[cell] ?? cell;
		basinNodeCounts.set(root, (basinNodeCounts.get(root) ?? 0) + 1);
		const prior = options.priorByNode?.[nodeIndex] ?? -1;
		if (prior >= 0) {
			const counts = priorCounts.get(root) ?? new Map<number, number>();
			counts.set(prior, (counts.get(prior) ?? 0) + 1);
			priorCounts.set(root, counts);
		}
	}
	const saddles = new Map<
		string,
		{ readonly left: number; readonly right: number; readonly density: number }
	>();
	for (let cell = 0; cell < grid.neighbors.length; cell += 1) {
		const leftRoot = roots[cell] ?? cell;
		for (const neighbor of grid.neighbors[cell] ?? []) {
			if (neighbor <= cell) {
				continue;
			}
			const rightRoot = roots[neighbor] ?? neighbor;
			if (leftRoot === rightRoot) {
				continue;
			}
			const left = Math.min(leftRoot, rightRoot);
			const right = Math.max(leftRoot, rightRoot);
			const key = `${left}:${right}`;
			const saddleDensity = Math.min(
				field.density[cell] ?? 0,
				field.density[neighbor] ?? 0,
			);
			const previous = saddles.get(key);
			if (previous === undefined || saddleDensity > previous.density) {
				saddles.set(key, {
					left,
					right,
					density: saddleDensity,
				});
			}
		}
	}
	const parent = new Int32Array(grid.vertices.length);
	const componentNodeCounts = new Int32Array(grid.vertices.length);
	const componentPeaks = new Float64Array(grid.vertices.length);
	const componentPriorCounts = new Map<number, Map<number, number>>();
	for (let index = 0; index < parent.length; index += 1) {
		parent[index] = index;
		componentNodeCounts[index] = basinNodeCounts.get(index) ?? 0;
		componentPeaks[index] = field.density[index] ?? 0;
		const counts = priorCounts.get(index);
		if (counts !== undefined) {
			componentPriorCounts.set(index, new Map(counts));
		}
	}
	const find = (value: number): number => {
		let root = value;
		while ((parent[root] ?? root) !== root) {
			root = parent[root] ?? root;
		}
		let cursor = value;
		while ((parent[cursor] ?? cursor) !== root) {
			const next = parent[cursor] ?? root;
			parent[cursor] = root;
			cursor = next;
		}
		return root;
	};
	const union = (left: number, right: number): number => {
		const leftRoot = find(left);
		const rightRoot = find(right);
		if (leftRoot === rightRoot) {
			return leftRoot;
		}
		const leftPeak = componentPeaks[leftRoot] ?? 0;
		const rightPeak = componentPeaks[rightRoot] ?? 0;
		let survivor: number;
		let absorbed: number;
		if (
			leftPeak > rightPeak + 1e-12 ||
			(Math.abs(leftPeak - rightPeak) <= 1e-12 &&
				leftRoot < rightRoot)
		) {
			survivor = leftRoot;
			absorbed = rightRoot;
		} else {
			survivor = rightRoot;
			absorbed = leftRoot;
		}
		parent[absorbed] = survivor;
		componentNodeCounts[survivor] =
			(componentNodeCounts[survivor] ?? 0) +
			(componentNodeCounts[absorbed] ?? 0);
		componentNodeCounts[absorbed] = 0;
		componentPeaks[survivor] = Math.max(leftPeak, rightPeak);
		componentPeaks[absorbed] = 0;
		const survivorPriors =
			componentPriorCounts.get(survivor) ?? new Map<number, number>();
		for (
			const [prior, count] of
			componentPriorCounts.get(absorbed) ?? []
		) {
			survivorPriors.set(
				prior,
				(survivorPriors.get(prior) ?? 0) + count,
			);
		}
		if (survivorPriors.size > 0) {
			componentPriorCounts.set(survivor, survivorPriors);
		}
		componentPriorCounts.delete(absorbed);
		return survivor;
	};
	const defaultRatio = options.shallowSaddleRatio ?? 0.62;
	const orderedSaddles = [...saddles.values()].sort(
		(left, right) =>
			right.density - left.density ||
			left.left - right.left ||
			left.right - right.right,
	);
	for (const saddle of orderedSaddles) {
		const leftRoot = find(saddle.left);
		const rightRoot = find(saddle.right);
		if (leftRoot === rightRoot) {
			continue;
		}
		const lowerPeak = Math.min(
			componentPeaks[leftRoot] ?? 0,
			componentPeaks[rightRoot] ?? 0,
		);
		const ratio =
			lowerPeak <= 1e-12 ? 0 : saddle.density / lowerPeak;
		const leftPrior = dominantPrior(
			componentPriorCounts.get(leftRoot),
		);
		const rightPrior = dominantPrior(
			componentPriorCounts.get(rightRoot),
		);
		const threshold =
			leftPrior >= 0 && leftPrior === rightPrior
				? 0.46
				: leftPrior >= 0 && rightPrior >= 0
					? Math.min(0.76, defaultRatio + 0.12)
					: Math.min(
							defaultRatio,
							(componentNodeCounts[leftRoot] ?? 0) <
									options.minimumBasinNodes ||
								(componentNodeCounts[rightRoot] ?? 0) <
									options.minimumBasinNodes
								? 0.52
								: defaultRatio,
						);
		if (ratio >= threshold) {
			union(leftRoot, rightRoot);
		}
	}

	const basinByCell = new Int32Array(roots.length);
	for (let cell = 0; cell < roots.length; cell += 1) {
		basinByCell[cell] = find(roots[cell] ?? cell);
	}
	const basinByNode = new Int32Array(field.nodeCells.length);
	for (let nodeIndex = 0; nodeIndex < basinByNode.length; nodeIndex += 1) {
		const cell = field.nodeCells[nodeIndex] ?? 0;
		basinByNode[nodeIndex] = basinByCell[cell] ?? cell;
	}
	const peakDensityByBasin = new Float64Array(grid.vertices.length);
	const saddleDensityByBasin = new Float64Array(grid.vertices.length);
	for (let cell = 0; cell < basinByCell.length; cell += 1) {
		const basin = basinByCell[cell] ?? cell;
		peakDensityByBasin[basin] = Math.max(
			peakDensityByBasin[basin] ?? 0,
			field.density[cell] ?? 0,
		);
		for (const neighbor of grid.neighbors[cell] ?? []) {
			const neighborBasin = basinByCell[neighbor] ?? neighbor;
			if (neighborBasin !== basin) {
				saddleDensityByBasin[basin] = Math.max(
					saddleDensityByBasin[basin] ?? 0,
					Math.min(
						field.density[cell] ?? 0,
						field.density[neighbor] ?? 0,
					),
				);
			}
		}
	}
	return {
		basinByCell,
		basinByNode,
		peakDensityByBasin,
		saddleDensityByBasin,
	};
}
