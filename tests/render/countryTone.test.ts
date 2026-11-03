import { describe,it,expect } from 'vitest';
import { createIntrinsicSphericalGrid } from '../../src/geography/sphericalGrid';
import { countryTonesForLand,countryMaterialForLand } from '../../src/render/countryTone';

describe('country material regions',()=>{
 it('gives countries distinct subtle hues stable under key reordering, with neutral sea',()=>{
  const grid=createIntrinsicSphericalGrid(1),positions=new Float32Array(grid.vertices.flat()),owners=grid.vertices.map((_,i)=>i===0?-1:i%3),keys=['Study/A','Study/B','Study/C'];
  const territory={subdivision:1,folderKeys:['Study'],ownerByCell:Int32Array.from(owners,v=>v<0?-1:0),countries:{keys,ownerByCell:owners}},before=JSON.stringify(territory.countries);
  const a=countryMaterialForLand(positions,territory),b=countryMaterialForLand(positions,{...territory,countries:{keys:[keys[2]!,keys[0]!,keys[1]!],ownerByCell:owners.map(v=>v<0?-1:(v+1)%3)}});
  expect(a.tints).toEqual(b.tints);expect([...a.tints.slice(0,3)]).toEqual([1,1,1]);expect(JSON.stringify(territory.countries)).toBe(before);
  const variants=new Set<string>();for(let i=1;i<4;i++){const c=a.tints.slice(i*3,i*3+3);variants.add([...c].join(','));expect(c[0]!*.2126+c[1]!*.7152+c[2]!*.0722).toBeCloseTo(1,6);expect([...c].every(v=>v>.80&&v<1.23)).toBe(true);}expect(variants.size).toBe(3);
 });
 it('uses the real country raster while preserving positions and sea',()=>{
  const grid=createIntrinsicSphericalGrid(1),positions=new Float32Array(grid.vertices.flat());
  const owners=grid.vertices.map((_,i)=>i===0?-1:i%3),before=positions.slice();
  const territory={subdivision:1,folderKeys:['Study'],ownerByCell:Int32Array.from(owners,v=>v<0?-1:0),countries:{keys:['Study/A','Study/B','Study/C'],ownerByCell:owners}};
  const tones=countryTonesForLand(positions,territory);
  expect(tones.length).toBe(grid.vertices.length);expect(tones[0]).toBe(0);
  for(let i=1;i<tones.length;i++)expect(tones[i]).toBeCloseTo([0,-.11,.09][owners[i]!]!);
  expect(positions).toEqual(before);expect(territory.countries.ownerByCell).toEqual(owners);
  expect(countryTonesForLand(positions,undefined).every(v=>v===0)).toBe(true);
 });
});
