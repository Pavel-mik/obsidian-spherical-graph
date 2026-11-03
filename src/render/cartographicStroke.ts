import { dotVec3, normalizeVec3, type Vec3 } from '../geometry/vector3';

const angle = (a: Vec3,b: Vec3): number => Math.acos(Math.max(-1,Math.min(1,dotVec3(a,b))));
const blend = (a: Vec3,b: Vec3,t: number): Vec3 => normalizeVec3([
 a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t,a[2]*(1-t)+b[2]*t,
]);
const edgeKey = (a: string,b: string): string => a < b ? a+'|'+b : b+'|'+a;

/** Round only display ink, with fixed junctions and a strict angular envelope.
 * Owner cells are never touched. Coast clipping and nearby city discs can veto
 * each rounded corner. Hashing city guards keeps work bounded for large vaults.
 */
export function softenCartographicStroke(
 segments: Float32Array, radius: number, cities: Float32Array,
 inside: (point: Vec3) => boolean = () => true,
 maxDeviation = 0.004, cityGuardAngle = 0.018,
): Float32Array {
 if (!segments.length) return new Float32Array();
 const points = new Map<string,Vec3>(), adjacency = new Map<string,Set<string>>();
 const key = (p: Vec3): string => p.map(v=>Math.round(v*100_000)).join(':');
 for (let i=0;i+5<segments.length;i+=6) {
  const a=normalizeVec3([segments[i]!,segments[i+1]!,segments[i+2]!]);
  const b=normalizeVec3([segments[i+3]!,segments[i+4]!,segments[i+5]!]);
  const ak=key(a),bk=key(b); if(ak===bk)continue;
  if(!points.has(ak))points.set(ak,a);if(!points.has(bk))points.set(bk,b);
  if(!adjacency.has(ak))adjacency.set(ak,new Set());if(!adjacency.has(bk))adjacency.set(bk,new Set());
  adjacency.get(ak)!.add(bk);adjacency.get(bk)!.add(ak);
 }
 const buckets=new Map<string,Vec3[]>(), size=cityGuardAngle*1.1, guardCos=Math.cos(cityGuardAngle);
 const bucket = (p: Vec3): [number,number,number] => p.map(v=>Math.floor(v/size)) as [number,number,number];
 for(let i=0;i+2<cities.length;i+=3){
  const p=normalizeVec3([cities[i]!,cities[i+1]!,cities[i+2]!]),k=bucket(p).join(':');
  const entries=buckets.get(k)??[];entries.push(p);buckets.set(k,entries);
 }
 const safe = (p: Vec3): boolean => {
  if(!inside(p))return false;
  const [x,y,z]=bucket(p);
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++) {
   for(const city of buckets.get([x+a,y+b,z+c].join(':'))??[])if(dotVec3(p,city)>guardCos)return false;
  }
  return true;
 };
 const used=new Set<string>(),chains:Vec3[][]=[];
 const walk=(start:string,next:string):void=>{
  const chain=[points.get(start)!];let previous=start,current=next;
  while(true){
   const edge=edgeKey(previous,current);if(used.has(edge))break;used.add(edge);chain.push(points.get(current)!);
   if(current===start||adjacency.get(current)!.size!==2)break;
   const following=[...adjacency.get(current)!].find(k=>k!==previous)!;
   previous=current;current=following;
  }
  if(chain.length>1)chains.push(chain);
 };
 for(const [start,neighbors]of adjacency)if(neighbors.size!==2)for(const next of neighbors)if(!used.has(edgeKey(start,next)))walk(start,next);
 for(const [start,neighbors]of adjacency)for(const next of neighbors)if(!used.has(edgeKey(start,next)))walk(start,next);
 const output:number[]=[];
 for(const chain of chains){
  // Remove the exact collinear subdivisions inserted by border/coast sampling.
  const simple:Vec3[]=[];
  for(const p of chain){
   simple.push(p);
   while(simple.length>=3){
    const a=simple[simple.length-3]!,b=simple[simple.length-2]!,c=simple[simple.length-1]!;
    if(Math.abs(angle(a,b)+angle(b,c)-angle(a,c))>1e-7)break;
    simple.splice(simple.length-2,1);
   }
  }
  const rounded:Vec3[]=[simple[0]!];
  for(let i=1;i+1<simple.length;i++){
   const previous=simple[i-1]!,p=simple[i]!,next=simple[i+1]!;
   const before=angle(p,previous),after=angle(p,next);
   const distance=Math.min(before*.45,after*.45,maxDeviation*2);
   if(distance<1e-6){rounded.push(p);continue;}
   const a=blend(p,previous,distance/before),b=blend(p,next,distance/after);
   const curve=[a];
   for(let step=1;step<=5;step++){
    const t=step/5;curve.push(blend(blend(a,p,t),blend(p,b,t),t));
   }
   // The quadratic lies within half its trimmed leg length of the original
   // broken arc; leg length <= 2*maxDeviation. Junctions are never rounded.
   if(curve.every(safe))rounded.push(...curve);else rounded.push(p);
  }
  rounded.push(simple[simple.length-1]!);
  for(let i=1;i<rounded.length;i++) {
   const a=rounded[i-1]!,b=rounded[i]!;
   if(angle(a,b)<1e-7)continue;
   output.push(...a.map(v=>v*radius),...b.map(v=>v*radius));
  }
 }
 return new Float32Array(output);
}
