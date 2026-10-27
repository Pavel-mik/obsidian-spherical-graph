import { describe, expect, it } from 'vitest';
import { GraphDataService } from '../../src/graph/GraphDataService';
import { diffGraphDescriptors } from '../../src/graph/graphDiff';
import { SphericalLayoutPlanner } from '../../src/layout/SphericalLayoutPlanner';
import { SphericalSolver } from '../../src/layout/SphericalSolver';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { createPersistedContinentalGeography } from '../../src/geography/postLayoutGeography';
import { directoryRegionKey } from '../../src/geography/directorySemantics';
import { validCountries } from '../../src/geography/countryTerritories';
import { createIntrinsicSphericalGrid, mapPositionsToGrid } from '../../src/geography/sphericalGrid';
import { createCommittedLayoutSnapshot, validatePersistedLayoutSnapshot, reconcileCommittedLayout, renameSnapshotPaths, pruneSnapshotPaths } from '../../src/persistence/layoutState';
import { createRenderGraphSnapshot } from '../../src/integration/renderSnapshot';
import { buildCountryBorders, countryLabels } from '../../src/render/countryGeometry';
import { DirectoryTerritoryConstraint } from '../../src/layout/territoryConstraints';
import { geodesicDistance } from '../../src/geometry/sphericalGeometry';
import { readVec3 } from '../../src/geometry/vector3';

function graph(paths: string[]) {
	const links = Object.fromEntries(paths.map((path, index) => [path,
		index % 7 === 0 ? {} : { [paths[(index + 1) % paths.length]!]: 1 }]));
	return new GraphDataService({
		getMarkdownFiles: () => paths.map((path) => ({ path, basename: path.split('/').pop()! })),
		getResolvedLinks: () => links,
	}).buildGraph();
}

const paths = [
	...Array.from({ length: 35 }, (_, i) => `Atlas/Large/deeper/n${i}.md`),
	...Array.from({ length: 8 }, (_, i) => `Atlas/Small/n${i}.md`),
	'Atlas/Single/only.md', 'Atlas/direct.md', 'Elsewhere/a.md', 'Root.md',
];
const planner = new SphericalLayoutPlanner(() => ({ ...DEFAULT_SETTINGS, layout: { ...DEFAULT_SETTINGS.layout, maxIterations: 40 } }));

function completed() {
	const current = graph(paths);
	const payload = planner.createPayload({ operationId: 'countries', mode: 'renew', graph: current, effectiveSeed: 42 });
	const result = new SphericalSolver({ ...payload, operationId: 'countries', mode: 'renew', graphSignature: current.signature, effectiveSeed: 42 }).solveSync();
	if (result.status !== 'completed') throw new Error('Cancelled');
	const geography = createPersistedContinentalGeography(current, result.positions, 42, undefined, result.territory);
	const saved = createCommittedLayoutSnapshot({ graph: current, positions: result.positions, geography, snapshotId: 'countries', mode: 'renew', effectiveSeed: 42, renewGeneration: 1, completedAt: 1 });
	if (saved === undefined) throw new Error('Invalid snapshot');
	return { current, payload, result, saved };
}

describe('subfolder countries', () => {
	it('puts unlinked folder notes on land and keeps a root orphan outside every state', () => {
		const current = new GraphDataService({ getMarkdownFiles: () => ['Only/Child/a.md', 'Only/Child/deeper/b.md', 'Only/direct.md', 'Root.md'].map((path) => ({ path, basename: path })), getResolvedLinks: () => ({}) }).buildGraph();
		const payload = planner.createPayload({ operationId: 'orphans', mode: 'renew', graph: current, effectiveSeed: 7 });
		const result = new SphericalSolver({ ...payload, operationId: 'orphans', mode: 'renew', graphSignature: current.signature, effectiveSeed: 7 }).solveSync();
		if (result.status !== 'completed') throw new Error('Cancelled');
		const territory = result.territory!;
		const cells = mapPositionsToGrid(createIntrinsicSphericalGrid(territory.subdivision), result.positions);
		for (const node of current.nodes) expect(territory.countries!.ownerByCell[cells[node.index]!]).toBe(territory.countries!.keys.indexOf(directoryRegionKey(node.path) ?? ''));
		expect(createPersistedContinentalGeography(current, result.positions, 7, undefined, territory).continents[0]?.nodeIds).toHaveLength(3);
	});
	it('allocates connected exclusive states, including nested descendants, singletons and direct notes', () => {
		const { current, payload, result } = completed();
		const territory = result.territory!;
		const countries = territory.countries!;
		expect(countries.keys).toEqual(['Atlas', 'Atlas/Large', 'Atlas/Single', 'Atlas/Small', 'Elsewhere']);
		expect(validCountries(countries, territory.folderKeys, territory.ownerByCell)).toBe(true);
		const grid = createIntrinsicSphericalGrid(territory.subdivision);
		const mapped = mapPositionsToGrid(grid, result.positions);
		const constraint = new DirectoryTerritoryConstraint({ subdivision: territory.subdivision, ownerCount: countries.keys.length + 1,
			ownerByCell: Int32Array.from(countries.ownerByCell, (owner) => owner < 0 ? countries.keys.length : owner) });
		for (const node of current.nodes) {
			const key = directoryRegionKey(node.path);
			const owner = key === undefined ? -1 : countries.keys.indexOf(key);
			expect(countries.ownerByCell[mapped[node.index]!], node.path).toBe(owner);
			expect(constraint.contains(readVec3(result.positions, node.index), owner < 0 ? countries.keys.length : owner, payload.collisionAngularRadii![node.index]), node.path).toBe(true);
		}
		for (let owner = 0; owner < countries.keys.length; owner += 1) {
			const owned = countries.ownerByCell.flatMap((value, cell) => value === owner ? [cell] : []);
			const seen = new Set([owned[0]!]);
			for (const cell of seen) for (const neighbor of grid.neighbors[cell]!) {
				if (countries.ownerByCell[neighbor] === owner) seen.add(neighbor);
			}
			expect(seen.size).toBe(owned.length);
		}
		const repeat = planner.createPayload({ operationId: 'repeat', mode: 'renew', graph: current, effectiveSeed: 42 });
		expect(repeat.territory?.countries).toEqual(countries);
	});

	it('round trips exact territories, draws internal borders only, and retains geography when filtering a continent', () => {
		const { current, saved } = completed();
		const loaded = validatePersistedLayoutSnapshot(JSON.parse(JSON.stringify(saved)));
		expect(loaded?.geography?.territory).toEqual(saved.geography?.territory);
		const rendered = createRenderGraphSnapshot(saved, current);
		const borders = buildCountryBorders(rendered.geography?.territory, 10);
		expect(borders.length).toBeGreaterThan(0);
		for (let i = 0; i < borders.length; i += 3) expect(Math.hypot(borders[i]!, borders[i + 1]!, borders[i + 2]!)).toBeCloseTo(10, 5);
		expect(countryLabels(rendered.geography?.territory).map((label) => label.label)).toContain('Common');
		const filtered = graph(paths.filter((path) => !path.startsWith('Elsewhere/')));
		expect(createRenderGraphSnapshot(saved, filtered).geography?.territory?.countries).toEqual(saved.geography?.territory?.countries);
		const pruned = pruneSnapshotPaths(saved, new Set(filtered.nodes.map((node) => node.path)));
		expect(validatePersistedLayoutSnapshot(pruned)?.geography?.territory?.countries).toEqual(saved.geography?.territory?.countries);
		const swapped = { ...saved, positionsByPath: { ...saved.positionsByPath, 'Atlas/direct.md': saved.positionsByPath['Elsewhere/a.md']! } };
		expect(validatePersistedLayoutSnapshot(swapped)).toBeUndefined();
		const invalid = JSON.parse(JSON.stringify(saved)) as typeof saved;
		const badCountries = { ...invalid.geography!.territory!.countries!, ownerByCell: Array(saved.geography!.territory!.ownerByCell.length).fill(0) as number[] };
		expect(validatePersistedLayoutSnapshot({ ...invalid, geography: { ...invalid.geography, territory: { ...invalid.geography!.territory, countries: badCountries } } })).toBeUndefined();
	});

	it('refreshes additions inside existing countries without changing borders or exceeding old-node caps', () => {
		const { current, saved } = completed();
		const next = graph([...paths, 'Atlas/Small/new.md']);
		const diff = diffGraphDescriptors(current.descriptor, next.descriptor, next.signature, [], current.signature);
		const payload = planner.createPayload({ operationId: 'refresh', mode: 'refresh', graph: next, effectiveSeed: 42, committedSnapshot: saved, diff });
		const result = new SphericalSolver({ ...payload, operationId: 'refresh', mode: 'refresh', graphSignature: next.signature, effectiveSeed: 42 }).solveSync();
		if (result.status !== 'completed') throw new Error('Cancelled');
		expect(result.territory?.countries).toEqual(saved.geography?.territory?.countries);
		for (const node of next.nodes) {
			const old = saved.positionsByPath[node.path];
			if (old !== undefined) expect(geodesicDistance(old, readVec3(result.positions, node.index))).toBeLessThanOrEqual((payload.refresh!.maxAnchorDistances[node.index] ?? 0) + 1e-6);
		}
		const mapped = mapPositionsToGrid(createIntrinsicSphericalGrid(result.territory!.subdivision), result.positions);
		for (const node of next.nodes) expect(result.territory!.countries!.ownerByCell[mapped[node.index]!]).toBe(result.territory!.countries!.keys.indexOf(directoryRegionKey(node.path) ?? ''));
	});

	it('asks for Renew for new countries and cross-country moves, while same-country rename stays fixed', () => {
		const { current, saved } = completed();
		const added = graph([...paths, 'Atlas/New/n.md']);
		const diff = diffGraphDescriptors(current.descriptor, added.descriptor, added.signature, [], current.signature);
		expect(() => planner.createPayload({ operationId: 'new', mode: 'refresh', graph: added, effectiveSeed: 42, committedSnapshot: saved, diff })).toThrow(/Renew layout/u);
		const rename = { oldPath: 'Atlas/direct.md', newPath: 'Atlas/Small/moved.md' };
		const moved = graph(paths.map((path) => path === rename.oldPath ? rename.newPath : path));
		expect(diffGraphDescriptors(current.descriptor, moved.descriptor, moved.signature, [{ ...rename, reliability: 'reliable' }], current.signature).requiresLayout).toBe(true);
		expect(renameSnapshotPaths(saved, [rename])).toBeUndefined();
		expect(reconcileCommittedLayout(saved, moved, [rename]).pendingNodeIds).toContain(rename.newPath);
		const same = { oldPath: 'Atlas/direct.md', newPath: 'Atlas/renamed.md' };
		expect(renameSnapshotPaths(saved, [same])?.positionsByPath[same.newPath]).toEqual(saved.positionsByPath[same.oldPath]);
	});
});
