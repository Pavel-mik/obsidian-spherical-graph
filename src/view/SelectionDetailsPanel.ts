import {
	PreparedRenderSnapshot,
	RenderGraphSnapshot,
	RenderNode,
	RenderRouteState,
	RenderTag,
	prepareRenderSnapshot,
} from '../render/renderTypes';
import { renderNodeKind } from '../render/renderFilters';

export type DetailsRouteKind = 'selecting' | 'complete' | 'unreachable';

export interface DetailsRouteState {
	route: RenderRouteState;
	kind: DetailsRouteKind;
	distance?: number;
}

export interface SelectionDetailsModel {
	selected?: {
		node: RenderNode;
		connections: readonly RenderNode[];
	};
	tag?: {
		tag: RenderTag;
		nodes: readonly RenderNode[];
	};
	route?: {
		start: RenderNode;
		end?: RenderNode;
		nodes: readonly RenderNode[];
		kind: DetailsRouteKind;
		distance?: number;
	};
}

interface SelectionDetailsCallbacks {
	onOpen(node: RenderNode, openInNewLeaf: boolean): void;
}

let selectionDetailsSequence = 0;

export class SelectionDetailsPanel {
	private readonly element: HTMLElement;
	private readonly content: HTMLElement;
	private readonly toggle: HTMLButtonElement;
	private snapshot: PreparedRenderSnapshot | undefined;
	private selectedNodeId: string | undefined;
	private selectedTagId: string | undefined;
	private route: DetailsRouteState | undefined;
	private collapsed = false;

	constructor(
		parent: HTMLElement,
		private readonly callbacks: SelectionDetailsCallbacks,
	) {
		this.element = parent.createEl('aside');
		this.element.className = 'spherical-graph-inspector';
		this.element.setAttribute('aria-label', 'Graph selection details');
		this.element.hidden = true;

		selectionDetailsSequence += 1;
		const contentId = `spherical-graph-inspector-content-${selectionDetailsSequence}`;
		this.toggle = this.element.createEl('button');
		this.toggle.type = 'button';
		this.toggle.className = 'spherical-graph-inspector-header';
		this.toggle.setAttribute('aria-controls', contentId);
		this.toggle.setAttribute('aria-expanded', 'true');
		this.toggle.title = 'Collapse selection details';
		const eyebrow = this.toggle.createSpan();
		eyebrow.className = 'spherical-graph-inspector-eyebrow';
		eyebrow.textContent = 'Selection details';
		const chevron = this.toggle.createSpan();
		chevron.className = 'spherical-graph-inspector-chevron';
		chevron.setAttribute('aria-hidden', 'true');
		this.toggle.append(eyebrow, chevron);
		this.toggle.addEventListener('click', () => {
			this.setCollapsed(!this.collapsed);
		});

		this.content = this.element.createDiv();
		this.content.className = 'spherical-graph-inspector-content';
		this.content.id = contentId;
		this.element.append(this.toggle, this.content);
		parent.append(this.element);
	}

	setSnapshot(snapshot: RenderGraphSnapshot): void {
		this.snapshot = prepareRenderSnapshot(snapshot);
		if (
			this.selectedNodeId !== undefined &&
			!this.snapshot.nodeById.has(this.selectedNodeId)
		) {
			this.selectedNodeId = undefined;
		}
		if (
			this.selectedTagId !== undefined &&
			!this.snapshot.tagById.has(this.selectedTagId)
		) {
			this.selectedTagId = undefined;
		}
		this.render();
	}

	setSelectedNode(nodeId: string | undefined): void {
		this.selectedNodeId = nodeId;
		this.render();
	}

	setSelectedTag(tagId: string | undefined): void {
		this.selectedTagId = tagId;
		this.render();
	}

	setRoute(route: DetailsRouteState | undefined): void {
		this.route =
			route === undefined
				? undefined
				: {
						...route,
						route: {
							...route.route,
							nodeIds: [...route.route.nodeIds],
							edges: [...route.route.edges],
						},
					};
		this.render();
	}

	dispose(): void {
		this.element.remove();
		this.snapshot = undefined;
		this.selectedTagId = undefined;
		this.route = undefined;
	}

	private setCollapsed(collapsed: boolean): void {
		this.collapsed = collapsed;
		this.element.dataset.collapsed = String(collapsed);
		this.toggle.setAttribute('aria-expanded', String(!collapsed));
		this.toggle.title = collapsed
			? 'Expand selection details'
			: 'Collapse selection details';
		this.content.hidden = collapsed;
	}

	private render(): void {
		const snapshot = this.snapshot;
		const model =
			snapshot === undefined
				? {}
				: buildSelectionDetailsModel(
						snapshot,
						this.selectedNodeId,
						this.route,
						this.selectedTagId,
					);
		this.content.replaceChildren();
		if (
			model.selected === undefined &&
			model.tag === undefined &&
			model.route === undefined
		) {
			this.element.hidden = true;
			return;
		}
		this.element.hidden = false;
		if (model.selected !== undefined) {
			this.renderSelected(model.selected);
		}
		if (model.tag !== undefined) {
			this.renderTag(model.tag);
		}
		if (model.route !== undefined) {
			this.renderRoute(model.route);
		}
	}

	private renderTag(
		tagModel: NonNullable<SelectionDetailsModel['tag']>,
	): void {
		const section = this.createSection('Tag', 'tag');
		const primary = section.createDiv();
		primary.className =
			'spherical-graph-inspector-primary spherical-graph-inspector-tag-primary';
		const marker = primary.createSpan();
		marker.className = 'spherical-graph-inspector-tag-marker';
		marker.setAttribute('aria-hidden', 'true');
		const name = primary.createSpan();
		name.className = 'spherical-graph-inspector-link-name';
		name.textContent = tagModel.tag.label;
		primary.append(marker, name);
		section.append(primary);

		const metadata = section.createDiv();
		metadata.className = 'spherical-graph-inspector-meta';
		metadata.textContent = `${tagModel.nodes.length} tagged ${
			tagModel.nodes.length === 1 ? 'note' : 'notes'
		}`;
		section.append(metadata);
		section.append(
			this.createNodeList(
				'Tagged notes',
				tagModel.nodes,
				'No tagged notes',
			),
		);
		this.content.append(section);
	}

	private renderSelected(
		selected: NonNullable<SelectionDetailsModel['selected']>,
	): void {
		const section = this.createSection('Node', 'node');
		section.append(this.createPrimaryLink(selected.node));

		const metadata = section.createDiv();
		metadata.className = 'spherical-graph-inspector-meta';
		metadata.textContent = `${selected.connections.length} direct ${
			selected.connections.length === 1 ? 'connection' : 'connections'
		}`;
		section.append(metadata);
		section.append(
			this.createNodeList(
				'Linked notes',
				selected.connections,
				'No linked notes',
			),
		);
		this.content.append(section);
	}

	private renderRoute(
		route: NonNullable<SelectionDetailsModel['route']>,
	): void {
		const section = this.createSection('Route', 'route');
		const endpoints = section.createDiv();
		endpoints.className = 'spherical-graph-route-endpoints';
		endpoints.append(this.createEndpoint('Start', route.start, 'start'));
		if (route.end !== undefined) {
			endpoints.append(
				this.createEndpoint('Dest', route.end, 'destination'),
			);
		} else {
			const pending = endpoints.createDiv();
			pending.className = 'spherical-graph-route-pending';
			pending.textContent = 'Select destination';
			endpoints.append(pending);
		}
		section.append(endpoints);

		const metadata = section.createDiv();
		metadata.className = 'spherical-graph-inspector-meta';
		if (route.kind === 'unreachable') {
			metadata.dataset.tone = 'error';
			metadata.textContent = 'No route through existing links';
		} else if (route.kind === 'selecting') {
			metadata.textContent = 'Awaiting destination node';
		} else {
			metadata.textContent = `${route.distance ?? 0} ${
				route.distance === 1 ? 'hop' : 'hops'
			} · ${route.nodes.length} route ${
				route.nodes.length === 1 ? 'node' : 'nodes'
			}`;
		}
		section.append(metadata);
		if (route.kind === 'complete') {
			section.append(
				this.createNodeList(
					'Shortest-path network',
					route.nodes,
					'No route nodes',
				),
			);
		}
		this.content.append(section);
	}

	private createSection(label: string, kind: string): HTMLElement {
		const section = this.content.createEl('section');
		section.className = 'spherical-graph-inspector-section';
		section.dataset.kind = kind;
		const labelElement = section.createDiv();
		labelElement.className = 'spherical-graph-inspector-section-label';
		labelElement.textContent = label;
		section.append(labelElement);
		return section;
	}

	private createPrimaryLink(node: RenderNode): HTMLButtonElement {
		const button = this.createNodeButton(node);
		button.classList.add('spherical-graph-inspector-primary');
		const path = button.createSpan();
		path.className = 'spherical-graph-inspector-path';
		path.textContent = node.path;
		button.append(path);
		return button;
	}

	private createEndpoint(
		role: string,
		node: RenderNode,
		kind: 'start' | 'destination',
	): HTMLElement {
		const row = this.content.createDiv();
		row.className = 'spherical-graph-route-endpoint';
		row.dataset.routeRole = kind;
		const label = row.createSpan();
		label.className = 'spherical-graph-route-role';
		label.textContent = role;
		row.append(label, this.createNodeButton(node));
		return row;
	}

	private createNodeList(
		label: string,
		nodes: readonly RenderNode[],
		emptyText: string,
	): HTMLElement {
		const wrapper = this.content.createDiv();
		wrapper.className = 'spherical-graph-inspector-list-block';
		const labelElement = wrapper.createDiv();
		labelElement.className = 'spherical-graph-inspector-list-label';
		labelElement.textContent = label;
		wrapper.append(labelElement);

		const list = wrapper.createDiv();
		list.className = 'spherical-graph-inspector-list';
		if (nodes.length === 0) {
			const empty = list.createDiv();
			empty.className = 'spherical-graph-inspector-empty';
			empty.textContent = emptyText;
			list.append(empty);
		} else {
			for (const node of nodes) {
				list.append(this.createNodeButton(node));
			}
		}
		wrapper.append(list);
		return wrapper;
	}

	private createNodeButton(node: RenderNode): HTMLButtonElement {
		const button = this.content.createEl('button');
		button.type = 'button';
		button.className = 'spherical-graph-inspector-link';
		const unresolved = renderNodeKind(node) === 'unresolved';
		button.title = unresolved
			? `${node.path} does not exist in the vault`
			: `Open ${node.path}`;
		button.disabled = unresolved;
		button.dataset.nodeId = node.id;
		const name = button.createSpan();
		name.className = 'spherical-graph-inspector-link-name';
		name.textContent = node.basename;
		button.append(name);
		if (!unresolved) {
			button.addEventListener('click', (event) => {
				event.stopPropagation();
				this.callbacks.onOpen(
					node,
					event.ctrlKey || event.metaKey,
				);
			});
		}
		return button;
	}
}

export function buildSelectionDetailsModel(
	snapshot: PreparedRenderSnapshot,
	selectedNodeId: string | undefined,
	routeState: DetailsRouteState | undefined,
	selectedTagId?: string,
): SelectionDetailsModel {
	const selectedNode =
		selectedNodeId === undefined
			? undefined
			: snapshot.nodeById.get(selectedNodeId);
	const selected =
		selectedNode === undefined
			? undefined
			: {
					node: selectedNode,
					connections: [
						...(
							snapshot.neighborsByIndex.get(
								selectedNode.index,
							) ?? []
						),
					]
						.map((index) => snapshot.nodeByIndex.get(index))
						.filter((node): node is RenderNode => node !== undefined)
						.sort((left, right) =>
							left.basename.localeCompare(right.basename),
						),
				};
	const selectedTag =
		selectedTagId === undefined
			? undefined
			: snapshot.tagById.get(selectedTagId);
	const tag =
		selectedTag === undefined
			? undefined
			: {
					tag: selectedTag,
					nodes: selectedTag.nodeIndices
						.map((index) => snapshot.nodeByIndex.get(index))
						.filter(
							(node): node is RenderNode => node !== undefined,
						)
						.sort((left, right) =>
							left.basename.localeCompare(right.basename),
						),
				};
	const route = routeState?.route;
	const start =
		route === undefined
			? undefined
			: snapshot.nodeById.get(route.startNodeId);
	const routeModel =
		routeState === undefined || route === undefined || start === undefined
			? undefined
			: {
					start,
					end:
						route.endNodeId === undefined
							? undefined
							: snapshot.nodeById.get(route.endNodeId),
					nodes: route.nodeIds
						.map((nodeId) => snapshot.nodeById.get(nodeId))
						.filter(
							(node): node is RenderNode => node !== undefined,
						),
					kind: routeState.kind,
					distance: routeState.distance,
				};
	return { selected, tag, route: routeModel };
}
