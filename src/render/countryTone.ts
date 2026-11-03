import { createIntrinsicSphericalGrid } from '../geography/sphericalGrid';
import { dotVec3, normalizeVec3 } from '../geometry/vector3';
import type { RenderGeography } from './renderTypes';
import { hashString } from '../geometry/deterministicHash';

/** A small material tint per real country. The raster and mesh are read-only. */
export function countryTonesForLand(positions: Float32Array, territory: RenderGeography['territory']): Float32Array {
 return countryMaterialForLand(positions,territory).tones;
}

/** Hue multipliers are stable by directory key, with nearly equal luminance. */
export function countryMaterialForLand(positions:Float32Array,territory:RenderGeography['territory']):{tones:Float32Array;tints:Float32Array}{
 const tones=new Float32Array(positions.length/3);
 const tints=new Float32Array(positions.length).fill(1);
 if(!territory?.countries)return {tones,tints};
 const grid=createIntrinsicSphericalGrid(territory.subdivision),countries=territory.countries;
 const groups=new Map<string,string[]>();
 for(const key of countries.keys){const parent=key.split('/')[0]!,group=groups.get(parent)??[];group.push(key);groups.set(parent,group);}
 const tintRanks=new Map<string,number>();for(const group of groups.values())group.sort().forEach((key,index)=>tintRanks.set(key,index));
 const accents=[[1.19,.99,.84],[.96,1.08,.91],[1.03,.97,1.14],[1.12,.96,1.03],[1.06,1.04,.88],[.91,1.08,1.04]];
 const countryTints=countries.keys.map(key=>{
  const accent=accents[(tintRanks.get(key)??0)%accents.length]!,jitter=((hashString(key)%101)/100-.5)*.025;
  const rgb=[accent[0]!+jitter,accent[1]!,accent[2]!-jitter],luma=rgb[0]!*.2126+rgb[1]!*.7152+rgb[2]!*.0722;
  return rgb.map(v=>v/luma);
 });
 const ranks=new Map<string,number>(),palette=[0,-0.11,0.09,-0.055,0.045,0.12];
 const countryTones=countries.keys.map(key=>{
  const parent=key.split('/')[0]!,rank=ranks.get(parent)??0;ranks.set(parent,rank+1);
  return palette[rank%palette.length]!;
 });
 let cell=0;
 for(let i=0;i<tones.length;i++){
  const p=normalizeVec3([positions[i*3]!,positions[i*3+1]!,positions[i*3+2]!]);
  while(true){
   let next=cell,score=dotVec3(p,grid.vertices[cell]!);
   for(const candidate of grid.neighbors[cell]??[]){const value=dotVec3(p,grid.vertices[candidate]!);if(value>score+1e-12){next=candidate;score=value;}}
   if(next===cell)break;cell=next;
  }
  const owner=countries.ownerByCell[cell]??-1;
  tones[i]=owner<0?0:countryTones[owner]??0;
  if(owner>=0)tints.set(countryTints[owner]??[1,1,1],i*3);
 }
 return {tones,tints};
}
