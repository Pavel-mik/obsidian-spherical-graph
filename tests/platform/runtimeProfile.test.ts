import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => ({ Platform: {} }));
import {
	resolveRuntimeRenderProfile,
	type RuntimePlatformFlags,
} from '../../src/platform/runtimeProfile';

const preferences = {
	phoneQuality: 'automatic',
	tabletQuality: 'automatic',
} as const;

function flags(
	overrides: Partial<RuntimePlatformFlags>,
): RuntimePlatformFlags {
	return {
		isMobileApp: false,
		isAndroidApp: false,
		isPhone: false,
		isTablet: false,
		...overrides,
	};
}

describe('runtime render profiles', () => {
	it('preserves full desktop rendering', () => {
		const profile = resolveRuntimeRenderProfile(flags({}), preferences);

		expect(profile.deviceClass).toBe('desktop');
		expect(profile.pixelRatioCap).toBe(2);
		expect(profile.supportsAutoRotation).toBe(true);
		expect(profile.deferDecorativeLayers).toBe(false);
	});

	it('uses a touch-first, bounded phone profile', () => {
		const profile = resolveRuntimeRenderProfile(
			flags({
				isMobileApp: true,
				isAndroidApp: true,
				isPhone: true,
			}),
			preferences,
		);

		expect(profile.deviceClass).toBe('phone');
		expect(profile.pixelRatioCap).toBeLessThanOrEqual(1.25);
		expect(profile.enableHoverPicking).toBe(false);
		expect(profile.supportsAutoRotation).toBe(false);
		expect(profile.deferDecorativeLayers).toBe(true);
	});

	it('keeps presentation features on tablets', () => {
		const profile = resolveRuntimeRenderProfile(
			flags({
				isMobileApp: true,
				isAndroidApp: true,
				isTablet: true,
			}),
			preferences,
		);

		expect(profile.deviceClass).toBe('tablet');
		expect(profile.supportsAutoRotation).toBe(true);
		expect(profile.presentationUsesAtmosphere).toBe(true);
		expect(profile.maxLabels).toBeGreaterThan(28);
	});

	it('applies an explicit battery-saver preference', () => {
		const profile = resolveRuntimeRenderProfile(
			flags({ isMobileApp: true, isTablet: true }),
			{
				phoneQuality: 'automatic',
				tabletQuality: 'battery-saver',
			},
		);

		expect(profile.qualityMode).toBe('battery-saver');
		expect(profile.pixelRatioCap).toBe(1);
		expect(profile.presentationUsesAtmosphere).toBe(false);
	});
});
