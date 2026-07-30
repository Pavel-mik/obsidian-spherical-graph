import {
	BASE_NODE_MARKER_SIZE,
	DEFAULT_ATMOSPHERE_HEIGHT_PERCENT,
	DEFAULT_GLOBE_SIZE,
	DEFAULT_TAG_ORBIT_HEIGHT_PERCENT,
	GRAPH_CHANGE_DEBOUNCE_MAX_MS,
	GRAPH_CHANGE_DEBOUNCE_MIN_MS,
	MAX_ATMOSPHERE_HEIGHT_PERCENT,
	MAX_TAG_ORBIT_HEIGHT_PERCENT,
	MIN_ATMOSPHERE_HEIGHT_PERCENT,
	MIN_TAG_ORBIT_HEIGHT_PERCENT,
	SPHERE_RADIUS,
} from '../constants';

export const SURFACE_MODES = ['solid', 'transparent', 'hidden'] as const;

export type SurfaceMode = (typeof SURFACE_MODES)[number];

export interface DataSettings {
	excludedFolderPrefixes: string[];
	includeOrphanNotes: boolean;
	graphChangeDebounceMs: number;
	pendingDiffListLimit: number;
}

export interface AppearanceSettings {
	/**
	 * Relative globe scale. Larger values make node markers and their reticle
	 * smaller compared with the fixed sphere, without changing layout vectors.
	 */
	globeSize: number;
	tagOrbitHeightPercent: number;
	tagViewProtectionEnabled: boolean;
	sizeNodesByDegree: boolean;
	edgeOpacity: number;
	edgeZoomThresholdPercent: number;
	showLabels: boolean;
	maxLabels: number;
	labelZoomThresholdPercent: number;
	showContinents: boolean;
	showAtmosphere: boolean;
	atmosphereHeightPercent: number;
	surfaceMode: SurfaceMode;
	surfaceOpacity: number;
	backgroundFollowsTheme: boolean;
	focusAnimationDurationMs: number;
}

export interface LayoutSettings {
	baseSeed: number;
	springStrength: number;
	repulsionStrength: number;
	centroidCoverageStrength: number;
	isotropyStrength: number;
	damping: number;
	initialStep: number;
	maxAngularVelocity: number;
	maxIterations: number;
	convergenceTolerance: number;
	exactRepulsionThreshold: number;
	negativeSamplesPerNode: number;
	progressReportIntervalMs: number;
}

export interface RefreshSettings {
	newNodeWarmupIterations: number;
	affectedNeighborhoodHops: number;
	anchorStrength: number;
	affectedNodeAnchorMultiplier: number;
	maxOldNodeDisplacementDegrees: number;
	largeChangeWarningRatio: number;
}

export interface SphericalGraphSettings {
	data: DataSettings;
	appearance: AppearanceSettings;
	layout: LayoutSettings;
	refresh: RefreshSettings;
}

export type SettingsChangeScope =
	| 'appearance'
	| 'data'
	| 'layout'
	| 'refresh';

export const DEFAULT_SPHERICAL_GRAPH_SETTINGS: SphericalGraphSettings = {
	data: {
		excludedFolderPrefixes: [],
		includeOrphanNotes: true,
		graphChangeDebounceMs: 750,
		pendingDiffListLimit: 50,
	},
	appearance: {
		globeSize: DEFAULT_GLOBE_SIZE,
		tagOrbitHeightPercent: DEFAULT_TAG_ORBIT_HEIGHT_PERCENT,
		tagViewProtectionEnabled: false,
		sizeNodesByDegree: true,
		edgeOpacity: 0.28,
		edgeZoomThresholdPercent: 50,
		showLabels: true,
		maxLabels: 80,
		labelZoomThresholdPercent: 80,
		showContinents: true,
		showAtmosphere: true,
		atmosphereHeightPercent: DEFAULT_ATMOSPHERE_HEIGHT_PERCENT,
		surfaceMode: 'solid',
		surfaceOpacity: 0.92,
		backgroundFollowsTheme: true,
		focusAnimationDurationMs: 450,
	},
	layout: {
		baseSeed: 42,
		springStrength: 0.075,
		repulsionStrength: 0.018,
		centroidCoverageStrength: 0.035,
		isotropyStrength: 0.02,
		damping: 0.86,
		initialStep: 0.08,
		maxAngularVelocity: 0.12,
		maxIterations: 1_500,
		convergenceTolerance: 0.000_1,
		exactRepulsionThreshold: 400,
		negativeSamplesPerNode: 24,
		progressReportIntervalMs: 200,
	},
	refresh: {
		newNodeWarmupIterations: 180,
		affectedNeighborhoodHops: 2,
		anchorStrength: 0.8,
		affectedNodeAnchorMultiplier: 0.45,
		maxOldNodeDisplacementDegrees: 12,
		largeChangeWarningRatio: 0.2,
	},
};

/**
 * Alias kept intentionally terse for plugin integration while the longer name
 * remains unambiguous to consumers that import several sets of defaults.
 */
export const DEFAULT_SETTINGS = DEFAULT_SPHERICAL_GRAPH_SETTINGS;

interface NumberBounds {
	min: number;
	max: number;
	integer?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function section(
	root: Record<string, unknown>,
	key: keyof SphericalGraphSettings,
): Record<string, unknown> {
	const value = root[key];
	return isRecord(value) ? value : {};
}

function numberValue(
	value: unknown,
	fallback: number,
	bounds: NumberBounds,
): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	const clamped = Math.min(bounds.max, Math.max(bounds.min, value));
	return bounds.integer ? Math.round(clamped) : clamped;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function surfaceModeValue(
	value: unknown,
	fallback: SurfaceMode,
): SurfaceMode {
	return typeof value === 'string' &&
		(SURFACE_MODES as readonly string[]).includes(value)
		? (value as SurfaceMode)
		: fallback;
}

function globeSizeValue(
	appearance: Record<string, unknown>,
	fallback: number,
): number {
	if (
		typeof appearance.globeSize === 'number' &&
		Number.isFinite(appearance.globeSize)
	) {
		return numberValue(
			appearance.globeSize,
			fallback,
			{ min: 40, max: 400 },
		);
	}

	// Migrate the pre-Globe-size visual setting without changing its apparent
	// node scale. nodeSize 0.11 maps to Globe size 100.
	if (
		typeof appearance.nodeSize === 'number' &&
		Number.isFinite(appearance.nodeSize) &&
		appearance.nodeSize > 0
	) {
		return numberValue(
			(BASE_NODE_MARKER_SIZE * DEFAULT_GLOBE_SIZE) /
				appearance.nodeSize,
			fallback,
			{ min: 40, max: 400 },
		);
	}
	return fallback;
}

function tagOrbitHeightPercentValue(
	appearance: Record<string, unknown>,
	fallback: number,
): number {
	if (
		typeof appearance.tagOrbitHeightPercent === 'number' &&
		Number.isFinite(appearance.tagOrbitHeightPercent)
	) {
		return numberValue(
			appearance.tagOrbitHeightPercent,
			fallback,
			{
				min: MIN_TAG_ORBIT_HEIGHT_PERCENT,
				max: MAX_TAG_ORBIT_HEIGHT_PERCENT,
			},
		);
	}

	// Migrate the earlier scene-unit setting to a percentage of the globe
	// radius. An old height of 1.25 on a radius-10 globe becomes 12.5%.
	if (
		typeof appearance.tagOrbitHeight === 'number' &&
		Number.isFinite(appearance.tagOrbitHeight)
	) {
		return numberValue(
			(appearance.tagOrbitHeight / SPHERE_RADIUS) * 100,
			fallback,
			{
				min: MIN_TAG_ORBIT_HEIGHT_PERCENT,
				max: MAX_TAG_ORBIT_HEIGHT_PERCENT,
			},
		);
	}
	return fallback;
}

export function normalizeExcludedFolderPrefixes(value: unknown): string[] {
	const values =
		typeof value === 'string'
			? value.split(/[,\n]/u)
			: Array.isArray(value)
				? value
				: [];
	const normalized = values
		.filter((entry): entry is string => typeof entry === 'string')
		.map((entry) =>
			entry
				.trim()
				.replaceAll('\\', '/')
				.replace(/^\/+/u, '')
				.replace(/\/+$/u, ''),
		)
		.filter((entry) => entry.length > 0);
	return [...new Set(normalized)];
}

export function cloneSphericalGraphSettings(
	settings: SphericalGraphSettings,
): SphericalGraphSettings {
	return {
		data: {
			...settings.data,
			excludedFolderPrefixes: [...settings.data.excludedFolderPrefixes],
		},
		appearance: { ...settings.appearance },
		layout: { ...settings.layout },
		refresh: { ...settings.refresh },
	};
}

/**
 * Treat persisted plugin data as untrusted input. Every field is type checked,
 * finite-number checked, and constrained to a range that keeps both the UI and
 * solver numerically well behaved.
 */
export function parseSphericalGraphSettings(
	value: unknown,
): SphericalGraphSettings {
	const root = isRecord(value) ? value : {};
	const data = section(root, 'data');
	const appearance = section(root, 'appearance');
	const layout = section(root, 'layout');
	const refresh = section(root, 'refresh');
	const defaults = DEFAULT_SPHERICAL_GRAPH_SETTINGS;

	return {
		data: {
			excludedFolderPrefixes: normalizeExcludedFolderPrefixes(
				data.excludedFolderPrefixes,
			),
			includeOrphanNotes: booleanValue(
				data.includeOrphanNotes,
				defaults.data.includeOrphanNotes,
			),
			graphChangeDebounceMs: numberValue(
				data.graphChangeDebounceMs,
				defaults.data.graphChangeDebounceMs,
				{
					min: GRAPH_CHANGE_DEBOUNCE_MIN_MS,
					max: GRAPH_CHANGE_DEBOUNCE_MAX_MS,
					integer: true,
				},
			),
			pendingDiffListLimit: numberValue(
				data.pendingDiffListLimit,
				defaults.data.pendingDiffListLimit,
				{ min: 1, max: 500, integer: true },
			),
		},
		appearance: {
			globeSize: globeSizeValue(
				appearance,
				defaults.appearance.globeSize,
			),
			tagOrbitHeightPercent: tagOrbitHeightPercentValue(
				appearance,
				defaults.appearance.tagOrbitHeightPercent,
			),
			tagViewProtectionEnabled: booleanValue(
				appearance.tagViewProtectionEnabled,
				defaults.appearance.tagViewProtectionEnabled,
			),
			sizeNodesByDegree: booleanValue(
				appearance.sizeNodesByDegree,
				defaults.appearance.sizeNodesByDegree,
			),
			edgeOpacity: numberValue(
				appearance.edgeOpacity,
				defaults.appearance.edgeOpacity,
				{ min: 0, max: 1 },
			),
			edgeZoomThresholdPercent: numberValue(
				appearance.edgeZoomThresholdPercent,
				defaults.appearance.edgeZoomThresholdPercent,
				{ min: 0, max: 100 },
			),
			showLabels: booleanValue(
				appearance.showLabels,
				defaults.appearance.showLabels,
			),
			maxLabels: numberValue(
				appearance.maxLabels,
				defaults.appearance.maxLabels,
				{ min: 0, max: 200, integer: true },
			),
			labelZoomThresholdPercent: numberValue(
				appearance.labelZoomThresholdPercent,
				defaults.appearance.labelZoomThresholdPercent,
				{ min: 0, max: 100 },
			),
			showContinents: booleanValue(
				appearance.showContinents,
				defaults.appearance.showContinents,
			),
			showAtmosphere: booleanValue(
				appearance.showAtmosphere,
				defaults.appearance.showAtmosphere,
			),
			atmosphereHeightPercent: numberValue(
				appearance.atmosphereHeightPercent,
				defaults.appearance.atmosphereHeightPercent,
				{
					min: MIN_ATMOSPHERE_HEIGHT_PERCENT,
					max: MAX_ATMOSPHERE_HEIGHT_PERCENT,
				},
			),
			surfaceMode: surfaceModeValue(
				appearance.surfaceMode,
				defaults.appearance.surfaceMode,
			),
			surfaceOpacity: numberValue(
				appearance.surfaceOpacity,
				defaults.appearance.surfaceOpacity,
				{ min: 0, max: 1 },
			),
			backgroundFollowsTheme: booleanValue(
				appearance.backgroundFollowsTheme,
				defaults.appearance.backgroundFollowsTheme,
			),
			focusAnimationDurationMs: numberValue(
				appearance.focusAnimationDurationMs,
				defaults.appearance.focusAnimationDurationMs,
				{ min: 0, max: 5_000, integer: true },
			),
		},
		layout: {
			baseSeed: numberValue(
				layout.baseSeed,
				defaults.layout.baseSeed,
				{ min: 0, max: 0xffff_ffff, integer: true },
			),
			springStrength: numberValue(
				layout.springStrength,
				defaults.layout.springStrength,
				{ min: 0, max: 10 },
			),
			repulsionStrength: numberValue(
				layout.repulsionStrength,
				defaults.layout.repulsionStrength,
				{ min: 0, max: 10 },
			),
			centroidCoverageStrength: numberValue(
				layout.centroidCoverageStrength,
				defaults.layout.centroidCoverageStrength,
				{ min: 0, max: 10 },
			),
			isotropyStrength: numberValue(
				layout.isotropyStrength,
				defaults.layout.isotropyStrength,
				{ min: 0, max: 10 },
			),
			damping: numberValue(
				layout.damping,
				defaults.layout.damping,
				{ min: 0, max: 0.999 },
			),
			initialStep: numberValue(
				layout.initialStep,
				defaults.layout.initialStep,
				{ min: 0.000_1, max: 1 },
			),
			maxAngularVelocity: numberValue(
				layout.maxAngularVelocity,
				defaults.layout.maxAngularVelocity,
				{ min: 0.001, max: 1 },
			),
			maxIterations: numberValue(
				layout.maxIterations,
				defaults.layout.maxIterations,
				{ min: 1, max: 100_000, integer: true },
			),
			convergenceTolerance: numberValue(
				layout.convergenceTolerance,
				defaults.layout.convergenceTolerance,
				{ min: 1e-8, max: 0.1 },
			),
			exactRepulsionThreshold: numberValue(
				layout.exactRepulsionThreshold,
				defaults.layout.exactRepulsionThreshold,
				{ min: 2, max: 5_000, integer: true },
			),
			negativeSamplesPerNode: numberValue(
				layout.negativeSamplesPerNode,
				defaults.layout.negativeSamplesPerNode,
				{ min: 1, max: 256, integer: true },
			),
			progressReportIntervalMs: numberValue(
				layout.progressReportIntervalMs,
				defaults.layout.progressReportIntervalMs,
				{ min: 100, max: 5_000, integer: true },
			),
		},
		refresh: {
			newNodeWarmupIterations: numberValue(
				refresh.newNodeWarmupIterations,
				defaults.refresh.newNodeWarmupIterations,
				{ min: 0, max: 100_000, integer: true },
			),
			affectedNeighborhoodHops: numberValue(
				refresh.affectedNeighborhoodHops,
				defaults.refresh.affectedNeighborhoodHops,
				{ min: 0, max: 10, integer: true },
			),
			anchorStrength: numberValue(
				refresh.anchorStrength,
				defaults.refresh.anchorStrength,
				{ min: 0, max: 100 },
			),
			affectedNodeAnchorMultiplier: numberValue(
				refresh.affectedNodeAnchorMultiplier,
				defaults.refresh.affectedNodeAnchorMultiplier,
				{ min: 0, max: 1 },
			),
			maxOldNodeDisplacementDegrees: numberValue(
				refresh.maxOldNodeDisplacementDegrees,
				defaults.refresh.maxOldNodeDisplacementDegrees,
				{ min: 0.1, max: 90 },
			),
			largeChangeWarningRatio: numberValue(
				refresh.largeChangeWarningRatio,
				defaults.refresh.largeChangeWarningRatio,
				{ min: 0, max: 1 },
			),
		},
	};
}
