import { Platform } from 'obsidian';
import type { RenderQualityMode } from './renderQuality';
export type DeviceClass = 'desktop' | 'tablet' | 'phone';

export interface RuntimePlatformFlags {
	readonly isMobileApp: boolean;
	readonly isAndroidApp: boolean;
	readonly isPhone: boolean;
	readonly isTablet: boolean;
}

export interface RuntimeRenderProfile {
	readonly deviceClass: DeviceClass;
	readonly isMobile: boolean;
	readonly isAndroid: boolean;
	readonly qualityMode: RenderQualityMode;
	readonly pixelRatioCap: number;
	readonly antialias: boolean;
	readonly powerPreference: WebGLPowerPreference;
	readonly maxLabels: number;
	readonly edgeSegmentScale: number;
	readonly landDetailScale: number;
	readonly atmosphereWidthSegments: number;
	readonly atmosphereHeightSegments: number;
	readonly continuousFrameIntervalMs: number;
	readonly deferDecorativeLayers: boolean;
	readonly hideLabelsDuringInteraction: boolean;
	readonly hideBaseEdgesDuringInteraction: boolean;
	readonly enableHoverPicking: boolean;
	readonly supportsAutoRotation: boolean;
	readonly presentationUsesAtmosphere: boolean;
}

export interface RuntimeProfilePreferences {
	readonly phoneQuality: RenderQualityMode;
	readonly tabletQuality: RenderQualityMode;
}

const DESKTOP_PROFILE: RuntimeRenderProfile = Object.freeze({
	deviceClass: 'desktop',
	isMobile: false,
	isAndroid: false,
	qualityMode: 'high-quality',
	pixelRatioCap: 2,
	antialias: true,
	powerPreference: 'high-performance',
	maxLabels: Number.MAX_SAFE_INTEGER,
	edgeSegmentScale: 1,
	landDetailScale: 1,
	atmosphereWidthSegments: 64,
	atmosphereHeightSegments: 40,
	continuousFrameIntervalMs: 0,
	deferDecorativeLayers: false,
	hideLabelsDuringInteraction: false,
	hideBaseEdgesDuringInteraction: false,
	enableHoverPicking: true,
	supportsAutoRotation: true,
	presentationUsesAtmosphere: true,
});

/**
 * Converts Obsidian's public platform flags into a stable renderer contract.
 * Tests can pass explicit flags; production calls `currentRuntimePlatformFlags`.
 */
export function resolveRuntimeRenderProfile(
	flags: RuntimePlatformFlags,
	preferences: RuntimeProfilePreferences,
): RuntimeRenderProfile {
	if (!flags.isMobileApp) {
		return DESKTOP_PROFILE;
	}
	const deviceClass: DeviceClass = flags.isTablet ? 'tablet' : 'phone';
	const qualityMode =
		deviceClass === 'tablet'
			? preferences.tabletQuality
			: preferences.phoneQuality;
	const automatic = qualityMode === 'automatic';
	const batterySaver = qualityMode === 'battery-saver';
	const highQuality = qualityMode === 'high-quality';

	if (deviceClass === 'tablet') {
		return Object.freeze({
			deviceClass,
			isMobile: true,
			isAndroid: flags.isAndroidApp,
			qualityMode,
			pixelRatioCap: batterySaver ? 1 : highQuality ? 1.75 : 1.5,
			antialias: !batterySaver,
			powerPreference: highQuality ? 'high-performance' : 'default',
			maxLabels: batterySaver ? 36 : highQuality ? 120 : 64,
			edgeSegmentScale: batterySaver ? 0.55 : highQuality ? 1 : 0.8,
			landDetailScale: batterySaver ? 0.5 : highQuality ? 1 : 0.75,
			atmosphereWidthSegments: batterySaver ? 28 : highQuality ? 64 : 44,
			atmosphereHeightSegments: batterySaver ? 18 : highQuality ? 40 : 28,
			continuousFrameIntervalMs: batterySaver ? 50 : 34,
			deferDecorativeLayers: !highQuality,
			hideLabelsDuringInteraction: true,
			hideBaseEdgesDuringInteraction: batterySaver || automatic,
			enableHoverPicking: false,
			supportsAutoRotation: true,
			presentationUsesAtmosphere: !batterySaver,
		});
	}

	return Object.freeze({
		deviceClass,
		isMobile: true,
		isAndroid: flags.isAndroidApp,
		qualityMode,
		pixelRatioCap: batterySaver ? 1 : highQuality ? 1.5 : 1.15,
		antialias: highQuality,
		powerPreference: highQuality ? 'high-performance' : 'default',
		maxLabels: batterySaver ? 16 : highQuality ? 56 : 28,
		edgeSegmentScale: batterySaver ? 0.4 : highQuality ? 0.8 : 0.58,
		landDetailScale: batterySaver ? 0.4 : highQuality ? 0.8 : 0.55,
		atmosphereWidthSegments: batterySaver ? 20 : highQuality ? 44 : 28,
		atmosphereHeightSegments: batterySaver ? 12 : highQuality ? 28 : 18,
		continuousFrameIntervalMs: batterySaver ? 67 : 34,
		deferDecorativeLayers: true,
		hideLabelsDuringInteraction: true,
		hideBaseEdgesDuringInteraction: true,
		enableHoverPicking: false,
		supportsAutoRotation: false,
		presentationUsesAtmosphere: highQuality,
	});
}

export function currentRuntimePlatformFlags(): RuntimePlatformFlags {
	const platform = Platform as Partial<typeof Platform> | undefined;
	return {
		isMobileApp: platform?.isMobileApp === true,
		isAndroidApp: platform?.isAndroidApp === true,
		isPhone: platform?.isPhone === true,
		isTablet: platform?.isTablet === true,
	};
}

export function currentRuntimeRenderProfile(
	preferences: RuntimeProfilePreferences,
): RuntimeRenderProfile {
	return resolveRuntimeRenderProfile(
		currentRuntimePlatformFlags(),
		preferences,
	);
}
