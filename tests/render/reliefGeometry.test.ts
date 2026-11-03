import { it,expect } from 'vitest';
import { decorateLandRelief } from '../../src/render/reliefGeometry';
import { normalizeVec3,crossVec3,dotVec3,type Vec3 } from '../../src/geometry/vector3';
import type { TerrainSurface } from '../../src/render/terrainSurface';
import type { LandSurfaceData } from '../../src/render/landGeometry';

it('refines a shared edge conformingly when only one triangle needs sharper strata',()=>{
 const points:Vec3[]=[[1,-.1,-.1],[1,.1,-.1],[1,-.1,.1],[1,.1,.1]];
 const [a,b,c,d]=points.map(p=>normalizeVec3(p));
 const positions=new Float32Array([a!,b!,c!,b!,d!,c!].flatMap(p=>p.map(v=>v*10.0025)));
 const raw:LandSurfaceData={positions,colorIndices:new Uint8Array(6),shades:new Float32Array(6).fill(1),beachPositions:new Float32Array(),coastPositions:new Float32Array(),triangleCount:2,beachTriangleCount:0,renderedIslandCount:0};
 const signal=(p:Vec3):number=>p[1]<-.05&&p[2]<-.05?.1:0;
 const surface={heightAt:(p:Vec3)=>signal(p)*.1,strataAt:signal} as unknown as TerrainSurface;
 const result=decorateLandRelief(raw,surface),mesh=result.reliefPositions!,edges=new Map<string,{count:number;a:Vec3;b:Vec3}>();
 const key=(i:number):string=>[mesh[i]!,mesh[i+1]!,mesh[i+2]!].map(v=>Math.round(v*1e5)).join(',');
 for(let i=0;i<mesh.length;i+=9)for(let j=0;j<3;j++){const x=i+j*3,y=i+(j+1)%3*3,a=key(x),b=key(y),edge=a<b?a+'|'+b:b+'|'+a,old=edges.get(edge);if(old)old.count++;else edges.set(edge,{count:1,a:normalizeVec3([mesh[x]!,mesh[x+1]!,mesh[x+2]!]),b:normalizeVec3([mesh[y]!,mesh[y+1]!,mesh[y+2]!])});}
 const boundary=[crossVec3(a!,b!),crossVec3(b!,d!),crossVec3(d!,c!),crossVec3(c!,a!)].map(p=>normalizeVec3(p));
 expect(mesh.length/9).toBeGreaterThanOrEqual(6);expect([...edges.values()].every(v=>v.count<=2)).toBe(true);
 for(const edge of edges.values())if(edge.count===1)expect(boundary.some(plane=>Math.abs(dotVec3(plane,edge.a))<1e-5&&Math.abs(dotVec3(plane,edge.b))<1e-5)).toBe(true);
 expect(raw.positions).toBe(positions);
});
