import { describe, expect, it } from 'vitest';
import {
	cloneSphericalGraphSettings,
	DEFAULT_SPHERICAL_GRAPH_SETTINGS,
	parseSphericalGraphSettings,
} from '../../src/settings/settings';

describe('parseSphericalGraphSettings', () => {
	it('returns complete independent defaults for missing data', () => {
		const parsed = parseSphericalGraphSettings(undefined);

		expect(parsed).toEqual(DEFAULT_SPHERICAL_GRAPH_SETTINGS);
		expect(parsed).not.toBe(DEFAULT_SPHERICAL_GRAPH_SETTINGS);
		expect(parsed.appearance).not.toBe(
			DEFAULT_SPHERICAL_GRAPH_SETTINGS.appearance,
		);
	});

	it('normalizes prefixes and clamps every unsafe numeric field', () => {
		const parsed = parseSphericalGraphSettings({
			data: {
				excludedFolderPrefixes: [
					' /Archive\\2024/ ',
					'Archive\\2024',
					'',
					42,
				],
				graphChangeDebounceMs: -10,
				pendingDiffListLimit: 99_999,
			},
			appearance: {
				globeSize: 5_000,
				tagOrbitHeightPercent: 500,
				tagViewProtectionEnabled: 'yes',
				edgeOpacity: -1,
				edgeZoomThresholdPercent: -20,
				maxLabels: 19.7,
				labelZoomThresholdPercent: 500,
				showAtmosphere: 'yes',
				atmosphereHeightPercent: 500,
				surfaceMode: 'wireframe',
				surfaceOpacity: Number.NaN,
				focusAnimationDurationMs: Infinity,
			},
			layout: {
				baseSeed: -1,
				damping: 4,
				maxIterations: 7.8,
				exactRepulsionThreshold: 0,
				negativeSamplesPerNode: 10_000,
			},
			refresh: {
				affectedNeighborhoodHops: 99,
				affectedNodeAnchorMultiplier: -4,
				maxOldNodeDisplacementDegrees: 180,
				largeChangeWarningRatio: 3,
			},
		});

		expect(parsed.data.excludedFolderPrefixes).toEqual([
			'Archive/2024',
		]);
		expect(parsed.data.graphChangeDebounceMs).toBe(100);
		expect(parsed.data.pendingDiffListLimit).toBe(500);
		expect(parsed.appearance.globeSize).toBe(400);
		expect(parsed.appearance.tagOrbitHeightPercent).toBe(100);
		expect(parsed.appearance.tagViewProtectionEnabled).toBe(false);
		expect(parsed.appearance.edgeOpacity).toBe(0);
		expect(parsed.appearance.edgeZoomThresholdPercent).toBe(0);
		expect(parsed.appearance.maxLabels).toBe(20);
		expect(parsed.appearance.labelZoomThresholdPercent).toBe(100);
		expect(parsed.appearance.showAtmosphere).toBe(true);
		expect(parsed.appearance.atmosphereHeightPercent).toBe(30);
		expect(parsed.appearance.surfaceMode).toBe('solid');
		expect(parsed.appearance.surfaceOpacity).toBe(
			DEFAULT_SPHERICAL_GRAPH_SETTINGS.appearance.surfaceOpacity,
		);
		expect(parsed.layout.baseSeed).toBe(0);
		expect(parsed.layout.damping).toBe(0.999);
		expect(parsed.layout.maxIterations).toBe(8);
		expect(parsed.layout.exactRepulsionThreshold).toBe(2);
		expect(parsed.layout.negativeSamplesPerNode).toBe(256);
		expect(parsed.refresh.affectedNeighborhoodHops).toBe(10);
		expect(parsed.refresh.affectedNodeAnchorMultiplier).toBe(0);
		expect(parsed.refresh.maxOldNodeDisplacementDegrees).toBe(90);
		expect(parsed.refresh.largeChangeWarningRatio).toBe(1);
	});

	it('uses the presentation defaults for labels, edges, orbit, and atmosphere', () => {
		const appearance =
			parseSphericalGraphSettings(undefined).appearance;

		expect(appearance.labelZoomThresholdPercent).toBe(80);
		expect(appearance.edgeZoomThresholdPercent).toBe(50);
		expect(appearance.tagOrbitHeightPercent).toBe(100 / 3);
		expect(appearance.showAtmosphere).toBe(true);
		expect(appearance.atmosphereHeightPercent).toBe(10);
	});

	it('uses percentage orbit height and defaults the optional tag-view guard to disabled', () => {
		const parsed = parseSphericalGraphSettings({
			appearance: {
				tagOrbitHeightPercent: 45,
				tagViewProtectionEnabled: true,
			},
		});

		expect(parsed.appearance.tagOrbitHeightPercent).toBe(45);
		expect(parsed.appearance.tagViewProtectionEnabled).toBe(true);
		expect(
			parseSphericalGraphSettings({ appearance: {} }).appearance
				.tagViewProtectionEnabled,
		).toBe(false);
	});

	it('migrates legacy scene-unit tag orbit height to radius percent', () => {
		expect(
			parseSphericalGraphSettings({
				appearance: { tagOrbitHeight: 2.5 },
			}).appearance.tagOrbitHeightPercent,
		).toBe(25);
	});

	it('migrates legacy node size to the equivalent relative Globe size', () => {
		expect(
			parseSphericalGraphSettings({
				appearance: { nodeSize: 0.11 },
			}).appearance.globeSize,
		).toBe(100);
		expect(
			parseSphericalGraphSettings({
				appearance: { nodeSize: 0.055 },
			}).appearance.globeSize,
		).toBe(200);
	});

	it('does not let a cloned prefix array mutate its source', () => {
		const source = parseSphericalGraphSettings({
			data: { excludedFolderPrefixes: ['Private'] },
		});
		const clone = cloneSphericalGraphSettings(source);

		clone.data.excludedFolderPrefixes.push('Archive');

		expect(source.data.excludedFolderPrefixes).toEqual(['Private']);
	});
});
