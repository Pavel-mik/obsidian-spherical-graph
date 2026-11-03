import { Quaternion, Vector3 } from 'three';
import { createIntrinsicSphericalGrid } from '../geography/sphericalGrid';
import type { PreparedRenderSnapshot } from './renderTypes';

const DEFAULT_VERTICAL_FOV_DEGREES = 45;
const NARROW_HORIZONTAL_FOV_DEGREES = 52;
const MAX_RESPONSIVE_VERTICAL_FOV_DEGREES = 85;

/**
 * Keeps the globe's horizontal framing stable in narrow Obsidian panes.
 * Landscape panes retain the familiar 45° vertical field of view.
 */
export function verticalFovForAspect(aspect: number): number {
	if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= 1) {
		return DEFAULT_VERTICAL_FOV_DEGREES;
	}
	const halfBaseRadians =
		(NARROW_HORIZONTAL_FOV_DEGREES * Math.PI) / 360;
	const responsive =
		(Math.atan(Math.tan(halfBaseRadians) / aspect) * 360) /
		Math.PI;
	return Math.min(MAX_RESPONSIVE_VERTICAL_FOV_DEGREES, responsive);
}


/** Reserve inspector space without changing camera orientation or stored layout. */
export function availableSceneSize(width: number, height: number, inspectorWidth = 0, inspectorHeight = 0): { width: number; height: number } {
	if (inspectorWidth <= 0 || inspectorHeight <= 0) return { width, height };
	return width > 760
		? { width: Math.max(1, width - inspectorWidth - 24), height }
		: { width, height: Math.max(1, height - inspectorHeight - 24) };
}

/** Explicit focus includes some real land context, while the city stays within
 * 14 degrees of the view centre even in narrow panes. No stored point changes.
 */
export function focusDirectionWithContext(node: Vector3, context?: Vector3): Vector3 {
 const direction=node.clone().normalize();
 if(!context||context.lengthSq()<1e-8)return direction;
 const centre=context.clone().normalize(),angle=direction.angleTo(centre);
 if(angle<1e-6)return direction;
 const fraction=Math.min(.35,.24/angle);
 return direction.applyQuaternion(new Quaternion().slerp(new Quaternion().setFromUnitVectors(direction,centre),fraction)).normalize();
}

/** Area context follows authoritative territory, not coastal clusters of cities. */
export function landContextForNode(snapshot: PreparedRenderSnapshot, nodeIndex: number): Vector3 | undefined {
 const index=snapshot.geography.continents.findIndex(c=>c.nodeIndices.includes(nodeIndex));
 if(index<0)return undefined;
 const territory=snapshot.geography.territory,centre=new Vector3();
 if(territory){
  const grid=createIntrinsicSphericalGrid(territory.subdivision);
  for(let cell=0;cell<territory.ownerByCell.length;cell++){
   if(territory.ownerByCell[cell]===index){const p=grid.vertices[cell]!;centre.x+=p[0];centre.y+=p[1];centre.z+=p[2];}
  }
  if(centre.lengthSq()>1e-8)return centre.normalize();
 }
 return new Vector3().fromArray(snapshot.geography.continents[index]!.center);
}
