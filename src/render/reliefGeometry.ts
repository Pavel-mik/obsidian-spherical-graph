import { SPHERE_RADIUS } from '../constants';
import { crossVec3, normalizeVec3, type Vec3 } from '../geometry/vector3';
import type { LandSurfaceData } from './landGeometry';
import { TerrainSurface } from './terrainSurface';
import { CARTOGRAPHY as T } from './cartography';
import { buildTerrainTree } from './terrainOcclusion';

/** Preserve raw buffers; only these derived buffers contain real elevation. */
export function decorateLandRelief(data:LandSurfaceData,surface:TerrainSurface):LandSurfaceData{
 const positions:number[]=[],normals:number[]=[],elevations:number[]=[],strata:number[]=[],indices:number[]=[],shades:number[]=[],tints:number[]=[];
 const cache=new Map<string,{point:Vec3;normal:Vec3;height:number;signal:number}>();
 let strataStride=1;
 const key=(p:Vec3):string=>p.map(v=>Math.round(v*1e6)).join(',');
 const sampleAt=(n:Vec3):{point:Vec3;normal:Vec3;height:number;signal:number}=>{
  const k=key(n);let sample=cache.get(k);
  if(!sample){
   const h=surface.heightAt(n);
   const radius=SPHERE_RADIUS+.0025+h,p:Vec3=[n[0]*radius,n[1]*radius,n[2]*radius];
   sample={point:p,normal:n,height:h,signal:surface.strataAt(n)};cache.set(k,sample);
  }
  return sample;
 };
 interface Corner {n:Vec3;shade:number;tint:Vec3;signal:number}
 const interpolate=(a:Corner,b:Corner,t:number,signal?:number):Corner=>{
  const n=normalizeVec3([a.n[0]*(1-t)+b.n[0]*t,a.n[1]*(1-t)+b.n[1]*t,a.n[2]*(1-t)+b.n[2]*t]);
  return {n,shade:a.shade*(1-t)+b.shade*t,tint:[a.tint[0]*(1-t)+b.tint[0]*t,a.tint[1]*(1-t)+b.tint[1]*t,a.tint[2]*(1-t)+b.tint[2]*t],signal:signal??sampleAt(n).signal};
 };
 const midpoint=(a:Corner,b:Corner):Corner=>interpolate(a,b,.5);
 const emitFace=(a:Corner,b:Corner,c:Corner,color:number):void=>{
  const samples=[sampleAt(a.n),sampleAt(b.n),sampleAt(c.n)];
  const p=samples[0]!.point,q=samples[1]!.point,r=samples[2]!.point,face=crossVec3([q[0]-p[0],q[1]-p[1],q[2]-p[2]],[r[0]-p[0],r[1]-p[1],r[2]-p[2]]);
  if(Math.hypot(...face)<1e-10)return;
  let normal=normalizeVec3(face);if(normal[0]*a.n[0]+normal[1]*a.n[1]+normal[2]*a.n[2]<0)normal=normal.map(v=>-v) as unknown as Vec3;
  const phase=((a.signal+b.signal+c.signal)/3*T.material.reliefBands)%1,riser=phase>T.material.terraceRampStart&&phase<T.material.terraceRampEnd;
  [a,b,c].forEach((corner,i)=>{const s=samples[i]!,n=riser?normal:normalizeVec3([corner.n[0]*.94+s.normal[0]*.06,corner.n[1]*.94+s.normal[1]*.06,corner.n[2]*.94+s.normal[2]*.06]);positions.push(...s.point);normals.push(...n);elevations.push(s.height/(SPHERE_RADIUS*T.material.geometricDisplacement));strata.push(corner.signal);indices.push(color);shades.push(corner.shade);tints.push(...corner.tint);});
 };
 const clip=(polygon:Corner[],cut:number,below:boolean):Corner[]=>{
  const out:Corner[]=[];let previous=polygon[polygon.length-1]!;
  for(const current of polygon){const a=below?previous.signal<=cut:previous.signal>=cut,b=below?current.signal<=cut:current.signal>=cut;if(a!==b){const t=(cut-previous.signal)/(current.signal-previous.signal);out.push(interpolate(previous,current,t,cut));}if(b)out.push(current);previous=current;}return out;
 };
 const emit=(a:Corner,b:Corner,c:Corner,color:number):void=>{
  const lo=Math.min(a.signal,b.signal,c.signal),hi=Math.max(a.signal,b.signal,c.signal),cuts:number[]=[];
  for(let band=Math.floor(lo*T.material.reliefBands);band<=Math.floor(hi*T.material.reliefBands);band++)if(band%strataStride===0)for(const phase of [T.material.terraceRampStart,T.material.terraceRampEnd]){const cut=(band+phase)/T.material.reliefBands;if(cut>lo+1e-7&&cut<hi-1e-7)cuts.push(cut);}
  // Every shared edge is split at the same strata levels. Plateaus use smooth
  // radial normals; actual narrow risers use their own face normals.
  let remainder=[a,b,c];
  for(const cut of cuts){const polygon=clip(remainder,cut,true);for(let i=1;i+1<polygon.length;i++)emitFace(polygon[0]!,polygon[i]!,polygon[i+1]!,color);remainder=clip(remainder,cut,false);}
  for(let i=1;i+1<remainder.length;i++)emitFace(remainder[0]!,remainder[i]!,remainder[i+1]!,color);
 };
 const edgeKey=(a:Vec3,b:Vec3):string=>{const ka=key(a),kb=key(b);return ka<kb?`${ka}|${kb}`:`${kb}|${ka}`;};
 const splitEdges=new Set<string>(),triangles:Array<{corners:Corner[];color:number}>=[],diameters:number[]=[];
 for(let i=0;i<data.positions.length;i+=9){
  const corners=[0,3,6].map(o=>{const n=normalizeVec3([data.positions[i+o]!,data.positions[i+o+1]!,data.positions[i+o+2]!]);return {n,shade:data.shades[(i+o)/3]??1,tint:[data.countryTints?.[i+o]??1,data.countryTints?.[i+o+1]??1,data.countryTints?.[i+o+2]??1] as Vec3,signal:sampleAt(n).signal};});
  const signals=corners.map(c=>sampleAt(c.n).signal),a=corners[0]!,b=corners[1]!,c=corners[2]!;
  const span=Math.max(...signals)-Math.min(...signals),diameter=Math.max(Math.hypot(a.n[0]-b.n[0],a.n[1]-b.n[1],a.n[2]-b.n[2]),Math.hypot(a.n[0]-c.n[0],a.n[1]-c.n[1],a.n[2]-c.n[2]));
  diameters.push(diameter);
  if(span>.5/T.material.reliefBands&&diameter>.012)for(let j=0;j<3;j++)splitEdges.add(edgeKey(corners[j]!.n,corners[(j+1)%3]!.n));
  triangles.push({corners,color:data.colorIndices[i/3]??0});
 }
 // Coarse/mobile source meshes keep fewer geometric cuts, consistently across
 // all neighbors. The shared height field and every city anchor stay identical.
 diameters.sort((a,b)=>a-b);const typicalEdge=diameters[Math.floor(diameters.length*.75)]??0;
 strataStride=typicalEdge>.10?4:typicalEdge>.055?2:1;
 // Neighbors honor the same split edge even if only one triangle needs detail.
 // This prevents T-junction cracks along the sharper height transitions.
 for(const {corners,color}of triangles){
  const [a,b,c]=corners as [Corner,Corner,Corner],ab=splitEdges.has(edgeKey(a.n,b.n)),bc=splitEdges.has(edgeKey(b.n,c.n)),ca=splitEdges.has(edgeKey(c.n,a.n));
  const mAB=midpoint(a,b),mBC=midpoint(b,c),mCA=midpoint(c,a);
  const two=(x:Corner,y:Corner,z:Corner,xy:Corner,yz:Corner):void=>{emit(xy,y,yz,color);emit(x,xy,yz,color);emit(x,yz,z,color);};
  if(ab&&bc&&ca){emit(a,mAB,mCA,color);emit(mAB,b,mBC,color);emit(mCA,mBC,c,color);emit(mAB,mBC,mCA,color);}
  else if(ab&&bc)two(a,b,c,mAB,mBC);else if(bc&&ca)two(b,c,a,mBC,mCA);else if(ca&&ab)two(c,a,b,mCA,mAB);
  else if(ab){emit(a,mAB,c,color);emit(mAB,b,c,color);}else if(bc){emit(b,mBC,a,color);emit(mBC,c,a,color);}else if(ca){emit(c,mCA,b,color);emit(mCA,a,b,color);}else emit(a,b,c,color);
 }
 // A real skirt joins the raised inner land to the lower sand apron. Shared
 // interior edges cancel; only the clipped outer contour receives a wall.
 const boundaries=new Map<string,{a:Vec3;b:Vec3;count:number}>();
 for(let i=0;i<data.positions.length;i+=9){
  const tri=[0,3,6].map(o=>normalizeVec3([data.positions[i+o]!,data.positions[i+o+1]!,data.positions[i+o+2]!]));
  for(let j=0;j<3;j++){const a=tri[j]!,b=tri[(j+1)%3]!,ka=key(a),kb=key(b),k=ka<kb?`${ka}|${kb}`:`${kb}|${ka}`,edge=boundaries.get(k);if(edge)edge.count++;else boundaries.set(k,{a,b,count:1});}
 }
 const walls:number[]=[];
 for(const {a,b,count}of boundaries.values())if(count===1){
  const segments=splitEdges.has(edgeKey(a,b))?[a,normalizeVec3([a[0]+b[0],a[1]+b[1],a[2]+b[2]]),b]:[a,b];
  for(let j=1;j<segments.length;j++){const n=segments[j-1]!,m=segments[j]!,pa=sampleAt(n).point,pb=sampleAt(m).point,ra=SPHERE_RADIUS+.008,ba=n.map(v=>v*ra),bb=m.map(v=>v*ra);walls.push(...pa,...ba,...pb,...pb,...ba,...bb);}
 }
 const beach=data.beachPositions.slice();
 for(let i=0;i<beach.length;i+=3){const n=normalizeVec3([beach[i]!,beach[i+1]!,beach[i+2]!]);beach.set(n.map(v=>v*(SPHERE_RADIUS+.008)),i);}
 const lift=(source:Float32Array|undefined,gap:number):Float32Array|undefined=>{
  if(!source)return undefined;const out=source.slice();for(let i=0;i<out.length;i+=3){const n=normalizeVec3([out[i]!,out[i+1]!,out[i+2]!]),r=SPHERE_RADIUS+surface.heightAt(n)+gap;out.set(n.map(v=>v*r),i);}return out;
 };
 const reliefPositions=new Float32Array(positions);
 return {...data,reliefPositions,occlusionTree:buildTerrainTree(reliefPositions),reliefNormals:new Float32Array(normals),reliefElevations:new Float32Array(elevations),
  reliefColorIndices:new Uint8Array(indices),reliefShades:new Float32Array(shades),reliefCountryTints:new Float32Array(tints),reliefStrata:new Float32Array(strata),
  reliefBeachPositions:beach,coastalWallPositions:new Float32Array(walls),
  reliefCoastPositions:lift(data.coastInkPositions??data.coastPositions,.009),
  reliefBorderPositions:lift(data.countryBorderPositions,.020)};
}
