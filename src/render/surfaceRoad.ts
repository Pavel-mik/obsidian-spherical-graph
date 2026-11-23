import { EDGE_SURFACE_LIFT, SPHERE_RADIUS } from '../constants';
import { hashUnorderedPair } from '../geometry/deterministicHash';
import { slerp } from '../geometry/geodesicArc';
import { crossVec3, dotVec3, normalizeVec3, orthogonalUnitVec3, type Vec3 } from '../geometry/vector3';
import type { AppearanceSettings } from '../settings/settings';
import type { PreparedRenderSnapshot,RenderEdge } from './renderTypes';
import { surfaceForSnapshot, terrainEnabled } from './terrainSurface';
import { CARTOGRAPHY as T } from './cartography';

/** A slight intrinsic bend, stable under endpoint reversal, camera and zoom. */
export function curvedRoadDirections(a:Vec3,b:Vec3,segments:number,aId:string,bId:string,veto?:(p:Vec3)=>boolean):Vec3[]{
 if(!Number.isSafeInteger(segments)||segments<2)throw new RangeError('Road needs at least two segments.');
 const reversed=aId>bId,start=normalizeVec3(reversed?b:a),end=normalizeVec3(reversed?a:b),first=reversed?bId:aId,last=reversed?aId:bId;
 const midpoint=slerp(start,end,.5,first,last),cross=crossVec3(start,midpoint),normal=Math.hypot(...cross)<1e-8?orthogonalUnitVec3(start,hashUnorderedPair(first,last)):normalizeVec3(cross);
 const angle=Math.acos(Math.max(-1,Math.min(1,dotVec3(start,end))));
 const amplitude=Math.min(T.edges.curvature.maxBendRadians,angle*T.edges.curvature.relativeBend)*(hashUnorderedPair(first,last)%2?1:-1);
 const build=(bend:number):Vec3[]=>Array.from({length:segments+1},(_,i)=>{
  const t=i/segments,p=slerp(start,end,t,first,last);if(i===0||i===segments||bend===0)return p;
  const delta=bend*Math.pow(Math.sin(Math.PI*t),2),c=Math.cos(delta),s=Math.sin(delta);return normalizeVec3([p[0]*c+normal[0]*s,p[1]*c+normal[1]*s,p[2]*c+normal[2]*s]);
 });
 let points=build(angle<1e-7?0:amplitude);
 if(veto&&points.slice(1,-1).some(veto))points=build(0);
 return reversed?points.reverse():points;
}

// Fixed-size direction cells for the flat map keep roads clear of unrelated cities
// without constructing the terrain sampler. The extra cell at each end handles the poles.
const cityIndices = new WeakMap<Float32Array, Map<number, number[]>>();
const cellWidth = 0.06, stride = 40;
const cell = (v: number): number => Math.floor((v+1)/cellWidth)+1;
function atlasCityGuard(points: Float32Array, source: number, target: number): (p:Vec3)=>boolean {
 let buckets = cityIndices.get(points);
 if (!buckets) {
  buckets = new Map();
  for (let i=0;i<points.length;i+=3) {
   const key=(cell(points[i]!)*stride+cell(points[i+1]!))*stride+cell(points[i+2]!);
   const list=buckets.get(key);
   if (list) list.push(i/3); else buckets.set(key,[i/3]);
  }
  cityIndices.set(points,buckets);
 }
 const limit=Math.cos(T.edges.curvature.unrelatedCityClearanceRadians);
 return p => {
  const origin=(cell(p[0])*stride+cell(p[1]))*stride+cell(p[2]);
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
   const nodes=buckets.get(origin+(x*stride+y)*stride+z);
   if (!nodes) continue;
   for (const i of nodes) if(i!==source && i!==target && p[0]*points[i*3]!+p[1]*points[i*3+1]!+p[2]*points[i*3+2]!>limit) return true;
  }
  return false;
 };
}

export function sampleSurfaceRoad(snapshot:PreparedRenderSnapshot,edge:RenderEdge,segments:number,appearance:AppearanceSettings):Vec3[]{
 const a=snapshot.nodeByIndex.get(edge.source)!,b=snapshot.nodeByIndex.get(edge.target)!,p=snapshot.positions;
 const start:Vec3=[p[a.index*3]!,p[a.index*3+1]!,p[a.index*3+2]!],end:Vec3=[p[b.index*3]!,p[b.index*3+1]!,p[b.index*3+2]!];
 const surface=terrainEnabled(appearance)?surfaceForSnapshot(snapshot):undefined;
 const directions=curvedRoadDirections(start,end,segments,a.id,b.id,surface ? n=>surface.nearUnrelatedCity(n,a.index,b.index) : atlasCityGuard(p,a.index,b.index));
 const height=(n:Vec3):number=>surface?.heightAt(n) ?? 0;
 const radii=directions.map(n=>SPHERE_RADIUS+height(n)+EDGE_SURFACE_LIFT);
 // Guard chords between samples against the sphere and local terrain ridges.
 for(let i=0;i<directions.length-1;i++){
  const n=directions[i]!,m=directions[i+1]!,angle=Math.acos(Math.max(-1,Math.min(1,dotVec3(n,m))));
  let h=Math.max(height(n),height(m));if(surface)for(const t of [.25,.5,.75])h=Math.max(h,height(slerp(n,m,t)));
  const minimum=(SPHERE_RADIUS+h+EDGE_SURFACE_LIFT)/Math.max(.9,Math.cos(angle/2));
  radii[i]=Math.max(radii[i]!,minimum);radii[i+1]=Math.max(radii[i+1]!,minimum);
 }
 return directions.map((n,i)=>[n[0]*radii[i]!,n[1]*radii[i]!,n[2]*radii[i]!] as Vec3);
}
