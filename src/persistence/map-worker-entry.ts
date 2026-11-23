import { runMapCodec, type CodecRequest } from './mapCodec';
declare const self: DedicatedWorkerGlobalScope;
self.onmessage = (event: MessageEvent<CodecRequest>) => {
	void runMapCodec(event.data).then(value => self.postMessage({ value }), (error: unknown) =>
		self.postMessage({ error: error instanceof Error ? error.message : 'Invalid saved map.' }));
};
