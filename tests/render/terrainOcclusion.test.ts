import { it,expect } from 'vitest';
import { Mesh,MeshBasicMaterial,SphereGeometry,Raycaster,Vector3 } from 'three';
import { buildTerrainTree,TerrainOcclusionIndex } from '../../src/render/terrainOcclusion';

it('matches exact front-face raycasts with segment clearance and keeps source geometry intact',()=>{
 const geometry=new SphereGeometry(10,32,20).toNonIndexed(),positions=geometry.getAttribute('position').array as Float32Array,before=positions.slice();
 const index=new TerrainOcclusionIndex(positions,buildTerrainTree(positions)),material=new MeshBasicMaterial(),mesh=new Mesh(geometry,material),ray=new Raycaster();mesh.updateMatrixWorld(true);
 for(let i=0;i<60;i++){
  const direction=new Vector3(Math.cos(i*2.399),Math.sin(i*2.399),Math.sin(i*.73)).normalize(),origin=direction.clone().multiplyScalar(27);
  for(const radius of [9.5,10.08,-12]){const point=direction.clone().multiplyScalar(radius),distance=origin.distanceTo(point);ray.set(origin,point.clone().sub(origin).normalize());ray.far=distance-.015;expect(index.occludesSegment(origin,point,1-.015/distance)).toBe(ray.intersectObject(mesh,false).length>0);}
 }
 expect(index.occludesSegment(new Vector3(27,0,0),new Vector3(27,0,0))).toBe(false);
 expect(new TerrainOcclusionIndex(new Float32Array(),buildTerrainTree(new Float32Array())).occludesSegment(new Vector3(27,0,0),new Vector3())).toBe(false);
 expect(positions).toEqual(before);geometry.dispose();material.dispose();
});
