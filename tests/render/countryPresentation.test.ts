import { describe, expect, it } from 'vitest';
import { createIntrinsicSphericalGrid } from '../../src/geography/sphericalGrid';
import { validCountries } from '../../src/geography/countryTerritories';
import { countryTerritoryForDisplay } from '../../src/render/countryPresentation';
import { buildCountryBorders, countryLabels } from '../../src/render/countryGeometry';
import { buildLandSurfaceData } from '../../src/render/landGeometry';
import { prepareRenderSnapshot } from '../../src/render/renderTypes';

function legacy() {
 const grid=createIntrinsicSphericalGrid(1);
 const paths=['Study/Research/A.md','Study/Design/B.md','Study/Research/Deep/C.md','Study/Direct.md'];
 return prepareRenderSnapshot({snapshotId:'legacy-countries',nodes:paths.map((path,index)=>({
  id:path,path,basename:path,index,degree:1,weightedDegree:1,
 })),edges:[],positions:new Float32Array(grid.vertices.slice(0,4).flat()),geography:{
  continents:[{id:'Study',label:'Study',nodeIndices:[0,1,2,3],center:[1,0,0],capRadius:2.9,colorIndex:0}],
  islandNodeIndices:[],territory:{subdivision:1,folderKeys:['Study'],ownerByCell:Int32Array.from(grid.vertices,(_,i)=>i===grid.vertices.length-1?-1:0)},
 }});
}

describe('legacy country presentation',()=>{
 it('draws real subfolders around frozen cities without mutating saved geography or positions',()=>{
  const snapshot=legacy(), original=snapshot.positions.slice(), saved=JSON.stringify(snapshot.geography);
  const display=countryTerritoryForDisplay(snapshot)!;
  expect(display.countries?.keys).toEqual(['Study','Study/Design','Study/Research']);
  expect(validCountries(display.countries,display.folderKeys,display.ownerByCell)).toBe(true);
  const countries=display.countries!;
  for(const [cell,key] of [[0,'Study/Research'],[1,'Study/Design'],[2,'Study/Research'],[3,'Study']] as const) {
   expect(countries.keys[countries.ownerByCell[cell]!]).toBe(key);
  }
  expect(countries.ownerByCell.at(-1)).toBe(-1);
  expect(buildCountryBorders(display,10.018).length).toBeGreaterThan(0);
  expect(countryLabels(display)).toHaveLength(3);
  expect(countryTerritoryForDisplay(snapshot)).toBe(display);
  expect(snapshot.positions).toEqual(original);
  expect(JSON.stringify(snapshot.geography)).toBe(saved);
  expect(snapshot.geography.territory?.countries).toBeUndefined();
 });
 it('keeps an existing persisted country raster authoritative',()=>{
  const snapshot=legacy(), display=countryTerritoryForDisplay(snapshot)!;
  const committed=prepareRenderSnapshot({...snapshot,geography:{...snapshot.geography,territory:display}});
  expect(countryTerritoryForDisplay(committed)).toBe(committed.geography.territory);
  expect(countryTerritoryForDisplay(committed)?.countries).toEqual(display.countries);
 });
 it('changes only border output when a legacy display raster is sent to the land worker',()=>{
  const snapshot=legacy(), display=countryTerritoryForDisplay(snapshot)!;
  const original=buildLandSurfaceData(snapshot.geography,snapshot.positions,10,1,4);
  const overlay=buildLandSurfaceData(snapshot.geography,snapshot.positions,10,1,4,[],undefined,display);
  expect(overlay.positions).toEqual(original.positions);
  expect(overlay.coastPositions).toEqual(original.coastPositions);
  expect(overlay.coastInkPositions).toEqual(original.coastInkPositions);
  expect(overlay.beachPositions).toEqual(original.beachPositions);
  expect(original.countryBorderPositions).toHaveLength(0);
  expect(overlay.countryBorderPositions!.length).toBeGreaterThan(0);
 });
});
