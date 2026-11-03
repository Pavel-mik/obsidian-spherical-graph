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

export function sampleSurfaceRoad(snapshot:PreparedRenderSnapshot,edge:RenderEdge,segments:number,appearance:AppearanceSettings):Vec3[]{
 const a=snapshot.nodeByIndex.get(edge.source)!,b=snapshot.nodeByIndex.get(edge.target)!,p=snapshot.positions;
 const start:Vec3=[p[a.index*3]!,p[a.index*3+1]!,p[a.index*3+2]!],end:Vec3=[p[b.index*3]!,p[b.index*3+1]!,p[b.index*3+2]!];
 const surface=surfaceForSnapshot(snapshot),directions=curvedRoadDirections(start,end,segments,a.id,b.id,n=>surface.nearUnrelatedCity(n,a.index,b.index));
 const height=(n:Vec3):number=>terrainEnabled(appearance)?surface.heightAt(n):0;
 const radii=directions.map(n=>SPHERE_RADIUS+height(n)+EDGE_SURFACE_LIFT);
 // Guard chords between samples against the sphere and local terrain ridges.
 for(let i=0;i<directions.length-1;i++){
  const n=directions[i]!,m=directions[i+1]!,angle=Math.acos(Math.max(-1,Math.min(1,dotVec3(n,m))));
  let h=Math.max(height(n),height(m));for(const t of [.25,.5,.75])h=Math.max(h,height(slerp(n,m,t)));
  const minimum=(SPHERE_RADIUS+h+EDGE_SURFACE_LIFT)/Math.max(.9,Math.cos(angle/2));
  radii[i]=Math.max(radii[i]!,minimum);radii[i+1]=Math.max(radii[i+1]!,minimum);
 }
 return directions.map((n,i)=>[n[0]*radii[i]!,n[1]*radii[i]!,n[2]*radii[i]!] as Vec3);
}
