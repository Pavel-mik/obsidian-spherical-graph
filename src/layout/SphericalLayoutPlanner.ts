import type { GraphDiff } from '../graph/graphDiff';
import type { GraphData } from '../graph/graphTypes';
import { nodeCollisionAngularRadius } from '../geometry/nodeMarkerMetrics';
import { tryNormalizeVec3, writeVec3 } from '../geometry/vector3';
import type { PersistedLayoutSnapshot } from '../persistence/layoutState';
import {
	autoGlobeSizeForNodeCount,
	shouldAutoSizeGlobe,
} from '../settings/autoGlobeSize';
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
	initializeRefreshLayout,
} from './initialization';
import {
	directoryAwareEdgeWeights,
	directoryFolderIndexByNode,
	directoryRegionIndexByNode,
	initializeDirectoryLayout,
	initializeDirectoryOrphanPositions,
} from './directoryInitialization';
import { deriveCoastalPortLayout } from './coastalPortLayout';
import { buildSparseStressConstraints } from './sparseStress';
import { topLevelFolder } from '../geography/directorySemantics';
import {
	createDirectoryTerritoryPlan,
	restoreDirectoryTerritoryPlan,
	seedDirectoryNodesInTerritories,
	type DirectoryTerritoryPlan,
} from '../geography/directoryTerritories';
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

function collisionAngularRadii(
	graph: GraphData,
	settings: SphericalGraphSettings,
	mode: LayoutPlanContext['mode'],
): Float32Array {
	const globeSize = shouldAutoSizeGlobe(mode)
		? autoGlobeSizeForNodeCount(graph.nodes.length)
		: settings.appearance.globeSize;
	return Float32Array.from(graph.nodes, (node) =>
		nodeCollisionAngularRadius(
			globeSize,
			node.degree,
			settings.appearance.sizeNodesByDegree,
		),
	);
}

function solverGraphBuffers(
	graph: GraphData,
	positions: Float32Array,
	folderIndexByNode: Int32Array,
	regionIndexByNode: Int32Array,
	effectiveSeed: number,
): {
	readonly edgeEndpoints: Uint32Array;
	readonly edgeWeights: Float32Array;
	readonly edgeTargetAngles: Float32Array;
	readonly coastalPortScores: Float32Array;
	readonly coastalPortDirections: Float32Array;
} {
	const raw = graphBuffers(graph);
	const sparse = buildSparseStressConstraints({
		nodeCount: graph.nodes.length,
		edgeEndpoints: raw.edgeEndpoints,
		edgeWeights: directoryAwareEdgeWeights(
			graph,
			folderIndexByNode,
		),
		positions,
		folderIndexByNode,
		regionIndexByNode,
		seed: effectiveSeed,
	});
	const ports = deriveCoastalPortLayout(
		graph,
		positions,
		folderIndexByNode,
	);
	return {
		edgeEndpoints: sparse.edgeEndpoints,
		edgeWeights: sparse.edgeWeights,
		edgeTargetAngles: sparse.targetAngles,
		coastalPortScores: ports.portScores,
		coastalPortDirections: ports.portDirections,
	};
}

function renameSourceByTarget(
	diff: GraphDiff,
): ReadonlyMap<string, string> {
	const crossFolderPairCounts = new Map<string, number>();
	for (const rename of diff.renamedNodes) {
		const oldFolder = topLevelFolder(rename.oldPath);
		const newFolder = topLevelFolder(rename.newPath);
		if (
			oldFolder !== undefined &&
			newFolder !== undefined &&
			oldFolder !== newFolder
		) {
			const key = `${oldFolder}\u0000${newFolder}`;
			crossFolderPairCounts.set(
				key,
				(crossFolderPairCounts.get(key) ?? 0) + 1,
			);
		}
	}
	return new Map(
		diff.renamedNodes
			.filter((rename) => {
				const oldFolder = topLevelFolder(rename.oldPath);
				const newFolder = topLevelFolder(rename.newPath);
				return (
					oldFolder === newFolder ||
					(oldFolder !== undefined &&
						newFolder !== undefined &&
						(crossFolderPairCounts.get(
							`${oldFolder}\u0000${newFolder}`,
						) ?? 0) >= 2)
				);
			})
			.map((rename) => [rename.newPath, rename.oldPath]),
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
		const resolvedSettings = solverSettings(settings);
		const collisionRadii = collisionAngularRadii(
			graph,
			settings,
			context.mode,
		);

		if (context.mode !== 'refresh') {
			this.latestRefreshPlan = null;
			const movableMask = new Uint8Array(graph.nodes.length);
			for (const node of graph.nodes) {
				movableMask[node.index] = node.degree === 0 ? 0 : 1;
			}
			const initialized = initializeDirectoryLayout(
				graph,
				context.effectiveSeed,
			);
			const territory = createDirectoryTerritoryPlan(
				graph,
				initialized.positions,
				initialized.folderIndexByNode,
				context.effectiveSeed,
			);
			const seededPositions = territory.folderKeys.length === 0
				? initialized.positions
				: seedDirectoryNodesInTerritories(
						graph,
						initialized.positions,
						initialized.folderIndexByNode,
						territory,
						context.effectiveSeed,
					);
			const solverGraph = solverGraphBuffers(
				graph,
				seededPositions,
				initialized.folderIndexByNode,
				initialized.regionIndexByNode,
				context.effectiveSeed,
			);
			return {
				positions: seededPositions,
				edgeEndpoints: solverGraph.edgeEndpoints,
				edgeWeights: solverGraph.edgeWeights,
				edgeTargetAngles: solverGraph.edgeTargetAngles,
				folderIndexByNode: initialized.folderIndexByNode,
				regionIndexByNode: initialized.regionIndexByNode,
				collisionAngularRadii: collisionRadii,
				coastalPortScores: solverGraph.coastalPortScores,
				coastalPortDirections:
					solverGraph.coastalPortDirections,
				...(territory.folderKeys.length === 0
					? {}
					: { territory: territoryPayload(territory) }),
				movableMask,
				settings: resolvedSettings,
			};
		}

		const buffers = graphBuffers(graph);
		const folderIndexByNode =
			directoryFolderIndexByNode(graph);
		const regionIndexByNode =
			directoryRegionIndexByNode(graph);
		const directoryEdgeWeights = directoryAwareEdgeWeights(
			graph,
			folderIndexByNode,
		);
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
			edgeWeights: directoryEdgeWeights,
			effectiveSeed: context.effectiveSeed,
		});
		const newOrphanMask = new Uint8Array(graph.nodes.length);
		let hasNewOrphans = false;
		for (const node of graph.nodes) {
			if (
				node.degree === 0 &&
				initialized.newNodeMask[node.index] === 1
			) {
				newOrphanMask[node.index] = 1;
				hasNewOrphans = true;
			}
		}
		if (hasNewOrphans) {
			const orphanPositions = initializeDirectoryOrphanPositions(
				graph,
				context.effectiveSeed,
			);
			for (let index = 0; index < graph.nodes.length; index += 1) {
				if (newOrphanMask[index] !== 1) {
					continue;
				}
				const position = orphanPositions.get(index);
				if (position !== undefined) {
					writeVec3(initialized.positions, index, position);
				}
			}
		}
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
		const newNodeMask = initialized.newNodeMask.slice();
		const relaxationMovableMask =
			plan.relaxationMovableMask.slice();
		for (let index = 0; index < newOrphanMask.length; index += 1) {
			if (newOrphanMask[index] === 1) {
				newNodeMask[index] = 0;
				relaxationMovableMask[index] = 0;
			}
		}
		const refresh: RefreshConstraints = {
			existingNodeMask: initialized.existingNodeMask,
			newNodeMask,
			relaxationMovableMask,
			anchorPositions: initialized.positions.slice(),
			anchorStrengths: plan.anchorStrengths.slice(),
			maxAnchorDistances: plan.maxAnchorDistances.slice(),
			alignToAnchors:
				existingCount > 0 && hardFixedCount === 0,
		};
		const solverGraph = solverGraphBuffers(
			graph,
			initialized.positions,
			folderIndexByNode,
			regionIndexByNode,
			context.effectiveSeed,
		);
		const territory =
			restoreDirectoryTerritoryPlan(
				graph,
				snapshot.geography?.territory,
			) ??
			createDirectoryTerritoryPlan(
				graph,
				initialized.positions,
				folderIndexByNode,
				context.effectiveSeed,
			);
		return {
			positions: initialized.positions,
			edgeEndpoints: solverGraph.edgeEndpoints,
			edgeWeights: solverGraph.edgeWeights,
			edgeTargetAngles: solverGraph.edgeTargetAngles,
			folderIndexByNode,
			regionIndexByNode,
			collisionAngularRadii: collisionRadii,
			coastalPortScores: solverGraph.coastalPortScores,
			coastalPortDirections:
				solverGraph.coastalPortDirections,
			...(territory.folderKeys.length === 0
				? {}
				: { territory: territoryPayload(territory) }),
			refresh,
			settings: resolvedSettings,
		};
	}
}

function territoryPayload(plan: DirectoryTerritoryPlan) {
	return {
		subdivision: plan.subdivision,
		folderKeys: Object.freeze([...plan.folderKeys]),
		ownerByCell: plan.ownerByCell.slice(),
	};
}
