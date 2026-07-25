import { GraphDescriptor, GraphDescriptorEdge } from "./graphTypes";

const FNV_OFFSET_A = 0x811c9dc5;
const FNV_OFFSET_B = 0x9e3779b9;
const FNV_PRIME = 0x01000193;

function hashText(text: string, seed: number): number {
	let hash = seed >>> 0;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, FNV_PRIME) >>> 0;
	}
	return hash;
}

function hashParts(parts: readonly string[], prefix: string): string {
	let first = FNV_OFFSET_A;
	let second = FNV_OFFSET_B;
	for (const part of parts) {
		const framed = `${part.length}:${part};`;
		first = hashText(framed, first);
		second = hashText(framed, second ^ first);
	}
	return `${prefix}-${first.toString(16).padStart(8, "0")}${second
		.toString(16)
		.padStart(8, "0")}`;
}

function edgePart(edge: GraphDescriptorEdge): string {
	return [
		edge.sourceId,
		edge.targetId,
		edge.weight.toString(),
		edge.forwardWeight.toString(),
		edge.backwardWeight.toString(),
	].join("\u001f");
}

export function createFilterSignature(
	includeOrphans: boolean,
	excludedFolderPrefixes: readonly string[],
): string {
	return hashParts(
		[
			includeOrphans ? "orphans:1" : "orphans:0",
			...excludedFolderPrefixes.map((prefix) => `exclude:${prefix}`),
		],
		"gf1",
	);
}

export function createGraphSignature(
	descriptor: GraphDescriptor,
): string {
	return hashParts(
		[
			`filter:${descriptor.filterSignature}`,
			...descriptor.nodeIds.map((id) => `node:${id}`),
			...descriptor.edges.map((edge) => `edge:${edgePart(edge)}`),
		],
		"sg1",
	);
}

export function deterministicUint32(parts: readonly string[]): number {
	let hash = FNV_OFFSET_A;
	for (const part of parts) {
		hash = hashText(`${part.length}:${part};`, hash);
	}
	return hash >>> 0;
}
