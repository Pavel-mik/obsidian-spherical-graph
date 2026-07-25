import {
	computeSphericalCoverage,
	geodesicDistance,
} from '../src/geometry/sphericalGeometry';
import { readVec3 } from '../src/geometry/vector3';
import { initializeRefreshLayout } from '../src/layout/initialization';
import type {
	LayoutFinalDiagnostics,
	LayoutSolverInput,
} from '../src/layout/layoutTypes';
import {
	createRefreshPlan,
	type RefreshPlan,
} from '../src/layout/RefreshPlanner';

export interface SyntheticGraph {
	readonly nodeIds: readonly string[];
	readonly edgeEndpoints: Uint32Array;
	readonly edgeWeights: Float32Array;
}

export interface RefreshBenchmarkInput {
	readonly name: string;
	readonly graph: SyntheticGraph;
	readonly committedPositions: Float32Array;
	readonly existingNodeCount: number;
	readonly directlyAffectedNodeIds: ReadonlySet<string>;
	readonly effectiveSeed: number;
	readonly maximumOldNodeDisplacementRadians: number;
	readonly iterationLimit: number;
	readonly warmupIterations: number;
	readonly expectedLargeChangeWarning?: boolean;
}

export interface RefreshBenchmarkPlan {
	readonly input: LayoutSolverInput;
	readonly plan: RefreshPlan;
}

export interface DisplacementMetrics {
	readonly maximumRadians: number;
	readonly meanRadians: number;
}

export interface CoverageMetrics {
	readonly meanVectorNorm: number;
	readonly covarianceDiagonal: readonly [number, number, number];
	readonly secondMomentEigenvalues: readonly [number, number, number];
}

function edgeKey(source: number, target: number): string {
	return source < target ? `${source}:${target}` : `${target}:${source}`;
}

function addEdge(
	edges: Map<string, readonly [number, number]>,
	source: number,
	target: number,
	nodeCount: number,
): void {
	if (
		source === target ||
		source < 0 ||
		target < 0 ||
		source >= nodeCount ||
		target >= nodeCount
	) {
		return;
	}
	const key = edgeKey(source, target);
	if (!edges.has(key)) {
		edges.set(key, source < target ? [source, target] : [target, source]);
	}
}

function graphFromEdges(
	nodeCount: number,
	edges: Iterable<readonly [number, number]>,
): SyntheticGraph {
	const endpoints: number[] = [];
	for (const [source, target] of edges) {
		endpoints.push(source, target);
	}
	return {
		nodeIds: Array.from(
			{ length: nodeCount },
			(_, index) => `node-${index.toString().padStart(5, '0')}`,
		),
		edgeEndpoints: Uint32Array.from(endpoints),
		edgeWeights: new Float32Array(endpoints.length / 2).fill(1),
	};
}

export function createSyntheticGraph(nodeCount: number): SyntheticGraph {
	if (!Number.isSafeInteger(nodeCount) || nodeCount < 0) {
		throw new RangeError('nodeCount must be a non-negative integer.');
	}
	const edges = new Map<string, readonly [number, number]>();
	for (let index = 0; index < nodeCount; index += 1) {
		addEdge(edges, index, (index + 1) % nodeCount, nodeCount);
		addEdge(edges, index, (index + 7) % nodeCount, nodeCount);
		addEdge(
			edges,
			index,
			(index * 37 + 17) % nodeCount,
			nodeCount,
		);
	}
	return graphFromEdges(nodeCount, edges.values());
}

export function appendSyntheticNodes(
	base: SyntheticGraph,
	addedNodeCount: number,
): SyntheticGraph {
	if (!Number.isSafeInteger(addedNodeCount) || addedNodeCount < 0) {
		throw new RangeError(
			'addedNodeCount must be a non-negative integer.',
		);
	}
	const baseNodeCount = base.nodeIds.length;
	const nodeCount = baseNodeCount + addedNodeCount;
	const edges = new Map<string, readonly [number, number]>();
	for (
		let offset = 0;
		offset < base.edgeEndpoints.length;
		offset += 2
	) {
		addEdge(
			edges,
			base.edgeEndpoints[offset] ?? 0,
			base.edgeEndpoints[offset + 1] ?? 0,
			nodeCount,
		);
	}
	for (let added = 0; added < addedNodeCount; added += 1) {
		const index = baseNodeCount + added;
		if (baseNodeCount > 0) {
			addEdge(edges, index, added % baseNodeCount, nodeCount);
			addEdge(
				edges,
				index,
				(added * 41 + 13) % baseNodeCount,
				nodeCount,
			);
		}
		if (added > 0) {
			addEdge(edges, index, index - 1, nodeCount);
		}
	}
	return graphFromEdges(nodeCount, edges.values());
}

export function addSyntheticLinks(
	base: SyntheticGraph,
	affectedNodeIndices: readonly number[],
): SyntheticGraph {
	const nodeCount = base.nodeIds.length;
	const edges = new Map<string, readonly [number, number]>();
	for (
		let offset = 0;
		offset < base.edgeEndpoints.length;
		offset += 2
	) {
		addEdge(
			edges,
			base.edgeEndpoints[offset] ?? 0,
			base.edgeEndpoints[offset + 1] ?? 0,
			nodeCount,
		);
	}
	for (const source of affectedNodeIndices) {
		addEdge(
			edges,
			source,
			(source * 97 + 211) % Math.max(1, nodeCount),
			nodeCount,
		);
	}
	return graphFromEdges(nodeCount, edges.values());
}

export function nodeIdsAt(
	graph: SyntheticGraph,
	indices: readonly number[],
): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const index of indices) {
		const id = graph.nodeIds[index];
		if (id !== undefined) {
			ids.add(id);
		}
	}
	return ids;
}

export function buildRefreshBenchmarkPlan(
	benchmark: RefreshBenchmarkInput,
): RefreshBenchmarkPlan {
	const nodeCount = benchmark.graph.nodeIds.length;
	if (
		benchmark.existingNodeCount < 0 ||
		benchmark.existingNodeCount > nodeCount ||
		benchmark.committedPositions.length !==
			benchmark.existingNodeCount * 3
	) {
		throw new RangeError(
			'Committed refresh positions do not match the existing node count.',
		);
	}

	const committedPositions = new Float32Array(nodeCount * 3);
	committedPositions.set(benchmark.committedPositions);
	const requestedExistingMask = new Uint8Array(nodeCount);
	requestedExistingMask.fill(1, 0, benchmark.existingNodeCount);
	const initialized = initializeRefreshLayout({
		nodeCount,
		committedPositions,
		existingNodeMask: requestedExistingMask,
		edgeEndpoints: benchmark.graph.edgeEndpoints,
		edgeWeights: benchmark.graph.edgeWeights,
		effectiveSeed: benchmark.effectiveSeed,
	});
	const plan = createRefreshPlan({
		nodeIds: benchmark.graph.nodeIds,
		edgeEndpoints: benchmark.graph.edgeEndpoints,
		existingNodeMask: initialized.existingNodeMask,
		directlyAffectedNodeIds: benchmark.directlyAffectedNodeIds,
		settings: {
			affectedNeighborhoodHops: 2,
			anchorStrength: 0.16,
			directlyAffectedAnchorMultiplier: 0.45,
			maximumOldNodeDisplacementRadians:
				benchmark.maximumOldNodeDisplacementRadians,
			largeChangeWarningRatio: 0.2,
		},
	});
	if (plan.noOp) {
		throw new Error(`${benchmark.name} unexpectedly produced a no-op plan.`);
	}
	if (
		benchmark.expectedLargeChangeWarning !== undefined &&
		plan.warnLargeChange !== benchmark.expectedLargeChangeWarning
	) {
		throw new Error(
			`${benchmark.name} large-change warning was ${String(plan.warnLargeChange)}, expected ${String(benchmark.expectedLargeChangeWarning)}.`,
		);
	}

	return {
		plan,
		input: {
			operationId: benchmark.name,
			mode: 'refresh',
			graphSignature: benchmark.name,
			effectiveSeed: benchmark.effectiveSeed,
			positions: initialized.positions,
			edgeEndpoints: benchmark.graph.edgeEndpoints,
			edgeWeights: benchmark.graph.edgeWeights,
			refresh: {
				existingNodeMask: initialized.existingNodeMask,
				newNodeMask: initialized.newNodeMask,
				relaxationMovableMask: plan.relaxationMovableMask,
				anchorPositions: committedPositions,
				anchorStrengths: plan.anchorStrengths,
				maxAnchorDistances: plan.maxAnchorDistances,
				alignToAnchors: plan.hardFixedMask.every(
					(value) => value === 0,
				),
			},
			settings: {
				maxIterations: benchmark.iterationLimit,
				refreshWarmupIterations: benchmark.warmupIterations,
				convergenceTolerance: 1e-10,
				convergenceWindow: benchmark.iterationLimit + 1,
				exactRepulsionThreshold: 200,
				negativeSamplesPerNode: 12,
				progressIntervalIterations: benchmark.iterationLimit,
			},
		},
	};
}

export function measureExistingNodeDisplacement(
	committedPositions: Float32Array,
	resultPositions: Float32Array,
	existingNodeCount: number,
): DisplacementMetrics {
	let maximumRadians = 0;
	let sumRadians = 0;
	for (let index = 0; index < existingNodeCount; index += 1) {
		const displacement = geodesicDistance(
			readVec3(committedPositions, index),
			readVec3(resultPositions, index),
		);
		maximumRadians = Math.max(maximumRadians, displacement);
		sumRadians += displacement;
	}
	return {
		maximumRadians,
		meanRadians:
			existingNodeCount === 0 ? 0 : sumRadians / existingNodeCount,
	};
}

function symmetricEigenvalues(
	moment: readonly [
		xx: number,
		xy: number,
		xz: number,
		yy: number,
		yz: number,
		zz: number,
	],
): readonly [number, number, number] {
	const [xx, xy, xz, yy, yz, zz] = moment;
	const offDiagonalEnergy = xy * xy + xz * xz + yz * yz;
	if (offDiagonalEnergy <= Number.EPSILON) {
		return [xx, yy, zz].sort((left, right) => right - left) as [
			number,
			number,
			number,
		];
	}
	const center = (xx + yy + zz) / 3;
	const variance =
		(xx - center) ** 2 +
		(yy - center) ** 2 +
		(zz - center) ** 2 +
		2 * offDiagonalEnergy;
	const scale = Math.sqrt(variance / 6);
	const bxx = (xx - center) / scale;
	const bxy = xy / scale;
	const bxz = xz / scale;
	const byy = (yy - center) / scale;
	const byz = yz / scale;
	const bzz = (zz - center) / scale;
	const determinant =
		bxx * (byy * bzz - byz * byz) -
		bxy * (bxy * bzz - byz * bxz) +
		bxz * (bxy * byz - byy * bxz);
	const angle =
		Math.acos(Math.max(-1, Math.min(1, determinant / 2))) / 3;
	const first = center + 2 * scale * Math.cos(angle);
	const third =
		center + 2 * scale * Math.cos(angle + (2 * Math.PI) / 3);
	const second = 3 * center - first - third;
	return [first, second, third].sort(
		(left, right) => right - left,
	) as [number, number, number];
}

export function measureCoverage(
	positions: Float32Array,
): CoverageMetrics {
	const coverage = computeSphericalCoverage(positions);
	return {
		meanVectorNorm: coverage.meanVectorNorm,
		covarianceDiagonal: coverage.covarianceDiagonal,
		secondMomentEigenvalues: symmetricEigenvalues(
			coverage.secondMoment,
		),
	};
}

export function validateDiagnostics(
	diagnostics: LayoutFinalDiagnostics,
	displacement: DisplacementMetrics,
	maximumAllowedDisplacement: number | null,
): void {
	if (
		!Number.isFinite(diagnostics.maximumNormError) ||
		diagnostics.maximumNormError > 1e-5
	) {
		throw new Error(
			`Maximum unit-vector norm error is invalid: ${diagnostics.maximumNormError}.`,
		);
	}
	if (
		maximumAllowedDisplacement !== null &&
		displacement.maximumRadians >
			maximumAllowedDisplacement + 2e-6
	) {
		throw new Error(
			`Refresh displacement ${displacement.maximumRadians} exceeded cap ${maximumAllowedDisplacement}.`,
		);
	}
}
