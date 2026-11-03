import { describe,it,expect } from 'vitest';
import { curvedRoadDirections,sampleSurfaceRoad } from '../../src/render/surfaceRoad';
import { slerp } from '../../src/geometry/geodesicArc';
import { prepareRenderSnapshot } from '../../src/render/renderTypes';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';

describe('intrinsic bent roads',()=>{

 it('uses the spatial city guard in the real road layer',()=>{
  const midpoint=curvedRoadDirections([1,0,0],[0,1,0],12,'a','b')[6]!;
  const snapshot=prepareRenderSnapshot({snapshotId:'guard',nodes:['a','b','c'].map((id,index)=>({id,index,path:id+'.md',basename:id,degree:1,weightedDegree:1})),edges:[{source:0,target:1,weight:1}],positions:new Float32Array([1,0,0,0,1,0,...midpoint])});
  const points=sampleSurfaceRoad(snapshot,snapshot.edges[0]!,12,DEFAULT_SETTINGS.appearance);
  expect(points).toHaveLength(13);expect(points[6]![2]).toBeCloseTo(0,12);
 });
 it('keeps endpoints and surface directions, with identical reverse paths',()=>{
  const a=[1,0,0] as const,b=[0,1,0] as const,points=curvedRoadDirections(a,b,16,'a','b'),reverse=curvedRoadDirections(b,a,16,'b','a').reverse();
  expect(points[0]).toEqual(a);expect(points.at(-1)).toEqual(b);expect(points).toEqual(reverse);
  expect(Math.abs(points[8]![2])).toBeGreaterThan(.01);
  for(const p of points)expect(Math.hypot(...p)).toBeCloseTo(1,12);
 });
 it('is finite for coincident, almost-coincident and antipodal cities',()=>{
  for(const b of [[1,0,0],[1,1e-10,0],[-1,0,0]] as const){const points=curvedRoadDirections([1,0,0],b,24,'a','b');for(const p of points){expect(p.every(Number.isFinite)).toBe(true);expect(Math.hypot(...p)).toBeCloseTo(1,10);}}
 });
 it('vetoes the bend near an unrelated city without dropping a relationship',()=>{
  const a=[1,0,0] as const,b=[0,1,0] as const,points=curvedRoadDirections(a,b,12,'a','b',()=>true);
  expect(points).toHaveLength(13);points.forEach((p,i)=>expect(p).toEqual(slerp(a,b,i/12,'a','b')));
 });
 it('guards coarse road chords above the globe and leaves the snapshot intact',()=>{
  const snapshot=prepareRenderSnapshot({snapshotId:'road',nodes:[{id:'a',index:0,path:'a.md',basename:'a',degree:1,weightedDegree:1},{id:'b',index:1,path:'b.md',basename:'b',degree:1,weightedDegree:1}],edges:[{source:0,target:1,weight:1}],positions:new Float32Array([1,0,0,0,1,0])});
  const before=snapshot.positions.slice(),points=sampleSurfaceRoad(snapshot,snapshot.edges[0]!,6,DEFAULT_SETTINGS.appearance);
  for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!;expect(Math.hypot((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2)).toBeGreaterThan(10.035);}
  expect(snapshot.positions).toEqual(before);
 });
});
