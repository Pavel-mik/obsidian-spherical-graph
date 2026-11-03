import { oceanFragment } from './oceanMaterial';
import {
	BufferAttribute,
	BufferGeometry,
	Color,
	PerspectiveCamera,
	Raycaster,
	Vector3,
	Matrix4,
	DoubleSide,
	FrontSide,
	Group,
	Mesh,
	MeshBasicMaterial,
	PlaneGeometry,
	ShaderMaterial,
	SphereGeometry,
} from 'three';
import { ATLAS_LIGHT_GLSL, CARTOGRAPHY as T, updateLineViewport } from './cartography';
import { screenSpaceLine } from './screenSpaceLine';
import { sculptedLandFragment } from './terrainMaterial';
import { HorizonGlow } from './HorizonGlow';
import { decorateLandRelief } from './reliefGeometry';
import { surfaceForSnapshot } from './terrainSurface';
import { TerrainOcclusionIndex,buildTerrainTree } from './terrainOcclusion';
import { countryTerritoryForDisplay } from './countryPresentation';
import { SPHERE_RADIUS } from '../constants';
import { hashString } from '../geometry/deterministicHash';
import { AppearanceSettings } from '../settings/settings';
import {
	buildLandSurfaceData,
	type LandSurfaceData,
} from './landGeometry';
import { LandSurfaceWorkerClient } from './LandSurfaceWorkerClient';
import {
	type PreparedRenderSnapshot,
	type RenderTheme,
} from './renderTypes';

// Keep the ocean depth skin slightly inside the logical globe. This gives
// land, graticule, roads, and cities unambiguous depth layers even on GPUs
// with modest depth-buffer precision.
const OCEAN_SURFACE_RADIUS = SPHERE_RADIUS - 0.02;
const LAND_SURFACE_RADIUS = SPHERE_RADIUS;

const PROCEDURAL_NOISE_GLSL = `
	float atlasHash(vec3 point) {
		point = fract(point * 0.1031);
		point += dot(point, point.yzx + 33.33);
		return fract((point.x + point.y) * point.z);
	}

	float atlasNoise(vec3 point) {
		vec3 cell = floor(point);
		vec3 local = fract(point);
		vec3 curve = local * local * (3.0 - 2.0 * local);
		return mix(
			mix(
				mix(atlasHash(cell), atlasHash(cell + vec3(1.0, 0.0, 0.0)), curve.x),
				mix(atlasHash(cell + vec3(0.0, 1.0, 0.0)), atlasHash(cell + vec3(1.0, 1.0, 0.0)), curve.x),
				curve.y
			),
			mix(
				mix(atlasHash(cell + vec3(0.0, 0.0, 1.0)), atlasHash(cell + vec3(1.0, 0.0, 1.0)), curve.x),
				mix(atlasHash(cell + vec3(0.0, 1.0, 1.0)), atlasHash(cell + vec3(1.0, 1.0, 1.0)), curve.x),
				curve.y
			),
			curve.z
		);
	}

	float atlasFbm(vec3 point) {
		float value = 0.0;
		float amplitude = 0.54;
		for (int octave = 0; octave < 4; octave += 1) {
			value += atlasNoise(point) * amplitude;
			point = point * 2.03 + vec3(7.1, 3.7, 5.9);
			amplitude *= 0.48;
		}
		return value;
	}
`;

export class SphereLayer {
	private readonly backdropGeometry = new PlaneGeometry(2, 2);
	private readonly backdropMaterial = new ShaderMaterial({
		depthTest: false, depthWrite: false, toneMapped: false,
		uniforms: { base: { value: new Color(T.colors.ui.void) }, glow: { value: new Color(T.colors.globe.oceanLight) }, aspect: { value: 1 } },
		vertexShader: 'varying vec2 backdropUv; void main(){ backdropUv=position.xy*0.5+0.5; gl_Position=vec4(position.xy,0.999,1.0); }',
		fragmentShader: `uniform vec3 base; uniform vec3 glow; uniform float aspect; varying vec2 backdropUv;
		 void main(){vec2 p=(backdropUv-vec2(0.48,0.54))*vec2(aspect,1.0);
		 gl_FragColor=vec4(mix(base,glow,exp(-dot(p,p)*5.0)*0.22),1.0);
		 #include <colorspace_fragment>
		 }`,
	});
	private readonly backdrop = new Mesh(this.backdropGeometry, this.backdropMaterial);
	private readonly oceanGeometry = new SphereGeometry(
		OCEAN_SURFACE_RADIUS,
		128,
		80,
	);
	private readonly rimGeometry = new SphereGeometry(SPHERE_RADIUS, 64, 40);
	private readonly oceanColor = new Color();
	private readonly material = new ShaderMaterial({
		depthTest: true,
		depthWrite: true,
		fragmentShader: oceanFragment(PROCEDURAL_NOISE_GLSL),
		side: FrontSide,
		toneMapped: false,
		uniforms: {
			oceanColor: { value: this.oceanColor },
			oceanDeep: { value: new Color(T.colors.globe.oceanDeep) },
			oceanLight: { value: new Color(T.colors.globe.oceanLight) },
			oceanOpacity: { value: 1 },
			oceanDetail: { value: 1 },
			showShallows: { value: 1 },
		},
		vertexShader: `
			attribute float waterShallow;
			varying float coastalWater;
			varying vec3 sphereDirection;
			varying vec3 viewNormal;
			varying vec3 viewDirection;

			void main() {
				vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
				sphereDirection = normalize(position);
				viewNormal = normalize(normalMatrix * normal);
				viewDirection = -viewPosition.xyz;
				coastalWater=waterShallow;
				gl_Position = projectionMatrix * viewPosition;
			}
		`,
	});
	private readonly mesh = new Mesh(this.oceanGeometry, this.material);
	/**
	 * The textured ocean is inset slightly to keep roads and cities clear of
	 * the water skin. In Solid mode this colorless shell restores the exact
	 * logical globe silhouette in the depth buffer, including at the limb.
	 */
	private readonly depthMaskMaterial = new MeshBasicMaterial({
		colorWrite: false,
		depthTest: true,
		depthWrite: true,
		side: FrontSide,
		toneMapped: false,
		transparent: false,
	});
	private readonly depthMask = new Mesh(
		this.rimGeometry,
		this.depthMaskMaterial,
	);
	private readonly gridGeometry = createGridGeometry(
		SPHERE_RADIUS + 0.001,
	);
	private readonly grid = screenSpaceLine(this.gridGeometry.getAttribute('position').array as Float32Array, {
		color: T.colors.globe.graticule, widthPx: T.edges.graticule.widthPx,
		opacity: T.edges.graticule.opacity, dash: T.edges.graticule.dashPx,
	});
	private readonly gridMaterial = this.grid.material;
	private readonly rimColor = new Color();
	private readonly rimMaterial = new ShaderMaterial({
		depthTest: true,
		depthWrite: false,
		fragmentShader: `
			uniform vec3 rimColor;
			uniform float rimOpacity;
			varying vec3 viewNormal;
			varying vec3 viewDirection;

			void main() {
				float facing = abs(dot(normalize(viewNormal), normalize(viewDirection)));
				float edgeDistance = facing * facing / max(fwidth(facing * facing), 0.0001);
				float rim = (1.0 - smoothstep(0.0, ${T.material.rimWidthPx.toFixed(2)}, edgeDistance)) *
					max(dot(normalize(viewNormal), normalize(${ATLAS_LIGHT_GLSL})), 0.0);
				gl_FragColor = vec4(rimColor, rim * rimOpacity);
				#include <colorspace_fragment>
			}
		`,
		side: FrontSide,
		toneMapped: false,
		transparent: true,
		uniforms: {
			rimColor: { value: this.rimColor },
			rimOpacity: { value: 0.18 },
		},
		vertexShader: `
			varying vec3 viewNormal;
			varying vec3 viewDirection;

			void main() {
				vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
				viewNormal = normalize(normalMatrix * normal);
				viewDirection = -viewPosition.xyz;
				gl_Position = projectionMatrix * viewPosition;
			}
		`,
	});
	private readonly rim = new Mesh(this.rimGeometry, this.rimMaterial);
	private readonly horizonGlow: HorizonGlow;
	private wallMesh: Mesh<BufferGeometry,ShaderMaterial>|undefined;
	private readonly terrainRay=new Raycaster();
	private readonly rayDirection=new Vector3();
	private landOcclusion:TerrainOcclusionIndex|undefined;
	private readonly inverseTerrain=new Matrix4();
	private readonly localEye=new Vector3();
	private readonly localTarget=new Vector3();
	private snapshot: PreparedRenderSnapshot | undefined;
	private appearance: AppearanceSettings;
	private theme: RenderTheme;
	private landData: LandSurfaceData | undefined;
	private landGeometry: BufferGeometry | undefined;
	private landMaterial: ShaderMaterial | undefined;
	private landMesh: Mesh | undefined;
	private beachGeometry: BufferGeometry | undefined;
	private beachMaterial: ShaderMaterial | undefined;
	private beachMesh: Mesh | undefined;
	private coastGeometry: BufferGeometry | undefined;
	private coastMaterial: ShaderMaterial | undefined;
	private coastLines: Mesh<BufferGeometry, ShaderMaterial> | undefined;
	private countryBorders: Mesh<BufferGeometry, ShaderMaterial> | undefined;
	private countryBorderShadow: Mesh<BufferGeometry, ShaderMaterial> | undefined;
	private coastShadow: Mesh<BufferGeometry, ShaderMaterial> | undefined;
	private readonly landWorker =
		typeof Worker === 'undefined'
			? undefined
			: new LandSurfaceWorkerClient();
	private landRevision: string | undefined;

	constructor(
		private readonly group: Group,
		appearance: AppearanceSettings,
		theme: RenderTheme,
		private readonly onInvalidate?: () => void,
		private readonly landDetailScale = 1,
	) {
		this.horizonGlow=new HorizonGlow(group);
		this.oceanGeometry.setAttribute('waterShallow',new BufferAttribute(new Float32Array(this.oceanGeometry.getAttribute('position').count),1));
		this.appearance = appearance;
		this.theme = theme;
		this.mesh.name = 'spherical-graph-surface';
		this.mesh.renderOrder = -2;
		this.depthMask.name = 'spherical-graph-solid-depth-mask';
		this.depthMask.renderOrder = -1;
		this.grid.name = 'spherical-graph-surface-grid';
		this.grid.renderOrder = 1;

		this.rim.name = 'spherical-graph-surface-rim';
		this.rim.renderOrder = 3;
		this.backdrop.name = 'spherical-graph-backdrop'; this.backdrop.renderOrder = -100; this.backdrop.frustumCulled = false;
		this.group.add(this.backdrop, this.mesh, this.depthMask, this.grid, this.rim);
		this.update(appearance, theme);
	}

	setSnapshot(snapshot: PreparedRenderSnapshot): void {
		this.snapshot = snapshot;
		const revision = `${snapshot.layoutRevision}:${snapshot.topologyRevision}`;
		if (revision === this.landRevision) {
			return;
		}
		this.landRevision = revision;
		const ocean=this.oceanGeometry.getAttribute('position'),shallows=this.oceanGeometry.getAttribute('waterShallow') as BufferAttribute,surface=surfaceForSnapshot(snapshot);
		for(let i=0;i<ocean.count;i++)shallows.setX(i,surface.shallowsAt([ocean.getX(i),ocean.getY(i),ocean.getZ(i)]));
		shallows.needsUpdate=true;
		this.rebuildLand();
	}

	update(appearance: AppearanceSettings, theme: RenderTheme): void {
		this.appearance = appearance;
		this.material.uniforms.showShallows!.value=appearance.showContinents?1:0;
		const themeChanged =
			this.theme !== theme ||
			this.theme.land.join('|') !== theme.land.join('|') ||
			this.theme.coast !== theme.coast;
		this.theme = theme;
		(this.backdropMaterial.uniforms.base!.value as Color).set(appearance.backgroundFollowsTheme ? theme.background : T.colors.ui.void);
		const visible = appearance.surfaceMode !== 'hidden';
		this.mesh.visible = visible;
		this.depthMask.visible = appearance.surfaceMode === 'solid';
		this.grid.visible = visible;
		this.rim.visible = visible;
		this.oceanColor.set(theme.sphere);
		(this.gridMaterial.uniforms.lineColor!.value as Color).set(theme.graticule);
		this.rimColor.set(T.colors.globe.rim);

		if (appearance.surfaceMode === 'transparent') {
			this.material.transparent = true;
			if (this.material.uniforms.oceanOpacity !== undefined) {
				this.material.uniforms.oceanOpacity.value = Math.min(
					0.3,
					appearance.surfaceOpacity,
				);
			}
			this.material.depthWrite = false;
			this.gridMaterial.uniforms.lineOpacity!.value = 0.08;
			if (this.rimMaterial.uniforms.rimOpacity !== undefined) {
				this.rimMaterial.uniforms.rimOpacity.value = 0.10;
			}
		} else {
			// "Solid" is an actual opaque surface. surfaceOpacity only
			// controls the explicitly transparent presentation.
			this.material.transparent = false;
			if (this.material.uniforms.oceanOpacity !== undefined) {
				this.material.uniforms.oceanOpacity.value = 1;
			}
			this.material.depthWrite = true;
			this.gridMaterial.uniforms.lineOpacity!.value = T.edges.graticule.opacity;
			if (this.rimMaterial.uniforms.rimOpacity !== undefined) {
				this.rimMaterial.uniforms.rimOpacity.value = T.material.rimPeakOpacity;
			}
		}
		this.updateLandVisibility();
		if (themeChanged) {
			this.recolorLand();
		}
		this.material.needsUpdate = true;
		this.gridMaterial.needsUpdate = true;
		this.rimMaterial.needsUpdate = true;
	}

	render(camera: PerspectiveCamera, width: number, height: number, phone = false): void {
		this.horizonGlow.render(camera,width,height,this.appearance.surfaceMode==='solid',phone);
		this.backdropMaterial.uniforms.aspect!.value = Math.max(1, width) / Math.max(1, height);
		for (const mesh of [this.grid, this.coastLines, this.countryBorders, this.coastShadow, this.countryBorderShadow]) {
			if (mesh) updateLineViewport(mesh.material, width, height);
		}
		const diameter = SPHERE_RADIUS*camera.projectionMatrix.elements[5]*height/Math.sqrt(Math.max(1,camera.position.lengthSq()-SPHERE_RADIUS*SPHERE_RADIUS));
		const fade = Math.min(1, Math.max(0, (diameter - 350) / 150));
		if (this.landMaterial?.uniforms.detailFade) this.landMaterial.uniforms.detailFade.value = phone ? fade * 0.35 : fade;
		this.material.uniforms.oceanDetail!.value=phone?0.35:fade;
		this.rim.visible = !phone && this.appearance.surfaceMode !== 'hidden';
	}

	dispose(): void {
		this.horizonGlow.dispose();
		this.landWorker?.dispose();
		this.removeLand();
		this.group.remove(this.backdrop, this.mesh, this.depthMask, this.grid, this.rim);
		this.backdropGeometry.dispose(); this.backdropMaterial.dispose();
		this.oceanGeometry.dispose();
		this.rimGeometry.dispose();
		this.gridGeometry.dispose();
		this.grid.geometry.dispose();
		this.material.dispose();
		this.depthMaskMaterial.dispose();
		this.gridMaterial.dispose();
		this.rimMaterial.dispose();
		this.snapshot = undefined;
		this.landRevision = undefined;
	}

	/** Exact CPU geometry agrees with the depth buffer for picking and DOM labels. */
	isTerrainOccluded(camera:Vector3,point:Vector3):boolean{
	 if(this.appearance.surfaceMode!=='solid'||!this.appearance.showContinents)return false;
	 const distance=this.rayDirection.subVectors(point,camera).length();if(distance<.02)return false;
	 if(this.landMesh?.visible&&this.landOcclusion){this.landMesh.updateWorldMatrix(true,false);this.inverseTerrain.copy(this.landMesh.matrixWorld).invert();this.localEye.copy(camera).applyMatrix4(this.inverseTerrain);this.localTarget.copy(point).applyMatrix4(this.inverseTerrain);if(this.landOcclusion.occludesSegment(this.localEye,this.localTarget,1-.015/distance))return true;}
	 this.terrainRay.set(camera,this.rayDirection.normalize());this.terrainRay.near=0;this.terrainRay.far=distance-.015;
	 if(this.wallMesh?.visible){this.wallMesh.updateWorldMatrix(true,false);if(this.terrainRay.intersectObject(this.wallMesh,false).length)return true;}
	 return false;
	}

	private rebuildLand(): void {
		this.removeLand();
		const snapshot = this.snapshot;
		if (
			snapshot === undefined ||
			(snapshot.geography.continents.length === 0 &&
				snapshot.geography.islandNodeIndices.length === 0)
		) {
			return;
		}
		const detail = Math.max(
			8,
			Math.round(
				adaptiveLandDetail(
					snapshot.nodes.length,
					snapshot.edges.length,
				) * this.landDetailScale,
			),
		);
		const seed = hashString(snapshot.layoutRevision);
		if (this.landWorker !== undefined) {
			const requestId = `${snapshot.layoutRevision}:${snapshot.topologyRevision}`;
			void this.landWorker
				.build({
					type: 'build-land',
					requestId,
					geography: snapshot.geography,
					positions: new Float32Array(snapshot.positions),
					radius: LAND_SURFACE_RADIUS,
					seed,
					detail,
					edges: snapshot.edges,
					nodeDegrees: Uint32Array.from(
						snapshot.nodes,
						(node) => node.degree,
					),
					countryDisplayTerritory: countryTerritoryForDisplay(snapshot),
				})
				.then((data) => {
					if (this.landRevision === requestId) {
						this.applyLandData(data);
					}
				})
				.catch(() => {
					// A superseded or failed decorative land build must never
					// block the rest of the saved graph from rendering.
				});
			return;
		}
		const data = buildLandSurfaceData(
			snapshot.geography,
			snapshot.positions,
			LAND_SURFACE_RADIUS,
			seed,
			detail,
			snapshot.edges,
			snapshot.nodes.map((node) => node.degree),
			countryTerritoryForDisplay(snapshot),
		);
		this.applyLandData(data);
	}

	private applyLandData(data: LandSurfaceData): void {
		if(!data.reliefPositions&&this.snapshot)data=decorateLandRelief(data,surfaceForSnapshot(this.snapshot));
		this.removeLand();
		this.landData = data;
		const beachGeometry = new BufferGeometry();
		beachGeometry.setAttribute(
			'position',
			new BufferAttribute(data.reliefBeachPositions??data.beachPositions, 3),
		);
		beachGeometry.computeBoundingSphere();
		const beachMaterial = new ShaderMaterial({
			depthTest: true,
			depthWrite: true,
			fragmentShader: `
				uniform vec3 beachColor;
				uniform float beachOpacity;
				varying vec3 sphereDirection;
				varying vec3 beachNormal;
				${PROCEDURAL_NOISE_GLSL}

				void main() {
					vec3 direction = normalize(sphereDirection);
					float dunes = atlasFbm(direction * 24.0 + vec3(3.1, 8.7, 1.9));
					float grains = atlasHash(direction * 421.0 + vec3(6.7, 2.3, 9.1));
					float wetEdge = atlasNoise(direction * 67.0 + vec3(1.2, 7.4, 4.6));
					float tone =
						0.78 +
						dunes * 0.2 +
						(grains - 0.5) * 0.12 +
						(wetEdge - 0.5) * 0.06;
					float light=0.32+0.90*max(dot(normalize(beachNormal),normalize(${ATLAS_LIGHT_GLSL})),0.0);
					gl_FragColor = vec4(beachColor * tone * light, beachOpacity);
					#include <colorspace_fragment>
				}
			`,
			side: FrontSide,
			toneMapped: false,
			transparent: false,
			uniforms: {
				beachColor: { value: new Color(this.theme.coast) },
				beachOpacity: { value: 1 },
			},
			vertexShader: `
				varying vec3 sphereDirection;
				varying vec3 beachNormal;

				void main() {
					sphereDirection = normalize(position);
					beachNormal=normalize(normalMatrix*normalize(position));
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			polygonOffset: true,
			polygonOffsetFactor: -0.5,
			polygonOffsetUnits: -0.5,
		});
		const beachMesh = new Mesh(beachGeometry, beachMaterial);
		beachMesh.name = 'spherical-graph-beaches';
		beachMesh.renderOrder = -0.5;
		this.group.add(beachMesh);
		this.beachGeometry = beachGeometry;
		this.beachMaterial = beachMaterial;
		this.beachMesh = beachMesh;

		const geometry = new BufferGeometry();
		const landPositions=data.reliefPositions??data.positions,landVertexCount=landPositions.length/3;
		this.landOcclusion=new TerrainOcclusionIndex(landPositions,data.occlusionTree??buildTerrainTree(landPositions));
		geometry.setAttribute(
			'position',
			new BufferAttribute(landPositions, 3),
		);
		geometry.setAttribute(
			'color',
			new BufferAttribute(new Float32Array(landPositions.length), 3),
		);
		geometry.setAttribute('shadeColor', new BufferAttribute(new Float32Array(landPositions.length), 3));
		geometry.setAttribute('lightColor', new BufferAttribute(new Float32Array(landPositions.length), 3));
		geometry.setAttribute('countryTint',new BufferAttribute(data.reliefCountryTints??data.countryTints??new Float32Array(landPositions.length).fill(1),3));
		geometry.setAttribute('strata',new BufferAttribute(data.reliefStrata??new Float32Array(landVertexCount),1));
		geometry.setAttribute('normal',new BufferAttribute(data.reliefNormals??data.positions.slice(),3));
		geometry.setAttribute('elevation',new BufferAttribute(data.reliefElevations??new Float32Array(landVertexCount),1));
		for(const name of ['mineralAColor','mineralBColor','mineralCColor'])geometry.setAttribute(name,new BufferAttribute(new Float32Array(landPositions.length),3));
		geometry.computeBoundingSphere();
		const material = new ShaderMaterial({
			depthTest: true,
			depthWrite: true,
			fragmentShader: sculptedLandFragment(PROCEDURAL_NOISE_GLSL),
			side: FrontSide,
			toneMapped: false,
			transparent: false,
			uniforms: {
				landOpacity: { value: 1 },
				detailFade: { value: 1 },
			},
			vertexShader: `
				attribute vec3 color;
				attribute vec3 shadeColor;
				attribute vec3 lightColor;
				attribute vec3 countryTint;
				attribute float strata;
				attribute float elevation;
				attribute vec3 mineralAColor;
				attribute vec3 mineralBColor;
				attribute vec3 mineralCColor;
				varying vec3 mineralA;
				varying vec3 mineralB;
				varying vec3 mineralC;
				varying float landElevation;
				varying vec3 landColor;
				varying vec3 landShadeColor;
				varying vec3 landLightColor;
				varying vec3 landCountryTint;
				varying float landStrata;
				varying vec3 terrainViewPosition;
				varying vec3 terrainViewNormal;
				varying vec3 terrainObjectLight;
				varying vec3 sphereDirection;

				void main() {
					landColor = color;
					landShadeColor = shadeColor;
					landLightColor = lightColor;
					landCountryTint=countryTint;landStrata=strata;
					mineralA=mineralAColor;mineralB=mineralBColor;mineralC=mineralCColor;landElevation=elevation;
					terrainViewPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
					terrainViewNormal = normalize(normalMatrix * normal);
					vec3 keyLight = normalize(${ATLAS_LIGHT_GLSL});
					terrainObjectLight = vec3(dot(modelViewMatrix[0].xyz, keyLight),
						dot(modelViewMatrix[1].xyz, keyLight), dot(modelViewMatrix[2].xyz, keyLight));
					sphereDirection = normalize(position);
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			// The atlas land skin sits deliberately below roads and cities, but
			// still needs a stable depth advantage over the ocean sphere.
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -1,
		});
		const mesh = new Mesh(geometry, material);
		mesh.name = 'spherical-graph-continents';
		mesh.renderOrder = 0;
		this.group.add(mesh);
		this.landGeometry = geometry;
		this.landMaterial = material;
		this.landMesh = mesh;

		const coastGeometry = new BufferGeometry();
		const coastInk = data.reliefCoastPositions??data.coastInkPositions ?? data.coastPositions;
		coastGeometry.setAttribute(
			'position',
			new BufferAttribute(coastInk, 3),
		);
		coastGeometry.computeBoundingSphere();
		const coastLines = screenSpaceLine(coastInk, {
			color: this.theme.coast, widthPx: T.edges.coast.widthPx, opacity: T.edges.coast.opacity, surfaceInk: true,
		});
		const coastMaterial = coastLines.material;
		coastLines.name = 'spherical-graph-coastlines';
		coastLines.renderOrder = 2;
		this.group.add(coastLines);
		this.coastGeometry = coastGeometry;
		this.coastMaterial = coastMaterial;
		this.coastLines = coastLines;
		this.coastShadow = screenSpaceLine(coastInk, {
			color: T.colors.globe.coastShadow, widthPx: T.edges.coast.underlayWidthPx, opacity: T.edges.coast.underlayOpacity,
		});
		this.coastShadow.name = 'spherical-graph-coast-shadow'; this.coastShadow.renderOrder = 0.7;
		this.coastLines.renderOrder = 0.9; this.group.add(this.coastShadow);
		const borders=data.reliefBorderPositions??data.countryBorderPositions;
		if (borders !== undefined && borders.length > 0) {
			const borderGeometry = new BufferGeometry();
			borderGeometry.setAttribute('position', new BufferAttribute(borders, 3));
			borderGeometry.computeBoundingSphere();
			this.countryBorders = screenSpaceLine(borders, {
				color: T.colors.globe.countryBorder, widthPx: T.edges.countryBorder.widthPx,
				opacity: T.edges.countryBorder.opacity, dash: T.edges.countryBorder.dashPx,
			});
			borderGeometry.dispose();
			this.countryBorders.name = 'spherical-graph-country-borders';
			this.countryBorders.renderOrder = 0.6;
			this.countryBorderShadow = screenSpaceLine(borders, {
				color: T.colors.globe.countryBorderShadow, widthPx: T.edges.countryBorder.underlayWidthPx,
				opacity: T.edges.countryBorder.underlayOpacity,
			});
			this.countryBorderShadow.name = 'spherical-graph-country-border-shadow';
			this.countryBorderShadow.renderOrder = 0.4; this.group.add(this.countryBorderShadow);

			this.group.add(this.countryBorders);
		}
		if(data.coastalWallPositions?.length){
		 const wallGeometry=new BufferGeometry();wallGeometry.setAttribute('position',new BufferAttribute(data.coastalWallPositions,3));wallGeometry.computeBoundingSphere();
		 const wallMaterial=new ShaderMaterial({depthTest:true,depthWrite:true,side:DoubleSide,toneMapped:false,
		  uniforms:{sand:{value:new Color(this.theme.coast)},wallOpacity:{value:1}},
		  vertexShader:'varying vec3 wallPosition;varying float wallHeight;void main(){wallHeight=length(position)-10.0;wallPosition=(modelViewMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*vec4(wallPosition,1.0);}',
		  fragmentShader:`uniform vec3 sand;uniform float wallOpacity;varying vec3 wallPosition;varying float wallHeight;void main(){vec3 n=normalize(cross(dFdx(wallPosition),dFdy(wallPosition)));if(!gl_FrontFacing)n=-n;
		   float key=max(dot(n,normalize(${ATLAS_LIGHT_GLSL})),0.0);float contact=mix(0.54,1.0,smoothstep(0.005,0.055,wallHeight));gl_FragColor=vec4(sand*(0.30+key*0.80)*contact,wallOpacity);
		   #include <colorspace_fragment>
		  }`});
		 this.wallMesh=new Mesh(wallGeometry,wallMaterial);this.wallMesh.name='spherical-graph-coastal-walls';this.wallMesh.renderOrder=0.2;this.group.add(this.wallMesh);
		}
		this.recolorLand();
		this.updateLandVisibility();
		this.onInvalidate?.();
	}

	private recolorLand(): void {
		const data = this.landData;
		const attribute = this.landGeometry?.getAttribute('color');
		if (
			data === undefined ||
			attribute === undefined ||
			!(attribute instanceof BufferAttribute) ||
			this.theme.land.length === 0
		) {
			return;
		}
		const color = new Color(), shadow = new Color(), light = new Color();
		const indices=data.reliefColorIndices??data.colorIndices,shades=data.reliefShades??data.shades;
		for (let vertex = 0; vertex < indices.length; vertex += 1) {
			const colorIndex = indices[vertex] ?? 0;
			const shade = shades[vertex] ?? 1;
			color
				.set(this.theme.land[colorIndex % this.theme.land.length] ?? '#66725a')
				.multiplyScalar(shade);
			attribute.setXYZ(vertex, color.r, color.g, color.b);
			const family = T.land[colorIndex % T.land.length] ?? T.land[0]!;
			shadow.set(family.shadow).multiplyScalar(shade);
			light.set(family.highlight).multiplyScalar(shade);
			this.landGeometry?.getAttribute('shadeColor').setXYZ(vertex, shadow.r, shadow.g, shadow.b);
			this.landGeometry?.getAttribute('lightColor').setXYZ(vertex, light.r, light.g, light.b);
			for(const name of ['mineralA','mineralB','mineralC'] as const){color.set(family[name]).multiplyScalar(shade);this.landGeometry?.getAttribute(`${name}Color`).setXYZ(vertex,color.r,color.g,color.b);}
		}
		attribute.needsUpdate = true;
		for (const name of ['shadeColor', 'lightColor','mineralAColor','mineralBColor','mineralCColor']) {
			const values = this.landGeometry?.getAttribute(name);
			if (values) values.needsUpdate = true;
		}
		if (this.coastMaterial?.uniforms.lineColor) (this.coastMaterial.uniforms.lineColor.value as Color).set(this.theme.coast);
		if (this.coastMaterial !== undefined) {
			this.coastMaterial.needsUpdate = true;
		}
		if (
			this.beachMaterial?.uniforms.beachColor !== undefined
		) {
			(
				this.beachMaterial.uniforms.beachColor.value as Color
			).set(this.theme.coast);
			this.beachMaterial.needsUpdate = true;
		}
	}

	private updateLandVisibility(): void {
		const visible =
			this.appearance.surfaceMode !== 'hidden' &&
			this.appearance.showContinents;
		if (this.countryBorders !== undefined) this.countryBorders.visible = visible && this.appearance.showCountryBorders;
		if (this.countryBorderShadow) this.countryBorderShadow.visible = visible && this.appearance.showCountryBorders;
		if (this.coastShadow) this.coastShadow.visible = visible;
		if(this.wallMesh){this.wallMesh.visible=visible;this.wallMesh.material.transparent=this.appearance.surfaceMode==='transparent';this.wallMesh.material.uniforms.wallOpacity!.value=this.appearance.surfaceMode==='transparent'?.3:1;this.wallMesh.material.depthWrite=this.appearance.surfaceMode!=='transparent';}
		if (this.landMesh !== undefined && this.landMaterial !== undefined) {
			this.landMesh.visible = visible;
			this.landMaterial.transparent =
				this.appearance.surfaceMode === 'transparent';
			if (this.landMaterial.uniforms.landOpacity !== undefined) {
				this.landMaterial.uniforms.landOpacity.value =
					this.appearance.surfaceMode === 'transparent' ? 0.58 : 1;
			}
			this.landMaterial.depthWrite =
				this.appearance.surfaceMode !== 'transparent';
			this.landMaterial.needsUpdate = true;
		}
		if (
			this.beachMesh !== undefined &&
			this.beachMaterial !== undefined
		) {
			this.beachMesh.visible = visible;
			this.beachMaterial.transparent = this.appearance.surfaceMode === 'transparent';
			if (this.beachMaterial.uniforms.beachOpacity !== undefined) {
				this.beachMaterial.uniforms.beachOpacity.value =
					this.appearance.surfaceMode === 'transparent' ? 0.08 : 1;
			}
			this.beachMaterial.depthWrite = this.appearance.surfaceMode !== 'transparent';
			this.beachMaterial.needsUpdate = true;
		}
		if (
			this.coastLines !== undefined &&
			this.coastMaterial !== undefined
		) {
			this.coastLines.visible = visible;
			this.coastMaterial.uniforms.lineOpacity!.value =
				this.appearance.surfaceMode === 'transparent' ? 0.4 : T.edges.coast.opacity;
			this.coastMaterial.needsUpdate = true;
		}
	}

	private removeLand(): void {
		this.landOcclusion=undefined;
		if(this.wallMesh){this.group.remove(this.wallMesh);this.wallMesh.geometry.dispose();this.wallMesh.material.dispose();this.wallMesh=undefined;}
		for (const mesh of [this.coastShadow, this.countryBorderShadow]) {
			if (mesh) { this.group.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
		}
		this.coastShadow = this.countryBorderShadow = undefined;
		if (this.countryBorders !== undefined) {
			this.group.remove(this.countryBorders);
			this.countryBorders.geometry.dispose();
			this.countryBorders.material.dispose();
			this.countryBorders = undefined;
		}
		if (this.landMesh !== undefined) {
			this.group.remove(this.landMesh);
		}
		if (this.coastLines !== undefined) {
			this.group.remove(this.coastLines);
		}
		if (this.beachMesh !== undefined) {
			this.group.remove(this.beachMesh);
		}
		this.landGeometry?.dispose();
		this.landMaterial?.dispose();
		this.beachGeometry?.dispose();
		this.beachMaterial?.dispose();
		this.coastGeometry?.dispose();
		this.coastLines?.geometry.dispose();
		this.coastMaterial?.dispose();
		this.landData = undefined;
		this.landGeometry = undefined;
		this.landMaterial = undefined;
		this.landMesh = undefined;
		this.beachGeometry = undefined;
		this.beachMaterial = undefined;
		this.beachMesh = undefined;
		this.coastGeometry = undefined;
		this.coastMaterial = undefined;
		this.coastLines = undefined;
	}
}

/** Bounds continent work for large vaults while keeping small maps detailed. */
export function adaptiveLandDetail(nodeCount: number, edgeCount: number): number {
	const load = Math.max(nodeCount, edgeCount / 4);
	if (load <= 500) {
		return 48;
	}
	if (load <= 1_500) {
		return 32;
	}
	if (load <= 3_000) {
		return 24;
	}
	return 16;
}

function createGridGeometry(radius: number): BufferGeometry {
	const positions: number[] = [];
	const segments = 256;
	const addSegment = (
		start: readonly [number, number, number],
		end: readonly [number, number, number],
	): void => {
		positions.push(...start, ...end);
	};

	for (let latitudeIndex = -5; latitudeIndex <= 5; latitudeIndex += 1) {
		const latitude = (latitudeIndex / 6) * (Math.PI / 2);
		const y = radius * Math.sin(latitude);
		const ringRadius = radius * Math.cos(latitude);
		for (let segment = 0; segment < segments; segment += 1) {
			const startAngle = (segment / segments) * Math.PI * 2;
			const endAngle = ((segment + 1) / segments) * Math.PI * 2;
			addSegment(
				[
					ringRadius * Math.cos(startAngle),
					y,
					ringRadius * Math.sin(startAngle),
				],
				[
					ringRadius * Math.cos(endAngle),
					y,
					ringRadius * Math.sin(endAngle),
				],
			);
		}
	}

	for (let longitudeIndex = 0; longitudeIndex < 18; longitudeIndex += 1) {
		const longitude = (longitudeIndex / 18) * Math.PI * 2;
		for (let segment = 0; segment < segments / 2; segment += 1) {
			const startPolar = (segment / (segments / 2)) * Math.PI;
			const endPolar = ((segment + 1) / (segments / 2)) * Math.PI;
			addSegment(
				pointOnSphere(radius, startPolar, longitude),
				pointOnSphere(radius, endPolar, longitude),
			);
		}
	}

	const geometry = new BufferGeometry();
	geometry.setAttribute(
		'position',
		new BufferAttribute(new Float32Array(positions), 3),
	);
	geometry.computeBoundingSphere();
	return geometry;
}

function pointOnSphere(
	radius: number,
	polar: number,
	longitude: number,
): [number, number, number] {
	const ringRadius = radius * Math.sin(polar);
	return [
		ringRadius * Math.cos(longitude),
		radius * Math.cos(polar),
		ringRadius * Math.sin(longitude),
	];
}
