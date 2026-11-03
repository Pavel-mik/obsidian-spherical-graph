import { describe, expect, it } from 'vitest';
import { availableSceneSize, verticalFovForAspect } from '../../src/render/cameraFraming';
import { focusDirectionWithContext, landContextForNode } from '../../src/render/cameraFraming';
import { Vector3 } from 'three';
import { createIntrinsicSphericalGrid } from '../../src/geography/sphericalGrid';
import { prepareRenderSnapshot } from '../../src/render/renderTypes';

describe('verticalFovForAspect', () => {
	it('retains the desktop framing in square and landscape panes', () => {
		expect(verticalFovForAspect(1)).toBe(45);
		expect(verticalFovForAspect(16 / 9)).toBe(45);
	});

	it('widens the vertical field of view to preserve horizontal framing', () => {
		expect(verticalFovForAspect(430 / 713)).toBeCloseTo(78, 0);
		expect(verticalFovForAspect(0.5)).toBeGreaterThan(80);
	});

	it('falls back safely for invalid dimensions and caps extreme panes', () => {
		expect(verticalFovForAspect(0)).toBe(45);
		expect(verticalFovForAspect(Number.NaN)).toBe(45);
		expect(verticalFovForAspect(0.1)).toBe(85);
	});
});

describe('inspector-aware framing', () => {
 it('uses the area of the saved territory rather than its seed or coastal city cluster',()=>{
  const grid=createIntrinsicSphericalGrid(1),owners=Int32Array.from(grid.vertices,p=>p[0]>.1?0:-1);
  const snapshot=prepareRenderSnapshot({snapshotId:'area-focus',nodes:[{id:'a',index:0,path:'Study/A.md',basename:'A',degree:0,weightedDegree:0}],edges:[],positions:new Float32Array([1,0,0]),geography:{continents:[{id:'study',label:'Study',nodeIndices:[0],center:[0,1,0],capRadius:1,colorIndex:0}],islandNodeIndices:[],territory:{subdivision:1,folderKeys:['Study'],ownerByCell:owners}}});
  const before=owners.slice(),context=landContextForNode(snapshot,0)!;
  expect(context.x).toBeGreaterThan(.99);expect(owners).toEqual(before);
  expect(landContextForNode(snapshot,99)).toBeUndefined();
 });
 it('includes land context only on explicit focus while bounding the city offset',()=>{
  const node=new Vector3(1,0,0),copy=node.clone(),centre=new Vector3(0,1,0);
  const direction=focusDirectionWithContext(node,centre);
  expect(direction.angleTo(node)).toBeGreaterThan(0);expect(direction.angleTo(node)).toBeLessThanOrEqual(.240001);
  expect(direction.angleTo(centre)).toBeLessThan(node.angleTo(centre));expect(node).toEqual(copy);
  expect(focusDirectionWithContext(node)).toEqual(copy);expect(focusDirectionWithContext(node,new Vector3())).toEqual(copy);
 });
	it('reserves a side rail on desktop and a bottom sheet on narrow panes', () => {
		expect(availableSceneSize(1200,800,288,600)).toEqual({width:888,height:800});
		expect(availableSceneSize(600,800,576,300)).toEqual({width:600,height:476});
		expect(availableSceneSize(1200,800,0,0)).toEqual({width:1200,height:800});
	});
});
