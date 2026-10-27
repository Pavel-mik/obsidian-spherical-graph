import { crossVec3, dotVec3, normalizeVec3, type Vec3 } from '../geometry/vector3';
import { createIntrinsicSphericalGrid } from '../geography/sphericalGrid';
import type { RenderGeography } from './renderTypes';

/** Exact dual-cell boundaries: no cosmetic smoothing can move the border over a city. */
export function buildCountryBorders(
	territory: RenderGeography['territory'],
	radius: number,
	insideLand?: (point: Vec3, parent: number) => boolean,
): Float32Array {
	if (territory?.countries === undefined) return new Float32Array();
	const grid = createIntrinsicSphericalGrid(territory.subdivision);
	const countries = territory.countries.ownerByCell;
	const result: number[] = [];
	for (const triangle of grid.triangles) {
		const a = grid.vertices[triangle[0]]!, b = grid.vertices[triangle[1]]!, c = grid.vertices[triangle[2]]!;
		let center = normalizeVec3(crossVec3(
			[b[0] - a[0], b[1] - a[1], b[2] - a[2]],
			[c[0] - a[0], c[1] - a[1], c[2] - a[2]],
		));
		if (dotVec3(center, a) < 0) center = [-center[0], -center[1], -center[2]];
		for (let side = 0; side < 3; side += 1) {
			const left = triangle[side]!, right = triangle[(side + 1) % 3]!;
			const parent = territory.ownerByCell[left] ?? -1;
			if (parent < 0 || parent !== territory.ownerByCell[right] || countries[left] === countries[right]) continue;
			const p = grid.vertices[left]!, q = grid.vertices[right]!;
			const midpoint = normalizeVec3([p[0] + q[0], p[1] + q[1], p[2] + q[2]]);
			// Clip short dual edges against the rendered coast, including its decorative inset.
			for (let part = 0; part < 4; part += 1) {
				const sample = (t: number): Vec3 => normalizeVec3([
					midpoint[0] * (1 - t) + center[0] * t,
					midpoint[1] * (1 - t) + center[1] * t,
					midpoint[2] * (1 - t) + center[2] * t,
				]);
				const start = sample(part / 4), end = sample((part + 1) / 4);
				if (insideLand !== undefined && (!insideLand(start, parent) || !insideLand(end, parent))) continue;
				result.push(...start.map((v) => v * radius), ...end.map((v) => v * radius));
			}
		}
	}
	return new Float32Array(result);
}

export function countryLabels(territory: RenderGeography['territory']): ReadonlyArray<{ key: string; label: string; center: Vec3 }> {
	if (territory?.countries === undefined) return [];
	const grid = createIntrinsicSphericalGrid(territory.subdivision);
	const { keys, ownerByCell } = territory.countries;
	const cells = keys.map(() => [] as number[]);
	for (let cell = 0; cell < ownerByCell.length; cell += 1) cells[ownerByCell[cell] ?? -1]?.push(cell);
	return keys.flatMap((key, owner) => {
		const parent = key.split('/')[0];
		if (keys.filter((other) => other.split('/')[0] === parent).length < 2) return [];
		const members = cells[owner] ?? [];
		const sum = members.reduce<Vec3>((acc, cell) => {
			const p = grid.vertices[cell]!;
			return [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]];
		}, [0, 0, 0]);
		const cell = members.reduce((best, candidate) => dotVec3(grid.vertices[candidate]!, sum) > dotVec3(grid.vertices[best]!, sum) ? candidate : best, members[0]!);
		return [{ key, label: key.includes('/') ? key.split('/')[1]! : 'Common', center: grid.vertices[cell]! }];
	});
}
