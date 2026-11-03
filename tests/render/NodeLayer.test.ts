import {
	PlaneGeometry,
	Color,
	Group,
	InstancedMesh,
	Matrix4,
	PerspectiveCamera,
	ShaderMaterial,
	Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';

import { NodeLayer } from '../../src/render/NodeLayer';
import { SEARCH_HIGHLIGHT_COLOR } from '../../src/render/searchHighlight';
import {
	prepareRenderSnapshot,
	type RenderTheme,
} from '../../src/render/renderTypes';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';

const theme: RenderTheme = {
	background: '#101319',
	node: '#39d7ff',
	nodeAttachment: '#ffb547',
	nodeUnresolved: '#70818d',
	nodeNeighbor: '#9beeff',
	nodeDirectoryPeer: '#82b7ad',
	nodeActive: '#f3a712',
	nodeHovered: '#ffe066',
	nodeSelected: '#8d6bff',
	nodeRoute: '#c8ff3d',
	nodeRouteStart: '#c8ff3d',
	nodeRouteEnd: '#ffb547',
	edge: '#2496b5',
	edgeSelected: '#a690ff',
	edgeRoute: '#c8ff3d',
	graticule: '#284650',
	tag: '#9d7bff',
	tagSoft: '#ded7ff',
	tagEdge: '#7364c7',
	sphere: '#252a34',
	coast: '#d4b572',
	land: ['#66725a', '#a07a49'],
};

function fixture(count = 3) {
	return prepareRenderSnapshot({ snapshotId: 'cities', nodes: Array.from({length: count}, (_, index) => ({
		index, id: 'id-' + index, path: index + '.md', basename: 'City ' + index, degree: 1, weightedDegree: 1,
	})), edges: [{source:0,target:1,weight:1}], positions: new Float32Array(Array.from({length: count}, (_, i) => [Math.cos(i), Math.sin(i), 0]).flat()) });
}
function named(group: Group, name: string): InstancedMesh { return group.getObjectByName(name) as InstancedMesh; }

describe('Živá kartografie cities', () => {
	it('keeps overview cities readable with the saved 155 percent globe scale', () => {
		const group=new Group(),snapshot=fixture(),original=snapshot.positions.slice();
		const layer=new NodeLayer(group,{...DEFAULT_SETTINGS.appearance,globeSize:155},theme);
		const camera=new PerspectiveCamera(45);camera.position.set(0,0,32);
		layer.setSnapshot(snapshot);layer.render(camera,1000,500);
		const style=layer.mesh!.geometry.getAttribute('cityStyle');
		for(let i=0;i<snapshot.nodes.length;i++) expect(style.getX(i)*2).toBeGreaterThanOrEqual(6.5);
		expect(style.getY(0)).toBeLessThan(1);expect(style.getY(0)).toBeGreaterThan(0);
		layer.updateSelection({selectedNodeId:'id-0'});layer.render(camera,1000,500,false,100,true);
		expect(style.getX(0)*2).toBeGreaterThanOrEqual(17);
		expect(style.getW(0)).toBe(1);expect(style.getW(1)).toBe(0);
		expect(style.getY(0)).toBe(1);
		expect(snapshot.positions).toEqual(original);layer.dispose();
	});
	it('allocates shader colours before empty highlight layers are first compiled', () => {
		const group = new Group(), layer = new NodeLayer(group, DEFAULT_SETTINGS.appearance, theme);
		layer.setSnapshot(fixture());
		const rings = named(group, 'spherical-graph-node-highlights');
		const search = named(group, 'spherical-graph-search-node-highlights');
		expect(rings.count).toBe(0); expect(search.count).toBe(0);
		for (const mesh of group.children as InstancedMesh[]) {
			expect(mesh.instanceColor?.count).toBe(3);
		}
		const colors = rings.instanceColor;
		layer.updateSelection({ selectedNodeId: 'id-0' });
		expect(rings.count).toBe(1); expect(rings.instanceColor).toBe(colors);
		layer.dispose();
	});
	it('finishes a local glow transition and stops requesting frames, including reduced motion', () => {
		const group=new Group(),layer=new NodeLayer(group,DEFAULT_SETTINGS.appearance,theme),camera=new PerspectiveCamera(45);
		camera.position.set(0,0,32);layer.setSnapshot(fixture());layer.render(camera,1000,800);
		layer.updateSelection({selectedNodeId:'id-0'});
		expect(layer.render(camera,1000,800,false,100)).toBe(true);
		expect(layer.render(camera,1000,800,false,280)).toBe(false);
		expect(layer.render(camera,1000,800,false,1000)).toBe(false);
		layer.updateSelection({selectedNodeId:'id-1'});
		expect(layer.render(camera,1000,800,false,1100,true)).toBe(false);
		layer.dispose();
	});
	it('composes search, selection and endpoints without changing a committed buffer', () => {
		const group = new Group(), layer = new NodeLayer(group, DEFAULT_SETTINGS.appearance, theme), snapshot = fixture(35);
		const original = snapshot.positions.slice();
		layer.setSnapshot(snapshot);
		layer.updateSearch(new Set(snapshot.nodes.map(n => n.path)));
		layer.updateRoute({startNodeId:'id-0',endNodeId:'id-1',nodeIds:['id-0','id-1'],edges:[]});
		layer.updateSelection({selectedNodeId:'id-0', hoveredNodeId:'id-1'});
		expect(named(group,'spherical-graph-search-node-highlights').count).toBe(35);
		expect(named(group,'spherical-graph-node-highlights').count).toBe(2);
		const color = new Color();
		layer.mesh?.getColorAt(0,color); expect(color.getHexString()).toBe(new Color(theme.nodeSelected).getHexString());
		layer.mesh?.getColorAt(1,color); expect(color.getHexString()).toBe(new Color(theme.nodeRouteEnd).getHexString());
		layer.mesh?.getColorAt(2,color); expect(color.getHexString()).toBe(new Color(SEARCH_HIGHLIGHT_COLOR).getHexString());
		layer.updateSearch(new Set());
		expect(named(group,'spherical-graph-search-node-highlights').count).toBe(0);
		layer.mesh?.getColorAt(2,color); expect(color.getHexString()).toBe(new Color(theme.node).getHexString());
		expect(snapshot.positions).toEqual(original);
		layer.dispose(); expect(group.children).toHaveLength(0);
	});
	it('keeps hover from erasing route and search colors', () => {
		const group = new Group(), layer = new NodeLayer(group, DEFAULT_SETTINGS.appearance, theme);
		layer.setSnapshot(fixture()); layer.updateSearch(new Set(['1.md']));
		layer.updateSelection({hoveredNodeId:'id-1'});
		const color = new Color(); layer.mesh?.getColorAt(1,color);
		expect(color.getHexString()).toBe(new Color(SEARCH_HIGHLIGHT_COLOR).getHexString());
		expect(named(group,'spherical-graph-search-node-highlights').count).toBe(1);
		layer.dispose();
	});
	it('uses batched anti-aliased screen-size markers and depth-tested local halos', () => {
		const group = new Group(), layer = new NodeLayer(group, DEFAULT_SETTINGS.appearance, theme);
		layer.setSnapshot(fixture()); const mesh = layer.mesh!;
		expect(mesh.geometry).toBeInstanceOf(PlaneGeometry); expect(mesh.material).toBeInstanceOf(ShaderMaterial);
		expect((mesh.material as ShaderMaterial).depthTest).toBe(true);
		const halo = named(group,'spherical-graph-node-glow');
		expect((halo.material as ShaderMaterial).depthWrite).toBe(false);
		expect(halo.geometry.getAttribute('cityStyle').getY(0)).toBeCloseTo(0.17);
		layer.dispose();
	});
	it('anchors a single primary ring and an independent search ring to the same city', () => {
		const group = new Group(), layer = new NodeLayer(group, DEFAULT_SETTINGS.appearance, theme);
		layer.setSnapshot(fixture()); layer.updateSelection({selectedNodeId:'id-0',activeNodeId:'id-0',hoveredNodeId:'id-0'});
		layer.updateSearch(new Set(['0.md']));
		const rings = named(group,'spherical-graph-node-highlights'), search = named(group,'spherical-graph-search-node-highlights');
		expect(rings.count).toBe(1); expect(search.count).toBe(1);
		const a=new Matrix4(), b=new Matrix4(); rings.getMatrixAt(0,a); search.getMatrixAt(0,b);
		expect(new Vector3().setFromMatrixPosition(a)).toEqual(new Vector3().setFromMatrixPosition(b));
		expect(search.geometry.getAttribute('cityStyle').getX(0)).toBeGreaterThan(rings.geometry.getAttribute('cityStyle').getX(0));
		layer.updateSelection({}); expect(rings.count).toBe(0); layer.dispose();
	});
	it('respects Globe size while preserving legible minima and the intrinsic position', () => {
		const group = new Group(), layer = new NodeLayer(group, DEFAULT_SETTINGS.appearance, theme), snapshot=fixture();
		layer.setSnapshot(snapshot);
		const style=layer.mesh!.geometry.getAttribute('cityStyle'), original=style.getX(0);
		layer.updateAppearance({...DEFAULT_SETTINGS.appearance,globeSize:200});
		expect(style.getX(0)).toBeLessThan(original); expect(style.getX(0)).toBeGreaterThanOrEqual(3.25);
		expect(layer.positionForNode('id-0',new Vector3())?.normalize().x).toBeCloseTo(1);
		layer.dispose();
	});
	it('uses CSS pixels independent of framebuffer density and disables normal glow on phones', () => {
		const group=new Group(), layer=new NodeLayer(group,DEFAULT_SETTINGS.appearance,theme), camera=new PerspectiveCamera(45);
		camera.position.set(0,0,32); layer.setSnapshot(fixture()); layer.render(camera,1000,800,true);
		expect(named(group,'spherical-graph-node-glow').geometry.getAttribute('cityStyle').getY(0)).toBe(0);
		layer.updateSelection({selectedNodeId:'id-0'}); layer.render(camera,1000,800,true);
		expect(named(group,'spherical-graph-node-glow').geometry.getAttribute('cityStyle').getY(0)).toBeCloseTo(0.45);
		const viewport=(layer.mesh!.material as ShaderMaterial).uniforms.viewport!.value as {x:number;y:number};
		expect(viewport).toMatchObject({x:1000,y:800}); layer.dispose();
	});
	it('filters auxiliary nodes and search membership by kind and path after reordering', () => {
		const group=new Group(),layer=new NodeLayer(group,DEFAULT_SETTINGS.appearance,theme);
		const snapshot=prepareRenderSnapshot({snapshotId:'filter',nodes:[
			{index:1,id:'image',path:'image.png',basename:'image',kind:'attachment',degree:1,weightedDegree:1},
			{index:0,id:'note',path:'note.md',basename:'Note',degree:1,weightedDegree:1},
		],edges:[],positions:new Float32Array([1,0,0,0,1,0])});
		layer.setSnapshot(snapshot);layer.updateSearch(new Set(['note.md','image.png']));
		expect(layer.nodeForInstance(1)).toBeUndefined();
		expect(named(group,'spherical-graph-search-node-highlights').count).toBe(1);
		layer.updateFilters({showTags:true,showAttachments:true,showOrphans:true,existingFilesOnly:true});
		expect(layer.nodeForInstance(1)?.id).toBe('image');
		expect(layer.mesh!.geometry.getAttribute('cityStyle').getZ(1)).toBe(1);
		expect(named(group,'spherical-graph-search-node-highlights').count).toBe(1);
		layer.dispose();
	});
});
