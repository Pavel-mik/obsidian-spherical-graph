import { spawnSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_PATH = fileURLToPath(
	new URL('../../scripts/generate-test-vault.mjs', import.meta.url),
);
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'spherical-graph-generator-'));
	temporaryRoots.push(root);
	return root;
}

function runGenerator(arguments_: readonly string[]) {
	return spawnSync(process.execPath, [SCRIPT_PATH, ...arguments_], {
		encoding: 'utf8',
	});
}

function snapshot(directory: string): ReadonlyArray<readonly [string, string]> {
	return readdirSync(directory)
		.sort()
		.map(
			(name) =>
				[
					name,
					readFileSync(path.join(directory, name), 'utf8'),
				] as const,
		);
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('generate-test-vault', () => {
	it('refuses to run without an explicit output directory', () => {
		const result = runGenerator([]);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('explicit --output');
	});

	it('generates identical Markdown for identical inputs', () => {
		const root = temporaryRoot();
		const first = path.join(root, 'first');
		const second = path.join(root, 'second');
		const common = [
			'--nodes',
			'12',
			'--edges',
			'18',
			'--seed',
			'73',
			'--pattern',
			'clustered',
		];

		expect(runGenerator(['--output', first, ...common]).status).toBe(0);
		expect(runGenerator(['--output', second, ...common]).status).toBe(0);
		expect(snapshot(first)).toEqual(snapshot(second));
		expect(readdirSync(first)).toHaveLength(12);
	});

	it('requires force for a non-empty disposable directory', () => {
		const root = temporaryRoot();
		const output = path.join(root, 'vault');
		mkdirSync(output);
		writeFileSync(path.join(output, 'keep.txt'), 'sentinel', 'utf8');

		const refused = runGenerator([
			'--output',
			output,
			'--nodes',
			'4',
			'--edges',
			'3',
		]);
		expect(refused.status).toBe(1);
		expect(refused.stderr).toContain('not empty');

		const forced = runGenerator([
			'--output',
			output,
			'--nodes',
			'4',
			'--edges',
			'3',
			'--force',
		]);
		expect(forced.status).toBe(0);
		expect(readdirSync(output).sort()).toEqual([
			'Note-0001.md',
			'Note-0002.md',
			'Note-0003.md',
			'Note-0004.md',
		]);
	});

	it('never overwrites a directory that is itself an Obsidian vault', () => {
		const root = temporaryRoot();
		const output = path.join(root, 'real-vault');
		// The CLI safety test intentionally exercises the default config folder.
		mkdirSync(path.join(output, '.obsidian'), { recursive: true });

		const result = runGenerator([
			'--output',
			output,
			'--nodes',
			'4',
			'--edges',
			'3',
			'--force',
		]);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Obsidian vault');
	});

	it.each([
		'ring',
		'star',
		'clustered',
		'multi-component',
		'random',
	])('supports the %s pattern', (pattern) => {
		const output = path.join(temporaryRoot(), pattern);
		const result = runGenerator([
			'--output',
			output,
			'--nodes',
			'8',
			'--edges',
			'7',
			'--seed',
			'9',
			'--pattern',
			pattern,
		]);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain(`Pattern: ${pattern}`);
		expect(readdirSync(output)).toHaveLength(8);
	});
});
