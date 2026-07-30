import {
	addVec3,
	clamp,
	dotVec3,
	lengthVec3,
	normalizeVec3,
	projectTangentVec3,
	scaleVec3,
	tryNormalizeVec3,
	type Vec3,
} from '../geometry/vector3';

export interface CoastalPortExternalTarget {
	/**
	 * Stable identifier of the destination continent. Multiple roads to the
	 * same continent are combined before diversity and direction are measured.
	 */
	readonly destinationContinentId: string;
	readonly weight: number;
	/**
	 * Unit-sphere direction of the destination continent's stable macro
	 * anchor. A continent anchor is intentionally preferred to an individual
	 * note position so the chosen coast remains stable during local packing.
	 */
	readonly direction: Vec3;
}

export interface CoastalPortCandidateInput {
	readonly nodeId: string;
	readonly continentId: string;
	readonly position: Vec3;
	readonly continentCenter: Vec3;
	readonly totalIncidentWeight: number;
	readonly externalTargets: readonly CoastalPortExternalTarget[];
}

export interface CoastalPortMetricWeights {
	readonly externalMass: number;
	readonly externalShare: number;
	readonly destinationDiversity: number;
}

export interface CoastalPortScoringOptions {
	readonly metricWeights?: Partial<CoastalPortMetricWeights>;
	/**
	 * Directional coherence below this value cannot nominate a port. This
	 * prevents an omnidirectional hub from being arbitrarily pulled to one
	 * side of its continent.
	 */
	readonly minimumDirectionCoherence?: number;
	/**
	 * Coherence at or above this value receives the full directional gate.
	 * Values between the two thresholds use a smooth transition.
	 */
	readonly fullDirectionCoherence?: number;
}

export const DEFAULT_COASTAL_PORT_METRIC_WEIGHTS:
	Readonly<CoastalPortMetricWeights> = Object.freeze({
		externalMass: 0.55,
		externalShare: 0.3,
		destinationDiversity: 0.15,
	});

export const DEFAULT_MINIMUM_PORT_DIRECTION_COHERENCE = 0.2;
export const DEFAULT_FULL_PORT_DIRECTION_COHERENCE = 0.65;

export interface CoastalPortCandidateScore {
	readonly nodeId: string;
	readonly continentId: string;
	readonly position: Vec3;
	readonly continentCenter: Vec3;
	readonly externalMass: number;
	readonly externalShare: number;
	/**
	 * Gini-Simpson diversity of destination continents. One destination is
	 * zero; evenly split roads to more destinations approach one.
	 */
	readonly destinationDiversity: number;
	readonly externalMassPercentile: number;
	readonly externalSharePercentile: number;
	readonly destinationDiversityPercentile: number;
	readonly relativeScore: number;
	readonly directionCoherence: number;
	readonly coherenceGate: number;
	readonly score: number;
	/**
	 * Preferred outgoing tangent at the note's current position.
	 */
	readonly preferredTangentDirection: Vec3 | null;
	/**
	 * Preferred outgoing tangent at the continent's macro center. Every
	 * candidate in a continent therefore has a comparable coast bearing.
	 */
	readonly coastBearing: Vec3 | null;
}

export type CoastalPortSeparationBasis = 'coast-bearing' | 'position';

export interface CoastalPortSelectionOptions {
	readonly capacity: number;
	readonly minimumAngularSeparation: number;
	readonly minimumScore?: number;
	readonly minimumDirectionCoherence?: number;
	readonly separationBasis?: CoastalPortSeparationBasis;
}

interface DestinationAggregate {
	readonly id: string;
	readonly weight: number;
	readonly direction: Vec3 | null;
}

interface DirectionalAggregate {
	readonly direction: Vec3 | null;
	readonly coherence: number;
}

interface UnrankedCandidate {
	readonly inputIndex: number;
	readonly nodeId: string;
	readonly continentId: string;
	readonly position: Vec3;
	readonly continentCenter: Vec3;
	readonly externalMass: number;
	readonly externalShare: number;
	readonly destinationDiversity: number;
	readonly directionCoherence: number;
	readonly preferredTangentDirection: Vec3 | null;
	readonly coastBearing: Vec3 | null;
}

function validateNonNegativeFinite(value: number, name: string): void {
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} must be finite and non-negative.`);
	}
}

function validateUnitInterval(value: number, name: string): void {
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError(`${name} must be within [0, 1].`);
	}
}

function compareIds(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function aggregateDestinations(
	targets: readonly CoastalPortExternalTarget[],
): readonly DestinationAggregate[] {
	const byDestination = new Map<
		string,
		{ weight: number; weightedDirection: Vec3 }
	>();
	for (const target of targets) {
		validateNonNegativeFinite(target.weight, 'External target weight');
		if (target.weight === 0) {
			continue;
		}
		const direction = normalizeVec3(target.direction);
		const aggregate = byDestination.get(target.destinationContinentId);
		if (aggregate === undefined) {
			byDestination.set(target.destinationContinentId, {
				weight: target.weight,
				weightedDirection: scaleVec3(direction, target.weight),
			});
			continue;
		}
		aggregate.weight += target.weight;
		aggregate.weightedDirection = addVec3(
			aggregate.weightedDirection,
			scaleVec3(direction, target.weight),
		);
	}

	const result: DestinationAggregate[] = [];
	for (const [id, aggregate] of [...byDestination.entries()].sort(
		(left, right) => compareIds(left[0], right[0]),
	)) {
		result.push({
			id,
			weight: aggregate.weight,
			// Conflicting directions still contribute external road mass and
			// destination diversity, but cannot vote for a coast bearing.
			direction: tryNormalizeVec3(aggregate.weightedDirection),
		});
	}
	return result;
}

function directionalAggregate(
	origin: Vec3,
	destinations: readonly DestinationAggregate[],
	externalMass: number,
): DirectionalAggregate {
	if (externalMass <= 0) {
		return { direction: null, coherence: 0 };
	}
	const unitOrigin = normalizeVec3(origin);
	let resultant: Vec3 = [0, 0, 0];
	for (const destination of destinations) {
		if (destination.direction === null) {
			continue;
		}
		const tangent = tryNormalizeVec3(
			projectTangentVec3(unitOrigin, destination.direction),
		);
		if (tangent === null) {
			// A coincident or antipodal destination does not define a unique
			// departure bearing. Keeping its mass in the denominator reduces
			// confidence instead of inventing a direction.
			continue;
		}
		resultant = addVec3(
			resultant,
			scaleVec3(tangent, destination.weight),
		);
	}
	return {
		direction: tryNormalizeVec3(resultant),
		coherence: clamp(lengthVec3(resultant) / externalMass, 0, 1),
	};
}

function destinationDiversity(
	destinations: readonly DestinationAggregate[],
	externalMass: number,
): number {
	if (externalMass <= 0 || destinations.length <= 1) {
		return 0;
	}
	let concentration = 0;
	for (const destination of destinations) {
		const share = destination.weight / externalMass;
		concentration += share * share;
	}
	return clamp(1 - concentration, 0, 1);
}

/**
 * Mid-rank empirical percentiles are insensitive to absolute vault scale and
 * give equal values equal treatment. An all-zero signal carries no evidence;
 * a sole positive observation is the strongest observation in its continent.
 */
function robustPercentiles(
	values: readonly number[],
	eligible: readonly boolean[],
): Float64Array {
	const result = new Float64Array(values.length);
	const ranked = values
		.map((value, index) => ({ value, index }))
		.filter(({ index }) => eligible[index] === true)
		.sort(
			(left, right) =>
				left.value - right.value || left.index - right.index,
		);
	if (ranked.length === 0) {
		return result;
	}
	if (ranked.length === 1) {
		const only = ranked[0];
		if (only !== undefined) {
			result[only.index] = only.value > 0 ? 1 : 0;
		}
		return result;
	}

	let start = 0;
	while (start < ranked.length) {
		let end = start;
		const value = ranked[start]?.value ?? 0;
		while (
			end + 1 < ranked.length &&
			(ranked[end + 1]?.value ?? Number.NaN) === value
		) {
			end += 1;
		}
		const percentile =
			start === 0 && end === ranked.length - 1
				? value > 0
					? 0.5
					: 0
				: (start + end) / (2 * (ranked.length - 1));
		for (let rank = start; rank <= end; rank += 1) {
			const entry = ranked[rank];
			if (entry !== undefined) {
				result[entry.index] = percentile;
			}
		}
		start = end + 1;
	}
	return result;
}

function coherenceGate(
	coherence: number,
	minimum: number,
	full: number,
): number {
	if (full === minimum) {
		return coherence >= full ? 1 : 0;
	}
	const normalized = clamp(
		(coherence - minimum) / (full - minimum),
		0,
		1,
	);
	return normalized * normalized * (3 - 2 * normalized);
}

function scoringWeights(
	partial: Partial<CoastalPortMetricWeights> | undefined,
): CoastalPortMetricWeights {
	const weights: CoastalPortMetricWeights = {
		...DEFAULT_COASTAL_PORT_METRIC_WEIGHTS,
		...partial,
	};
	validateNonNegativeFinite(weights.externalMass, 'External-mass weight');
	validateNonNegativeFinite(weights.externalShare, 'External-share weight');
	validateNonNegativeFinite(
		weights.destinationDiversity,
		'Destination-diversity weight',
	);
	const total =
		weights.externalMass +
		weights.externalShare +
		weights.destinationDiversity;
	if (total <= 0) {
		throw new RangeError('At least one coastal-port metric weight is required.');
	}
	return {
		externalMass: weights.externalMass / total,
		externalShare: weights.externalShare / total,
		destinationDiversity: weights.destinationDiversity / total,
	};
}

function unrankedCandidate(
	input: CoastalPortCandidateInput,
	inputIndex: number,
): UnrankedCandidate {
	validateNonNegativeFinite(
		input.totalIncidentWeight,
		'Total incident weight',
	);
	const position = normalizeVec3(input.position);
	const continentCenter = normalizeVec3(input.continentCenter);
	const destinations = aggregateDestinations(input.externalTargets);
	const externalMass = destinations.reduce(
		(sum, destination) => sum + destination.weight,
		0,
	);
	const externalShare =
		externalMass <= 0
			? 0
			: clamp(
					externalMass /
						Math.max(input.totalIncidentWeight, externalMass),
					0,
					1,
				);
	const localDirection = directionalAggregate(
		position,
		destinations,
		externalMass,
	);
	const coastDirection = directionalAggregate(
		continentCenter,
		destinations,
		externalMass,
	);
	return {
		inputIndex,
		nodeId: input.nodeId,
		continentId: input.continentId,
		position,
		continentCenter,
		externalMass,
		externalShare,
		destinationDiversity: destinationDiversity(
			destinations,
			externalMass,
		),
		directionCoherence: coastDirection.coherence,
		preferredTangentDirection: localDirection.direction,
		coastBearing: coastDirection.direction,
	};
}

/**
 * Scores possible port cities relative to peers in the same continent.
 *
 * Absolute link counts are deliberately converted to per-continent
 * percentiles, so a lightly linked vault and a densely linked vault use the
 * same semantics. Directional coherence then gates the score separately:
 * globally connected but directionally ambiguous hubs remain inland.
 */
export function scoreCoastalPortCandidates(
	inputs: readonly CoastalPortCandidateInput[],
	options: CoastalPortScoringOptions = {},
): readonly CoastalPortCandidateScore[] {
	const minimumCoherence =
		options.minimumDirectionCoherence ??
		DEFAULT_MINIMUM_PORT_DIRECTION_COHERENCE;
	const fullCoherence =
		options.fullDirectionCoherence ??
		DEFAULT_FULL_PORT_DIRECTION_COHERENCE;
	validateUnitInterval(minimumCoherence, 'Minimum direction coherence');
	validateUnitInterval(fullCoherence, 'Full direction coherence');
	if (fullCoherence < minimumCoherence) {
		throw new RangeError(
			'Full direction coherence must not be below the minimum.',
		);
	}
	const weights = scoringWeights(options.metricWeights);
	const seenNodeIds = new Set<string>();
	const candidates = inputs.map((input, inputIndex) => {
		if (seenNodeIds.has(input.nodeId)) {
			throw new RangeError(`Duplicate coastal-port node ID: ${input.nodeId}`);
		}
		seenNodeIds.add(input.nodeId);
		return unrankedCandidate(input, inputIndex);
	});
	const indicesByContinent = new Map<string, number[]>();
	for (let index = 0; index < candidates.length; index += 1) {
		const continentId = candidates[index]?.continentId ?? '';
		const indices = indicesByContinent.get(continentId) ?? [];
		indices.push(index);
		indicesByContinent.set(continentId, indices);
	}

	const scored: (CoastalPortCandidateScore | undefined)[] = Array.from({
		length: candidates.length,
	});
	for (const indices of indicesByContinent.values()) {
		const continentCandidates = indices.map(
			(index) => candidates[index],
		);
		const eligible = continentCandidates.map(
			(candidate) => (candidate?.externalMass ?? 0) > 0,
		);
		const massPercentiles = robustPercentiles(
			continentCandidates.map(
				(candidate) => candidate?.externalMass ?? 0,
			),
			eligible,
		);
		const sharePercentiles = robustPercentiles(
			continentCandidates.map(
				(candidate) => candidate?.externalShare ?? 0,
			),
			eligible,
		);
		const diversityPercentiles = robustPercentiles(
			continentCandidates.map(
				(candidate) => candidate?.destinationDiversity ?? 0,
			),
			eligible,
		);
		for (let localIndex = 0; localIndex < indices.length; localIndex += 1) {
			const globalIndex = indices[localIndex];
			const candidate = continentCandidates[localIndex];
			if (globalIndex === undefined || candidate === undefined) {
				continue;
			}
			const externalMassPercentile =
				massPercentiles[localIndex] ?? 0;
			const externalSharePercentile =
				sharePercentiles[localIndex] ?? 0;
			const destinationDiversityPercentile =
				diversityPercentiles[localIndex] ?? 0;
			const relativeScore =
				externalMassPercentile * weights.externalMass +
				externalSharePercentile * weights.externalShare +
				destinationDiversityPercentile *
					weights.destinationDiversity;
			const gate = coherenceGate(
				candidate.directionCoherence,
				minimumCoherence,
				fullCoherence,
			);
			scored[globalIndex] = {
				nodeId: candidate.nodeId,
				continentId: candidate.continentId,
				position: candidate.position,
				continentCenter: candidate.continentCenter,
				externalMass: candidate.externalMass,
				externalShare: candidate.externalShare,
				destinationDiversity: candidate.destinationDiversity,
				externalMassPercentile,
				externalSharePercentile,
				destinationDiversityPercentile,
				relativeScore,
				directionCoherence: candidate.directionCoherence,
				coherenceGate: gate,
				score: relativeScore * gate,
				preferredTangentDirection:
					candidate.preferredTangentDirection,
				coastBearing: candidate.coastBearing,
			};
		}
	}
	return Object.freeze(
		scored.filter(
			(candidate): candidate is CoastalPortCandidateScore =>
				candidate !== undefined,
		),
	);
}

function angularSeparation(left: Vec3, right: Vec3): number {
	return Math.acos(clamp(dotVec3(left, right), -1, 1));
}

/**
 * Deterministic non-maximum suppression for one continent. The caller derives
 * capacity from available coastline length and invokes this once per
 * continent. By default, separation is measured between coast bearings,
 * preventing a row of equally strong candidates from becoming a new ring of
 * adjacent ports on the same side.
 */
export function selectSeparatedCoastalPorts(
	candidates: readonly CoastalPortCandidateScore[],
	options: CoastalPortSelectionOptions,
): readonly CoastalPortCandidateScore[] {
	if (!Number.isSafeInteger(options.capacity) || options.capacity < 0) {
		throw new RangeError('Port capacity must be a non-negative integer.');
	}
	if (
		!Number.isFinite(options.minimumAngularSeparation) ||
		options.minimumAngularSeparation < 0 ||
		options.minimumAngularSeparation > Math.PI
	) {
		throw new RangeError(
			'Minimum port separation must be within [0, pi].',
		);
	}
	const minimumScore = options.minimumScore ?? 0;
	const minimumCoherence =
		options.minimumDirectionCoherence ??
		DEFAULT_MINIMUM_PORT_DIRECTION_COHERENCE;
	validateUnitInterval(minimumScore, 'Minimum port score');
	validateUnitInterval(minimumCoherence, 'Minimum direction coherence');
	if (options.capacity === 0 || candidates.length === 0) {
		return Object.freeze([]);
	}

	const continentIds = new Set(
		candidates.map((candidate) => candidate.continentId),
	);
	if (continentIds.size > 1) {
		throw new RangeError(
			'Separated port selection must be called for one continent at a time.',
		);
	}
	const basis = options.separationBasis ?? 'coast-bearing';
	const ranked = [...candidates]
		.filter(
			(candidate) =>
				candidate.externalMass > 0 &&
				candidate.score > 0 &&
				candidate.score >= minimumScore &&
				candidate.directionCoherence >= minimumCoherence &&
				(basis === 'position' || candidate.coastBearing !== null),
		)
		.sort(
			(left, right) =>
				right.score - left.score ||
				right.directionCoherence - left.directionCoherence ||
				right.externalMass - left.externalMass ||
				compareIds(left.nodeId, right.nodeId),
		);

	const selected: CoastalPortCandidateScore[] = [];
	const selectedDirections: Vec3[] = [];
	for (const candidate of ranked) {
		const direction =
			basis === 'position'
				? candidate.position
				: candidate.coastBearing;
		if (direction === null) {
			continue;
		}
		if (
			selectedDirections.some(
				(existing) =>
					angularSeparation(existing, direction) <
					options.minimumAngularSeparation,
			)
		) {
			continue;
		}
		selected.push(candidate);
		selectedDirections.push(direction);
		if (selected.length >= options.capacity) {
			break;
		}
	}
	return Object.freeze(selected);
}
