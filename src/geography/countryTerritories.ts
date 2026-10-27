import type { GraphData } from '../graph/graphTypes';
import { directoryRegionKey, topLevelFolder } from './directorySemantics';
import type { DirectoryTerritoryPlan } from './directoryTerritories';
import { createIntrinsicSphericalGrid } from './sphericalGrid';
import { dotVec3, normalizeVec3, type Vec3 } from '../geometry/vector3';

/** Keys are actual directory paths; a top-level key is its direct-note district. */
export interface CountryTerritories {
	readonly keys: readonly string[];
	readonly ownerByCell: readonly number[];
}

export function freezeCountries(value: CountryTerritories): CountryTerritories {
	return Object.freeze({
		keys: Object.freeze([...value.keys]),
		ownerByCell: Object.freeze([...value.ownerByCell]),
	});
}

export function countryIndices(graph: GraphData, countries: CountryTerritories): Int32Array {
	const byKey = new Map(countries.keys.map((key, index) => [key, index]));
	return Int32Array.from(graph.nodes, (node) => {
		const key = directoryRegionKey(node.path);
		if (key === undefined) return countries.keys.length; // ocean/root owner
		const owner = byKey.get(key);
		if (owner === undefined) {
			throw new Error('A new country needs space on the map. Use Renew layout to include the changed folders.');
		}
		return owner;
	});
}

/** Connected frontier growth inside each fixed continent, with no sea between states. */
export function createCountryTerritories(graph: GraphData, plan: DirectoryTerritoryPlan): CountryTerritories {
	const keys = [...new Set(graph.nodes.map((node) => directoryRegionKey(node.path))
		.filter((key): key is string => key !== undefined))].sort((a, b) => a.localeCompare(b));
	const counts = keys.map(() => 0);
	const byKey = new Map(keys.map((key, index) => [key, index]));
	for (const node of graph.nodes) {
		const owner = byKey.get(directoryRegionKey(node.path) ?? '');
		if (owner !== undefined) counts[owner] = (counts[owner] ?? 0) + 1;
	}
	const grid = createIntrinsicSphericalGrid(plan.subdivision);
	const owners = new Int32Array(grid.vertices.length).fill(-1);
	for (let parent = 0; parent < plan.folderKeys.length; parent += 1) {
		const members = keys.map((key, index) => ({ key, index }))
			.filter(({ key }) => key.split('/')[0] === plan.folderKeys[parent])
			.map(({ index }) => index)
			.sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a - b);
		const cells: number[] = [];
		for (let cell = 0; cell < owners.length; cell += 1) {
			if (plan.ownerByCell[cell] === parent) cells.push(cell);
		}
		if (members.length > cells.length) {
			throw new Error('This continent has too many countries for its territory. Increase territory resolution.');
		}
		const center = normalizeVec3(cells.reduce<Vec3>((sum, cell) => {
			const p = grid.vertices[cell]!;
			return [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]];
		}, [0, 0, 0]));
		const seeds = new Map<number, number>();
		const actual = new Map<number, number>();
		const frontiers = new Map<number, Set<number>>();
		const addNeighbors = (owner: number, cell: number): void => {
			for (const next of grid.neighbors[cell] ?? []) {
				if (plan.ownerByCell[next] === parent && owners[next] === -1) frontiers.get(owner)?.add(next);
			}
		};
		for (const owner of members) {
			let best = -1;
			let score = -Infinity;
			for (const cell of cells) {
				if (owners[cell] !== -1) continue;
				const p = grid.vertices[cell]!;
				const candidate = seeds.size === 0 ? dotVec3(p, center)
					: Math.min(...[...seeds.values()].map((seed) => 1 - dotVec3(p, grid.vertices[seed]!)));
				if (candidate > score) { best = cell; score = candidate; }
			}
			owners[best] = owner;
			seeds.set(owner, best);
			actual.set(owner, 1);
			frontiers.set(owner, new Set());
		}
		for (const [owner, seed] of seeds) addNeighbors(owner, seed);
		// Ratios grant small states a usable minimum while giving large states more space.
		const weights = new Map(members.map((owner) => [owner, Math.max(1, counts[owner] ?? 1) + 4]));
		while (true) {
			let selected = -1;
			let ratio = Infinity;
			for (const owner of members) {
				const frontier = frontiers.get(owner)!;
				for (const cell of frontier) if (owners[cell] !== -1) frontier.delete(cell);
				const value = (actual.get(owner) ?? 0) / (weights.get(owner) ?? 1);
				if (frontier.size > 0 && value < ratio) { selected = owner; ratio = value; }
			}
			if (selected < 0) break;
			const seed = grid.vertices[seeds.get(selected)!]!;
			let best = -1;
			let score = -Infinity;
			for (const cell of frontiers.get(selected)!) {
				const support = (grid.neighbors[cell] ?? []).filter((n) => owners[n] === selected).length;
				const candidate = dotVec3(seed, grid.vertices[cell]!) + support * 0.0003;
				if (candidate > score) { best = cell; score = candidate; }
			}
			owners[best] = selected;
			actual.set(selected, (actual.get(selected) ?? 0) + 1);
			addNeighbors(selected, best);
		}
		if (cells.some((cell) => owners[cell] === -1)) throw new Error('Country allocation left unassigned land.');
	}
	return freezeCountries({ keys, ownerByCell: [...owners] });
}

/** Shared validation for disk, workers and renderer; rejects mismatched parent ownership. */
export function validCountries(value: unknown, folders: readonly string[], parents: ArrayLike<number>): value is CountryTerritories {
	if (typeof value !== 'object' || value === null) return false;
	const data = value as Partial<CountryTerritories>;
	if (!Array.isArray(data.keys) || !Array.isArray(data.ownerByCell) || data.ownerByCell.length !== parents.length) return false;
	if (new Set(data.keys).size !== data.keys.length || !data.keys.every((key: unknown) =>
		typeof key === 'string' && key.length > 0 && key.split('/').length <= 2 && !key.includes('\\') &&
		key.split('/').every((part) => part.length > 0) && folders.includes(topLevelFolder(`${key}/_`) ?? ''))) return false;
	const parentByCountry = data.keys.map((key: string) => folders.indexOf(key.split('/')[0] ?? ''));
	const seen = new Set<number>();
	for (let cell = 0; cell < parents.length; cell += 1) {
		const owner: unknown = data.ownerByCell[cell];
		if (typeof owner !== 'number' || !Number.isSafeInteger(owner) || owner < -1 || owner >= data.keys.length) return false;
		if (parents[cell] === -1 ? owner !== -1 : owner < 0 || parentByCountry[owner] !== parents[cell]) return false;
		if (owner >= 0) seen.add(owner);
	}
	return seen.size === data.keys.length;
}
