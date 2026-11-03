import { hashString } from '../geometry/deterministicHash';
import { normalizeVec3, dotVec3, type Vec3 } from '../geometry/vector3';
import { SPHERE_RADIUS } from '../constants';
import type { AppearanceSettings } from '../settings/settings';
import { continentBeachWidth, renderedIslandRadius, selectRenderedIslandNodeIndices } from './landGeometry';
import { createLandSupportModel, sampleOwnedLand } from './landSupport';
import type { PreparedRenderSnapshot, RenderEdge, RenderGeography } from './renderTypes';
import { CARTOGRAPHY as T } from './cartography';

const smooth=(a:number,b:number,x:number):number=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function terracedRelief(signal:number):number{
 const raw=Math.max(0,Math.min(1,signal)),b=raw*T.material.reliefBands;
 const terrace=(Math.floor(b)+smooth(T.material.terraceRampStart,T.material.terraceRampEnd,b%1))/T.material.reliefBands;
 return raw*(1-T.material.terraceMix)+terrace*T.material.terraceMix;
}
function hash(x:number,y:number,z:number):number{
 let h=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2147483647);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295;
}
export function mineralNoise(x:number,y:number,z:number):number{
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),u=smooth(0,1,x-ix),v=smooth(0,1,y-iy),w=smooth(0,1,z-iz);
 const mix=(a:number,b:number,t:number):number=>a+(b-a)*t;
 return mix(mix(mix(hash(ix,iy,iz),hash(ix+1,iy,iz),u),mix(hash(ix,iy+1,iz),hash(ix+1,iy+1,iz),u),v),
  mix(mix(hash(ix,iy,iz+1),hash(ix+1,iy,iz+1),u),mix(hash(ix,iy+1,iz+1),hash(ix+1,iy+1,iz+1),u),v),w);
}

/** Stationary erosion: medium folds break terraces; fine channels notch their
 * edges without adding a second height field or changing the land ownership. */
export function mineralStrataSignal(p:Vec3,phase:number):number{
 const f=(k:number,o:number):number=>mineralNoise(p[0]*k+phase+o,p[1]*k+o*.7,p[2]*k-o*.4);
 const warpX=(f(6.7,3)-.5)*1.1+(f(23,17)-.5)*.28;
 const warpY=(f(6.7,13)-.5)*1.1+(f(23,29)-.5)*.28;
 const warpZ=(f(6.7,23)-.5)*1.1+(f(23,41)-.5)*.28;
 const warped=(k:number,o:number):number=>mineralNoise(p[0]*k+phase+o+warpX,p[1]*k+o*.7+warpY,p[2]*k-o*.4+warpZ);
 const folds=warped(3.8,11)*.58+warped(7.6,7)*.25+warped(15.2,5)*.13+warped(30.4,9)*.04;
 const channel=1-Math.abs(warped(24,31)*2-1);
 return Math.max(0,Math.min(1,(folds-.22)*1.9-Math.pow(channel,8)*.045));
}

/** Immutable decorative terrain. It never changes intrinsic directions or ownership. */
export class TerrainSurface {
 private readonly support:ReturnType<typeof createLandSupportModel>|undefined;
 private readonly islands:ReadonlyArray<{direction:Vec3;radius:number}>;
 private readonly cities=new Map<string,Array<{direction:Vec3;height:number;index:number}>>();
 private readonly phase:number;
 private readonly heights=new Map<string,number>();
 constructor(readonly geography:RenderGeography,readonly positions:Float32Array,readonly seed:number,edges:readonly RenderEdge[]=[],degrees?:ArrayLike<number>){
  this.support=geography.continents.length?createLandSupportModel(geography,positions,edges,seed,degrees):undefined;
  this.phase=(seed%997)*.017;
  this.islands=selectRenderedIslandNodeIndices(geography,positions,seed,edges,degrees).map(i=>({direction:normalizeVec3([positions[i*3]!,positions[i*3+1]!,positions[i*3+2]!]),radius:renderedIslandRadius(positions.length/3,i,seed)}));
  for(let i=0;i<positions.length;i+=3){const p=normalizeVec3([positions[i]!,positions[i+1]!,positions[i+2]!]),key=this.key(p);const bucket=this.cities.get(key)??[];bucket.push({direction:p,height:this.field(p),index:i/3});this.cities.set(key,bucket);}
 }
 private key(p:Vec3):string{return `${Math.floor(p[0]/.06)},${Math.floor(p[1]/.06)},${Math.floor(p[2]/.06)}`;}
 shallowsAt(direction:Vec3):number{
  const p=normalizeVec3(direction),sample=this.support?sampleOwnedLand(p,this.support):undefined;
  let shallow=sample?Math.max(0,Math.min(1,1+sample.margin/T.material.shallowsWidthRadians)):0;
  for(const island of this.islands){const angle=Math.acos(Math.max(-1,Math.min(1,dotVec3(p,island.direction))));shallow=Math.max(shallow,1-smooth(island.radius,island.radius*2,angle));}
  return shallow;
 }
 nearUnrelatedCity(p:Vec3,source:number,target:number):boolean{
  const x=Math.floor(p[0]/.06),y=Math.floor(p[1]/.06),z=Math.floor(p[2]/.06),limit=Math.cos(T.edges.curvature.unrelatedCityClearanceRadians);
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++)for(const city of this.cities.get(`${x+a},${y+b},${z+c}`)??[])if(city.index!==source&&city.index!==target&&dotVec3(p,city.direction)>limit)return true;
  return false;
 }
 private signal(p:Vec3):number{
  return mineralStrataSignal(p,this.phase);
 }
 private field(p:Vec3):number{
  return terracedRelief(this.signal(p));
 }
 strataAt(direction:Vec3):number{
  return this.signal(normalizeVec3(direction));
 }
 private calmField(p:Vec3):number{
  const value=this.field(p);let target=value,best=1-Math.cos(.024);
  const x=Math.floor(p[0]/.06),y=Math.floor(p[1]/.06),z=Math.floor(p[2]/.06);
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++)for(const city of this.cities.get(`${x+a},${y+b},${z+c}`)??[]){
   const d=1-dotVec3(p,city.direction);if(d<best){best=d;target=city.height;}
  }
  const blend=smooth(0,1-Math.cos(.024),best);return value*blend+target*(1-blend);
 }
 heightAt(direction:Vec3):number{
  const p=normalizeVec3(direction),key=p.map(v=>Math.round(v*1e7)).join(','),cached=this.heights.get(key);
  if(cached!==undefined)return cached;
  const height=this.computeHeight(p);
  if(this.heights.size>=65536){let count=0;for(const old of this.heights.keys()){this.heights.delete(old);if(++count>=4096)break;}}
  this.heights.set(key,height);return height;
 }
 private computeHeight(p:Vec3):number{
  const sample=this.support?sampleOwnedLand(p,this.support):undefined,owner=sample?.owner??-1;
  if(owner>=0&&this.support){
   const margin=sample!.margin,width=continentBeachWidth(p,owner,this.seed);
   const bevel=smooth(width-.003,width+.003,margin);
   const plateau=SPHERE_RADIUS*T.material.coastalPlateauHeight;
   const relief=SPHERE_RADIUS*T.material.reliefHeight*this.calmField(p)*smooth(0,.035,margin-width);
   return .008+bevel*(plateau+relief-.008);
  }
  for(const island of this.islands){const angle=Math.acos(Math.max(-1,Math.min(1,dotVec3(p,island.direction))));if(angle<island.radius*.95)return .008+(1-smooth(island.radius*.65,island.radius*.95,angle))*.025;}
  return 0;
 }
}
const cache=new WeakMap<PreparedRenderSnapshot,TerrainSurface>();
export function surfaceForSnapshot(snapshot:PreparedRenderSnapshot):TerrainSurface{
 let s=cache.get(snapshot);if(!s){s=new TerrainSurface(snapshot.geography,snapshot.positions,hashString(snapshot.layoutRevision),snapshot.edges,snapshot.nodes.map(n=>n.degree));cache.set(snapshot,s);}return s;
}
export function terrainEnabled(appearance:AppearanceSettings):boolean{return appearance.showContinents&&appearance.surfaceMode!=='hidden';}
export function surfaceRadius(snapshot:PreparedRenderSnapshot,appearance:AppearanceSettings,direction:Vec3,lift=0):number{
 return SPHERE_RADIUS+lift+(terrainEnabled(appearance)?surfaceForSnapshot(snapshot).heightAt(direction):0);
}
