/** Packed read-only BVH built with decorative terrain in the worker. */
export interface TerrainTreeData {
 readonly bounds:Float32Array;
 readonly nodes:Int32Array;
 readonly triangles:Uint32Array;
}
interface Point {x:number;y:number;z:number}

export function buildTerrainTree(positions:Float32Array):TerrainTreeData {
 const count=positions.length/9,triangles=Uint32Array.from({length:count},(_,i)=>i),centres=new Float32Array(count*3),bounds:number[]=[],nodes:number[]=[];
 for(let i=0;i<count;i++)for(let axis=0;axis<3;axis++)centres[i*3+axis]=(positions[i*9+axis]!+positions[i*9+3+axis]!+positions[i*9+6+axis]!)/3;
 const build=(start:number,length:number):number=>{
  const node=nodes.length/4,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];nodes.push(-1,-1,start,length);bounds.push(0,0,0,0,0,0);
  for(let i=start;i<start+length;i++){const offset=triangles[i]!*9;for(let axis=0;axis<3;axis++)for(let corner=0;corner<3;corner++){const v=positions[offset+corner*3+axis]!;min[axis]=Math.min(min[axis]!,v);max[axis]=Math.max(max[axis]!,v);}}
  for(let axis=0;axis<3;axis++){bounds[node*6+axis]=min[axis]!;bounds[node*6+3+axis]=max[axis]!;}
  if(length>32){let axis=0;for(let i=1;i<3;i++)if(max[i]!-min[i]!>max[axis]!-min[axis]!)axis=i;
   triangles.subarray(start,start+length).sort((a,b)=>centres[a*3+axis]!-centres[b*3+axis]!);
   const half=Math.floor(length/2),left=build(start,half),right=build(start+half,length-half);nodes[node*4]=left;nodes[node*4+1]=right;nodes[node*4+3]=0;
  }return node;
 };
 if(count)build(0,count);
 return {bounds:new Float32Array(bounds),nodes:new Int32Array(nodes),triangles};
}

/** Exact front-face triangle intersections, with segment bounds and no allocations
 * per triangle. Coordinates are local to the source terrain geometry. */
export class TerrainOcclusionIndex {
 constructor(private readonly positions:Float32Array,private readonly tree:TerrainTreeData){}
 occludesSegment(origin:Point,end:Point,maxT=1):boolean{
  const dx=end.x-origin.x,dy=end.y-origin.y,dz=end.z-origin.z;
  if(!this.tree.nodes.length||!Number.isFinite(dx+dy+dz)||dx*dx+dy*dy+dz*dz<1e-20)return false;
  const {bounds,nodes,triangles}=this.tree,stack=[0],o=[origin.x,origin.y,origin.z],d=[dx,dy,dz],p=this.positions;
  while(stack.length){const node=stack.pop()!;let near=0,far=maxT,hit=true;
   for(let axis=0;axis<3;axis++){const min=bounds[node*6+axis]!,max=bounds[node*6+3+axis]!;
    if(Math.abs(d[axis]!)<1e-12){if(o[axis]!<min||o[axis]!>max){hit=false;break;}}
    else{let a=(min-o[axis]!)/d[axis]!,b=(max-o[axis]!)/d[axis]!;if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far){hit=false;break;}}
   }if(!hit)continue;
   const count=nodes[node*4+3]!;
   if(!count){stack.push(nodes[node*4]!,nodes[node*4+1]!);continue;}
   const start=nodes[node*4+2]!;
   for(let i=start;i<start+count;i++){
    const k=triangles[i]!*9,ax=p[k]!,ay=p[k+1]!,az=p[k+2]!,ex=p[k+3]!-ax,ey=p[k+4]!-ay,ez=p[k+5]!-az,fx=p[k+6]!-ax,fy=p[k+7]!-ay,fz=p[k+8]!-az;
    const px=dy*fz-dz*fy,py=dz*fx-dx*fz,pz=dx*fy-dy*fx,det=ex*px+ey*py+ez*pz;if(det<=1e-12)continue;
    const tx=origin.x-ax,ty=origin.y-ay,tz=origin.z-az,u=(tx*px+ty*py+tz*pz)/det;if(u< -1e-9||u>1+1e-9)continue;
    const qx=ty*ez-tz*ey,qy=tz*ex-tx*ez,qz=tx*ey-ty*ex,v=(dx*qx+dy*qy+dz*qz)/det;if(v< -1e-9||u+v>1+1e-9)continue;
    const t=(fx*qx+fy*qy+fz*qz)/det;if(t>1e-6&&t<maxT)return true;
   }
  }return false;
 }
}
