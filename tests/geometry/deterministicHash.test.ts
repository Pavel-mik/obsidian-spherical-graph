import { describe, expect, it } from 'vitest';
import {
	DeterministicRandom,
	deterministicPermutation,
	deriveSeed,
	hashUnorderedPair,
} from '../../src/geometry/deterministicHash';

describe('deterministic hashing', () => {
	it('derives stable but input-sensitive seeds', () => {
		expect(deriveSeed(42, 'graph', 7)).toBe(
			deriveSeed(42, 'graph', 7),
		);
		expect(deriveSeed(42, 'graph', 7)).not.toBe(
			deriveSeed(42, 'graph', 8),
		);
		expect(hashUnorderedPair('a', 'b')).toBe(
			hashUnorderedPair('b', 'a'),
		);
	});

	it('produces reproducible random streams and permutations', () => {
		const first = new DeterministicRandom(123);
		const second = new DeterministicRandom(123);
		expect(
			Array.from({ length: 20 }, () => first.nextUint32()),
		).toEqual(
			Array.from({ length: 20 }, () => second.nextUint32()),
		);
		const permutation = deterministicPermutation(100, 99);
		expect(permutation).toEqual(deterministicPermutation(100, 99));
		expect(new Set(permutation).size).toBe(100);
		expect(permutation).not.toEqual(deterministicPermutation(100, 100));
	});
});
