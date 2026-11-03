import { readFileSync } from 'node:fs';
import { Color, Vector2 } from 'three';
import { describe, expect, it } from 'vitest';
import { CARTOGRAPHY as T, updateLineViewport } from '../../src/render/cartography';
import { screenSpaceLine } from '../../src/render/screenSpaceLine';
import { LabelPlacement } from '../../src/render/LabelPlacement';
import { cityLabelAnchor } from '../../src/render/LabelPlacement';

describe('cartography integration contracts', () => {
 it('keeps important labels away from their city and within narrow view boundaries',()=>{
  for(const [x,y,width]of [[180,200,360],[340,200,360],[180,20,360],[400,400,900]]){
   const point=cityLabelAnchor(x!,y!,200,width!,600,true);
   expect(point.x-100).toBeGreaterThanOrEqual(12);expect(point.x+100).toBeLessThanOrEqual(width!-12);
   expect(Math.abs(point.x-x!)>=122||Math.abs(point.y-y!)>=40).toBe(true);
  }
 });
 it('keeps spherical endpoints immutable while changing CSS-pixel viewports', () => {
  const positions = new Float32Array([10.04,0,0, 0,10.04,0]), copy=positions.slice();
  const mesh = screenSpaceLine(positions,{color:T.colors.edge.route,...T.edges.route});
  updateLineViewport(mesh.material,1000,800);
  expect(mesh.material.uniforms.viewport?.value).toEqual(new Vector2(1000,800));
  expect(mesh.material.uniforms.lineWidth?.value).toBe(2.2);
  updateLineViewport(mesh.material,500,400);
  expect(mesh.material.uniforms.lineWidth?.value).toBe(2.2);
  expect(positions).toEqual(copy);
  expect(mesh.geometry.getAttribute('position').count).toBe(6);
  expect(mesh.material.depthTest).toBe(true);
  mesh.geometry.dispose(); mesh.material.dispose();
 });
 it('uses the approved role values in the final CSS skin', () => {
  const css=readFileSync(new URL('../../styles.css',import.meta.url),'utf8');
  for (const [role,value] of Object.entries({city:T.colors.node.base,selection:T.colors.node.selected,tag:T.colors.satellite.base,route:T.colors.node.route,void:T.colors.ui.void})) {
   const matches=[...css.matchAll(new RegExp('--sg-'+role+':\\s*([^;]+);','g'))];
   expect(matches.at(-1)?.[1]?.toLowerCase()).toBe(value.toLowerCase());
  }
  expect(new Color(T.colors.node.search).getHexString()).toBe('963652');
 });
 it('replaces a low-priority geographic label with an interactive label and honors the shared budget', () => {
  const placement=new LabelPlacement(), continent={hidden:false} as HTMLElement, selected={hidden:false} as HTMLElement, ordinary={hidden:false} as HTMLElement;
  placement.reset(500,400,1);
  expect(placement.place(200,200,100,30,60,continent)).toBe(true);
  expect(placement.place(200,200,100,30,100,selected)).toBe(true);
  expect(continent.hidden).toBe(true);
  expect(placement.place(400,200,80,20,40,ordinary)).toBe(false);
  expect(placement.place(4,200,100,20,110,ordinary)).toBe(false);
 });
});
