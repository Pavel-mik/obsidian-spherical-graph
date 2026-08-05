import workerSource from 'virtual:spherical-graph-geography-worker';

import type { GraphData } from '../graph/graphTypes';
import type { PersistedContinentalGeography } from './geographyTypes';
import type { DirectoryTerritorySource } from './geographyTypes';
import type {
	GeographyWorkerRequest,
	GeographyWorkerResponse,
} from './geography-worker-entry';

interface ActiveBuild {
	readonly worker: Worker;
	readonly objectUrl: string;
	reject(error: Error): void;
}

export class GeographyWorkerClient {
	private active: ActiveBuild | undefined;
	private sequence = 0;

	build(
		graph: GraphData,
		positions: ArrayLike<number>,
		seed: number,
		previous?: PersistedContinentalGeography,
		territory?: DirectoryTerritorySource,
	): Promise<PersistedContinentalGeography> {
		if (this.active !== undefined) {
			return Promise.reject(new Error('A geography build is already active.'));
		}
		const requestId = `geography-${Date.now()}-${++this.sequence}`;
		const blob = new Blob([workerSource], { type: 'text/javascript' });
		const objectUrl = URL.createObjectURL(blob);
		let worker: Worker;
		try {
			worker = new Worker(objectUrl);
		} catch (error) {
			URL.revokeObjectURL(objectUrl);
			return Promise.reject(
				error instanceof Error ? error : new Error('Could not start the geography worker.'),
			);
		}
		return new Promise((resolve, reject) => {
			const active: ActiveBuild = {
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
				const response = event.data as Partial<GeographyWorkerResponse>;
				if (response.requestId !== requestId) {
					return;
				}
				close();
				if (
					response.type === 'completed' &&
					response.geography !== undefined
				) {
					resolve(response.geography);
				} else {
					reject(
						new Error(
							response.type === 'error' &&
								typeof response.message === 'string'
								? response.message
								: 'The geography worker returned invalid data.',
						),
					);
				}
			};
			worker.onerror = (event) => {
				close();
				reject(new Error(event.message || 'The geography worker crashed.'));
			};
			const positionCopy = Float32Array.from(positions);
			const request: GeographyWorkerRequest = {
				type: 'build-geography',
				requestId,
				graph,
				positions: positionCopy,
				seed,
				...(previous === undefined ? {} : { previous }),
				...(territory === undefined
					? {}
					: {
							territory: {
								subdivision: territory.subdivision,
								folderKeys: [...territory.folderKeys],
								ownerByCell: Int32Array.from(territory.ownerByCell),
							},
						}),
			};
			try {
				worker.postMessage(request, [
					positionCopy.buffer,
					...(request.territory?.ownerByCell.buffer instanceof ArrayBuffer
						? [request.territory.ownerByCell.buffer]
						: []),
				]);
			} catch (error) {
				close();
				reject(
					error instanceof Error ? error : new Error('Could not send data to the geography worker.'),
				);
			}
		});
	}

	dispose(): void {
		const active = this.active;
		if (active === undefined) {
			return;
		}
		this.active = undefined;
		active.worker.terminate();
		URL.revokeObjectURL(active.objectUrl);
		active.reject(new Error('The geography build was cancelled.'));
	}
}
