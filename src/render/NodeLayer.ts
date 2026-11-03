import {
 Color, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh,
 Matrix4, PerspectiveCamera, PlaneGeometry, Quaternion, ShaderMaterial, Sphere, Vector3,
} from 'three';
import { NODE_SURFACE_LIFT, SPHERE_RADIUS } from '../constants';
import { nodeMarkerScaleForGlobe } from '../geometry/nodeMarkerMetrics';
import { AppearanceSettings } from '../settings/settings';
import { CARTOGRAPHY as T, cityState, pixelsPerWorldUnit, updateLineViewport } from './cartography';
import { cityMaterial } from './cityMaterial';
import { surfaceRadius } from './terrainSurface';
import { isSearchMatch, SEARCH_HIGHLIGHT_COLOR } from './searchHighlight';
import { DEFAULT_RENDER_FILTERS, isRenderNodeVisible, renderNodeKind, type RenderFilterState } from './renderFilters';
import { PreparedRenderSnapshot, RenderNode, RenderRouteState, RenderSelectionState, RenderTheme } from './renderTypes';

type CityMesh = InstancedMesh<PlaneGeometry, ShaderMaterial>;

export class NodeLayer {
 private meshValue: CityMesh | undefined;
 private glowMesh: CityMesh | undefined;
 private highlightMesh: CityMesh | undefined;
 private searchHighlightMesh: CityMesh | undefined;
 private snapshot: PreparedRenderSnapshot | undefined;
 private nodesByInstance: readonly RenderNode[] = [];
 private selection: RenderSelectionState = {};
 private route: RenderRouteState | undefined;
 private routeNodeIds = new Set<string>();
 private searchPaths: ReadonlySet<string> = new Set();
 private filters: RenderFilterState = DEFAULT_RENDER_FILTERS;
 private pixelScale = 1;
 private worldPerPixel = 0.05;
 private phone = false;
 private readonly matrix = new Matrix4();
 private readonly position = new Vector3();
 private readonly scale = new Vector3();
 private readonly rotation = new Quaternion();
 private readonly color = new Color();
 private readonly normal = new Vector3(0, 0, 1);
 private pickCamera: PerspectiveCamera | undefined;
 private readonly viewPosition = new Vector3();
 private readonly cameraDirection = new Vector3();
 private cameraDistance = 32;
 private proxyWorldPerPixel = 0.05;
 private metrics = '';
 private transitionPending = false;
 private transitionStart: number | undefined;
 private transitionDuration = T.motion.selectionMs;

 constructor(private readonly group: Group, private appearance: AppearanceSettings, private theme: RenderTheme) {}
 get mesh(): InstancedMesh | undefined { return this.meshValue; }

 setSnapshot(snapshot: PreparedRenderSnapshot): void {
  this.removeMesh();
  this.snapshot = snapshot;
  this.nodesByInstance = [...snapshot.nodes].sort((a, b) => a.index - b.index);
  this.meshValue = this.makeMesh('spherical-graph-nodes', 'core', 4);
  this.glowMesh = this.makeMesh('spherical-graph-node-glow', 'halo', 2);
  this.highlightMesh = this.makeMesh('spherical-graph-node-highlights', 'ring', 5);
  this.searchHighlightMesh = this.makeMesh('spherical-graph-search-node-highlights', 'ring', 6);
  this.updateInstances();
 }

 private makeMesh(name: string, mode: 'core' | 'halo' | 'ring', order: number): CityMesh {
  const capacity = Math.max(1, this.nodesByInstance.length);
  const geometry = new PlaneGeometry(2, 2);
  geometry.setAttribute('previousStyle', new InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
  geometry.setAttribute('cityStyle', new InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
  const mesh = new InstancedMesh(geometry, cityMaterial(mode), capacity);
  // Allocate even for an initially empty ring layer, so Three compiles the
  // instanced-colour shader variant before the first selection or hover.
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
  mesh.instanceColor.setUsage(DynamicDrawUsage);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.boundingSphere = new Sphere(new Vector3(), SPHERE_RADIUS + NODE_SURFACE_LIFT + 2);
  mesh.name = name; mesh.renderOrder = order; mesh.frustumCulled = false;
  this.group.add(mesh);
  return mesh;
 }

 render(camera: PerspectiveCamera, width: number, height: number, phone = false, timestamp = 0, reducedMotion = false): boolean {
  camera.updateMatrixWorld(); this.pickCamera = camera;
  this.cameraDistance=camera.position.length();this.cameraDirection.copy(camera.position).normalize();
  const ppu = pixelsPerWorldUnit(camera, height);
  const scale = Math.max(0.70, Math.min(1.60, 2 * SPHERE_RADIUS * ppu / T.reference.globeDiameterCssPx));
  const key = [width, height, ppu.toFixed(4), ...camera.quaternion.toArray().map(v => v.toFixed(4)), phone].join(':');
  if (this.metrics !== key) {
   this.metrics = key; this.pixelScale = scale; this.worldPerPixel = 1 / Math.max(ppu, 0.001); this.phone = phone;
   this.updateInstances();
  }
  for (const mesh of this.meshes()) updateLineViewport(mesh.material, width, height);
  if (this.transitionPending && this.transitionStart === undefined) this.transitionStart = timestamp;
  const progress = reducedMotion || this.transitionStart === undefined ? 1 : Math.min(1, Math.max(0, (timestamp - this.transitionStart) / this.transitionDuration));
  const eased = 1 - Math.pow(1 - progress, 3);
  for (const mesh of [this.meshValue, this.glowMesh]) if (mesh) mesh.material.uniforms.transition!.value = eased;
  this.transitionPending = progress < 1;
  if (!this.transitionPending) this.transitionStart = undefined;
  return this.transitionPending;
 }

 updateAppearance(appearance: AppearanceSettings): void { this.appearance = appearance; this.updateInstances(); }
 updateFilters(filters: RenderFilterState): void { this.filters = { ...filters }; this.updateInstances(); }
 updateTheme(theme: RenderTheme): void { this.theme = theme; this.updateInstances(); }
 updateSelection(selection: RenderSelectionState): void {
  if (selection.selectedNodeId === this.selection.selectedNodeId && selection.activeNodeId === this.selection.activeNodeId && selection.hoveredNodeId === this.selection.hoveredNodeId) return;
  const hoverOnly = selection.selectedNodeId === this.selection.selectedNodeId && selection.activeNodeId === this.selection.activeNodeId;
  this.animateChange(() => { this.selection = { ...selection }; }, hoverOnly ? T.motion.hoverMs : T.motion.selectionMs);
 }
 updateRoute(route: RenderRouteState | undefined): void {
  this.route = route === undefined ? undefined : { ...route, nodeIds: [...route.nodeIds], edges: [...route.edges] };
  this.animateChange(() => { this.routeNodeIds = new Set(route?.nodeIds ?? []); });
 }
 updateSearch(paths: ReadonlySet<string>): void { this.animateChange(() => { this.searchPaths = new Set(paths); }); }
 nodeForInstance(instanceId: number): RenderNode | undefined {
  const node = this.nodesByInstance[instanceId];
  return node && isRenderNodeVisible(node, this.filters) ? node : undefined;
 }
 positionForNode(nodeId: string, target: Vector3): Vector3 | undefined {
  const node = this.snapshot?.nodeById.get(nodeId);
  if (!node || !this.snapshot || !isRenderNodeVisible(node, this.filters)) return undefined;
  target.fromArray(this.snapshot.positions,node.index*3).normalize();return target.multiplyScalar(surfaceRadius(this.snapshot,this.appearance,[target.x,target.y,target.z],NODE_SURFACE_LIFT));
 }

 private animateChange(change: () => void, duration = T.motion.selectionMs): void {
  const layers = [this.meshValue, this.glowMesh].filter((mesh): mesh is CityMesh => mesh !== undefined);
  const before = layers.map(mesh => {
   const target = mesh.geometry.getAttribute('cityStyle').array;
   const previous = mesh.geometry.getAttribute('previousStyle').array;
   const mix = Number(mesh.material.uniforms.transition!.value);
   return Float32Array.from(target, (value, i) => (previous[i] ?? value) * (1 - mix) + value * mix);
  });
  change(); this.updateInstances();
  layers.forEach((mesh,i) => {
   const previous = mesh.geometry.getAttribute('previousStyle') as InstancedBufferAttribute;
   previous.array.set(before[i] ?? []); previous.needsUpdate = true;
   mesh.material.uniforms.transition!.value = 0;
  });
  this.transitionPending = layers.length > 0; this.transitionStart = undefined; this.transitionDuration = duration;
 }

 private write(mesh: CityMesh, index: number, radiusPx: number, color: string, second = 1, kind = 0, emphasis = 0): void {
  // Actual proxy geometry stays in world space for ray casting. The shader
  // expands the same committed centre in CSS pixels, without writing positions.
  this.scale.setScalar(radiusPx * this.proxyWorldPerPixel);
  this.matrix.compose(this.position, this.rotation, this.scale);
  mesh.setMatrixAt(index, this.matrix);
  mesh.setColorAt(index, this.color.set(color));
  (mesh.geometry.getAttribute('cityStyle') as InstancedBufferAttribute).setXYZW(index, radiusPx, second, kind, emphasis);
 }

 private updateInstances(): void {
  const snapshot = this.snapshot, core = this.meshValue, glow = this.glowMesh, rings = this.highlightMesh, searchRings = this.searchHighlightMesh;
  if (!snapshot || !core || !glow || !rings || !searchRings) return;
  const selected = snapshot.nodeById.get(this.selection.selectedNodeId ?? '');
  const neighbors = selected ? snapshot.neighborsByIndex.get(selected.index) : undefined;
  const region = selected ? snapshot.directoryRegionByNodeId.get(selected.id) : undefined;
  let ringCount = 0, searchCount = 0;
  for (let i = 0; i < this.nodesByInstance.length; i++) {
   const node = this.nodesByInstance[i];
   if (!node) continue;
   const visible = isRenderNodeVisible(node, this.filters);
   this.position.fromArray(snapshot.positions,node.index*3).normalize();this.position.multiplyScalar(surfaceRadius(snapshot,this.appearance,[this.position.x,this.position.y,this.position.z],NODE_SURFACE_LIFT));
   if (this.pickCamera) {
    this.rotation.copy(this.pickCamera.quaternion);
    const depth = -this.viewPosition.copy(this.position).applyMatrix4(this.pickCamera.matrixWorldInverse).z;
    this.proxyWorldPerPixel = this.worldPerPixel * Math.max(0.01, depth) / this.pickCamera.position.length();
   } else {
    this.rotation.setFromUnitVectors(this.normal, this.position.clone().normalize());
    this.proxyWorldPerPixel = this.worldPerPixel;
   }
   const flags = {
    selected: node.id === this.selection.selectedNodeId,
    routeStart: node.id === this.route?.startNodeId, routeEnd: node.id === this.route?.endNodeId,
    route: this.routeNodeIds.has(node.id), search: isSearchMatch(node, this.searchPaths),
    active: node.id === this.selection.activeNodeId, neighbor: neighbors?.has(node.index) ?? false,
    directoryPeer: region !== undefined && snapshot.directoryRegionByNodeId.get(node.id) === region,
   };
   const hovered = node.id === this.selection.hoveredNodeId;
   const state = cityState(flags), style = T.node.states[state];
   const hover = T.node.states.hovered;
   const degree = this.appearance.sizeNodesByDegree ? Math.min(T.node.degreeGainCap, T.node.degreeGain * Math.log2(Math.max(0, node.degree) + 1)) : 0;
   const size = T.node.baseDiameterPx * (1 + degree) * this.pixelScale * 100 / this.appearance.globeSize;
   const diameter = visible ? Math.max(style.minDiameterPx, hovered ? hover.minDiameterPx : 0, size * Math.max(style.coreScale, hovered ? hover.coreScale : 0)) : 0;
   const kind = renderNodeKind(node), kindIndex = kind === 'attachment' ? 1 : kind === 'unresolved' ? 2 : 0;
   const base = kindIndex === 1 ? this.theme.nodeAttachment : kindIndex === 2 ? this.theme.nodeUnresolved : this.theme.node;
   const color = flags.selected ? this.theme.nodeSelected : flags.routeStart ? this.theme.nodeRouteStart : flags.routeEnd ? this.theme.nodeRouteEnd
    : flags.route ? this.theme.nodeRoute : flags.search ? SEARCH_HIGHLIGHT_COLOR : flags.active ? this.theme.nodeActive
    : flags.neighbor ? this.theme.nodeNeighbor : flags.directoryPeer ? this.theme.nodeDirectoryPeer : base;
   let limbOpacity=1;
   if(this.pickCamera&&!hovered&&(state==='normal'||state==='directoryPeer')){
    const facing=this.position.dot(this.cameraDirection)/(SPHERE_RADIUS+NODE_SURFACE_LIFT);
    const t=Math.max(0,Math.min(1,(facing-SPHERE_RADIUS/this.cameraDistance-.015)/.25));
    limbOpacity=.55+.45*t*t*(3-2*t);
   }
   this.write(core, i, diameter / 2, color, style.coreOpacity*limbOpacity, kindIndex, flags.selected ? 1 : 0);
   const intensity = Math.max(style.haloPeakOpacity, hovered ? hover.haloPeakOpacity : 0);
   const haloPx = Math.max(style.haloDiameterPx, hovered ? hover.haloDiameterPx : 0) * this.pixelScale;
   const normalHalo = state === 'normal' || state === 'directoryPeer' || state === 'neighbor';
   this.write(glow, i, visible && kindIndex === 0 ? haloPx / 2 : 0,
    flags.search && state === 'search' ? T.colors.node.searchHalo : color,
    this.phone ? normalHalo ? 0 : intensity * T.performance.phoneHighlightHaloOpacityMultiplier : intensity*limbOpacity);
   const semanticRing = style.ringWidthPx > 0 && state !== 'search';
   const ringWidth = semanticRing ? style.ringWidthPx : hovered ? hover.ringWidthPx : 0;
   const gap = 'ringGapPx' in style ? style.ringGapPx : hover.ringGapPx;
   let outer = diameter / 2;
   if (visible && ringWidth > 0) {
    outer += gap + ringWidth + (hovered ? 0.5 : 0);
    this.write(rings, ringCount++, outer, semanticRing ? color : T.colors.node.hover, ringWidth,0,flags.selected?1:0);
   }
   if (visible && flags.search) {
    outer += 2 + T.node.states.search.ringWidthPx;
    this.write(searchRings, searchCount++, outer, SEARCH_HIGHLIGHT_COLOR, T.node.states.search.ringWidthPx, 1);
   }
  }
  core.count = glow.count = this.nodesByInstance.length; rings.count = ringCount; searchRings.count = searchCount;
  for (const mesh of this.meshes()) {
   mesh.instanceMatrix.needsUpdate = true;
   if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
   (mesh.geometry.getAttribute('cityStyle') as InstancedBufferAttribute).needsUpdate = true;

  }
 }

 private meshes(): CityMesh[] {
  return [this.meshValue, this.glowMesh, this.highlightMesh, this.searchHighlightMesh].filter((mesh): mesh is CityMesh => mesh !== undefined);
 }
 private removeMesh(): void {
  for (const mesh of this.meshes()) { this.group.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
  this.meshValue = this.glowMesh = this.highlightMesh = this.searchHighlightMesh = undefined;
 }
 dispose(): void {
  this.removeMesh(); this.snapshot = undefined; this.nodesByInstance = [];
  this.route = undefined; this.routeNodeIds.clear(); this.searchPaths = new Set();
 }
}
export { nodeMarkerScaleForGlobe };
