import { describe, expect, it } from 'vitest';
import { softenCartographicStroke } from '../../src/render/cartographicStroke';
import { normalizeVec3, dotVec3, type Vec3 } from '../../src/geometry/vector3';

const a=normalizeVec3([1,-.12,0]),b:Vec3=[1,0,0],c=normalizeVec3([1,0,.12]);
const packed=(...points:Vec3[]):Float32Array=>new Float32Array(points.flatMap(p=>p.map(v=>v*10)));
const raw=packed(a,b,b,c);

describe('protected cartographic ink',()=>{
 it('rounds a sharp bend within its angular envelope and preserves endpoints, radius and input',()=>{
  const before=raw.slice(),result=softenCartographicStroke(raw,10,new Float32Array());
  expect(result.length).toBeGreaterThan(raw.length);
  expect([...result.slice(0,3)]).toEqual([...raw.slice(0,3)]);
  expect([...result.slice(-3)]).toEqual([...raw.slice(-3)]);
  for(let i=0;i<result.length;i+=3){
   const p:Vec3=[result[i]!,result[i+1]!,result[i+2]!];
   expect(Math.hypot(...p)).toBeCloseTo(10,5);
   const q=normalizeVec3(p);
   // The source arcs lie on the z=0 and y=0 great-circle planes.
   expect(Math.min(Math.asin(Math.abs(q[1])),Math.asin(Math.abs(q[2])))).toBeLessThanOrEqual(.00401);
  }
  expect(raw).toEqual(before);
 });
 it('keeps a corner exact when a city marker or the coast vetoes rounding',()=>{
  const city=softenCartographicStroke(raw,10,new Float32Array(b));
  expect(city.length).toBe(raw.length);
  expect(dotVec3(normalizeVec3([city[3]!,city[4]!,city[5]!]),b)).toBeCloseTo(1,8);
  const coast=softenCartographicStroke(raw,10,new Float32Array(),p=>p[1]>=-1e-8||p[2]<=1e-8);
  expect(coast.length).toBe(raw.length);
 });
 it('keeps all three junction arms connected and supports an empty map',()=>{
  const d=normalizeVec3([1,.12,0]),network=packed(a,b,b,c,b,d);
  const result=softenCartographicStroke(network,10,new Float32Array());
  let junctions=0;
  for(let i=0;i<result.length;i+=3)if(result[i]===10&&result[i+1]===0&&result[i+2]===0)junctions++;
  expect(junctions).toBe(3);
  expect(softenCartographicStroke(new Float32Array(),10,new Float32Array())).toHaveLength(0);
 });
});
