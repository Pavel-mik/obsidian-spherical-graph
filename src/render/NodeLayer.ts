import {
 Color, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh,
 Matrix4, PerspectiveCamera, PlaneGeometry, Quaternion, ShaderMaterial, Sphere, Vector3,
} from 'three';
import { NODE_SURFACE_LIFT, SPHERE_RADIUS } from '../constants';
import { nodeMarkerScaleForGlobe } from '../geometry/nodeMarkerMetrics';
import { AppearanceSettings } from '../settings/settings';
import { CARTOGRAPHY as T, cityState, pixelsPerWorldUnit, updateLineViewport } from './cartography';
import { NodePickIndex } from './NodePickIndex';
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
 private centers = new Float32Array();
 private picks?: NodePickIndex;
 private readonly byId = new Map<string, number>();
 private readonly ringSlots = new Map<number, number>();
 private readonly searchSlots = new Map<number, number>();
 private readonly ringNodes: number[] = [];
 private readonly searchNodes: number[] = [];
 private maxPickRadius = 0;
 private width = 1;
 private height = 1;
 private animated = new Set<number>();
 private transitionPending = false;
 private transitionStart: number | undefined;
 private transitionDuration = T.motion.selectionMs;

 constructor(private readonly group: Group, private appearance: AppearanceSettings, private theme: RenderTheme) {}
 get mesh(): InstancedMesh | undefined { return this.meshValue; }

 setSnapshot(snapshot: PreparedRenderSnapshot): void {
  this.removeMesh();
  this.animated.clear();
  this.transitionPending = false; this.transitionStart = undefined;
  this.snapshot = snapshot;
  this.nodesByInstance = [...snapshot.nodes].sort((a, b) => a.index - b.index);
  this.meshValue = this.makeMesh('spherical-graph-nodes', 'core', 4);
  this.glowMesh = this.makeMesh('spherical-graph-node-glow', 'halo', 2);
  this.highlightMesh = this.makeMesh('spherical-graph-node-highlights', 'ring', 5);
  this.searchHighlightMesh = this.makeMesh('spherical-graph-search-node-highlights', 'ring', 6);
  this.byId.clear();
  this.nodesByInstance.forEach((node, i) => this.byId.set(node.id, i));
  this.cacheCenters();
  const mesh = this.meshValue;
  mesh.raycast = (caster, hits) => this.picks?.hits(caster, mesh, this.width, this.height, this.maxPickRadius, this.pixelScale, hits);
  this.updateInstances();
 }

 private cacheCenters(): void {
  if (!this.snapshot) return;
  this.centers = new Float32Array(this.nodesByInstance.length * 3);
  this.nodesByInstance.forEach((node, i) => {
   this.position.fromArray(this.snapshot!.positions, node.index * 3).normalize();
   this.position.multiplyScalar(surfaceRadius(this.snapshot!, this.appearance, [this.position.x,this.position.y,this.position.z], NODE_SURFACE_LIFT)).toArray(this.centers, i*3);
  });
  this.picks = new NodePickIndex(this.centers);
 }

 private makeMesh(name: string, mode: 'core' | 'halo' | 'ring', order: number): CityMesh {
  const capacity = Math.max(1, this.nodesByInstance.length);
  const geometry = new PlaneGeometry(2, 2);
  geometry.setAttribute('previousStyle', new InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
  geometry.setAttribute('cityStyle', new InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
  geometry.setAttribute('radiusRule', new InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
  geometry.setAttribute('limbFade', new InstancedBufferAttribute(new Float32Array(capacity), 1));
  const mesh = new InstancedMesh(geometry, cityMaterial(mode, mode !== 'ring', true), capacity);
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
  camera.updateMatrixWorld(); this.width = width; this.height = height;
  const ppu = pixelsPerWorldUnit(camera, height);
  const scale = Math.max(0.70, Math.min(1.60, 2 * SPHERE_RADIUS * ppu / T.reference.globeDiameterCssPx));
  this.pixelScale = scale;
  this.worldPerPixel = 1 / Math.max(ppu,0.001);
  if (this.phone !== phone) { this.phone=phone; this.updateInstances(); }
  for (const mesh of this.meshes()) {
   updateLineViewport(mesh.material, width, height);
   mesh.material.uniforms.markerScale!.value = scale;
  }
  if (this.transitionPending && this.transitionStart === undefined) this.transitionStart = timestamp;
  const progress = reducedMotion || this.transitionStart === undefined ? 1 : Math.min(1, Math.max(0, (timestamp - this.transitionStart) / this.transitionDuration));
  const eased = 1 - Math.pow(1 - progress, 3);
  for (const mesh of [this.meshValue, this.glowMesh]) if (mesh) mesh.material.uniforms.transition!.value = eased;
  this.transitionPending = progress < 1;
  if (!this.transitionPending) this.transitionStart = undefined;
  return this.transitionPending;
 }

 updateAppearance(appearance: AppearanceSettings): void {
  const terrainChanged = this.appearance.mapStyle !== appearance.mapStyle || this.appearance.surfaceMode !== appearance.surfaceMode || this.appearance.showContinents !== appearance.showContinents;
  this.appearance = appearance;
  if (terrainChanged) this.cacheCenters();
  this.updateInstances();
 }
 updateFilters(filters: RenderFilterState): void { this.filters = { ...filters }; this.updateInstances(); }
 updateTheme(theme: RenderTheme): void { this.theme = theme; this.updateInstances(); }
 updateSelection(selection: RenderSelectionState): void {
  if (selection.selectedNodeId === this.selection.selectedNodeId && selection.activeNodeId === this.selection.activeNodeId && selection.hoveredNodeId === this.selection.hoveredNodeId) return;
  const hoverOnly = selection.selectedNodeId === this.selection.selectedNodeId && selection.activeNodeId === this.selection.activeNodeId;
  if (hoverOnly) {
   const ids = [this.selection.hoveredNodeId, selection.hoveredNodeId];
   const affected = new Set(ids.flatMap(id => id && this.byId.has(id) ? [this.byId.get(id)!] : []));
   this.selection = { ...selection };
   this.updateHoverInstances(affected);
   return;
  }
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
  return target.fromArray(this.centers, this.byId.get(nodeId)! * 3);
 }

 private animateChange(change: () => void, duration = T.motion.selectionMs): void {
  const layers = [this.meshValue, this.glowMesh].filter((mesh): mesh is CityMesh => mesh !== undefined);
  const before = layers.map(mesh => {
   const target = mesh.geometry.getAttribute('cityStyle').array;
   const previous = mesh.geometry.getAttribute('previousStyle').array;
   const mix = Number(mesh.material.uniforms.transition!.value);
   return Float32Array.from(target, (value, i) => (previous[i] ?? value) * (1 - mix) + value * mix);
  });
  this.animated = new Set(this.nodesByInstance.keys());
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
  this.scale.setScalar(radiusPx * this.worldPerPixel);
  this.matrix.compose(this.position, this.rotation, this.scale);
  mesh.setMatrixAt(index, this.matrix);
  mesh.setColorAt(index, this.color.set(color));
  (mesh.geometry.getAttribute('cityStyle') as InstancedBufferAttribute).setXYZW(index, radiusPx, second, kind, emphasis);
 }

 private updateHoverInstances(affected: Set<number>): void {
  const layers = [this.meshValue, this.glowMesh].filter((mesh): mesh is CityMesh => !!mesh);
  // Complete an interrupted local transition at its current value before changing targets.
  const changed = new Set([...this.animated, ...affected]);
  for (const mesh of layers) {
   const current = mesh.geometry.getAttribute('cityStyle'), previous = mesh.geometry.getAttribute('previousStyle') as InstancedBufferAttribute;
   const t = Number(mesh.material.uniforms.transition!.value);
   for (const i of changed) {
    for (let k=0;k<4;k++) {
     const offset=i*4+k;
     previous.array[offset] = affected.has(i) ? previous.array[offset]!*(1-t)+current.array[offset]!*t : current.array[offset]!;
    }
    previous.addUpdateRange(i*4,4);
   }
   previous.needsUpdate = true;
   mesh.material.uniforms.transition!.value = 0;
  }
  this.updateInstances(affected);
  this.animated = affected; this.transitionPending = true; this.transitionStart = undefined; this.transitionDuration = T.motion.hoverMs;
 }

 private ringSlot(mesh: CityMesh, node: number, visible: boolean, slots: Map<number,number>, nodes: number[]): number | undefined {
  const slot = slots.get(node);
  if (visible) {
   if (slot !== undefined) return slot;
   slots.set(node,nodes.length); nodes.push(node); return nodes.length-1;
  }
  if (slot === undefined) return;
  const lastIndex = nodes.length-1, last = nodes.pop()!;
  if (slot !== lastIndex) {
   nodes[slot]=last; slots.set(last,slot);
   for (const attr of [mesh.instanceMatrix, mesh.instanceColor!, mesh.geometry.getAttribute('cityStyle') as InstancedBufferAttribute, mesh.geometry.getAttribute('radiusRule') as InstancedBufferAttribute]) {
    const size=attr.itemSize; attr.array.copyWithin(slot*size,lastIndex*size,(lastIndex+1)*size); attr.addUpdateRange(slot*size,size); attr.needsUpdate=true;
   }
  }
  slots.delete(node);
  return undefined;
 }

 private updateInstances(changed?: ReadonlySet<number>): void {
  const snapshot = this.snapshot, core = this.meshValue, glow = this.glowMesh, rings = this.highlightMesh, searchRings = this.searchHighlightMesh;
  if (!snapshot || !core || !glow || !rings || !searchRings) return;
  const selected = snapshot.nodeById.get(this.selection.selectedNodeId ?? '');
  const neighbors = selected ? snapshot.neighborsByIndex.get(selected.index) : undefined;
  const region = selected ? snapshot.directoryRegionByNodeId.get(selected.id) : undefined;
  if (!changed) {
   this.ringSlots.clear(); this.searchSlots.clear(); this.ringNodes.length = this.searchNodes.length = 0; this.maxPickRadius = 0;
  }
  for (const i of changed ?? this.nodesByInstance.keys()) {
   const node = this.nodesByInstance[i];
   if (!node) continue;
   const visible = isRenderNodeVisible(node, this.filters);
   this.position.fromArray(this.centers,i*3);
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
   const size = T.node.baseDiameterPx * (1 + degree) * 100 / this.appearance.globeSize;
   const minimum = visible ? Math.max(style.minDiameterPx, hovered ? hover.minDiameterPx : 0) / 2 : 0;
   const proportional = visible ? size * Math.max(style.coreScale, hovered ? hover.coreScale : 0) / 2 : 0;
   const diameter = 2 * Math.max(minimum, proportional);
   const setRadius = (mesh: CityMesh, slot: number, min: number, base: number, extra = 0): void => {
    (mesh.geometry.getAttribute('radiusRule') as InstancedBufferAttribute).setXYZ(slot,min,base,extra);
   };
   setRadius(core,i,minimum,proportional);
   const kind = renderNodeKind(node), kindIndex = kind === 'attachment' ? 1 : kind === 'unresolved' ? 2 : 0;
   const base = kindIndex === 1 ? this.theme.nodeAttachment : kindIndex === 2 ? this.theme.nodeUnresolved : this.theme.node;
   const color = flags.selected ? this.theme.nodeSelected : flags.routeStart ? this.theme.nodeRouteStart : flags.routeEnd ? this.theme.nodeRouteEnd
    : flags.route ? this.theme.nodeRoute : flags.search ? SEARCH_HIGHLIGHT_COLOR : flags.active ? this.theme.nodeActive
    : flags.neighbor ? this.theme.nodeNeighbor : flags.directoryPeer ? this.theme.nodeDirectoryPeer : base;
   const fade = !hovered && (state === 'normal' || state === 'directoryPeer') ? 1 : 0;
   this.maxPickRadius = Math.max(this.maxPickRadius, minimum, proportional * 1.60);
   for (const mesh of [core,glow]) (mesh.geometry.getAttribute('limbFade') as InstancedBufferAttribute).setX(i,fade);
   this.write(core, i, diameter / 2, color, style.coreOpacity, kindIndex, flags.selected ? 1 : 0);
   const intensity = Math.max(style.haloPeakOpacity, hovered ? hover.haloPeakOpacity : 0);
   const haloPx = Math.max(style.haloDiameterPx, hovered ? hover.haloDiameterPx : 0);
   const normalHalo = state === 'normal' || state === 'directoryPeer' || state === 'neighbor';
   const haloRadius = visible && kindIndex === 0 && !(normalHalo && !hovered && this.appearance.mapStyle === 'atlas') ? haloPx / 2 : 0;
   setRadius(glow,i,0,haloRadius);
   this.write(glow, i, haloRadius,
    flags.search && state === 'search' ? T.colors.node.searchHalo : color,
    this.phone ? normalHalo ? 0 : intensity * T.performance.phoneHighlightHaloOpacityMultiplier : intensity);
   const semanticRing = style.ringWidthPx > 0 && state !== 'search';
   const ringWidth = semanticRing ? style.ringWidthPx : hovered ? hover.ringWidthPx : 0;
   const gap = 'ringGapPx' in style ? style.ringGapPx : hover.ringGapPx;
   let outer = diameter / 2;
   const ringSlot = this.ringSlot(rings, i, visible && ringWidth > 0, this.ringSlots, this.ringNodes);
   if (ringSlot !== undefined) {
    outer += gap + ringWidth + (hovered ? 0.5 : 0);
    setRadius(rings,ringSlot,minimum,proportional,outer-diameter/2);
    this.write(rings, ringSlot, outer, semanticRing ? color : T.colors.node.hover, ringWidth,0,flags.selected?1:0);
   }
   const searchSlot = this.ringSlot(searchRings,i,visible && flags.search,this.searchSlots,this.searchNodes);
   if (searchSlot !== undefined) {
    outer += 2 + T.node.states.search.ringWidthPx;
    setRadius(searchRings,searchSlot,minimum,proportional,outer-diameter/2);
    this.write(searchRings, searchSlot, outer, SEARCH_HIGHLIGHT_COLOR, T.node.states.search.ringWidthPx, 1);
   }
   if (changed) {
    for (const [mesh,slot] of [[core,i],[glow,i],[rings,ringSlot],[searchRings,searchSlot]] as const) {
     if (slot === undefined) continue;
     for (const attr of [mesh.instanceMatrix,mesh.instanceColor!,mesh.geometry.getAttribute('cityStyle') as InstancedBufferAttribute,mesh.geometry.getAttribute('limbFade') as InstancedBufferAttribute,mesh.geometry.getAttribute('radiusRule') as InstancedBufferAttribute]) attr.addUpdateRange(slot*attr.itemSize,attr.itemSize);
    }
   }
  }
  core.count = glow.count = this.nodesByInstance.length;
  rings.count = this.ringNodes.length; searchRings.count = this.searchNodes.length;
  if (!changed) {
   for (const mesh of [core,glow]) {
    const previous = mesh.geometry.getAttribute('previousStyle') as InstancedBufferAttribute;
    previous.array.set(mesh.geometry.getAttribute('cityStyle').array); previous.clearUpdateRanges(); previous.needsUpdate = true;
   }
  }
  glow.visible = this.appearance.mapStyle === 'living' || this.searchPaths.size > 0 || !!this.route || !!this.selection.selectedNodeId || !!this.selection.activeNodeId || !!this.selection.hoveredNodeId;
  for (const mesh of this.meshes()) {
   for (const attr of [mesh.instanceMatrix,mesh.instanceColor!,mesh.geometry.getAttribute('cityStyle') as InstancedBufferAttribute,mesh.geometry.getAttribute('limbFade') as InstancedBufferAttribute,mesh.geometry.getAttribute('radiusRule') as InstancedBufferAttribute]) {
    if (!changed) attr.clearUpdateRanges();
    attr.needsUpdate = true;
   }
  }
 }

 private meshes(): CityMesh[] {
  return [this.meshValue, this.glowMesh, this.highlightMesh, this.searchHighlightMesh].filter((mesh): mesh is CityMesh => mesh !== undefined);
 }
 private removeMesh(): void {
  for (const mesh of this.meshes()) { this.group.remove(mesh); mesh.dispose(); mesh.geometry.dispose(); mesh.material.dispose(); }
  this.meshValue = this.glowMesh = this.highlightMesh = this.searchHighlightMesh = undefined;
 }
 dispose(): void {
  this.removeMesh(); this.picks = undefined; this.centers = new Float32Array(); this.byId.clear(); this.animated.clear(); this.snapshot = undefined; this.nodesByInstance = [];
  this.route = undefined; this.routeNodeIds.clear(); this.searchPaths = new Set();
 }
}
export { nodeMarkerScaleForGlobe };
