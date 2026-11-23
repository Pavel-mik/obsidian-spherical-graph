import { validatePersistedGraphCache, type PersistedGraphCache } from './graphCache';
import { isPackedBlock, PACKED_SCHEMA, type PackedBlock } from './mapCodec';
import { processMap } from './mapCodecClient';
import { prepareSyncSafeData } from './syncBudget';
import { validatePersistedLayoutSnapshot, type PersistedLayoutSnapshot, type PersistedPluginData } from './layoutState';

interface Block<T> { value: T; disk: PackedBlock }
function matches<T>(entry: Block<T> | undefined, disk: PackedBlock): entry is Block<T> {
	return entry !== undefined && entry.disk.sha256 === disk.sha256 && entry.disk.bytes === disk.bytes &&
		entry.disk.base64 === disk.base64;
}

/** Memoize only the current revision. Partial writes still consult the latest on-disk envelope. */
export class CompactMapFile {
	private layout?: Block<PersistedLayoutSnapshot>;
	private cache?: Block<PersistedGraphCache>;

	async read(raw: Record<string, unknown>, verify = false) {
		if (raw.schemaVersion !== PACKED_SCHEMA || !isPackedBlock(raw.packedLayout)) throw new Error('Invalid compact map format.');
		const packed = raw.packedLayout;
		if (verify || !matches(this.layout, packed)) {
			const snapshot = validatePersistedLayoutSnapshot(await processMap({ operation: 'unpack-layout', value: packed }));
			if (!snapshot) throw new Error('Invalid topology in compact map.');
			this.layout = { value: snapshot, disk: packed };
		}
		let graphCache: PersistedGraphCache | null = null;
		if (raw.graphCache !== null) {
			if (!isPackedBlock(raw.graphCache)) throw new Error('Invalid compact map cache.');
			if (verify || !matches(this.cache, raw.graphCache)) {
				const cache = validatePersistedGraphCache(await processMap({ operation: 'unpack-cache', value: raw.graphCache }));
				if (!cache) throw new Error('Invalid compact map cache.');
				this.cache = { value: cache, disk: raw.graphCache };
			}
			graphCache = this.cache.value;
			if (graphCache.graphSignature !== this.layout.value.graphSignature) throw new Error('Cache belongs to a different map.');
		}
		return { committedLayout: this.layout.value, graphCache };
	}

	needsEncoding(layout: PersistedLayoutSnapshot, cache: PersistedGraphCache | null): boolean {
		return layout !== this.layout?.value || (cache !== null && cache !== this.cache?.value);
	}

	async prepare<T>(data: PersistedPluginData<T>, layout: PersistedLayoutSnapshot, verify: boolean) {
		if (this.layout?.value !== layout) {
			const disk = await processMap({ operation: 'pack-layout', value: layout });
			if (!isPackedBlock(disk)) throw new Error('Could not encode saved map.');
			this.layout = { value: layout, disk };
		}
		const cache = data.graphCache;
		if (cache && this.cache?.value !== cache) {
			const disk = await processMap({ operation: 'pack-cache', value: cache });
			if (!isPackedBlock(disk)) throw new Error('Could not encode map cache.');
			this.cache = { value: cache, disk };
		}
		const prepared = prepareSyncSafeData({ schemaVersion: PACKED_SCHEMA, settings: data.settings,
			camera: data.camera, pinnedNotePaths: data.pinnedNotePaths, packedLayout: this.layout.disk,
			graphCache: cache ? this.cache!.disk : null });
		if (verify) {
			const decoded = await this.read(prepared.data, true);
			if (JSON.stringify(decoded.committedLayout) !== JSON.stringify(layout) ||
				(!prepared.graphCacheDropped && JSON.stringify(decoded.graphCache) !== JSON.stringify(cache))) {
				throw new Error('The converted map did not match the original. The saved map was kept.');
			}
			this.layout = { value: layout, disk: this.layout.disk };
			if (cache && this.cache) this.cache = { value: cache, disk: this.cache.disk };
		}
		return prepared;
	}
}
