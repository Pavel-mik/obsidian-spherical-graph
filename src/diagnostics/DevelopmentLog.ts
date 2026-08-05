import type { DataAdapter, Stat } from 'obsidian';

export type DevelopmentDiagnosticDetails = Readonly<Record<string, unknown>>;

export type DevelopmentDiagnosticSink = (
	event: string,
	details?: DevelopmentDiagnosticDetails,
) => void;

type DevelopmentLogAdapter = Pick<
	DataAdapter,
	'append' | 'stat' | 'write'
>;

const DEFAULT_MAXIMUM_BYTES = 256 * 1024;

interface DevelopmentLogOptions {
	readonly maximumBytes?: number;
	readonly now?: () => Date;
}

/**
 * Temporary, local-only JSONL diagnostics for reproducing layout failures.
 * The file is capped between sessions and deliberately excludes vault paths.
 */
export class DevelopmentLog {
	private readonly maximumBytes: number;
	private readonly now: () => Date;
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly adapter: DevelopmentLogAdapter,
		readonly path: string,
		options: DevelopmentLogOptions = {},
	) {
		this.maximumBytes = Math.max(
			1024,
			options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES,
		);
		this.now = options.now ?? (() => new Date());
	}

	startSession(details: DevelopmentDiagnosticDetails): void {
		this.enqueue(async () => {
			const stat = await this.safeStat();
			if (stat !== null && stat.size >= this.maximumBytes) {
				await this.adapter.write(
					this.path,
					this.serialize('log.rotated', {
						previousBytes: stat.size,
					}),
				);
			}
			await this.adapter.append(
				this.path,
				this.serialize('session.started', details),
			);
		});
	}

	record(
		event: string,
		details: DevelopmentDiagnosticDetails = {},
	): void {
		this.enqueue(() =>
			this.adapter.append(
				this.path,
				this.serialize(event, details),
			),
		);
	}

	flush(): Promise<void> {
		return this.queue;
	}

	private enqueue(task: () => Promise<void>): void {
		this.queue = this.queue.then(task, task).catch(() => undefined);
	}

	private async safeStat(): Promise<Stat | null> {
		try {
			return await this.adapter.stat(this.path);
		} catch {
			return null;
		}
	}

	private serialize(
		event: string,
		details: DevelopmentDiagnosticDetails,
	): string {
		return `${JSON.stringify({
			timestamp: this.now().toISOString(),
			event,
			details,
		})}\n`;
	}
}
