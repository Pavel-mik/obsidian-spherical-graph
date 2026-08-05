import { describe, expect, it } from 'vitest';
import {
	computeSphericalForces,
	computeLayoutEnergy,
	maximumForceTangencyError,
} from '../../src/layout/forces';
import { initializeFullLayout } from '../../src/layout/initialization';
import {
	DEFAULT_SOLVER_SETTINGS,
	resolveSolverSettings,
} from '../../src/layout/layoutTypes';
import { geodesicDistance } from '../../src/geometry/sphericalGeometry';
import { readVec3 } from '../../src/geometry/vector3';
import {
	rotatePositionBuffer,
	type Mat3,
} from '../../src/geometry/rotationAlignment';

const ROTATION: Mat3 = [
	0, 0, 1,
	1, 0, 0,
	0, 1, 0,
];

describe('intrinsic spherical forces', () => {
	it('projects every accumulated force into its local tangent plane', () => {
		const positions = initializeFullLayout(8, 12);
		const movableMask = new Uint8Array(8);
		movableMask.fill(1);
		const evaluation = computeSphericalForces({
			positions,
			edgeEndpoints: new Uint32Array([
				0, 1,
				1, 2,
				2, 3,
				3, 4,
			]),
			edgeWeights: new Float32Array([1, 2, 1, 3]),
			movableMask,
			settings: DEFAULT_SOLVER_SETTINGS,
			effectiveSeed: 3,
			iteration: 0,
		});
		expect(
			maximumForceTangencyError(positions, evaluation.forces),
		).toBeLessThan(1e-7);
	});

	it('attenuates only same-folder long-range repulsion and preserves collision separation', () => {
		const magnitude = (
			angle: number,
			folders: Int32Array,
			repulsionStrength: number,
		): number => {
			const evaluation = computeSphericalForces({
				positions: new Float32Array([
					1, 0, 0,
					Math.cos(angle), Math.sin(angle), 0,
				]),
				edgeEndpoints: new Uint32Array(),
				edgeWeights: new Float32Array(),
				movableMask: new Uint8Array([1, 1]),
				folderIndexByNode: folders,
				settings: resolveSolverSettings({
					repulsionStrength,
					repulsionCap: 1,
					centroidStrength: 0,
					isotropyStrength: 0,
				}),
				effectiveSeed: 19,
				iteration: 0,
			});
			return Math.hypot(...readVec3(evaluation.forces, 0));
		};

		const sameFolder = new Int32Array([3, 3]);
		const differentFolders = new Int32Array([3, 8]);
		const longRangeSame = magnitude(0.8, sameFolder, 0.02);
		const longRangeDifferent = magnitude(
			0.8,
			differentFolders,
			0.02,
		);
		expect(longRangeSame / longRangeDifferent).toBeCloseTo(
			0.24,
			6,
		);

		const collisionSame = magnitude(0.01, sameFolder, 0);
		const collisionDifferent = magnitude(
			0.01,
			differentFolders,
			0,
		);
		expect(collisionSame).toBeGreaterThan(0.5);
		expect(collisionSame).toBeCloseTo(collisionDifferent, 8);
	});

	it('has rotation-invariant intrinsic energy', () => {
		const positions = initializeFullLayout(10, 55);
		const edgeEndpoints = new Uint32Array([
			0, 1,
			1, 2,
			2, 3,
			4, 9,
			5, 7,
		]);
		const edgeWeights = new Float32Array([1, 2, 1, 4, 1]);
		const settings = resolveSolverSettings({
			exactRepulsionThreshold: 100,
		});
		const energy = computeLayoutEnergy({
			positions,
			edgeEndpoints,
			edgeWeights,
			settings,
		});
		const rotatedEnergy = computeLayoutEnergy({
			positions: rotatePositionBuffer(positions, ROTATION),
			edgeEndpoints,
			edgeWeights,
			settings,
		});
		expect(rotatedEnergy).toBeCloseTo(energy, 6);
	});

	it('varies equal-weight spring targets so hub neighbors do not settle on one ring', () => {
		const angle = 0.42;
		const positions = new Float32Array([
			1,
			0,
			0,
			Math.cos(angle),
			Math.sin(angle),
			0,
			Math.cos(angle),
			0,
			Math.sin(angle),
		]);
		const evaluation = computeSphericalForces({
			positions,
			edgeEndpoints: new Uint32Array([0, 1, 0, 2]),
			edgeWeights: new Float32Array([1, 1]),
			movableMask: new Uint8Array([0, 1, 1]),
			settings: resolveSolverSettings({
				repulsionStrength: 0,
				repulsionCap: 0,
				centroidStrength: 0,
				isotropyStrength: 0,
			}),
			effectiveSeed: 37,
			iteration: 0,
		});
		const firstForce = readVec3(evaluation.forces, 1);
		const secondForce = readVec3(evaluation.forces, 2);
		const firstMagnitude = Math.hypot(...firstForce);
		const secondMagnitude = Math.hypot(...secondForce);

		expect(
			geodesicDistance(
				readVec3(positions, 0),
				readVec3(positions, 1),
			),
		).toBeCloseTo(
			geodesicDistance(
				readVec3(positions, 0),
				readVec3(positions, 2),
			),
			6,
		);
		expect(Math.abs(firstMagnitude - secondMagnitude)).toBeGreaterThan(
			0.002,
		);
	});

	it('pulls only folder outliers back through the soft envelope and leaves ports freer', () => {
		const positions = new Float32Array([
			1, 0, 0,
			0.9998, 0.02, 0,
			0.9998, -0.02, 0,
			0.9998, 0, 0.02,
			0.9998, 0, -0.02,
			0, 1, 0,
			-1, 0, 0,
			-0.9998, 0.02, 0,
			-0.9998, -0.02, 0,
			-0.9998, 0, 0.02,
			-0.9998, 0, -0.02,
			0, -1, 0,
		]);
		const evaluate = (portScore: number): number => {
			const portScores = new Float32Array(12);
			portScores[5] = portScore;
			const result = computeSphericalForces({
				positions,
				edgeEndpoints: new Uint32Array(),
				edgeWeights: new Float32Array(),
				folderIndexByNode: new Int32Array([
					0, 0, 0, 0, 0, 0,
					1, 1, 1, 1, 1, 1,
				]),
				coastalPortScores: portScores,
				movableMask: new Uint8Array(12).fill(1),
				settings: resolveSolverSettings({
					repulsionStrength: 0,
					repulsionCap: 0,
					centroidStrength: 0,
					isotropyStrength: 0,
				}),
				effectiveSeed: 53,
				iteration: 0,
			});
			return Math.hypot(...readVec3(result.forces, 5));
		};

		expect(evaluate(0)).toBeGreaterThan(evaluate(1) + 0.01);
	});
});
