import type { PreparedRenderSnapshot, RenderEdge } from './renderTypes';

/** All roads remain drawn; long/hub context is quieter than local connections.
 * Explicit selection, hover, Search and route ribbons never use this factor.
 */
export function ordinaryRoadEmphasis(snapshot: PreparedRenderSnapshot, edge: RenderEdge): number {
 const a=snapshot.nodeByIndex.get(edge.source),b=snapshot.nodeByIndex.get(edge.target);
 if(!a||!b)return 1;
 const region=snapshot.directoryRegionByNodeId.get(a.id);
 const sameRegion=region!==undefined&&region===snapshot.directoryRegionByNodeId.get(b.id);
 const sameContinent=a.path.includes('/')&&a.path.split('/')[0]===b.path.split('/')[0];
 const x=edge.source*3,y=edge.target*3,p=snapshot.positions;
 const dot=p[x]!*p[y]!+p[x+1]!*p[y+1]!+p[x+2]!*p[y+2]!;
 const distance=Math.acos(Math.max(-1,Math.min(1,dot)));
 const hub=Math.min(1,Math.sqrt(8/Math.max(8,(a.degree+b.degree)/2)));
 return Math.max(.28,Math.min(1,(sameRegion ? 1 : sameContinent ? .68 : .43)*hub/(1+distance*.95)));
}
