export interface MetadataReadinessSource {
	isReady(): boolean;
	onResolved(callback: () => void): () => void;
}

/** A workspace can be ready before Obsidian has resolved its note links. */
export function waitForGraphMetadata(source: MetadataReadinessSource, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(new Error('Graph indexing was cancelled.'));
	if (source.isReady()) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		const cleanup = (): void => {
			unsubscribe();
			signal.removeEventListener('abort', onAbort);
		};
		const onResolved = (): void => { cleanup(); resolve(); };
		const onAbort = (): void => { cleanup(); reject(new Error('Graph indexing was cancelled.')); };
		const unsubscribe = source.onResolved(onResolved);
		signal.addEventListener('abort', onAbort, { once: true });
		if (signal.aborted) onAbort();
		else if (source.isReady()) onResolved();
	});
}
