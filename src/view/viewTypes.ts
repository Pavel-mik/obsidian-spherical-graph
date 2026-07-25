import { RenderGraphSnapshot, RenderNode } from '../render/renderTypes';
import {
	CameraState,
} from '../render/renderTypes';
import {
	SettingsChangeScope,
	SphericalGraphSettings,
	SurfaceMode,
} from '../settings/settings';

export interface ViewGraphDiffSummary {
	addedNodeIds: readonly string[];
	removedNodeIds: readonly string[];
	renamedNodes: ReadonlyArray<{
		oldPath: string;
		newPath: string;
	}>;
	addedEdgeCount: number;
	removedEdgeCount: number;
	changedEdgeWeightCount: number;
	filterChanged: boolean;
	largeChangeWarning?: boolean;
}

export type ViewLifecycleState =
	| { kind: 'no-layout' }
	| { kind: 'initializing'; operationId: string }
	| { kind: 'fixed-clean'; snapshotId: string }
	| {
			kind: 'fixed-dirty';
			snapshotId: string;
			diff: ViewGraphDiffSummary;
	  }
	| {
			kind: 'refreshing';
			operationId: string;
			snapshotId: string;
	  }
	| {
			kind: 'renewing';
			operationId: string;
			snapshotId?: string;
	  }
	| {
			kind: 'error';
			previousSnapshotId?: string;
			message: string;
	  };

export interface ViewLayoutProgress {
	phase:
		| 'initial'
		| 'new-node-warmup'
		| 'anchored-relaxation'
		| 'finalizing';
	iteration: number;
	maxAngularDisplacement?: number;
	elapsedMs?: number;
}

export interface ViewStatusModel {
	state: ViewLifecycleState;
	nodeCount: number;
	edgeCount: number;
	progress?: ViewLayoutProgress;
	compatibilityMode?: boolean;
	transientNotice?: 'cancelled';
}

export interface SphericalGraphViewCallbacks {
	onRefresh(): Promise<void> | void;
	onRenew(): Promise<void> | void;
	onCancel(): Promise<void> | void;
	onResetCamera?(camera: CameraState): Promise<void> | void;
	onOpenFile(node: RenderNode, openInNewLeaf: boolean): Promise<void> | void;
	onCameraChange(camera: CameraState): Promise<void> | void;
	onSurfaceModeChange(mode: SurfaceMode): Promise<void> | void;
	onClose(): Promise<void> | void;
}

export interface SphericalGraphViewOptions {
	getSettings(): SphericalGraphSettings;
	callbacks: SphericalGraphViewCallbacks;
	initialCamera?: CameraState;
}

export interface SphericalGraphViewModel {
	snapshot?: RenderGraphSnapshot;
	status: ViewStatusModel;
	activeNodeId?: string;
}

export interface SphericalGraphSettingsBridge {
	getSettings(): SphericalGraphSettings;
	updateSettings(
		settings: SphericalGraphSettings,
		scope: SettingsChangeScope,
	): Promise<void> | void;
}
