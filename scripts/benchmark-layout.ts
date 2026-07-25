import { performance } from 'node:perf_hooks';
import process from 'node:process';

import { initializeFullLayout } from '../src/layout/initialization';
import type {
	LayoutFinalDiagnostics,
	LayoutSolverInput,
} from '../src/layout/layoutTypes';
import { SphericalSolver } from '../src/layout/SphericalSolver';
import {
	addSyntheticLinks,
	appendSyntheticNodes,
	buildRefreshBenchmarkPlan,
	createSyntheticGraph,
	measureCoverage,
	measureExistingNodeDisplacement,
	nodeIdsAt,
	type CoverageMetrics,
	type DisplacementMetrics,
	type SyntheticGraph,
	validateDiagnostics,
} from './benchmark-layout-helpers';

interface BenchmarkResult {
	readonly name: string;
	readonly mode: 'renew' | 'refresh';
	readonly nodeCount: number;
	readonly edgeCount: number;
	readonly iterationLimit: number;
	readonly elapsedMs: number;
	readonly diagnostics: LayoutFinalDiagnostics;
	readonly coverage: CoverageMetrics;
	readonly displacement: DisplacementMetrics;
	readonly positions: Float32Array;
	readonly largeChangeWarning: boolean | null;
}

const BASE_SEED = 0x5a17c0de;
const REFRESH_DISPLACEMENT_CAP = (12 * Math.PI) / 180;

function runSolver(
	name: string,
	graph: SyntheticGraph,
	input: LayoutSolverInput,
	iterationLimit: number,
	existingPositions: Float32Array | null,
	existingNodeCount: number,
	largeChangeWarning: boolean | null,
): BenchmarkResult {
	const startedAt = performance.now();
	const solved = new SphericalSolver(input).solveSync();
	const elapsedMs = performance.now() - startedAt;
	if (solved.status !== 'completed') {
		throw new Error(`${name} was cancelled unexpectedly.`);
	}
	const displacement =
		existingPositions === null
			? { maximumRadians: 0, meanRadians: 0 }
			: measureExistingNodeDisplacement(
					existingPositions,
					solved.positions,
					existingNodeCount,
				);
	validateDiagnostics(
		solved.diagnostics,
		displacement,
		existingPositions === null ? null : REFRESH_DISPLACEMENT_CAP,
	);
	return {
		name,
		mode: input.mode === 'refresh' ? 'refresh' : 'renew',
		nodeCount: graph.nodeIds.length,
		edgeCount: graph.edgeWeights.length,
		iterationLimit,
		elapsedMs,
		diagnostics: solved.diagnostics,
		coverage: measureCoverage(solved.positions),
		displacement,
		positions: solved.positions,
		largeChangeWarning,
	};
}

function runRenew(nodeCount: number, iterationLimit: number): BenchmarkResult {
	const name = `renew-${nodeCount}`;
	const graph = createSyntheticGraph(nodeCount);
	return runSolver(
		name,
		graph,
		{
			operationId: name,
			mode: 'renew',
			graphSignature: name,
			effectiveSeed: BASE_SEED + nodeCount,
			positions: initializeFullLayout(
				nodeCount,
				BASE_SEED + nodeCount,
			),
			edgeEndpoints: graph.edgeEndpoints,
			edgeWeights: graph.edgeWeights,
			settings: {
				maxIterations: iterationLimit,
				convergenceTolerance: 1e-10,
				convergenceWindow: iterationLimit + 1,
				exactRepulsionThreshold: 200,
				negativeSamplesPerNode: 12,
				progressIntervalIterations: iterationLimit,
			},
		},
		iterationLimit,
		null,
		0,
		null,
	);
}

function runRefresh(
	name: string,
	graph: SyntheticGraph,
	committedPositions: Float32Array,
	existingNodeCount: number,
	directlyAffectedNodeIds: ReadonlySet<string>,
	iterationLimit: number,
	warmupIterations: number,
	expectedLargeChangeWarning?: boolean,
): BenchmarkResult {
	const planned = buildRefreshBenchmarkPlan({
		name,
		graph,
		committedPositions,
		existingNodeCount,
		directlyAffectedNodeIds,
		effectiveSeed: BASE_SEED + graph.nodeIds.length,
		maximumOldNodeDisplacementRadians: REFRESH_DISPLACEMENT_CAP,
		iterationLimit,
		warmupIterations,
		expectedLargeChangeWarning,
	});
	return runSolver(
		name,
		graph,
		planned.input,
		iterationLimit,
		committedPositions,
		existingNodeCount,
		planned.plan.warnLargeChange,
	);
}

function formatNumber(value: number, digits = 6): string {
	return Number.isInteger(value)
		? value.toString()
		: value.toFixed(digits);
}

function formatVector(values: readonly number[]): string {
	return `[${values.map((value) => value.toFixed(6)).join(', ')}]`;
}

function formatResult(result: BenchmarkResult): string {
	const diagnostics = result.diagnostics;
	const degrees = 180 / Math.PI;
	return [
		`[${result.name}]`,
		`  mode=${result.mode} phase=${diagnostics.phase} nodes=${result.nodeCount} edges=${result.edgeCount}`,
		`  movable=${diagnostics.movableNodeCount} iterations=${diagnostics.iteration}/${result.iterationLimit} elapsedMs=${result.elapsedMs.toFixed(2)}`,
		`  repulsionMode=${diagnostics.repulsionMode} repulsionPairs=${diagnostics.evaluatedRepulsionPairs}`,
		`  meanVectorNorm=${result.coverage.meanVectorNorm.toExponential(4)} covarianceDiagonal=${formatVector(result.coverage.covarianceDiagonal)}`,
		`  secondMomentEigenvalues=${formatVector(result.coverage.secondMomentEigenvalues)} maximumNormError=${diagnostics.maximumNormError.toExponential(4)}`,
		`  hardFixed=${diagnostics.hardFixedNodeCount} anchored=${diagnostics.anchoredNodeCount} capped=${diagnostics.cappedNodeCount}`,
		`  oldDisplacementMaxRad=${formatNumber(result.displacement.maximumRadians)} oldDisplacementMeanRad=${formatNumber(result.displacement.meanRadians)}`,
		`  oldDisplacementMaxDeg=${formatNumber(result.displacement.maximumRadians * degrees, 3)} oldDisplacementMeanDeg=${formatNumber(result.displacement.meanRadians * degrees, 3)}`,
		`  largeChangeWarning=${result.largeChangeWarning === null ? 'n/a' : String(result.largeChangeWarning)}`,
	].join('\n');
}

function addedNodeIds(
	graph: SyntheticGraph,
	existingNodeCount: number,
): ReadonlySet<string> {
	return new Set(graph.nodeIds.slice(existingNodeCount));
}

function runBenchmarks(): readonly BenchmarkResult[] {
	const renew100 = runRenew(100, 40);
	const renew1000 = runRenew(1_000, 28);
	const renew5000 = runRenew(5_000, 14);
	const baseGraph = createSyntheticGraph(1_000);

	const graphWithNewNodes = appendSyntheticNodes(baseGraph, 50);
	const refreshNewNodes = runRefresh(
		'refresh-1000-plus-50',
		graphWithNewNodes,
		renew1000.positions,
		1_000,
		addedNodeIds(graphWithNewNodes, 1_000),
		28,
		8,
	);

	const smallIndices = [11, 211, 503, 887] as const;
	const smallGraph = addSyntheticLinks(baseGraph, smallIndices);
	const refreshSmallLinkChange = runRefresh(
		'refresh-small-link-change',
		smallGraph,
		renew1000.positions,
		1_000,
		nodeIdsAt(smallGraph, smallIndices),
		20,
		0,
		false,
	);

	const largeIndices = Array.from(
		{ length: 250 },
		(_, index) => index * 4,
	);
	const largeGraph = addSyntheticLinks(baseGraph, largeIndices);
	const refreshLargeChange = runRefresh(
		'refresh-large-change',
		largeGraph,
		renew1000.positions,
		1_000,
		nodeIdsAt(largeGraph, largeIndices),
		20,
		0,
		true,
	);

	return [
		renew100,
		renew1000,
		renew5000,
		refreshNewNodes,
		refreshSmallLinkChange,
		refreshLargeChange,
	];
}

try {
	process.stdout.write(
		[
			'Spherical Graph deterministic layout benchmark',
			'Single-process synchronous solver; elapsed times are local measurements, not universal performance guarantees.',
			'Fixed iteration caps: renew 100=40, renew 1000=28, renew 5000=14, refresh new=28 (8 warm-up), refresh link changes=20.',
			'Repulsion is exact through 200 nodes and deterministic sampled above that threshold.',
			'',
		].join('\n'),
	);
	const results = runBenchmarks();
	process.stdout.write(`${results.map(formatResult).join('\n\n')}\n`);
} catch (error) {
	const message = error instanceof Error ? error.stack ?? error.message : String(error);
	process.stderr.write(`Layout benchmark failed:\n${message}\n`);
	process.exitCode = 1;
}
