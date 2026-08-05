#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import {
	access,
	mkdir,
	readdir,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const SUPPORTED_PATTERNS = new Set([
	'ring',
	'star',
	'clustered',
	'multi-component',
	'random',
	'territories',
]);

function parseArguments(argv) {
	const values = new Map();
	const flags = new Set();

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === '--force') {
			flags.add('force');
			continue;
		}
		if (!token?.startsWith('--')) {
			throw new Error(`Unexpected argument: ${token ?? ''}`);
		}
		const value = argv[index + 1];
		if (!value || value.startsWith('--')) {
			throw new Error(`Missing value for ${token}`);
		}
		values.set(token.slice(2), value);
		index += 1;
	}

	if (!values.has('output')) {
		throw new Error(
			'Refusing to generate files without an explicit --output directory.',
		);
	}

	const nodes = parseInteger(values.get('nodes') ?? '500', 'nodes', 1);
	const defaultEdges = Math.min(
		Math.max(nodes - 1, nodes * 3),
		(nodes * (nodes - 1)) / 2,
	);
	const edges = parseInteger(
		values.get('edges') ?? String(defaultEdges),
		'edges',
		0,
	);
	const seed = parseInteger(values.get('seed') ?? '42', 'seed', 0);
	const pattern = values.get('pattern') ?? 'clustered';
	const folders = parseInteger(
		values.get('folders') ?? (pattern === 'territories' ? '18' : '1'),
		'folders',
		1,
	);

	if (!SUPPORTED_PATTERNS.has(pattern)) {
		throw new Error(
			`Unsupported --pattern "${pattern}". Choose ${[...SUPPORTED_PATTERNS].join(', ')}.`,
		);
	}

	const maximumEdges = (nodes * (nodes - 1)) / 2;
	if (edges > maximumEdges) {
		throw new Error(
			`Requested ${edges} edges, but ${nodes} nodes allow at most ${maximumEdges}.`,
		);
	}
	if (folders > nodes) {
		throw new Error('--folders cannot exceed --nodes.');
	}

	return {
		output: path.resolve(process.cwd(), values.get('output')),
		nodes,
		edges,
		seed,
		pattern,
		folders,
		force: flags.has('force'),
	};
}

function parseInteger(raw, name, minimum) {
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < minimum) {
		throw new Error(`--${name} must be an integer greater than or equal to ${minimum}.`);
	}
	return value;
}

function createPrng(seed) {
	let state = (seed ^ 0x9e3779b9) >>> 0;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return (state >>> 0) / 0x1_0000_0000;
	};
}

function edgeKey(left, right) {
	return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function addEdge(edges, left, right) {
	if (left === right) {
		return false;
	}
	const key = edgeKey(left, right);
	if (edges.has(key)) {
		return false;
	}
	edges.set(key, left < right ? [left, right] : [right, left]);
	return true;
}

function componentOf(index, nodeCount) {
	const componentCount = Math.max(2, Math.min(8, Math.round(Math.sqrt(nodeCount / 20))));
	return index % componentCount;
}

function territoryOf(index, nodeCount, folderCount) {
	return Math.min(
		folderCount - 1,
		Math.floor(index * folderCount / nodeCount),
	);
}

function randomNodeInTerritory(territory, nodeCount, folderCount, random) {
	const start = Math.ceil(territory * nodeCount / folderCount);
	const end = Math.ceil((territory + 1) * nodeCount / folderCount);
	return start + Math.floor(random() * Math.max(1, end - start));
}

function randomPair(pattern, nodeCount, folderCount, random) {
	const left = Math.floor(random() * nodeCount);
	let right;

	if (pattern === 'territories' && random() < 0.78) {
		right = randomNodeInTerritory(
			territoryOf(left, nodeCount, folderCount),
			nodeCount,
			folderCount,
			random,
		);
	} else if (pattern === 'clustered' && random() < 0.84) {
		const clusterCount = Math.max(2, Math.min(12, Math.round(Math.sqrt(nodeCount / 8))));
		const cluster = left % clusterCount;
		const candidates = Math.max(1, Math.floor(nodeCount / clusterCount));
		right = (cluster + clusterCount * Math.floor(random() * candidates)) % nodeCount;
	} else if (pattern === 'multi-component') {
		const component = componentOf(left, nodeCount);
		const componentCount = Math.max(
			2,
			Math.min(8, Math.round(Math.sqrt(nodeCount / 20))),
		);
		const candidates = Math.max(1, Math.ceil(nodeCount / componentCount));
		right =
			(component + componentCount * Math.floor(random() * candidates)) %
			nodeCount;
	} else {
		right = Math.floor(random() * nodeCount);
	}

	return [left, right];
}

function createEdges(nodeCount, requestedCount, pattern, folderCount, seed) {
	const edges = new Map();
	const random = createPrng(seed);

	if (pattern === 'ring' && nodeCount > 1) {
		for (let index = 0; index < nodeCount && edges.size < requestedCount; index += 1) {
			addEdge(edges, index, (index + 1) % nodeCount);
		}
	}

	if (pattern === 'star' && nodeCount > 1) {
		for (let index = 1; index < nodeCount && edges.size < requestedCount; index += 1) {
			addEdge(edges, 0, index);
		}
	}

	if (pattern === 'multi-component' && nodeCount > 1) {
		const componentCount = Math.max(
			2,
			Math.min(8, Math.round(Math.sqrt(nodeCount / 20))),
		);
		for (
			let component = 0;
			component < componentCount && edges.size < requestedCount;
			component += 1
		) {
			const members = [];
			for (let index = component; index < nodeCount; index += componentCount) {
				members.push(index);
			}
			for (
				let index = 1;
				index < members.length && edges.size < requestedCount;
				index += 1
			) {
				addEdge(edges, members[index - 1], members[index]);
			}
		}
	}

	const maximumAttempts = Math.max(10_000, requestedCount * 80);
	for (
		let attempt = 0;
		edges.size < requestedCount && attempt < maximumAttempts;
		attempt += 1
	) {
		const [left, right] = randomPair(
			pattern,
			nodeCount,
			folderCount,
			random,
		);
		addEdge(edges, left, right);
	}

	if (edges.size < requestedCount) {
		for (
			let left = 0;
			left < nodeCount && edges.size < requestedCount;
			left += 1
		) {
			for (
				let right = left + 1;
				right < nodeCount && edges.size < requestedCount;
				right += 1
			) {
				if (
					pattern !== 'multi-component' ||
					componentOf(left, nodeCount) === componentOf(right, nodeCount)
				) {
					addEdge(edges, left, right);
				}
			}
		}
	}

	if (edges.size !== requestedCount) {
		throw new Error(
			`Pattern "${pattern}" can produce only ${edges.size} of the requested ${requestedCount} edges.`,
		);
	}

	return [...edges.values()];
}

async function pathExists(candidate) {
	try {
		await access(candidate, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function validateOutputDirectory(output) {
	const root = path.parse(output).root;
	const currentDirectory = path.resolve(process.cwd());
	const userHome = path.resolve(homedir());

	if (
		output === root ||
		output === currentDirectory ||
		output === userHome ||
		output.length <= root.length + 2
	) {
		throw new Error(`Refusing unsafe output directory: ${output}`);
	}

	const info = await stat(output).catch(() => undefined);
	if (info && !info.isDirectory()) {
		throw new Error(`Output exists and is not a directory: ${output}`);
	}
	// This standalone generator is not running inside an Obsidian Vault
	// instance, so Vault#configDir is unavailable. The default directory is a
	// deliberate conservative guard, not an assumption about every vault.
	if (await pathExists(path.join(output, '.obsidian'))) {
		throw new Error(
			`Refusing to overwrite an Obsidian vault, even with --force: ${output}`,
		);
	}
}

async function prepareOutputDirectory(output, force) {
	await validateOutputDirectory(output);
	if (await pathExists(output)) {
		const entries = await readdir(output);
		if (entries.length > 0 && !force) {
			throw new Error(
				`Output directory is not empty. Re-run with --force only if it is disposable: ${output}`,
			);
		}
		if (entries.length > 0) {
			await rm(output, { recursive: true, force: true });
		}
	}
	await mkdir(output, { recursive: true });
}

function fileStem(index, nodeCount) {
	const width = Math.max(4, String(nodeCount).length);
	return `Note-${String(index + 1).padStart(width, '0')}`;
}

function relativeNotePath(index, nodeCount, pattern, folderCount) {
	const stem = fileStem(index, nodeCount);
	if (pattern !== 'territories') {
		return stem;
	}
	const territory = territoryOf(index, nodeCount, folderCount);
	const start = Math.ceil(territory * nodeCount / folderCount);
	const localIndex = index - start;
	const folderWidth = Math.max(2, String(folderCount).length);
	return path.join(
		`Continent-${String(territory + 1).padStart(folderWidth, '0')}`,
		`District-${String((localIndex % 3) + 1).padStart(2, '0')}`,
		stem,
	);
}

async function writeVault(output, nodeCount, edges, pattern, folderCount, seed) {
	const neighbors = Array.from({ length: nodeCount }, () => []);
	for (const [left, right] of edges) {
		neighbors[left].push(right);
		neighbors[right].push(left);
	}

	await Promise.all(
		neighbors.map(async (linkedNodes, index) => {
			linkedNodes.sort((left, right) => left - right);
			const name = fileStem(index, nodeCount);
			const links = linkedNodes
				.map((neighbor) => `- [[${relativeNotePath(neighbor, nodeCount, pattern, folderCount)}]]`)
				.join('\n');
			const body = [
				`# ${name}`,
				'',
				`Synthetic ${pattern} graph node generated with seed ${seed}.`,
				'',
				'## Links',
				'',
				links || '_No links._',
				'',
			].join('\n');
			const relativePath = relativeNotePath(
				index,
				nodeCount,
				pattern,
				folderCount,
			);
			const target = path.join(output, `${relativePath}.md`);
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, body, 'utf8');
		}),
	);
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	await prepareOutputDirectory(options.output, options.force);
	const edges = createEdges(
		options.nodes,
		options.edges,
		options.pattern,
		options.folders,
		options.seed,
	);
	await writeVault(
		options.output,
		options.nodes,
		edges,
		options.pattern,
		options.folders,
		options.seed,
	);
	process.stdout.write(
		[
			`Generated synthetic vault: ${options.output}`,
			`Pattern: ${options.pattern}`,
			`Markdown files: ${options.nodes}`,
			`Undirected edges: ${edges.length}`,
			`Seed: ${options.seed}`,
			`Top-level folders: ${options.pattern === 'territories' ? options.folders : 0}`,
		].join('\n') + '\n',
	);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`Test vault generation failed: ${message}\n`);
	process.exitCode = 1;
});
