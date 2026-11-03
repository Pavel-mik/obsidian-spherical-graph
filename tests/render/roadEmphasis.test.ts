import { describe,it,expect } from 'vitest';
import { Group,Mesh,ShaderMaterial } from 'three';
import { ordinaryRoadEmphasis } from '../../src/render/roadEmphasis';
import { EdgeLayer } from '../../src/render/EdgeLayer';
import { prepareRenderSnapshot,type RenderTheme } from '../../src/render/renderTypes';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { CARTOGRAPHY } from '../../src/render/cartography';

describe('overview road context',()=>{
 it('retains every segment while making long hub context quieter and selection full strength',()=>{
  const snapshot=prepareRenderSnapshot({snapshotId:'context',nodes:[
   {id:'a',path:'Study/A/a.md',basename:'a',index:0,degree:12,weightedDegree:12},
   {id:'b',path:'Study/A/b.md',basename:'b',index:1,degree:12,weightedDegree:12},
   {id:'c',path:'Other/B/c.md',basename:'c',index:2,degree:12,weightedDegree:12},
  ],edges:[{source:0,target:1,weight:1},{source:0,target:2,weight:1}],positions:new Float32Array([1,0,0,Math.cos(.15),Math.sin(.15),0,-1,0,0])});
  expect(ordinaryRoadEmphasis(snapshot,snapshot.edges[0]!)).toBeGreaterThan(ordinaryRoadEmphasis(snapshot,snapshot.edges[1]!));
  const group=new Group(),theme={edge:'#E5CB8E',edgeSelected:'#F5CE76',edgeRoute:'#F3C66B'} as RenderTheme;
  const layer=new EdgeLayer(group,DEFAULT_SETTINGS.appearance,theme);layer.setSnapshot(snapshot);
  const base=group.getObjectByName('spherical-graph-edges') as Mesh;
  const vertices=base.geometry.getAttribute('position').count,scales=base.geometry.getAttribute('strokeOpacity');
  expect(scales.count).toBe(vertices);expect([...scales.array].every(v=>v>=.279&&v<=1)).toBe(true);
  layer.updateSelection('a');
  const selected=group.getObjectByName('spherical-graph-selected-edge-ribbon') as Mesh;
  expect(selected.geometry.getAttribute('position').count).toBe(vertices);
  expect([...selected.geometry.getAttribute('strokeOpacity').array].every(v=>v===1)).toBe(true);
  expect((selected.material as ShaderMaterial).uniforms.lineOpacity!.value).toBe(CARTOGRAPHY.edges.selected.opacity);
  layer.dispose();expect(group.children).toHaveLength(0);
 });
});
