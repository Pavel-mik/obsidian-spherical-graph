import type { Stat } from 'obsidian';
import { describe, expect, it } from 'vitest';

import { DevelopmentLog } from '../../src/diagnostics/DevelopmentLog';

class MemoryLogAdapter {
	content = '';

	async stat(): Promise<Stat | null> {
		return this.content.length === 0
			? null
			: {
					type: 'file',
					ctime: 0,
					mtime: 0,
					size: this.content.length,
				};
	}

	async write(_path: string, data: string): Promise<void> {
		this.content = data;
	}

	async append(_path: string, data: string): Promise<void> {
		this.content += data;
	}
}

describe('DevelopmentLog', () => {
	it('serializes session and diagnostic events as ordered JSONL', async () => {
		const adapter = new MemoryLogAdapter();
		const log = new DevelopmentLog(adapter, 'development.log', {
			now: () => new Date('2026-08-05T10:00:00.000Z'),
		});

		log.startSession({ pluginVersion: 'test' });
		log.record('layout.completed', { iteration: 600 });
		await log.flush();

		const lines = adapter.content.trim().split('\n').map((line) =>
			JSON.parse(line) as {
				readonly event: string;
				readonly details: Readonly<Record<string, unknown>>;
			},
		);
		expect(lines.map((line) => line.event)).toEqual([
			'session.started',
			'layout.completed',
		]);
		expect(lines[1]?.details.iteration).toBe(600);
	});

	it('rotates an oversized previous log before starting a session', async () => {
		const adapter = new MemoryLogAdapter();
		adapter.content = 'x'.repeat(1024);
		const log = new DevelopmentLog(adapter, 'development.log', {
			maximumBytes: 1024,
			now: () => new Date('2026-08-05T10:00:00.000Z'),
		});

		log.startSession({ pluginVersion: 'test' });
		await log.flush();

		expect(adapter.content).not.toContain('x'.repeat(100));
		expect(adapter.content).toContain('"event":"log.rotated"');
		expect(adapter.content).toContain('"event":"session.started"');
	});
});
