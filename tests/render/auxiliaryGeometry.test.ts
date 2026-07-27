import { describe, expect, it } from 'vitest';
import { auxiliaryDirectionFromAnchors } from '../../src/render/auxiliaryGeometry';

describe('auxiliaryDirectionFromAnchors', () => {
	it('places auxiliary nodes deterministically near referencing notes', () => {
		const first = auxiliaryDirectionFromAnchors('image.png', [
			[1, 0, 0],
		]);
		const second = auxiliaryDirectionFromAnchors('image.png', [
			[1, 0, 0],
		]);

		expect(second).toEqual(first);
		expect(Math.hypot(...first)).toBeCloseTo(1, 10);
		expect(first[0]).toBeGreaterThan(0.99);
	});

	it('falls back to a stable unit direction for unlinked attachments', () => {
		const direction = auxiliaryDirectionFromAnchors('orphan.pdf', []);
		expect(Math.hypot(...direction)).toBeCloseTo(1, 10);
		expect(auxiliaryDirectionFromAnchors('orphan.pdf', []))
			.toEqual(direction);
	});
});
