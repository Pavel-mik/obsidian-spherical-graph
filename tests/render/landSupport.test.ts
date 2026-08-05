import { describe, expect, it } from 'vitest';
import {
	classifySupportedContinent,
	continentSupportClearance,
	createLandSupportModel,
	eligibleIslandNodeIndices,
	landSupportDiagnostics,
	sampleContinentSupport,
} from '../../src/render/landSupport';
import {
	exponentialMap,
	geodesicDistance,
} from '../../src/geometry/sphericalGeometry';
import {
	addVec3,
	crossVec3,
	dotVec3,
	normalizeVec3,
	orthogonalUnitVec3,
	scaleVec3,
	type Vec3,
} from '../../src/geometry/vector3';
import { fibonacciSpherePoint } from '../../src/layout/initialization';
import type { RenderGeography } from '../../src/render/renderTypes';
import { createIntrinsicSphericalGrid } from '../../src/geography/sphericalGrid';

const center: Vec3 = [1, 0, 0];

function twoMemberGeography(): RenderGeography {
	return {
		continents: [
			{
				id: 'network',
				label: 'Network',
				nodeIndices: [0, 1],
				center,
				capRadius: 0.65,
				colorIndex: 0,
			},
		],
		islandNodeIndices: [],
	};
}

function clusterAround(
	clusterCenter: Vec3,
	count: number,
	seed: number,
): Vec3[] {
	const tangentX = orthogonalUnitVec3(clusterCenter, seed);
	const tangentY = normalizeVec3(crossVec3(clusterCenter, tangentX));
	return Array.from({ length: count }, (_, index) => {
		if (index === 0) {
			return clusterCenter;
		}
		const phase = ((index - 1) / Math.max(1, count - 1)) * Math.PI * 2;
		return exponentialMap(
			clusterCenter,
			addVec3(
				scaleVec3(tangentX, Math.cos(phase) * 0.07),
				scaleVec3(tangentY, Math.sin(phase) * 0.07),
			),
		);
	});
}

describe('node- and edge-supported continent territory', () => {
	it('uses a persisted connected territory verbatim instead of rebuilding node ribbons', () => {
		const grid = createIntrinsicSphericalGrid(4);
		const ownerByCell = Int32Array.from(
			grid.vertices,
			(point) => point[0] > 0.35 ? 0 : -1,
		);
		const geography: RenderGeography = {
			continents: [
				{
					id: 'books',
					label: 'Books',
					nodeIndices: [0, 1],
					center,
					capRadius: 0.8,
					colorIndex: 0,
				},
			],
			islandNodeIndices: [],
			territory: {
				subdivision: 4,
				folderKeys: ['Books'],
				ownerByCell,
			},
		};
		const positions = new Float32Array([
			1, 0, 0,
			0.9, 0.42, 0.1,
		]);
		const model = createLandSupportModel(geography, positions, [], 73);
		const diagnostics = landSupportDiagnostics(model);
		const expectedLand = [...ownerByCell].filter((owner) => owner === 0).length;

		expect(diagnostics.landCellCount).toBe(expectedLand);
		expect(diagnostics.protectedLandCellCount).toBe(expectedLand);
		expect(diagnostics.expandedLandCellCount).toBe(0);
		expect(diagnostics.ownerComponentCounts).toEqual([1]);
		expect(classifySupportedContinent([1, 0, 0], model)).toBe(0);
		expect(classifySupportedContinent([-1, 0, 0], model)).toBe(-1);
	});

	it('guarantees member land without cutting a lake around one isolated free node', () => {
		const member = center;
		const foreign = exponentialMap(center, [0, 0.08, 0]);
		const geography: RenderGeography = {
			continents: [
				{
					id: 'member',
					label: 'Member',
					nodeIndices: [0],
					center,
					capRadius: 0.6,
					colorIndex: 0,
				},
			],
			islandNodeIndices: [1],
		};
		const model = createLandSupportModel(
			geography,
			new Float32Array([...member, ...foreign]),
			[],
			42,
		);

		expect(classifySupportedContinent(member, model)).toBe(0);
		expect(continentSupportClearance(member, 0, model)).toBeLessThan(0);
		expect(classifySupportedContinent(foreign, model)).toBe(0);
	});

	it('lets a competing accepted continent carve a sea boundary', () => {
		const first = center;
		const second = exponentialMap(center, [0, 0.08, 0]);
		const geography: RenderGeography = {
			continents: [
				{
					id: 'first',
					label: 'First',
					nodeIndices: [0],
					center,
					capRadius: 0.6,
					colorIndex: 0,
				},
				{
					id: 'second',
					label: 'Second',
					nodeIndices: [1],
					center: second,
					capRadius: 0.6,
					colorIndex: 1,
				},
			],
			islandNodeIndices: [],
		};
		const model = createLandSupportModel(
			geography,
			new Float32Array([...first, ...second]),
			[],
			42,
		);

		expect(classifySupportedContinent(first, model)).toBe(0);
		expect(classifySupportedContinent(second, model)).toBe(1);
	});

	it('keeps a forced member on land when sub-cell coast noise crosses its sample', () => {
		const first = center;
		const second = exponentialMap(center, [0, 0.065, 0]);
		const geography: RenderGeography = {
			continents: [
				{
					id: 'first',
					label: 'First',
					nodeIndices: [0],
					center,
					capRadius: 0.6,
					colorIndex: 0,
				},
				{
					id: 'second',
					label: 'Second',
					nodeIndices: [1],
					center: second,
					capRadius: 0.6,
					colorIndex: 1,
				},
			],
			islandNodeIndices: [],
		};
		const model = createLandSupportModel(
			geography,
			new Float32Array([...first, ...second]),
			[],
			2,
		);

		expect(classifySupportedContinent(first, model)).toBe(0);
		expect(classifySupportedContinent(second, model)).toBe(1);
		expect(sampleContinentSupport(second, 1, model)?.margin).toBeGreaterThan(
			0,
		);
	});

	it('reports a declared owner whose raster component is missing', () => {
		const geography: RenderGeography = {
			continents: [
				{
					id: 'populated',
					label: 'Populated',
					nodeIndices: [0],
					center,
					capRadius: 0.6,
					colorIndex: 0,
				},
				{
					id: 'missing',
					label: 'Missing',
					nodeIndices: [],
					center: [-1, 0, 0],
					capRadius: 0.6,
					colorIndex: 1,
				},
			],
			islandNodeIndices: [],
		};
		const model = createLandSupportModel(
			geography,
			new Float32Array(center),
			[],
			73,
		);
		const diagnostics = landSupportDiagnostics(model);

		expect(diagnostics.ownerComponentCounts).toEqual([1, 0]);
		expect(diagnostics.disconnectedContinentCount).toBe(1);
	});

	it('keeps both owners connected when a foreign belt surrounds another owner path', () => {
		const beltCount = 16;
		const belt = Array.from({ length: beltCount }, (_, index) => {
			const phase = (index / beltCount) * Math.PI * 2;
			return exponentialMap(center, [
				0,
				Math.cos(phase) * 0.28,
				Math.sin(phase) * 0.28,
			]);
		});
		const innerTerminal = center;
		const outerTerminal = exponentialMap(center, [0, 0.52, 0.07]);
		const beltDefinition = {
			id: 'belt',
			label: 'Belt',
			nodeIndices: belt.map((_, index) => index),
			center,
			capRadius: 0.5,
			colorIndex: 0,
		};
		const terminalDefinition = {
			id: 'terminals',
			label: 'Terminals',
			nodeIndices: [beltCount, beltCount + 1],
			center: normalizeVec3(
				addVec3(innerTerminal, outerTerminal),
			),
			capRadius: 0.7,
			colorIndex: 1,
		};
		for (const beltFirst of [true, false]) {
			const model = createLandSupportModel(
				{
					continents: beltFirst
						? [beltDefinition, terminalDefinition]
						: [terminalDefinition, beltDefinition],
					islandNodeIndices: [],
				},
				new Float32Array([
					...belt.flat(),
					...innerTerminal,
					...outerTerminal,
				]),
				Array.from({ length: beltCount }, (_, index) => ({
					source: index,
					target: (index + 1) % beltCount,
					weight: 1,
				})),
				113,
			);
			const diagnostics = landSupportDiagnostics(model);
			const beltOwner = beltFirst ? 0 : 1;
			const terminalOwner = beltFirst ? 1 : 0;

			expect(diagnostics.ownerComponentCounts).toEqual([1, 1]);
			expect(diagnostics.disconnectedContinentCount).toBe(0);
			for (const member of belt) {
				expect(classifySupportedContinent(member, model)).toBe(
					beltOwner,
				);
			}
			expect(classifySupportedContinent(innerTerminal, model)).toBe(
				terminalOwner,
			);
			expect(classifySupportedContinent(outerTerminal, model)).toBe(
				terminalOwner,
			);
		}
	});

	it('preserves a protected terminal for owners quantized to one raster cell', () => {
		const first = center;
		const second = exponentialMap(center, [0, 0.001, 0]);
		const model = createLandSupportModel(
			{
				continents: [
					{
						id: 'first-cell-owner',
						label: 'First',
						nodeIndices: [0],
						center: first,
						capRadius: 0.2,
						colorIndex: 0,
					},
					{
						id: 'second-cell-owner',
						label: 'Second',
						nodeIndices: [1],
						center: second,
						capRadius: 0.2,
						colorIndex: 1,
					},
				],
				islandNodeIndices: [],
			},
			new Float32Array([...first, ...second]),
			[],
			211,
		);
		const diagnostics = landSupportDiagnostics(model);

		expect(diagnostics.ownerComponentCounts).toEqual([1, 1]);
		expect(diagnostics.disconnectedContinentCount).toBe(0);
		expect(diagnostics.protectedLandCellCount).toBeGreaterThanOrEqual(2);
		expect(classifySupportedContinent(first, model)).toBe(0);
		expect(classifySupportedContinent(second, model)).toBe(1);
		expect(sampleContinentSupport(first, 0, model)?.margin).toBeGreaterThan(
			0,
		);
		expect(sampleContinentSupport(second, 1, model)?.margin).toBeGreaterThan(
			0,
		);
	});

	it('lets a coherent free-node community preserve open water', () => {
		const member = center;
		const freeNodes = [
			exponentialMap(center, [0, 0.08, 0]),
			exponentialMap(center, [0, 0.095, 0.02]),
			exponentialMap(center, [0, 0.095, -0.02]),
		];
		const geography: RenderGeography = {
			continents: [
				{
					id: 'member',
					label: 'Member',
					nodeIndices: [0],
					center,
					capRadius: 0.6,
					colorIndex: 0,
				},
			],
			islandNodeIndices: [1, 2, 3],
		};
		const model = createLandSupportModel(
			geography,
			new Float32Array([...member, ...freeNodes.flat()]),
			[
				{ source: 1, target: 2, weight: 1 },
				{ source: 2, target: 3, weight: 1 },
				{ source: 3, target: 1, weight: 1 },
			],
			42,
		);

		for (const freeNode of freeNodes) {
			expect(classifySupportedContinent(freeNode, model)).toBe(-1);
		}
	});

	it('keeps orphans out while retaining low-degree directory members', () => {
		const directions: readonly Vec3[] = [
			[-1, 0, 0],
			[0, 1, 0],
			[0, -1, 0],
			center,
		];
		const geography: RenderGeography = {
			continents: [
				{
					id: 'legacy',
					label: 'Legacy',
					nodeIndices: [0, 1, 2, 3],
					center,
					capRadius: 1,
					colorIndex: 0,
				},
			],
			islandNodeIndices: [0],
		};
		const degrees = new Uint8Array([0, 1, 2, 3]);
		const model = createLandSupportModel(
			geography,
			new Float32Array(directions.flat()),
			[
				{ source: 1, target: 2, weight: 1 },
				{ source: 2, target: 3, weight: 1 },
			],
			42,
			degrees,
		);

		expect(eligibleIslandNodeIndices(geography, 4, degrees)).toEqual([]);
		expect(landSupportDiagnostics(model).densityAnchorCount).toBe(3);
		expect(classifySupportedContinent(directions[0] ?? center, model)).toBe(
			-1,
		);
		expect(classifySupportedContinent(directions[1] ?? center, model)).toBe(0);
		expect(classifySupportedContinent(directions[2] ?? center, model)).toBe(0);
		expect(classifySupportedContinent(center, model)).toBe(0);
	});

	it('connects separated directory members without filling the unsupported globe', () => {
		const first = exponentialMap(center, [0, -0.175, 0]);
		const second = exponentialMap(center, [0, 0.175, 0]);
		const positions = new Float32Array([...first, ...second]);
		const geography = twoMemberGeography();
		const withoutRoad = createLandSupportModel(
			geography,
			positions,
			[],
			7,
		);
		const withRoad = createLandSupportModel(
			geography,
			positions,
			[{ source: 0, target: 1, weight: 1 }],
			7,
		);

		expect(classifySupportedContinent(center, withRoad)).toBe(0);
		const unsupported = exponentialMap(center, [0, 0, 0.35]);
		expect(classifySupportedContinent(unsupported, withRoad)).toBe(-1);
		expect(
			landSupportDiagnostics(withoutRoad).ownerComponentCounts,
		).toEqual([1]);
	});

	it('keeps a protected directory backbone through a long sparse gap', () => {
		const first = exponentialMap(center, [0, -0.26, 0]);
		const second = exponentialMap(center, [0, 0.26, 0]);
		const model = createLandSupportModel(
			twoMemberGeography(),
			new Float32Array([...first, ...second]),
			[{ source: 0, target: 1, weight: 1 }],
			9,
		);

		expect(classifySupportedContinent(first, model)).toBe(0);
		expect(classifySupportedContinent(second, model)).toBe(0);
		expect(classifySupportedContinent([-1, 0, 0], model)).toBe(-1);
		expect(landSupportDiagnostics(model).ownerComponentCounts).toEqual([1]);
	});

	it('turns separated clusters of one directory into one connected continent', () => {
		const secondCenter = exponentialMap(center, [0, 0.82, 0]);
		const firstCluster = clusterAround(center, 8, 17);
		const secondCluster = clusterAround(secondCenter, 8, 29);
		const members = [...firstCluster, ...secondCluster];
		const clusterEdges = (
			offset: number,
		amount: number,
		): Array<{ source: number; target: number; weight: number }> => {
			const result: Array<{
				source: number;
				target: number;
				weight: number;
			}> = [];
			for (let index = 1; index < amount; index += 1) {
				result.push(
					{ source: offset, target: offset + index, weight: 1 },
					{
						source: offset + index,
						target: offset + 1 + (index % (amount - 1)),
						weight: 1,
					},
				);
			}
			return result;
		};
		const edges = [
			...clusterEdges(0, firstCluster.length),
			...clusterEdges(firstCluster.length, secondCluster.length),
			{
				source: 0,
				target: firstCluster.length,
				weight: 1,
			},
		];
		const model = createLandSupportModel(
			{
				continents: [
					{
						id: 'archipelago',
						label: 'Archipelago',
						nodeIndices: members.map((_, index) => index),
						center: normalizeVec3(
							addVec3(center, secondCenter),
						),
						capRadius: 1,
						colorIndex: 0,
					},
				],
				islandNodeIndices: [],
			},
			new Float32Array(members.flat()),
			edges,
			73,
		);

		for (const member of members) {
			expect(classifySupportedContinent(member, model)).toBe(0);
		}
		const midpoint = exponentialMap(center, [0, 0.41, 0]);
		expect(classifySupportedContinent(midpoint, model)).toBe(0);
		expect(landSupportDiagnostics(model).ownerComponentCounts).toEqual([1]);
		expect(landSupportDiagnostics(model).disconnectedContinentCount).toBe(0);
		expect(
			landSupportDiagnostics(model).connectedOceanCellCount,
		).toBeGreaterThan(0);
	});

	it('loosens a dense circular community into a deterministic organic coast without interior lakes', () => {
		const ringCount = 24;
		const members: Vec3[] = [center];
		for (let index = 0; index < ringCount; index += 1) {
			const phase = (index / ringCount) * Math.PI * 2;
			members.push(
				exponentialMap(center, [
					0,
					Math.cos(phase) * 0.32,
					Math.sin(phase) * 0.32,
				]),
			);
		}
		const organicGeography: RenderGeography = {
			continents: [
				{
					id: 'round-community',
					label: 'Round community',
					nodeIndices: members.map((_, index) => index),
					center,
					capRadius: 0.5,
					colorIndex: 0,
				},
			],
			islandNodeIndices: [],
		};
		const edges = Array.from({ length: ringCount }, (_, index) => ({
			source: 0,
			target: index + 1,
			weight: 1,
		}));
		const model = createLandSupportModel(
			organicGeography,
			new Float32Array(members.flat()),
			edges,
			42,
		);

		for (const member of members) {
			expect(classifySupportedContinent(member, model)).toBe(0);
		}
		const centerSupport = sampleContinentSupport(center, 0, model);
		expect(centerSupport?.margin).toBeGreaterThan(0.025);
		expect(landSupportDiagnostics(model).ownerComponentCounts).toEqual([1]);
		for (let azimuthIndex = 0; azimuthIndex < 48; azimuthIndex += 1) {
			const phase = (azimuthIndex / 48) * Math.PI * 2;
			const interior = exponentialMap(center, [
				0,
				Math.cos(phase) * 0.27,
				Math.sin(phase) * 0.27,
			]);
			expect(classifySupportedContinent(interior, model)).toBe(0);
		}

		const coastRadii = Array.from({ length: 96 }, (_, azimuthIndex) => {
			const phase = (azimuthIndex / 96) * Math.PI * 2;
			let lastLandRadius = 0;
			for (let radius = 0; radius <= 0.62; radius += 0.002) {
				const sample = exponentialMap(center, [
					0,
					Math.cos(phase) * radius,
					Math.sin(phase) * radius,
				]);
				if (classifySupportedContinent(sample, model) === 0) {
					lastLandRadius = radius;
				}
			}
			return lastLandRadius;
		});
		expect(Math.max(...coastRadii) - Math.min(...coastRadii)).toBeGreaterThan(
			0.035,
		);
		const repeat = createLandSupportModel(
			organicGeography,
			new Float32Array(members.flat()),
			edges,
			42,
		);
		for (let index = 0; index < coastRadii.length; index += 12) {
			const phase = (index / coastRadii.length) * Math.PI * 2;
			const radius = coastRadii[index] ?? 0;
			const sample = exponentialMap(center, [
				0,
				Math.cos(phase) * radius,
				Math.sin(phase) * radius,
			]);
			expect(classifySupportedContinent(sample, repeat)).toBe(0);
		}
	});

	it('uses inter-folder port evidence only as a connected-ocean coastal preference', () => {
		const disk: Vec3[] = [center];
		for (const [radius, count] of [
			[0.08, 8],
			[0.16, 16],
			[0.24, 24],
		] as const) {
			for (let index = 0; index < count; index += 1) {
				const phase = (index / count) * Math.PI * 2;
				disk.push(
					exponentialMap(center, [
						0,
						Math.cos(phase) * radius,
						Math.sin(phase) * radius,
					]),
				);
			}
		}
		const destinationCenter: Vec3 = [0, 1, 0];
		const destination = clusterAround(destinationCenter, 10, 91);
		const portIndex = 25;
		const positions = new Float32Array([...disk, ...destination].flat());
		const geography: RenderGeography = {
			continents: [
				{
					id: 'port-origin',
					label: 'Port origin',
					nodeIndices: disk.map((_, index) => index),
					center,
					capRadius: 0.4,
					colorIndex: 0,
				},
				{
					id: 'port-destination',
					label: 'Port destination',
					nodeIndices: destination.map(
						(_, index) => disk.length + index,
					),
					center: destinationCenter,
					capRadius: 0.2,
					colorIndex: 1,
				},
			],
			islandNodeIndices: [],
		};
		const withoutPort = createLandSupportModel(
			geography,
			positions,
			[],
			181,
		);
		const withPort = createLandSupportModel(
			geography,
			positions,
			[
				{
					source: portIndex,
					target: disk.length,
					weight: 8,
				},
			],
			181,
		);
		const coastRadius = (
			model: ReturnType<typeof createLandSupportModel>,
		): number => {
			let lastLand = 0;
			for (let radius = 0; radius <= 0.5; radius += 0.002) {
				const sample = exponentialMap(center, [0, radius, 0]);
				if (classifySupportedContinent(sample, model) === 0) {
					lastLand = radius;
				}
			}
			return lastLand;
		};
		const withoutRadius = coastRadius(withoutPort);
		const withRadius = coastRadius(withPort);

		const addedOceanCells =
			landSupportDiagnostics(withPort).connectedOceanCellCount -
			landSupportDiagnostics(withoutPort).connectedOceanCellCount;
		expect(addedOceanCells).toBeGreaterThan(0);
		expect(addedOceanCells).toBeLessThanOrEqual(8);
		expect(withRadius).toBeLessThanOrEqual(withoutRadius);
		for (const model of [withoutPort, withPort]) {
			const diagnostics = landSupportDiagnostics(model);
			expect(diagnostics.ownerComponentCounts).toEqual([1, 1]);
			expect(diagnostics.disconnectedContinentCount).toBe(0);
			expect(diagnostics.connectedOceanFraction).toBeGreaterThanOrEqual(
				0.495,
			);
			expect(classifySupportedContinent(center, model)).toBe(0);
		}
		const repeat = createLandSupportModel(
			geography,
			positions,
			[
				{
					source: portIndex,
					target: disk.length,
					weight: 8,
				},
			],
			181,
		);
		expect(coastRadius(repeat)).toBe(withRadius);
	});

	it('expands one compact directory continent without turning sparse notes into a global cap', () => {
		const tangentX = orthogonalUnitVec3(center, 367);
		const tangentY = normalizeVec3(
			crossVec3(center, tangentX),
		);
		const members = Array.from({ length: 128 }, (_, index) => {
			const phase =
				index * Math.PI * (3 - Math.sqrt(5));
			const irregularRadius =
				1.48 *
				Math.sqrt((index + 0.5) / 128) *
				(0.84 + Math.sin(phase * 3 + 0.4) * 0.16);
			return exponentialMap(
				center,
				addVec3(
					scaleVec3(
						tangentX,
						Math.cos(phase) * irregularRadius,
					),
					scaleVec3(
						tangentY,
						Math.sin(phase) * irregularRadius,
					),
				),
			);
		});
		const geography: RenderGeography = {
			continents: [
				{
					id: 'single-compact-folder',
					label: 'Single compact folder',
					nodeIndices: members.map((_, index) => index),
					center,
					capRadius: 1.6,
					colorIndex: 0,
				},
			],
			islandNodeIndices: [],
		};
		const model = createLandSupportModel(
			geography,
			new Float32Array(members.flat()),
			members.slice(1).map((_, index) => ({
				source: index,
				target: index + 1,
				weight: 1,
			})),
			433,
		);
		const diagnostics = landSupportDiagnostics(model);

		expect(diagnostics.expandedLandCellCount).toBeGreaterThan(0);
		expect(diagnostics.connectedOceanFraction).toBeGreaterThanOrEqual(
			0.5,
		);
		expect(diagnostics.connectedOceanFraction).toBeLessThanOrEqual(
			0.55,
		);
		expect(diagnostics.enclosedWaterCellCount).toBe(0);
		expect(diagnostics.ownerComponentCounts).toEqual([1]);
		expect(diagnostics.ownerThinCellFractions[0]).toBeLessThan(0.12);
		expect(diagnostics.disconnectedContinentCount).toBe(0);
		for (const member of members) {
			expect(classifySupportedContinent(member, model)).toBe(0);
		}
	});

	it('expands compact folder continents toward the ocean target without lakes or foreign contact', () => {
		const folderCenters: readonly Vec3[] = [
			normalizeVec3([1, 1, 1]),
			normalizeVec3([1, -1, -1]),
			normalizeVec3([-1, 1, -1]),
			normalizeVec3([-1, -1, 1]),
		];
		const membersByFolder = folderCenters.map(
			(folderCenter, folderIndex) => {
				const tangentX = orthogonalUnitVec3(
					folderCenter,
					301 + folderIndex,
				);
				const tangentY = normalizeVec3(
					crossVec3(folderCenter, tangentX),
				);
				return Array.from({ length: 44 }, (_, index) => {
					const radius =
						0.53 *
						Math.sqrt((index + 0.5) / 44);
					const phase =
						index * Math.PI * (3 - Math.sqrt(5));
					return exponentialMap(
						folderCenter,
						addVec3(
							scaleVec3(
								tangentX,
								Math.cos(phase) * radius,
							),
							scaleVec3(
								tangentY,
								Math.sin(phase) * radius,
							),
						),
					);
				});
			},
		);
		const positions = new Float32Array(
			membersByFolder.flat(2),
		);
		let offset = 0;
		const continents = membersByFolder.map(
			(members, folderIndex) => {
				const nodeIndices = members.map(
					(_, localIndex) => offset + localIndex,
				);
				offset += members.length;
				return {
					id: `compact-folder-${folderIndex}`,
					label: `Compact folder ${folderIndex}`,
					nodeIndices,
					center:
						folderCenters[folderIndex] ?? center,
					capRadius: 0.6,
					colorIndex: folderIndex,
				};
			},
		);
		const edges = continents.flatMap((continent) =>
			continent.nodeIndices.slice(1).map((nodeIndex, index) => ({
				source:
					continent.nodeIndices[index] ??
					continent.nodeIndices[0] ??
					0,
				target: nodeIndex,
				weight: 1,
			})),
		);
		const geography: RenderGeography = {
			continents,
			islandNodeIndices: [],
		};
		const model = createLandSupportModel(
			geography,
			positions,
			edges,
			419,
		);
		const diagnostics = landSupportDiagnostics(model);

		expect(diagnostics.expandedLandCellCount).toBeGreaterThan(0);
		expect(diagnostics.connectedOceanFraction).toBeGreaterThanOrEqual(
			0.5,
		);
		expect(diagnostics.connectedOceanFraction).toBeLessThanOrEqual(
			0.55,
		);
		expect(diagnostics.enclosedWaterCellCount).toBe(0);
		expect(diagnostics.ownerComponentCounts).toEqual([1, 1, 1, 1]);
		expect(
			Math.max(...diagnostics.ownerThinCellFractions),
		).toBeLessThan(0.16);
		expect(diagnostics.disconnectedContinentCount).toBe(0);
		const interiorMargins = membersByFolder.flatMap(
			(members, owner) =>
				members
					.filter(
						(member) =>
							geodesicDistance(
								member,
								folderCenters[owner] ?? center,
							) < 0.26,
					)
					.map(
						(member) =>
							sampleContinentSupport(
								member,
								owner,
								model,
							)?.margin ?? -1,
					),
		);
		expect(interiorMargins.length).toBeGreaterThan(20);
		expect(Math.min(...interiorMargins)).toBeGreaterThan(0.035);
		for (let left = 0; left < folderCenters.length; left += 1) {
			for (
				let right = left + 1;
				right < folderCenters.length;
				right += 1
			) {
				const leftCenter = folderCenters[left];
				const rightCenter = folderCenters[right];
				if (
					leftCenter === undefined ||
					rightCenter === undefined
				) {
					continue;
				}
				expect(
					classifySupportedContinent(
						normalizeVec3(
							addVec3(leftCenter, rightCenter),
						),
						model,
					),
				).toBe(-1);
			}
		}

		const repeat = createLandSupportModel(
			geography,
			positions,
			edges,
			419,
		);
		expect(landSupportDiagnostics(repeat)).toEqual(diagnostics);
	});

	it(
		'bounds a 636-node raster while reserving broad connected ocean',
		() => {
			const nodeCount = 636;
			const largePositions = new Float32Array(nodeCount * 3);
			const centers: readonly Vec3[] = [
				[1, 0, 0],
				[-0.5, Math.sqrt(0.75), 0],
				[-0.5, -Math.sqrt(0.75), 0],
			];
			const members = centers.map(() => [] as number[]);
			for (let index = 0; index < nodeCount; index += 1) {
				const point = fibonacciSpherePoint(index, nodeCount);
				largePositions.set(point, index * 3);
				const owner =
					centers
						.map((candidate, candidateIndex) => ({
							candidateIndex,
							score: dotVec3(candidate, point),
						}))
						.sort(
							(left, right) =>
								right.score - left.score ||
								left.candidateIndex - right.candidateIndex,
						)[0]?.candidateIndex ?? 0;
				members[owner]?.push(index);
			}
			const startedAt = performance.now();
			const model = createLandSupportModel(
				{
					continents: members.map((nodeIndices, owner) => ({
						id: `global-sample-${owner}`,
						label: `Global sample ${owner}`,
						nodeIndices,
						center: centers[owner] ?? center,
						capRadius: Math.PI,
						colorIndex: owner,
					})),
					islandNodeIndices: [],
				},
				largePositions,
				[],
				101,
			);
			const elapsed = performance.now() - startedAt;
			const diagnostics = landSupportDiagnostics(model);

			expect(diagnostics.rasterCellCount).toBeLessThanOrEqual(10_242);
			expect(diagnostics.densityAnchorCount).toBe(nodeCount);
			expect(diagnostics.connectedOceanFraction).toBeGreaterThanOrEqual(
				0.495,
			);
			expect(diagnostics.ownerComponentCounts).toEqual([1, 1, 1]);
			expect(diagnostics.disconnectedContinentCount).toBe(0);
			expect(elapsed).toBeLessThan(3_500);
		},
		7_000,
	);
});
