import { gzipSync, gunzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import type { PersistedLayoutSnapshot } from './layoutState';
import type { PersistedGraphCache } from './graphCache';

export const PACKED_SCHEMA = 5;
const MAX_RAW_BYTES = 256 * 1024 * 1024;
export interface PackedBlock {
	codec: 'indexed-json-gzip-1';
	bytes: number;
	sha256: string;
	base64: string;
}
export type CodecRequest =
	| { operation: 'pack-layout'; value: PersistedLayoutSnapshot }
	| { operation: 'pack-cache'; value: PersistedGraphCache }
	| { operation: 'unpack-layout' | 'unpack-cache'; value: PackedBlock };

function indexLayout(layout: PersistedLayoutSnapshot) {
	const { graphDescriptor, positionsByPath, geography, ...metadata } = layout;
	const { nodeIds, edges, filterSignature } = graphDescriptor;
	const indices = new Map(nodeIds.map((path, i) => [path, i]));
	const index = (path: string): number => {
		const i = indices.get(path);
		if (i === undefined) throw new Error('Unknown note in saved map.');
		return i;
	};
	return {
		metadata, nodeIds, filterSignature,
		positions: nodeIds.map(path => positionsByPath[path]),
		edges: edges.map(e => [index(e.sourceId), index(e.targetId), e.weight, e.forwardWeight, e.backwardWeight]),
		geography: geography && {
			...geography, continents: geography.continents.map(c => ({ ...c, nodeIds: c.nodeIds.map(index) })),
			islandNodeIds: geography.islandNodeIds.map(index),
		},
	};
}
function expandLayout(body: ReturnType<typeof indexLayout>): unknown {
	const { nodeIds, positions, geography } = body;
	if (positions.length !== nodeIds.length) throw new Error('Incomplete saved positions.');
	const path = (index: number): string => {
		if (!Number.isSafeInteger(index) || typeof nodeIds[index] !== 'string') throw new Error('Invalid note index in saved map.');
		return nodeIds[index];
	};
	return {
		...body.metadata,
		positionsByPath: Object.fromEntries(nodeIds.map((id, i) => [id, positions[i]])),
		graphDescriptor: { nodeIds, filterSignature: body.filterSignature, edges: body.edges.map(row => {
			if (row.length !== 5) throw new Error('Incomplete saved link.');
			return { sourceId: path(row[0]!), targetId: path(row[1]!), weight: row[2], forwardWeight: row[3], backwardWeight: row[4] };
		}) },
		...(geography && { geography: { ...geography,
			continents: geography.continents.map(c => ({ ...c, nodeIds: c.nodeIds.map(path) })),
			islandNodeIds: geography.islandNodeIds.map(path),
		} }),
	};
}
function base64(bytes: Uint8Array): string {
	let output = '';
	// A multiple of three keeps interior chunks free of Base64 padding.
	for (let i = 0; i < bytes.length; i += 24_576) {
		output += btoa(String.fromCharCode(...bytes.subarray(i, i + 24_576)));
	}
	return output;
}
async function checksum(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}
export function isPackedBlock(value: unknown): value is PackedBlock {
	if (!value || typeof value !== 'object') return false;
	const block = value as Partial<PackedBlock>;
	return block.codec === 'indexed-json-gzip-1' && typeof block.bytes === 'number' &&
		Number.isSafeInteger(block.bytes) && block.bytes > 0 && block.bytes <= MAX_RAW_BYTES &&
		typeof block.sha256 === 'string' && /^[a-f0-9]{64}$/.test(block.sha256) &&
		typeof block.base64 === 'string' && block.base64.length > 0;
}
export async function runMapCodec(request: CodecRequest): Promise<unknown> {
	if (request.operation === 'pack-layout' || request.operation === 'pack-cache') {
		const serial = request.operation === 'pack-layout' ? indexLayout(request.value) : request.value;
		const bytes = new TextEncoder().encode(JSON.stringify(serial));
		if (bytes.length > MAX_RAW_BYTES) throw new Error('Map exceeds the supported decompressed size.');
		return { codec: 'indexed-json-gzip-1', bytes: bytes.length, sha256: await checksum(bytes),
			base64: base64(gzipSync(bytes, { level: 6, mtime: 0 })) } satisfies PackedBlock;
	}
	const block = request.value;
	if (!isPackedBlock(block)) throw new Error('Unrecognized saved map block.');
	const zipped = Uint8Array.from(atob(block.base64), c => c.charCodeAt(0));
	if (zipped.length < 18 || new DataView(zipped.buffer).getUint32(zipped.length - 4, true) !== block.bytes) {
		throw new Error('Invalid saved map length.');
	}
	const bytes = new Uint8Array(block.bytes);
	gunzipSync(zipped, { out: bytes });
	if (await checksum(bytes) !== block.sha256) throw new Error('Saved map checksum did not match.');
	const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
	return request.operation === 'unpack-layout' ? expandLayout(value as ReturnType<typeof indexLayout>) : value;
}
