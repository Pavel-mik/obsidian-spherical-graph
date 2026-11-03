import { directoryRegionKey, topLevelFolder } from '../geography/directorySemantics';
import { freezeCountries } from '../geography/countryTerritories';
import { createIntrinsicSphericalGrid } from '../geography/sphericalGrid';
import { dotVec3, readVec3, type Vec3 } from '../geometry/vector3';
import type { PreparedRenderSnapshot, RenderGeography } from './renderTypes';

type Territory = NonNullable<RenderGeography['territory']>;
const cache = new WeakMap<PreparedRenderSnapshot, Territory>();

/** Legacy maps get a display-only subdivision around their actual frozen cities.
 * This never enters the committed snapshot or changes the land/coast algorithm.
 * Existing persisted countries remain authoritative, including their boundaries.
 */
export function countryTerritoryForDisplay(snapshot: PreparedRenderSnapshot): Territory | undefined {
 const territory = snapshot.geography.territory;
 if (!territory || territory.countries) return territory;
 const cached = cache.get(snapshot);
 if (cached) return cached;
 const nodes = snapshot.nodes.filter(node => territory.folderKeys.includes(topLevelFolder(node.path) ?? ''))
  .sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
 const keys = [...new Set(nodes.map(node => directoryRegionKey(node.path)).filter((key): key is string => key !== undefined))].sort();
 if (keys.length === 0) return territory;
 const byKey = new Map(keys.map((key,index) => [key,index]));
 const parents = keys.map(key => territory.folderKeys.indexOf(key.split('/')[0] ?? ''));
 const grid = createIntrinsicSphericalGrid(territory.subdivision);
 const owners = new Int32Array(grid.vertices.length).fill(-1);
 const seeds: number[] = [], queue: number[] = [];
 const previous = new Map<number,number>();
 const nearest = (point: Vec3, parent: number, owner: number): number => {
  let cell = previous.get(parent) ?? 0;
  // Greedy nearest-cell lookup on the intrinsic convex grid avoids a full
  // grid scan per note in large vaults. A coast/collision fallback stays exact.
  while (true) {
   let best = cell, score = dotVec3(point,grid.vertices[cell]!);
   for (const next of grid.neighbors[cell] ?? []) {
    const value = dotVec3(point,grid.vertices[next]!);
    if (value > score + 1e-12) { best=next; score=value; }
   }
   if (best === cell) break;
   cell=best;
  }
  if (territory.ownerByCell[cell] !== parent || (owners[cell] !== -1 && owners[cell] !== owner)) {
   let best=-1, score=-Infinity;
   for (let candidate=0;candidate<owners.length;candidate++) {
    if (territory.ownerByCell[candidate] !== parent || (owners[candidate] !== -1 && owners[candidate] !== owner)) continue;
    const value=dotVec3(point,grid.vertices[candidate]!);
    if (value > score) { best=candidate; score=value; }
   }
   cell=best;
  }
  if (cell >= 0) previous.set(parent,cell);
  return cell;
 };
 for (const node of nodes) {
  const owner=byKey.get(directoryRegionKey(node.path) ?? '');
  if (owner === undefined) continue;
  const cell=nearest(readVec3(snapshot.positions,node.index),parents[owner]!,owner);
  if (cell < 0 || owners[cell] !== -1) continue;
  owners[cell]=owner; seeds.push(cell); queue.push(cell);
 }
 let cursor=0;
 const flood = (): void => {
  while (cursor < queue.length) {
   const cell=queue[cursor++]!, owner=owners[cell]!;
   for (const next of grid.neighbors[cell] ?? []) {
    if (owners[next] !== -1 || territory.ownerByCell[next] !== parents[owner]) continue;
    owners[next]=owner; queue.push(next);
   }
  }
 };
 flood();
 // A disconnected patch of the same saved continent inherits the nearest
 // actual directory seed. Sea cells always keep owner -1.
 for (let cell=0;cell<owners.length;cell++) {
  const parent=territory.ownerByCell[cell];
  if (parent === -1 || owners[cell] !== -1) continue;
  let best=-1,score=-Infinity;
  for (const seed of seeds) {
   const owner=owners[seed]!;
   if (parents[owner] !== parent) continue;
   const value=dotVec3(grid.vertices[cell]!,grid.vertices[seed]!);
   if (value > score) { best=owner; score=value; }
  }
  if (best >= 0) { owners[cell]=best; queue.push(cell); flood(); }
 }
 const result={...territory,countries:freezeCountries({keys,ownerByCell:[...owners]})};
 cache.set(snapshot,result);
 return result;
}
