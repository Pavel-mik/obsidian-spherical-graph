import workerSource from 'virtual:spherical-graph-map-worker';
import { runMapCodec, type CodecRequest } from './mapCodec';

export async function processMap(request: CodecRequest): Promise<unknown> {
	if (typeof Worker === 'undefined') return runMapCodec(request);
	const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
	let worker: Worker | undefined;
	try {
		const active = new Worker(url);
		worker = active;
		return await new Promise<unknown>((resolve, reject) => {
			active.onmessage = (event: MessageEvent<{ value?: unknown; error?: string }>) => {
				if (event.data.error) reject(new Error(event.data.error));
				else resolve(event.data.value);
			};
			active.onerror = event => reject(new Error(event.message || 'The map storage worker stopped.'));
			active.onmessageerror = () => reject(new Error('Could not read the map storage result.'));
			active.postMessage(request);
		});
	} finally {
		worker?.terminate();
		URL.revokeObjectURL(url);
	}
}
