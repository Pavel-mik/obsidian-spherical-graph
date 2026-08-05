import {
	hashNumbers,
	hashToUnitFloat,
} from '../geometry/deterministicHash';

const DEFAULT_MAX_LANDMARKS_PER_GROUP = 8;
const DEFAULT_PAIRS_PER_NODE = 3;
const DEFAULT_MINIMUM_GRAPH_DISTANCE = 2;
const DEFAULT_MINIMUM_TARGET_ANGLE = 0.055;
const DEFAULT_MAXIMUM_TARGET_ANGLE = 1.35;
const DEFAULT_STRESS_WEIGHT_SCALE = 0.22;
const LOCAL_SCAFFOLD_WEIGHT_SCALE = 0.34;
const REGIONAL_SCAFFOLD_WEIGHT_SCALE = 0.28;
const LOCAL_SCAFFOLD_NEIGHBORS = 3;
const REGIONAL_SCAFFOLD_NEIGHBORS = 4;
const SCAFFOLD_LATITUDE_BANDS = 32;
const SCAFFOLD_LONGITUDE_BANDS = 64;
const REGIONAL_BRIDGE_SAMPLE_LIMIT = 36;

export interface SparseStressOptions {
	/** A constant upper bound keeps landmark BFS work linear in the graph size. */
	readonly maxLandmarksPerGroup?: number;
	/** Maximum number of new constraints initiated by one node. */
	readonly pairsPerNode?: number;
	readonly minimumGraphDistance?: number;
	readonly minimumTargetAngle?: number;
	readonly maximumTargetAngle?: number;
	/** Multiplier relative to the mean weight of the original graph. */
	readonly stressWeightScale?: number;
}

export interface SparseStressInput {
	readonly nodeCount: number;
	readonly edgeEndpoints: Uint32Array;
	readonly edgeWeights: Float32Array;
	readonly positions: Float32Array;
	readonly folderIndexByNode?: Int32Array;
	readonly regionIndexByNode?: Int32Array;
	readonly seed: number;
	readonly options?: SparseStressOptions;
}

export interface SparseStressResult {
	/** Original edges first, followed by deterministic sparse-stress pairs. */
	readonly edgeEndpoints: Uint32Array;
	readonly edgeWeights: Float32Array;
	/**
	 * Explicit geodesic target per edge. Zero is the sentinel for an original
	 * edge whose ordinary spring target should be used by the solver.
	 */
	readonly targetAngles: Float32Array;
	readonly addedPairCount: number;
	readonly landmarkCount: number;
}

interface ResolvedOptions {
	readonly maxLandmarksPerGroup: number;
	readonly pairsPerNode: number;
	readonly minimumGraphDistance: number;
	readonly minimumTargetAngle: number;
	readonly maximumTargetAngle: number;
	readonly stressWeightScale: number;
}

interface SparseConstraint {
	readonly source: number;
	readonly target: number;
	readonly weight: number;
	readonly targetAngle: number;
}

interface LandmarkDistance {
	readonly landmark: number;
	readonly distances: Int32Array;
}

interface FolderRegion {
	readonly index: number;
	readonly members: readonly number[];
	readonly representative: number;
	readonly spatialOrder: number;
}

interface ScaffoldCandidate {
	readonly source: number;
	readonly target: number;
	readonly distance: number;
	readonly tieBreak: number;
}

class DisjointSet {
	private readonly parent: Int32Array;
	private readonly rank: Uint8Array;

	public constructor(size: number) {
		this.parent = new Int32Array(size);
		this.rank = new Uint8Array(size);
		for (let index = 0; index < size; index += 1) {
			this.parent[index] = index;
		}
	}

	public find(value: number): number {
		let root = value;
		while (this.parent[root] !== root) {
			root = this.parent[root] ?? root;
		}
		let current = value;
		while (this.parent[current] !== current) {
			const next = this.parent[current] ?? root;
			this.parent[current] = root;
			current = next;
		}
		return root;
	}

	public union(first: number, second: number): boolean {
		let firstRoot = this.find(first);
		let secondRoot = this.find(second);
		if (firstRoot === secondRoot) {
			return false;
		}
		const firstRank = this.rank[firstRoot] ?? 0;
		const secondRank = this.rank[secondRoot] ?? 0;
		if (firstRank < secondRank) {
			[firstRoot, secondRoot] = [secondRoot, firstRoot];
		}
		this.parent[secondRoot] = firstRoot;
		if (firstRank === secondRank) {
			this.rank[firstRoot] = firstRank + 1;
		}
		return true;
	}
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function resolveOptions(
	options: SparseStressOptions | undefined,
): ResolvedOptions {
	const resolved: ResolvedOptions = {
		maxLandmarksPerGroup:
			options?.maxLandmarksPerGroup ??
			DEFAULT_MAX_LANDMARKS_PER_GROUP,
		pairsPerNode:
			options?.pairsPerNode ?? DEFAULT_PAIRS_PER_NODE,
		minimumGraphDistance:
			options?.minimumGraphDistance ??
			DEFAULT_MINIMUM_GRAPH_DISTANCE,
		minimumTargetAngle:
			options?.minimumTargetAngle ??
			DEFAULT_MINIMUM_TARGET_ANGLE,
		maximumTargetAngle:
			options?.maximumTargetAngle ??
			DEFAULT_MAXIMUM_TARGET_ANGLE,
		stressWeightScale:
			options?.stressWeightScale ??
			DEFAULT_STRESS_WEIGHT_SCALE,
	};
	for (const [key, value] of [
		['maxLandmarksPerGroup', resolved.maxLandmarksPerGroup],
		['pairsPerNode', resolved.pairsPerNode],
		['minimumGraphDistance', resolved.minimumGraphDistance],
	] as const) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError(`${key} must be a non-negative integer.`);
		}
	}
	for (const [key, value] of [
		['minimumTargetAngle', resolved.minimumTargetAngle],
		['maximumTargetAngle', resolved.maximumTargetAngle],
		['stressWeightScale', resolved.stressWeightScale],
	] as const) {
		if (!Number.isFinite(value) || value < 0) {
			throw new RangeError(`${key} must be finite and non-negative.`);
		}
	}
	if (
		resolved.minimumTargetAngle <= 0 ||
		resolved.maximumTargetAngle > Math.PI ||
		resolved.minimumTargetAngle > resolved.maximumTargetAngle
	) {
		throw new RangeError(
			'Sparse-stress target angles must form a positive interval within π.',
		);
	}
	return resolved;
}

function validateInput(input: SparseStressInput): void {
	if (!Number.isSafeInteger(input.nodeCount) || input.nodeCount < 0) {
		throw new RangeError('nodeCount must be a non-negative integer.');
	}
	if (
		input.positions.length !== input.nodeCount * 3 ||
		input.edgeEndpoints.length !== input.edgeWeights.length * 2 ||
		(input.folderIndexByNode !== undefined &&
			input.folderIndexByNode.length !== input.nodeCount) ||
		(input.regionIndexByNode !== undefined &&
			input.regionIndexByNode.length !== input.nodeCount)
	) {
		throw new RangeError('Sparse-stress buffers have inconsistent lengths.');
	}
	if (!Number.isFinite(input.seed)) {
		throw new RangeError('seed must be finite.');
	}
	for (
		let componentIndex = 0;
		componentIndex < input.positions.length;
		componentIndex += 1
	) {
		if (!Number.isFinite(input.positions[componentIndex])) {
			throw new RangeError('positions must contain only finite values.');
		}
	}
	for (
		let edgeIndex = 0;
		edgeIndex < input.edgeWeights.length;
		edgeIndex += 1
	) {
		const source = input.edgeEndpoints[edgeIndex * 2];
		const target = input.edgeEndpoints[edgeIndex * 2 + 1];
		const weight = input.edgeWeights[edgeIndex];
		if (
			source === undefined ||
			target === undefined ||
			source >= input.nodeCount ||
			target >= input.nodeCount
		) {
			throw new RangeError('edgeEndpoints contains an invalid node index.');
		}
		if (weight === undefined || !Number.isFinite(weight) || weight <= 0) {
			throw new RangeError('edgeWeights must be finite and positive.');
		}
	}
}

function pairKey(first: number, second: number): string {
	return first < second
		? `${first}:${second}`
		: `${second}:${first}`;
}

function groupKey(
	nodeIndex: number,
	folderIndexByNode: Int32Array | undefined,
	regionIndexByNode: Int32Array | undefined,
): string {
	const folder = folderIndexByNode?.[nodeIndex];
	const region = regionIndexByNode?.[nodeIndex];
	if (region !== undefined && region >= 0) {
		return `f:${folder ?? '*'}:r:${region}`;
	}
	if (folder !== undefined) {
		return `f:${folder}`;
	}
	return 'all';
}

function createGroups(input: SparseStressInput): {
	readonly groups: readonly number[][];
	readonly groupIndexByNode: Int32Array;
} {
	const groups: number[][] = [];
	const groupByKey = new Map<string, number>();
	const groupIndexByNode = new Int32Array(input.nodeCount);
	for (let nodeIndex = 0; nodeIndex < input.nodeCount; nodeIndex += 1) {
		const key = groupKey(
			nodeIndex,
			input.folderIndexByNode,
			input.regionIndexByNode,
		);
		let groupIndex = groupByKey.get(key);
		if (groupIndex === undefined) {
			groupIndex = groups.length;
			groupByKey.set(key, groupIndex);
			groups.push([]);
		}
		groupIndexByNode[nodeIndex] = groupIndex;
		groups[groupIndex]?.push(nodeIndex);
	}
	return { groups, groupIndexByNode };
}

function buildAdjacency(input: SparseStressInput): {
	readonly adjacency: readonly number[][];
	readonly occupiedPairs: Set<string>;
	readonly meanEdgeWeight: number;
} {
	const adjacency = Array.from(
		{ length: input.nodeCount },
		(): number[] => [],
	);
	const occupiedPairs = new Set<string>();
	let totalWeight = 0;
	let positiveWeightCount = 0;
	for (
		let edgeIndex = 0;
		edgeIndex < input.edgeWeights.length;
		edgeIndex += 1
	) {
		const source = input.edgeEndpoints[edgeIndex * 2];
		const target = input.edgeEndpoints[edgeIndex * 2 + 1];
		const weight = input.edgeWeights[edgeIndex];
		if (
			source === undefined ||
			target === undefined ||
			weight === undefined
		) {
			continue;
		}
		totalWeight += weight;
		positiveWeightCount += 1;
		if (source === target) {
			continue;
		}
		adjacency[source]?.push(target);
		adjacency[target]?.push(source);
		occupiedPairs.add(pairKey(source, target));
	}
	for (const neighbors of adjacency) {
		neighbors.sort((first, second) => first - second);
	}
	return {
		adjacency,
		occupiedPairs,
		meanEdgeWeight:
			positiveWeightCount > 0
				? totalWeight / positiveWeightCount
				: 1,
	};
}

function graphDistances(
	landmark: number,
	members: readonly number[],
	localIndexByNode: Int32Array,
	groupIndex: number,
	groupIndexByNode: Int32Array,
	adjacency: readonly number[][],
): Int32Array {
	const distances = new Int32Array(members.length);
	distances.fill(-1);
	const landmarkLocalIndex = localIndexByNode[landmark];
	if (landmarkLocalIndex === undefined || landmarkLocalIndex < 0) {
		return distances;
	}
	distances[landmarkLocalIndex] = 0;
	const queue = new Uint32Array(members.length);
	let readIndex = 0;
	let writeIndex = 1;
	queue[0] = landmark;
	while (readIndex < writeIndex) {
		const current = queue[readIndex];
		readIndex += 1;
		if (current === undefined) {
			continue;
		}
		const currentLocalIndex = localIndexByNode[current];
		const currentDistance =
			currentLocalIndex === undefined || currentLocalIndex < 0
				? -1
				: (distances[currentLocalIndex] ?? -1);
		for (const neighbor of adjacency[current] ?? []) {
			if (groupIndexByNode[neighbor] !== groupIndex) {
				continue;
			}
			const neighborLocalIndex = localIndexByNode[neighbor];
			if (
				neighborLocalIndex === undefined ||
				neighborLocalIndex < 0 ||
				distances[neighborLocalIndex] !== -1
			) {
				continue;
			}
			distances[neighborLocalIndex] = currentDistance + 1;
			queue[writeIndex] = neighbor;
			writeIndex += 1;
		}
	}
	return distances;
}

function angularDistance(
	positions: Float32Array,
	first: number,
	second: number,
): number {
	const firstOffset = first * 3;
	const secondOffset = second * 3;
	const ax = positions[firstOffset] ?? 0;
	const ay = positions[firstOffset + 1] ?? 0;
	const az = positions[firstOffset + 2] ?? 0;
	const bx = positions[secondOffset] ?? 0;
	const by = positions[secondOffset + 1] ?? 0;
	const bz = positions[secondOffset + 2] ?? 0;
	const firstLength = Math.hypot(ax, ay, az);
	const secondLength = Math.hypot(bx, by, bz);
	if (firstLength <= 1e-12 || secondLength <= 1e-12) {
		return 0;
	}
	const dot = clamp(
		(ax * bx + ay * by + az * bz) /
			(firstLength * secondLength),
		-1,
		1,
	);
	return Math.acos(dot);
}

function scaffoldTargetAngle(
	input: SparseStressInput,
	options: ResolvedOptions,
	source: number,
	target: number,
): number {
	return clamp(
		angularDistance(input.positions, source, target),
		options.minimumTargetAngle,
		options.maximumTargetAngle,
	);
}

function scaffoldWeight(
	input: SparseStressInput,
	meanEdgeWeight: number,
	source: number,
	target: number,
	scale: number,
	salt: number,
): number {
	const low = Math.min(source, target);
	const high = Math.max(source, target);
	const organicVariation =
		0.86 +
		0.28 *
			hashToUnitFloat(
				input.seed,
				low,
				high,
				salt,
			);
	return meanEdgeWeight * scale * organicVariation;
}

function appendScaffoldConstraint(
	input: SparseStressInput,
	options: ResolvedOptions,
	occupiedPairs: Set<string>,
	meanEdgeWeight: number,
	constraints: SparseConstraint[],
	source: number,
	target: number,
	weightScale: number,
	salt: number,
): boolean {
	const key = pairKey(source, target);
	if (source === target || occupiedPairs.has(key)) {
		return false;
	}
	occupiedPairs.add(key);
	const low = Math.min(source, target);
	const high = Math.max(source, target);
	constraints.push({
		source: low,
		target: high,
		weight: scaffoldWeight(
			input,
			meanEdgeWeight,
			low,
			high,
			weightScale,
			salt,
		),
		targetAngle: scaffoldTargetAngle(input, options, low, high),
	});
	return true;
}

function regionRepresentative(
	positions: Float32Array,
	members: readonly number[],
): number {
	let best = members[0] ?? 0;
	let bestTotalDistance = Number.POSITIVE_INFINITY;
	for (const candidate of members) {
		let totalDistance = 0;
		for (const other of members) {
			totalDistance += angularDistance(positions, candidate, other);
		}
		if (
			totalDistance < bestTotalDistance ||
			(totalDistance === bestTotalDistance && candidate < best)
		) {
			best = candidate;
			bestTotalDistance = totalDistance;
		}
	}
	return best;
}

function sphericalStripBucket(
	positions: Float32Array,
	nodeIndex: number,
): number {
	const offset = nodeIndex * 3;
	const x = positions[offset] ?? 0;
	const y = positions[offset + 1] ?? 0;
	const z = positions[offset + 2] ?? 0;
	const length = Math.hypot(x, y, z);
	if (length <= 1e-12) {
		return 0;
	}
	const normalizedZ = clamp(z / length, -1, 1);
	const band = Math.min(
		SCAFFOLD_LATITUDE_BANDS - 1,
		Math.floor(
			((normalizedZ + 1) * SCAFFOLD_LATITUDE_BANDS) / 2,
		),
	);
	const longitude = Math.atan2(y, x) + Math.PI;
	const longitudeBand = Math.min(
		SCAFFOLD_LONGITUDE_BANDS - 1,
		Math.floor(
			(longitude * SCAFFOLD_LONGITUDE_BANDS) /
				(2 * Math.PI),
		),
	);
	const withinBand =
		band % 2 === 0
			? longitudeBand
			: SCAFFOLD_LONGITUDE_BANDS - 1 - longitudeBand;
	return band * SCAFFOLD_LONGITUDE_BANDS + withinBand;
}

function createFolderRegions(
	input: SparseStressInput,
): ReadonlyMap<number, readonly FolderRegion[]> {
	const folderIndexByNode = input.folderIndexByNode;
	if (folderIndexByNode === undefined) {
		return new Map();
	}
	const membersByFolderAndRegion = new Map<
		number,
		Map<number, number[]>
	>();
	for (let nodeIndex = 0; nodeIndex < input.nodeCount; nodeIndex += 1) {
		const folderIndex = folderIndexByNode[nodeIndex] ?? -1;
		if (folderIndex < 0) {
			continue;
		}
		const rawRegion = input.regionIndexByNode?.[nodeIndex] ?? -1;
		const regionIndex =
			rawRegion >= 0 ? rawRegion : -nodeIndex - 2;
		let membersByRegion = membersByFolderAndRegion.get(folderIndex);
		if (membersByRegion === undefined) {
			membersByRegion = new Map();
			membersByFolderAndRegion.set(folderIndex, membersByRegion);
		}
		let members = membersByRegion.get(regionIndex);
		if (members === undefined) {
			members = [];
			membersByRegion.set(regionIndex, members);
		}
		members.push(nodeIndex);
	}

	const regionsByFolder = new Map<number, readonly FolderRegion[]>();
	for (const [folderIndex, membersByRegion] of membersByFolderAndRegion) {
		const buckets = Array.from(
			{
				length:
					SCAFFOLD_LATITUDE_BANDS *
					SCAFFOLD_LONGITUDE_BANDS,
			},
			(): FolderRegion[] => [],
		);
		for (const [regionIndex, members] of membersByRegion) {
				const representative = regionRepresentative(
					input.positions,
					members,
				);
				const region: FolderRegion = {
					index: regionIndex,
					members,
					representative,
					spatialOrder: sphericalStripBucket(
						input.positions,
						representative,
					),
				};
				buckets[region.spatialOrder]?.push(region);
		}
		const regions = buckets.flat();
		regionsByFolder.set(folderIndex, regions);
	}
	return regionsByFolder;
}

function nearestBridge(
	input: SparseStressInput,
	first: readonly number[],
	second: readonly number[],
	salt: number,
): ScaffoldCandidate | undefined {
	let best: ScaffoldCandidate | undefined;
	const firstStride = Math.max(
		1,
		Math.ceil(first.length / REGIONAL_BRIDGE_SAMPLE_LIMIT),
	);
	const secondStride = Math.max(
		1,
		Math.ceil(second.length / REGIONAL_BRIDGE_SAMPLE_LIMIT),
	);
	const firstOffset = hashNumbers(salt, first.length, 0x48a) % firstStride;
	const secondOffset = hashNumbers(salt, second.length, 0x48b) % secondStride;
	for (
		let firstIndex = firstOffset;
		firstIndex < first.length;
		firstIndex += firstStride
	) {
		const source = first[firstIndex];
		if (source === undefined) {
			continue;
		}
		for (
			let secondIndex = secondOffset;
			secondIndex < second.length;
			secondIndex += secondStride
		) {
			const target = second[secondIndex];
			if (target === undefined) {
				continue;
			}
			const distance = angularDistance(
				input.positions,
				source,
				target,
			);
			const tieBreak = hashNumbers(
				input.seed,
				Math.min(source, target),
				Math.max(source, target),
				salt,
			);
			if (
				best === undefined ||
				distance < best.distance ||
				(distance === best.distance &&
					tieBreak < best.tieBreak) ||
				(distance === best.distance &&
					tieBreak === best.tieBreak &&
					source < best.source) ||
				(distance === best.distance &&
					tieBreak === best.tieBreak &&
					source === best.source &&
					target < best.target)
			) {
				best = { source, target, distance, tieBreak };
			}
		}
	}
	return best;
}

function appendFolderScaffoldConstraints(
	input: SparseStressInput,
	options: ResolvedOptions,
	occupiedPairs: Set<string>,
	meanEdgeWeight: number,
	constraints: SparseConstraint[],
): void {
	const folderIndexByNode = input.folderIndexByNode;
	if (folderIndexByNode === undefined) {
		return;
	}
	const regionsByFolder = createFolderRegions(input);
	const components = new DisjointSet(input.nodeCount);
	for (
		let edgeIndex = 0;
		edgeIndex < input.edgeWeights.length;
		edgeIndex += 1
	) {
		const source = input.edgeEndpoints[edgeIndex * 2];
		const target = input.edgeEndpoints[edgeIndex * 2 + 1];
		if (source === undefined || target === undefined) {
			continue;
		}
		const folder = folderIndexByNode[source] ?? -1;
		const targetFolder = folderIndexByNode[target] ?? -1;
		const region = input.regionIndexByNode?.[source] ?? -1;
		const targetRegion = input.regionIndexByNode?.[target] ?? -1;
		if (
			folder >= 0 &&
			folder === targetFolder &&
			region === targetRegion
		) {
			components.union(source, target);
		}
	}

	for (const regions of regionsByFolder.values()) {
		for (const region of regions) {
			const connectivityCandidates: ScaffoldCandidate[] = [];
			for (
				let firstIndex = 0;
				firstIndex < region.members.length;
				firstIndex += 1
			) {
				const source = region.members[firstIndex];
				if (source === undefined) {
					continue;
				}
				for (
					let secondIndex = firstIndex + 1;
					secondIndex < region.members.length;
					secondIndex += 1
				) {
					const target = region.members[secondIndex];
					if (
						target === undefined
					) {
						continue;
					}
					connectivityCandidates.push({
						source,
						target,
						distance: angularDistance(
							input.positions,
							source,
							target,
						),
						tieBreak: hashNumbers(
							input.seed,
							source,
							target,
							region.index,
							0x5ca,
						),
					});
				}
			}
			connectivityCandidates.sort(
				(first, second) =>
					first.distance - second.distance ||
					first.tieBreak - second.tieBreak ||
					first.source - second.source ||
					first.target - second.target,
			);

			for (const source of region.members) {
				const nearest = region.members
					.filter((target) => target !== source)
					.map(
						(target): ScaffoldCandidate => ({
							source,
							target,
							distance: angularDistance(
								input.positions,
								source,
								target,
							),
							tieBreak: hashNumbers(
								input.seed,
								Math.min(source, target),
								Math.max(source, target),
								region.index,
								0x34d,
							),
						}),
					)
					.sort(
						(first, second) =>
							first.distance - second.distance ||
							first.tieBreak - second.tieBreak ||
							first.target - second.target,
					);
				let supportedNeighborCount = 0;
				for (const candidate of nearest) {
					const key = pairKey(
						candidate.source,
						candidate.target,
					);
					const alreadyOccupied = occupiedPairs.has(key);
					const added = appendScaffoldConstraint(
						input,
						options,
						occupiedPairs,
						meanEdgeWeight,
						constraints,
						candidate.source,
						candidate.target,
						LOCAL_SCAFFOLD_WEIGHT_SCALE,
						0x1a7,
					);
					if (alreadyOccupied || added) {
						components.union(
							candidate.source,
							candidate.target,
						);
						supportedNeighborCount += 1;
					}
					if (
						supportedNeighborCount >=
						LOCAL_SCAFFOLD_NEIGHBORS
					) {
						break;
					}
				}
			}

			for (const candidate of connectivityCandidates) {
				if (
					!components.union(
						candidate.source,
						candidate.target,
					)
				) {
					continue;
				}
				appendScaffoldConstraint(
					input,
					options,
					occupiedPairs,
					meanEdgeWeight,
					constraints,
					candidate.source,
					candidate.target,
					LOCAL_SCAFFOLD_WEIGHT_SCALE,
					0x1a7,
				);
			}
		}

		/*
		 * The former latitude-strip neighbor chain gave a folder only one
		 * flexible topological spine. Under stress it folded into a long ribbon.
		 * Build a bounded two-dimensional proximity scaffold instead: an MST
		 * guarantees connectivity and local k-nearest links resist folding.
		 */
		const regionCandidates: Array<{
			readonly first: number;
			readonly second: number;
			readonly distance: number;
			readonly tieBreak: number;
		}> = [];
		for (let first = 0; first < regions.length; first += 1) {
			const firstRegion = regions[first];
			if (firstRegion === undefined) {
				continue;
			}
			for (let second = first + 1; second < regions.length; second += 1) {
				const secondRegion = regions[second];
				if (secondRegion === undefined) {
					continue;
				}
				regionCandidates.push({
					first,
					second,
					distance: angularDistance(
						input.positions,
						firstRegion.representative,
						secondRegion.representative,
					),
					tieBreak: hashNumbers(
						input.seed,
						firstRegion.index,
						secondRegion.index,
						0x7e6,
					),
				});
			}
		}
		regionCandidates.sort(
			(left, right) =>
				left.distance - right.distance ||
				left.tieBreak - right.tieBreak ||
				left.first - right.first ||
				left.second - right.second,
		);
		const selectedRegionPairs = new Set<string>();
		const regionComponents = new DisjointSet(regions.length);
		const selectRegionPair = (first: number, second: number): void => {
			selectedRegionPairs.add(`${Math.min(first, second)}:${Math.max(first, second)}`);
		};
		for (const candidate of regionCandidates) {
			if (regionComponents.union(candidate.first, candidate.second)) {
				selectRegionPair(candidate.first, candidate.second);
			}
		}
		for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
			let neighborCount = 0;
			for (const candidate of regionCandidates) {
				if (
					candidate.first !== regionIndex &&
					candidate.second !== regionIndex
				) {
					continue;
				}
				selectRegionPair(candidate.first, candidate.second);
				neighborCount += 1;
				if (neighborCount >= REGIONAL_SCAFFOLD_NEIGHBORS) {
					break;
				}
			}
		}
		for (const pair of selectedRegionPairs) {
			const [firstText, secondText] = pair.split(':');
			const first = Number(firstText);
			const second = Number(secondText);
			const current = regions[first];
			const neighbor = regions[second];
			if (current === undefined || neighbor === undefined) {
				continue;
			}
			const bridge = nearestBridge(
				input,
				current.members,
				neighbor.members,
				hashNumbers(input.seed, current.index, neighbor.index, 0x7e6),
			);
			if (bridge === undefined) {
				continue;
			}
			components.union(bridge.source, bridge.target);
			appendScaffoldConstraint(
				input,
				options,
				occupiedPairs,
				meanEdgeWeight,
				constraints,
				bridge.source,
				bridge.target,
				REGIONAL_SCAFFOLD_WEIGHT_SCALE,
				hashNumbers(current.index, neighbor.index, 0x2b9),
			);
		}
	}
}

function chooseLandmarks(
	input: SparseStressInput,
	members: readonly number[],
	groupIndex: number,
	groupIndexByNode: Int32Array,
	adjacency: readonly number[][],
	localIndexByNode: Int32Array,
	maximumCount: number,
): LandmarkDistance[] {
	if (members.length === 0 || maximumCount === 0) {
		return [];
	}
	const desiredCount = Math.min(
		maximumCount,
		members.length,
		Math.max(2, Math.ceil(Math.sqrt(members.length))),
	);
	let firstLandmark = members[0] ?? 0;
	let firstDegree = -1;
	let firstTieBreak = -1;
	for (const nodeIndex of members) {
		let degree = 0;
		for (const neighbor of adjacency[nodeIndex] ?? []) {
			if (groupIndexByNode[neighbor] === groupIndex) {
				degree += 1;
			}
		}
		const tieBreak = hashNumbers(input.seed, groupIndex, nodeIndex, 0x51e);
		if (
			degree > firstDegree ||
			(degree === firstDegree && tieBreak > firstTieBreak)
		) {
			firstLandmark = nodeIndex;
			firstDegree = degree;
			firstTieBreak = tieBreak;
		}
	}

	const selected = new Set<number>([firstLandmark]);
	const landmarks: LandmarkDistance[] = [
		{
			landmark: firstLandmark,
			distances: graphDistances(
				firstLandmark,
				members,
				localIndexByNode,
				groupIndex,
				groupIndexByNode,
				adjacency,
			),
		},
	];
	while (landmarks.length < desiredCount) {
		let bestNode = -1;
		let bestGraphSeparation = -1;
		let bestSpatialSeparation = -1;
		let bestTieBreak = -1;
		for (const nodeIndex of members) {
			if (selected.has(nodeIndex)) {
				continue;
			}
			const localIndex = localIndexByNode[nodeIndex];
			if (localIndex === undefined || localIndex < 0) {
				continue;
			}
			let minimumGraphDistance = Number.POSITIVE_INFINITY;
			let minimumSpatialDistance = Number.POSITIVE_INFINITY;
			for (const landmark of landmarks) {
				const distance = landmark.distances[localIndex] ?? -1;
				minimumGraphDistance = Math.min(
					minimumGraphDistance,
					distance < 0 ? 1_000_000 : distance,
				);
				minimumSpatialDistance = Math.min(
					minimumSpatialDistance,
					angularDistance(
						input.positions,
						nodeIndex,
						landmark.landmark,
					),
				);
			}
			const tieBreak = hashNumbers(
				input.seed,
				groupIndex,
				nodeIndex,
				landmarks.length,
				0xfa4,
			);
			if (
				minimumGraphDistance > bestGraphSeparation ||
				(minimumGraphDistance === bestGraphSeparation &&
					minimumSpatialDistance > bestSpatialSeparation) ||
				(minimumGraphDistance === bestGraphSeparation &&
					minimumSpatialDistance === bestSpatialSeparation &&
					tieBreak > bestTieBreak)
			) {
				bestNode = nodeIndex;
				bestGraphSeparation = minimumGraphDistance;
				bestSpatialSeparation = minimumSpatialDistance;
				bestTieBreak = tieBreak;
			}
		}
		if (bestNode < 0) {
			break;
		}
		selected.add(bestNode);
		landmarks.push({
			landmark: bestNode,
			distances: graphDistances(
				bestNode,
				members,
				localIndexByNode,
				groupIndex,
				groupIndexByNode,
				adjacency,
			),
		});
	}
	return landmarks;
}

function sparseTargetAngle(
	input: SparseStressInput,
	options: ResolvedOptions,
	source: number,
	target: number,
	graphDistance: number,
): number {
	const nominalSpacing = clamp(
		0.82 * Math.sqrt((4 * Math.PI) / Math.max(1, input.nodeCount)),
		options.minimumTargetAngle,
		0.55,
	);
	const topologicalTarget =
		nominalSpacing *
		(1 + 0.78 * Math.sqrt(Math.max(0, graphDistance - 1)));
	const currentDistance = angularDistance(input.positions, source, target);
	const positionReference =
		currentDistance > 0
			? clamp(
					currentDistance,
					options.minimumTargetAngle,
					options.maximumTargetAngle,
				)
			: topologicalTarget;
	const organicScale =
		0.84 +
		0.32 *
			hashToUnitFloat(
				input.seed,
				Math.min(source, target),
				Math.max(source, target),
				graphDistance,
				0x57e,
			);
	return clamp(
		(0.82 * topologicalTarget + 0.18 * positionReference) *
			organicScale,
		options.minimumTargetAngle,
		options.maximumTargetAngle,
	);
}

function appendGroupConstraints(
	input: SparseStressInput,
	options: ResolvedOptions,
	members: readonly number[],
	groupIndex: number,
	groupIndexByNode: Int32Array,
	adjacency: readonly number[][],
	occupiedPairs: Set<string>,
	meanEdgeWeight: number,
	localIndexByNode: Int32Array,
	constraints: SparseConstraint[],
): number {
	if (
		members.length < 3 ||
		options.maxLandmarksPerGroup === 0 ||
		options.pairsPerNode === 0
	) {
		return 0;
	}
	for (let localIndex = 0; localIndex < members.length; localIndex += 1) {
		const nodeIndex = members[localIndex];
		if (nodeIndex !== undefined) {
			localIndexByNode[nodeIndex] = localIndex;
		}
	}
	const landmarks = chooseLandmarks(
		input,
		members,
		groupIndex,
		groupIndexByNode,
		adjacency,
		localIndexByNode,
		options.maxLandmarksPerGroup,
	);
	for (const source of members) {
		const sourceLocalIndex = localIndexByNode[source];
		if (sourceLocalIndex === undefined || sourceLocalIndex < 0) {
			continue;
		}
		const candidates = landmarks
			.filter((entry) => {
				const distance = entry.distances[sourceLocalIndex] ?? -1;
				return (
					entry.landmark !== source &&
					distance >= options.minimumGraphDistance &&
					!occupiedPairs.has(pairKey(source, entry.landmark))
				);
			})
			.map((entry) => ({
				landmark: entry.landmark,
				distance: entry.distances[sourceLocalIndex] ?? -1,
				tieBreak: hashNumbers(
					input.seed,
					source,
					entry.landmark,
					0x1ad,
				),
			}))
			.sort(
				(first, second) =>
					second.distance - first.distance ||
					second.tieBreak - first.tieBreak ||
					first.landmark - second.landmark,
			);
		let addedForNode = 0;
		for (const candidate of candidates) {
			if (addedForNode >= options.pairsPerNode) {
				break;
			}
			const key = pairKey(source, candidate.landmark);
			if (occupiedPairs.has(key)) {
				continue;
			}
			occupiedPairs.add(key);
			const low = Math.min(source, candidate.landmark);
			const high = Math.max(source, candidate.landmark);
			const weightVariation =
				0.82 +
				0.36 *
					hashToUnitFloat(
						input.seed,
						low,
						high,
						candidate.distance,
						0x8e1,
					);
			const weight =
				(meanEdgeWeight *
					options.stressWeightScale *
					weightVariation) /
				Math.sqrt(candidate.distance);
			constraints.push({
				source: low,
				target: high,
				weight,
				targetAngle: sparseTargetAngle(
					input,
					options,
					low,
					high,
					candidate.distance,
				),
			});
			addedForNode += 1;
		}
	}
	for (const nodeIndex of members) {
		localIndexByNode[nodeIndex] = -1;
	}
	return landmarks.length;
}

/**
 * Adds a bounded set of landmark-to-node graph-distance constraints.
 *
 * The routine performs only a constant number of BFS traversals per group and
 * adds at most `nodeCount * pairsPerNode` stress constraints. Folder-aware
 * inputs also receive a bounded local initial-geometry mesh. Three local
 * neighbors per node keep each bounded region shape-rigid, a connectivity pass
 * joins any remaining components, and three forward spatial neighbors per
 * region prevent a folder from folding around a single hinge. This adds at
 * most `nodeCount * 6` scaffold constraints and uses no centroid or radial
 * target. No generated pair crosses a top-level folder.
 */
export function buildSparseStressConstraints(
	input: SparseStressInput,
): SparseStressResult {
	validateInput(input);
	const options = resolveOptions(input.options);
	const { adjacency, occupiedPairs, meanEdgeWeight } =
		buildAdjacency(input);
	const { groups, groupIndexByNode } = createGroups(input);
	const constraints: SparseConstraint[] = [];
	const localIndexByNode = new Int32Array(input.nodeCount);
	localIndexByNode.fill(-1);
	let landmarkCount = 0;
	for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
		const members = groups[groupIndex];
		if (members === undefined) {
			continue;
		}
		landmarkCount += appendGroupConstraints(
			input,
			options,
			members,
			groupIndex,
			groupIndexByNode,
			adjacency,
			occupiedPairs,
			meanEdgeWeight,
			localIndexByNode,
			constraints,
		);
	}
	appendFolderScaffoldConstraints(
		input,
		options,
		occupiedPairs,
		meanEdgeWeight,
		constraints,
	);
	constraints.sort(
		(first, second) =>
			first.source - second.source ||
			first.target - second.target ||
			first.targetAngle - second.targetAngle,
	);

	const originalEdgeCount = input.edgeWeights.length;
	const outputEdgeCount = originalEdgeCount + constraints.length;
	const edgeEndpoints = new Uint32Array(outputEdgeCount * 2);
	const edgeWeights = new Float32Array(outputEdgeCount);
	const targetAngles = new Float32Array(outputEdgeCount);
	edgeEndpoints.set(input.edgeEndpoints);
	edgeWeights.set(input.edgeWeights);
	for (
		let constraintIndex = 0;
		constraintIndex < constraints.length;
		constraintIndex += 1
	) {
		const constraint = constraints[constraintIndex];
		if (constraint === undefined) {
			continue;
		}
		const outputIndex = originalEdgeCount + constraintIndex;
		edgeEndpoints[outputIndex * 2] = constraint.source;
		edgeEndpoints[outputIndex * 2 + 1] = constraint.target;
		edgeWeights[outputIndex] = constraint.weight;
		targetAngles[outputIndex] = constraint.targetAngle;
	}
	return {
		edgeEndpoints,
		edgeWeights,
		targetAngles,
		addedPairCount: constraints.length,
		landmarkCount,
	};
}
