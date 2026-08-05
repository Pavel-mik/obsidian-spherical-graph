import workerSource from 'virtual:spherical-graph-land-worker';

import type { LandSurfaceData } from './landGeometry';
import type { LandWorkerRequest, LandWorkerResponse } from './landWorkerProtocol';

interface ActiveLandBuild {
	readonly requestId: string;
	readonly worker: Worker;
	readonly objectUrl: string;
	reject(error: Error): void;
}

export class LandSurfaceWorkerClient {
	private active: ActiveLandBuild | undefined;

	build(request: LandWorkerRequest): Promise<LandSurfaceData> {
		this.cancel();
		const blob = new Blob([workerSource], { type: 'text/javascript' });
		const objectUrl = URL.createObjectURL(blob);
		let worker: Worker;
		try {
			worker = new Worker(objectUrl);
		} catch (error) {
			URL.revokeObjectURL(objectUrl);
			return Promise.reject(
				error instanceof Error ? error : new Error('Could not start the continent worker.'),
			);
		}
		return new Promise<LandSurfaceData>((resolve, reject) => {
			const active: ActiveLandBuild = {
				requestId: request.requestId,
				worker,
				objectUrl,
				reject: (error) => reject(error),
			};
			this.active = active;
			const close = (): void => {
				if (this.active !== active) {
					return;
				}
				this.active = undefined;
				worker.terminate();
				URL.revokeObjectURL(objectUrl);
			};
			worker.onmessage = (event: MessageEvent<unknown>) => {
				const response = event.data as Partial<LandWorkerResponse>;
				if (response.requestId !== request.requestId) {
					return;
				}
				close();
				if (response.type === 'completed' && response.data !== undefined) {
					resolve(response.data);
				} else {
					reject(
						new Error(
							response.type === 'error' &&
								typeof response.message === 'string'
								? response.message
								: 'The continent worker returned invalid data.',
						),
					);
				}
			};
			worker.onerror = (event) => {
				close();
				reject(new Error(event.message || 'The continent worker crashed.'));
			};
			try {
				worker.postMessage(request, [
					request.positions.buffer,
					request.nodeDegrees.buffer,
				]);
			} catch (error) {
				close();
				reject(
					error instanceof Error ? error : new Error('Could not send data to the continent worker.'),
				);
			}
		});
	}

	cancel(): void {
		const active = this.active;
		if (active === undefined) {
			return;
		}
		this.active = undefined;
		active.worker.terminate();
		URL.revokeObjectURL(active.objectUrl);
		active.reject(new Error('The continent build was superseded.'));
	}

	dispose(): void {
		this.cancel();
	}
}
