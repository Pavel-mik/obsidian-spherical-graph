import { describe, expect, it } from 'vitest';
import {
	autoGlobeSizeForNodeCount,
	shouldAutoSizeGlobe,
} from '../../src/settings/autoGlobeSize';

describe('autoGlobeSizeForNodeCount', () => {
	it('scales smoothly with vault size and stays on bounded five-unit steps', () => {
		expect(autoGlobeSizeForNodeCount(0)).toBe(60);
		expect(autoGlobeSizeForNodeCount(100)).toBe(100);
		expect(autoGlobeSizeForNodeCount(1_000)).toBe(180);
		expect(autoGlobeSizeForNodeCount(50_000)).toBe(400);
	});

	it('only applies to newly initialized or completely renewed maps', () => {
		expect(shouldAutoSizeGlobe('initialize')).toBe(true);
		expect(shouldAutoSizeGlobe('renew')).toBe(true);
		expect(shouldAutoSizeGlobe('refresh')).toBe(false);
	});
});
