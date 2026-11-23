import { BufferAttribute, BufferGeometry, Color, Group, LineBasicMaterial, LineSegments, Mesh, ShaderMaterial } from 'three';
import { SPHERE_RADIUS } from '../constants';
import { createIntrinsicSphericalGrid } from '../geography/sphericalGrid';
import { hashString } from '../geometry/deterministicHash';
import { addVec3, crossVec3, dotVec3, normalizeVec3, orthogonalUnitVec3, readVec3, type Vec3 } from '../geometry/vector3';
import type { AppearanceSettings } from '../settings/settings';
import { CARTOGRAPHY as T } from './cartography';
import { buildCountryBorders } from './countryGeometry';
import { countryTerritoryForDisplay } from './countryPresentation';
import { renderedIslandRadius, selectRenderedIslandNodeIndices } from './landGeometry';
import { createLandSupportModel, sampleOwnedLand } from './landSupport';
import type { PreparedRenderSnapshot, RenderTheme } from './renderTypes';

function lineLayer() { return new LineSegments(new BufferGeometry(), new LineBasicMaterial({ transparent: true, depthWrite: false })); }

/** A single lit sphere. Geography, coast and country ink share the saved intrinsic grid. */
export class AtlasSphereLayer {
	private readonly material = new ShaderMaterial({
		vertexColors: true, uniforms: { water: { value: new Color() }, land: { value: true }, rim: { value: true }, opacity: { value: 1 } },
		vertexShader: `
			varying vec3 tint, direction, viewNormal, eye;
			void main() {
				tint=color; direction=normalize(position); viewNormal=normalMatrix*direction;
				vec4 p=modelViewMatrix*vec4(position,1.0); eye=-p.xyz; gl_Position=projectionMatrix*p;
			}`,
		fragmentShader: `
			varying vec3 tint, direction, viewNormal, eye;
			uniform vec3 water; uniform bool land, rim; uniform float opacity;
			void main() {
				vec3 n=normalize(viewNormal), d=normalize(direction);
				vec3 base=land?tint:water;
				float light=max(dot(n, normalize(vec3(-0.45,0.65,0.7))),0.0);
				vec2 ll=vec2(atan(d.z,d.x),asin(clamp(d.y,-1.0,1.0)))*3.81972;
				vec2 grid=abs(fract(ll+0.5)-0.5)/max(fwidth(ll),vec2(0.0001));
				float ink=1.0-smoothstep(0.0,0.8,min(grid.x,grid.y));
				base=base*(0.68+0.45*light)+vec3(0.018,0.030,0.028)*ink;
				float facing=max(dot(n,normalize(eye)),0.0);
				if(rim)base=mix(base,vec3(0.50,0.71,0.66),0.56*pow(1.0-facing,4.0));
				gl_FragColor=vec4(base,opacity);
				#include <colorspace_fragment>
			}`,
	});
	private readonly sphere = new Mesh(new BufferGeometry(), this.material);
	private readonly coast = lineLayer();
	private readonly borders = lineLayer();
	private owners: number[] = [];
	private countries: ArrayLike<number> = [];
	private snapshot?: PreparedRenderSnapshot;

	constructor(private readonly group: Group, appearance: AppearanceSettings, private theme: RenderTheme) {
		this.sphere.name = 'spherical-graph-atlas-surface';
		this.sphere.renderOrder = -2;
		this.coast.name = 'spherical-graph-atlas-coast';
		this.borders.name = 'spherical-graph-atlas-countries';
		group.add(this.sphere, this.coast, this.borders);
		this.update(appearance, theme);
	}

	setSnapshot(snapshot: PreparedRenderSnapshot): void {
		const previous = this.snapshot;
		this.snapshot = snapshot;
		if (previous && previous.topologyRevision === snapshot.topologyRevision && previous.layoutRevision === snapshot.layoutRevision) return;
		const territory = countryTerritoryForDisplay(snapshot);
		const grid = createIntrinsicSphericalGrid(territory?.subdivision ?? 4);
		const seed = hashString(snapshot.layoutRevision);
		const degrees = snapshot.nodes.map(node => node.degree);
		const model = !territory && snapshot.geography.continents.length ? createLandSupportModel(snapshot.geography, snapshot.positions, snapshot.edges, seed, degrees) : undefined;
		this.owners = territory ? Array.from(territory.ownerByCell) : grid.vertices.map(p => model ? sampleOwnedLand(p, model).owner : -1);
		if (!territory) {
			const sampled = new Set(this.owners);
			// A legacy continent can have only isolated notes and no sampled land cells.
			// Its saved cap gives it a visible footprint even on this coarse grid.
			snapshot.geography.continents.forEach((continent, owner) => {
				if (sampled.has(owner) || !continent.nodeIndices.length) return;
				const threshold = Math.cos(Math.max(0.08, continent.capRadius));
				grid.vertices.forEach((point,i) => {
					if (this.owners[i] === -1 && dotVec3(point,continent.center) >= threshold) this.owners[i] = owner;
				});
			});
		}
		this.countries = territory?.countries?.ownerByCell ?? [];
		const positions = grid.vertices.flatMap(p => p.map(x => x * SPHERE_RADIUS));
		const indices = grid.triangles.flat();
		const coast: number[] = [];
		for (const tri of grid.triangles) {
			for (let side = 0; side < 3; side++) {
				const a = tri[side]!, b = tri[(side + 1) % 3]!;
				if ((this.owners[a]! < 0) === (this.owners[b]! < 0)) continue;
				const midpoint = normalizeVec3(addVec3(grid.vertices[a]!, grid.vertices[b]!));
				coast.push(...midpoint.map(x => x * (SPHERE_RADIUS + 0.012)));
			}
		}
		for (const i of selectRenderedIslandNodeIndices(snapshot.geography, snapshot.positions, seed, snapshot.edges, degrees)) {
			const n = readVec3(snapshot.positions, i), u = orthogonalUnitVec3(n, i), v = crossVec3(n, u);
			const angle = renderedIslandRadius(snapshot.nodes.length, i, seed);
			const center = positions.length / 3;
			positions.push(...n.map(x => x * (SPHERE_RADIUS + 0.009)));
			this.owners.push(snapshot.geography.continents.length + i);
			for (let j = 0; j < 12; j++) {
				const a = j * Math.PI / 6, x = Math.cos(a)*angle, y = Math.sin(a)*angle;
				const p: Vec3 = [n[0]+u[0]*x+v[0]*y,n[1]+u[1]*x+v[1]*y,n[2]+u[2]*x+v[2]*y];
				positions.push(...normalizeVec3(p).map(k => k * (SPHERE_RADIUS + 0.009)));
				this.owners.push(snapshot.geography.continents.length + i);
				indices.push(center, center + j + 1, center + (j+1)%12 + 1);
			}
		}
		this.sphere.geometry.dispose();
		const geometry = this.sphere.geometry = new BufferGeometry();
		geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
		geometry.setIndex(indices);
		geometry.setAttribute('color', new BufferAttribute(new Float32Array(positions.length), 3));
		this.coast.geometry.dispose(); this.coast.geometry = new BufferGeometry();
		this.coast.geometry.setAttribute('position', new BufferAttribute(Float32Array.from(coast), 3));
		this.borders.geometry.dispose(); this.borders.geometry = new BufferGeometry();
		this.borders.geometry.setAttribute('position', new BufferAttribute(buildCountryBorders(territory, SPHERE_RADIUS + 0.014), 3));
		this.recolor();
	}

	private recolor(): void {
		const attr = this.sphere.geometry.getAttribute('color');
		if (!attr || !this.snapshot) return;
		const continents = this.snapshot.geography.continents;
		const palette = this.theme.land.map(c => new Color(c)), water = new Color(this.theme.sphere);
		const tint = new Color();
		for (let i = 0; i < this.owners.length; i++) {
			const owner = this.owners[i]!;
			tint.copy(owner < 0 ? water : palette[(continents[owner]?.colorIndex ?? owner) % palette.length] ?? water);
			const region = this.countries[i] ?? -1;
			if (region >= 0) tint.offsetHSL(((region * 7) % 13 - 6) * 0.002, 0, ((region * 13) % 11 - 5) * 0.004);
			attr.setXYZ(i, tint.r, tint.g, tint.b);
		}
		attr.needsUpdate = true;
	}
	update(appearance: AppearanceSettings, theme: RenderTheme): void {
		const changed = this.theme !== theme;
		this.theme = theme;
		this.sphere.visible = appearance.surfaceMode !== 'hidden';
		this.coast.visible = this.sphere.visible && appearance.showContinents;
		this.borders.visible = this.coast.visible && appearance.showCountryBorders;
		this.coast.material.color.set(theme.coast); this.coast.material.opacity = 0.82;
		this.borders.material.color.set(T.colors.globe.countryBorder); this.borders.material.opacity = 0.82;
		(this.material.uniforms.water!.value as Color).set(theme.sphere);
		this.material.uniforms.land!.value = appearance.showContinents;
		this.material.uniforms.rim!.value = appearance.showAtmosphere;
		this.material.transparent = appearance.surfaceMode === 'transparent';
		this.material.depthWrite = !this.material.transparent;
		this.material.uniforms.opacity!.value = this.material.transparent ? Math.min(0.3, appearance.surfaceOpacity) : 1;
		if (changed) this.recolor();
	}
	// Spherical occlusion is shared by picking and labels. This surface adds no mountains.
	isTerrainOccluded(): boolean { return false; }
	render(): void { /* All camera-dependent lighting runs in the shader. */ }
	dispose(): void {
		for (const item of [this.sphere, this.coast, this.borders]) {
			this.group.remove(item); item.geometry.dispose(); item.material.dispose();
		}
		this.snapshot = undefined;
	}
}
