const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function mixUint32(value: number): number {
	let mixed = value >>> 0;
	mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
	mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
	return (mixed ^ (mixed >>> 15)) >>> 0;
}

export function hashString(value: string, seed = FNV_OFFSET_BASIS): number {
	let hash = seed >>> 0;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		hash ^= code & 0xff;
		hash = Math.imul(hash, FNV_PRIME);
		hash ^= code >>> 8;
		hash = Math.imul(hash, FNV_PRIME);
	}
	return mixUint32(hash);
}

export function hashNumbers(seed: number, ...values: readonly number[]): number {
	let hash = mixUint32(seed);
	for (const value of values) {
		hash = mixUint32(hash ^ (value >>> 0));
	}
	return hash;
}

export function deriveSeed(
	baseSeed: number,
	...parts: readonly (number | string)[]
): number {
	let result = mixUint32(baseSeed);
	for (const part of parts) {
		result =
			typeof part === 'number'
				? hashNumbers(result, part)
				: hashString(part, result);
	}
	return result;
}

export function hashOrderedPair(
	first: string,
	second: string,
	seed = 0,
): number {
	return deriveSeed(seed, first, '\u0000', second);
}

export function hashUnorderedPair(
	first: string,
	second: string,
	seed = 0,
): number {
	return first <= second
		? hashOrderedPair(first, second, seed)
		: hashOrderedPair(second, first, seed);
}

export function uint32ToUnitFloat(value: number): number {
	return (value >>> 0) / 0x100000000;
}

export function hashToUnitFloat(
	seed: number,
	...values: readonly number[]
): number {
	return uint32ToUnitFloat(hashNumbers(seed, ...values));
}

export function hashToSignedUnitFloat(
	seed: number,
	...values: readonly number[]
): number {
	return hashToUnitFloat(seed, ...values) * 2 - 1;
}

export class DeterministicRandom {
	private state: number;

	constructor(seed: number) {
		this.state = mixUint32(seed);
	}

	nextUint32(): number {
		this.state = (this.state + 0x6d2b79f5) >>> 0;
		let value = this.state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return (value ^ (value >>> 14)) >>> 0;
	}

	next(): number {
		return uint32ToUnitFloat(this.nextUint32());
	}

	nextInt(exclusiveMaximum: number): number {
		if (
			!Number.isSafeInteger(exclusiveMaximum) ||
			exclusiveMaximum <= 0
		) {
			throw new RangeError('exclusiveMaximum must be a positive integer.');
		}
		return Math.floor(this.next() * exclusiveMaximum);
	}
}

export function deterministicPermutation(
	length: number,
	seed: number,
): Uint32Array {
	if (!Number.isSafeInteger(length) || length < 0) {
		throw new RangeError('length must be a non-negative integer.');
	}

	const result = new Uint32Array(length);
	for (let index = 0; index < length; index += 1) {
		result[index] = index;
	}

	const random = new DeterministicRandom(seed);
	for (let index = length - 1; index > 0; index -= 1) {
		const swapIndex = random.nextInt(index + 1);
		const current = result[index];
		const other = result[swapIndex];
		if (current === undefined || other === undefined) {
			throw new RangeError('Permutation index escaped its allocated range.');
		}
		result[index] = other;
		result[swapIndex] = current;
	}
	return result;
}
