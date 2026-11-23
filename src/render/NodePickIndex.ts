import { Matrix4, PerspectiveCamera, Ray, Raycaster, Vector3, type Intersection, type InstancedMesh } from 'three';
import { SPHERE_RADIUS } from '../constants';

interface Cell { center: Vector3; indices: number[] }

/** Static globe-local cells. The broad phase uses the largest possible projected marker;
 * the narrow phase tests its actual CSS-pixel footprint, including near the limb. */
export class NodePickIndex {
	private readonly cells = new Map<string, Cell>();
	private readonly side = SPHERE_RADIUS / 6;
	private readonly ray = new Ray();
	private readonly inverse = new Matrix4();
	private readonly center = new Vector3();
	private readonly ndc = new Vector3();
	private readonly pointer = new Vector3();

	constructor(private readonly positions: Float32Array) {
		for (let index = 0; index < positions.length / 3; index++) {
			this.center.fromArray(positions, index * 3);
			const x = Math.floor(this.center.x / this.side), y = Math.floor(this.center.y / this.side), z = Math.floor(this.center.z / this.side);
			const key = [x,y,z].join(',');
			let cell = this.cells.get(key);
			if (!cell) {
				cell = { center: new Vector3(x+0.5,y+0.5,z+0.5).multiplyScalar(this.side), indices: [] };
				this.cells.set(key,cell);
			}
			cell.indices.push(index);
		}
	}

	hits(caster: Raycaster, mesh: InstancedMesh, width: number, height: number, maxRadius: number, scale: number, result: Intersection[]): void {
		const camera = caster.camera;
		if (!(camera instanceof PerspectiveCamera) || width <= 0 || height <= 0) return;
		const sizes = mesh.geometry.getAttribute('radiusRule');
		this.ray.copy(caster.ray).applyMatrix4(this.inverse.copy(mesh.matrixWorld).invert());
		const farDepth = this.ray.origin.length() + SPHERE_RADIUS * 1.5;
		const maxWorldRadius = 2 * farDepth * Math.tan(camera.fov * Math.PI / 360) / (height * camera.zoom) * maxRadius * Math.SQRT2;
		const cellRadius = Math.sqrt(3) * this.side / 2 + maxWorldRadius;
		caster.ray.at(1, this.pointer).project(camera);
		for (const cell of this.cells.values()) {
			if (this.ray.distanceSqToPoint(cell.center) > cellRadius * cellRadius) continue;
			for (const i of cell.indices) {
				const radius = Math.max(sizes.getX(i),sizes.getY(i)*scale);
				if (radius <= 0) continue;
				this.center.fromArray(this.positions, i*3).applyMatrix4(mesh.matrixWorld);
				this.ndc.copy(this.center).project(camera);
				if (this.ndc.z < -1 || this.ndc.z > 1) continue;
				const dx=(this.ndc.x-this.pointer.x)*width/2, dy=(this.ndc.y-this.pointer.y)*height/2;
				const distance = caster.ray.origin.distanceTo(this.center);
				if (Math.abs(dx) <= radius && Math.abs(dy) <= radius && distance >= caster.near && distance <= caster.far) {
					result.push({ distance, point: this.center.clone(), object: mesh, instanceId: i });
				}
			}
		}
	}
}
