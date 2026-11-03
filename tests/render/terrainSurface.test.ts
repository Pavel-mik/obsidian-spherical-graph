import { describe,it,expect } from 'vitest';
import { createIntrinsicSphericalGrid } from '../../src/geography/sphericalGrid';
import { prepareRenderSnapshot } from '../../src/render/renderTypes';
import { surfaceForSnapshot,surfaceRadius,terracedRelief,mineralStrataSignal } from '../../src/render/terrainSurface';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { buildLandSurfaceData } from '../../src/render/landGeometry';
import { decorateLandRelief } from '../../src/render/reliefGeometry';

describe('shared decorative height field',()=>{
 it('keeps eroded strata stationary, bounded and continuous across nearby directions',()=>{
  const samples:number[]=[];
  for(let i=0;i<400;i++){
   const angle=i*.007,p=[Math.cos(angle),Math.sin(angle),0] as const,value=mineralStrataSignal(p,.37);
   expect(mineralStrataSignal(p,.37)).toBe(value);expect(value).toBeGreaterThanOrEqual(0);expect(value).toBeLessThanOrEqual(1);
   const next=mineralStrataSignal([Math.cos(angle+1e-6),Math.sin(angle+1e-6),0],.37);
   expect(Math.abs(next-value)).toBeLessThan(.0001);samples.push(value);
  }
  expect(Math.max(...samples)-Math.min(...samples)).toBeGreaterThan(.3);
  expect(mineralStrataSignal([1,0,0],.37)).not.toBe(mineralStrataSignal([1,0,0],2.71));
 });
 it('has mostly flat strata separated by narrow, monotone risers',()=>{
  let flat=0,steep=0,previous=terracedRelief(0);expect(previous).toBe(0);
  for(let i=1;i<=8000;i++){const height=terracedRelief(i/8000),slope=(height-previous)*8000;expect(height).toBeGreaterThanOrEqual(previous-1e-12);if(slope<.15)flat++;if(slope>3)steep++;previous=height;}
  expect(previous).toBe(1);expect(flat/8000).toBeGreaterThan(.70);expect(steep/8000).toBeGreaterThan(.07);
 });
 it('provides bounded, deterministic land relief without changing directions or ownership',()=>{
  const grid=createIntrinsicSphericalGrid(2),owners=Int32Array.from(grid.vertices,p=>p[0]>.1?0:-1);
  const snapshot=prepareRenderSnapshot({snapshotId:'relief',nodes:[{id:'a',index:0,path:'Land/a.md',basename:'a',degree:1,weightedDegree:1}],edges:[],positions:new Float32Array([1,0,0]),geography:{continents:[{id:'land',label:'Land',nodeIndices:[0],center:[1,0,0],capRadius:1,colorIndex:0}],islandNodeIndices:[],territory:{subdivision:2,folderKeys:['Land'],ownerByCell:owners}}});
  const before=snapshot.positions.slice(),raster=snapshot.geography.territory!.ownerByCell.slice(),s=surfaceForSnapshot(snapshot),heights=[];
  for(let i=0;i<41;i++){const angle=(i-20)*.035,p=[Math.cos(angle),Math.sin(angle),0] as const,h=s.heightAt(p);heights.push(h);expect(s.heightAt(p)).toBe(h);expect(h).toBeGreaterThanOrEqual(0);expect(h).toBeLessThanOrEqual(.220000001);}
  expect(Math.max(...heights)-Math.min(...heights)).toBeGreaterThan(.025);
  expect(s.heightAt([-1,0,0])).toBe(0);expect(snapshot.positions).toEqual(before);expect(snapshot.geography.territory!.ownerByCell).toEqual(raster);
  expect(s.shallowsAt([-1,0,0])).toBe(0);expect(s.shallowsAt([1,0,0])).toBe(1);
  const raw=buildLandSurfaceData(snapshot.geography,snapshot.positions,10,s.seed,6),rawBefore=raw.positions.slice(),sandBefore=raw.beachPositions.slice(),relief=decorateLandRelief(raw,s);
  expect(raw.positions).toEqual(rawBefore);expect(raw.beachPositions).toEqual(sandBefore);expect(relief.reliefPositions).not.toBe(raw.positions);
  const count=relief.reliefPositions!.length/3;expect(count).toBeLessThanOrEqual(raw.positions.length/3*36);
  expect(relief.reliefNormals!.length).toBe(count*3);expect(relief.reliefCountryTints!.length).toBe(count*3);expect(relief.reliefColorIndices!.length).toBe(count);expect(relief.reliefStrata!.length).toBe(count);
  expect(relief.reliefPositions!.some((v,i)=>Math.abs(v-raw.positions[i]!)>.01)).toBe(true);
  expect(surfaceRadius(snapshot,{...DEFAULT_SETTINGS.appearance,showContinents:false},[1,0,0],.08)).toBe(10.08);
  expect(surfaceRadius(snapshot,{...DEFAULT_SETTINGS.appearance,surfaceMode:'hidden'},[1,0,0],.08)).toBe(10.08);
 });
 it('does not manufacture terrain under an unassigned orphan',()=>{
  const snapshot=prepareRenderSnapshot({snapshotId:'orphan',nodes:[{id:'a',index:0,path:'a.md',basename:'a',degree:0,weightedDegree:0}],edges:[],positions:new Float32Array([1,0,0])});
  expect(surfaceForSnapshot(snapshot).heightAt([1,0,0])).toBe(0);
 });
});
