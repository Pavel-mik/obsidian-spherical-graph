import type { GraphDiff } from '../graph/graphDiff';
import type { GraphData } from '../graph/graphTypes';
import { tryNormalizeVec3, writeVec3 } from '../geometry/vector3';
import type { PersistedLayoutSnapshot } from '../persistence/layoutState';
import type { SphericalGraphSettings } from '../settings/settings';
import type {
	LayoutOperationPayload,
	LayoutOperationPlanner,
	LayoutPlanContext,
} from './LayoutLifecycleController';
import {
	createRefreshPlan,
	type RefreshPlan,
} from './RefreshPlanner';
import {
	initializeFullLayout,
	initializeRefreshLayout,
} from './initialization';
import type {
	RefreshConstraints,
	SolverSettings,
} from './layoutTypes';

function graphBuffers(graph: GraphData): {
	readonly edgeEndpoints: Uint32Array;
	readonly edgeWeights: Float32Array;
} {
	const edgeEndpoints = new Uint32Array(graph.edges.length * 2);
	const edgeWeights = new Float32Array(graph.edges.length);
	for (let index = 0; index < graph.edges.length; index += 1) {
		const edge = graph.edges[index];
		if (edge === undefined) {
			continue;
		}
		edgeEndpoints[index * 2] = edge.source;
		edgeEndpoints[index * 2 + 1] = edge.target;
		edgeWeights[index] = edge.weight;
	}
	return { edgeEndpoints, edgeWeights };
}

function solverSettings(
	settings: SphericalGraphSettings,
): Partial<SolverSettings> {
	return {
		springStrength: settings.layout.springStrength,
		repulsionStrength: settings.layout.repulsionStrength,
		centroidStrength: settings.layout.centroidCoverageStrength,
		isotropyStrength: settings.layout.isotropyStrength,
		damping: settings.layout.damping,
		stepSize: settings.layout.initialStep,
		maxAngularVelocity: settings.layout.maxAngularVelocity,
		maxIterations: settings.layout.maxIterations,
		convergenceTolerance: settings.layout.convergenceTolerance,
		exactRepulsionThreshold:
			settings.layout.exactRepulsionThreshold,
		negativeSamplesPerNode:
			settings.layout.negativeSamplesPerNode,
		progressIntervalMs:
			settings.layout.progressReportIntervalMs,
		refreshWarmupIterations:
			settings.refresh.newNodeWarmupIterations,
	};
}

function renameSourceByTarget(
	diff: GraphDiff,
): ReadonlyMap<string, string> {
	return new Map(
		diff.renamedNodes.map((rename) => [
			rename.newPath,
			rename.oldPath,
		]),
	);
}

function committedBuffers(
	graph: GraphData,
	snapshot: PersistedLayoutSnapshot,
	diff: GraphDiff,
): {
	readonly positions: Float32Array;
	readonly existingNodeMask: Uint8Array;
} {
	const positions = new Float32Array(graph.nodes.length * 3);
	const existingNodeMask = new Uint8Array(graph.nodes.length);
	const renameSources = renameSourceByTarget(diff);
	for (const node of graph.nodes) {
		const value =
			snapshot.positionsByPath[node.path] ??
			snapshot.positionsByPath[
				renameSources.get(node.path) ?? ''
			];
		const normalized =
			value === undefined ? null : tryNormalizeVec3(value);
		if (normalized !== null) {
			writeVec3(positions, node.index, normalized);
			existingNodeMask[node.index] = 1;
		}
	}
	return { positions, existingNodeMask };
}

function countOnes(mask: Uint8Array): number {
	let count = 0;
	for (const value of mask) {
		count += value === 1 ? 1 : 0;
	}
	return count;
}

/**
 * Bridges vault graph/snapshot state into compact transferable solver buffers.
 * It never mutates the committed snapshot.
 */
export class SphericalLayoutPlanner implements LayoutOperationPlanner {
	private readonly getSettings: () => SphericalGraphSettings;
	private latestRefreshPlan: RefreshPlan | null = null;

	constructor(getSettings: () => SphericalGraphSettings) {
		this.getSettings = getSettings;
	}

	get lastRefreshPlan(): RefreshPlan | null {
		return this.latestRefreshPlan;
	}

	createPayload(context: LayoutPlanContext): LayoutOperationPayload {
		const settings = this.getSettings();
		const { graph } = context;
		const buffers = graphBuffers(graph);
		const resolvedSettings = solverSettings(settings);

		if (context.mode !== 'refresh') {
			this.latestRefreshPlan = null;
			const movableMask = new Uint8Array(graph.nodes.length);
			movableMask.fill(1);
			return {
				positions: initializeFullLayout(
					graph.nodes.length,
					context.effectiveSeed,
				),
				...buffers,
				movableMask,
				settings: resolvedSettings,
			};
		}

		const snapshot = context.committedSnapshot;
		const diff = context.diff;
		if (
			snapshot === undefined ||
			diff === undefined ||
			!diff.requiresLayout
		) {
			throw new Error(
				'Refresh requires a committed snapshot and a real pending graph diff.',
			);
		}
		const committed = committedBuffers(graph, snapshot, diff);
		const initialized = initializeRefreshLayout({
			nodeCount: graph.nodes.length,
			committedPositions: committed.positions,
			existingNodeMask: committed.existingNodeMask,
			edgeEndpoints: buffers.edgeEndpoints,
			edgeWeights: buffers.edgeWeights,
			effectiveSeed: context.effectiveSeed,
		});
		const plan = createRefreshPlan({
			nodeIds: graph.nodes.map((node) => node.id),
			edgeEndpoints: buffers.edgeEndpoints,
			existingNodeMask: initialized.existingNodeMask,
			directlyAffectedNodeIds: new Set(diff.affectedNodeIds),
			filterChanged: diff.filterChanged,
			settings: {
				affectedNeighborhoodHops:
					settings.refresh.affectedNeighborhoodHops,
				anchorStrength: settings.refresh.anchorStrength,
				directlyAffectedAnchorMultiplier:
					settings.refresh.affectedNodeAnchorMultiplier,
				maximumOldNodeDisplacementRadians:
					(settings.refresh.maxOldNodeDisplacementDegrees *
						Math.PI) /
					180,
				largeChangeWarningRatio:
					settings.refresh.largeChangeWarningRatio,
			},
		});
		this.latestRefreshPlan = plan;
		const existingCount = countOnes(initialized.existingNodeMask);
		const hardFixedCount = countOnes(plan.hardFixedMask);
		const refresh: RefreshConstraints = {
			existingNodeMask: initialized.existingNodeMask,
			newNodeMask: initialized.newNodeMask,
			relaxationMovableMask: plan.relaxationMovableMask,
			anchorPositions: initialized.positions.slice(),
			anchorStrengths: plan.anchorStrengths,
			maxAnchorDistances: plan.maxAnchorDistances,
			alignToAnchors:
				existingCount > 0 && hardFixedCount === 0,
		};
		return {
			positions: initialized.positions,
			...buffers,
			refresh,
			settings: resolvedSettings,
		};
	}
}
