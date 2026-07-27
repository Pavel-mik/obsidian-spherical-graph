import {
	DEFAULT_RENDER_FILTERS,
	type RenderFilterState,
} from '../render/renderFilters';
import { RenderNode } from '../render/renderTypes';
import { SurfaceMode } from '../settings/settings';
import { StatusPresentation } from './LayoutStatusPresenter';
import {
	SearchController,
	SearchControllerCallbacks,
} from './SearchController';
import { VIEW_CONTROL_COPY } from './viewCopy';

export interface ViewToolbarCallbacks extends SearchControllerCallbacks {
	onRefresh(): void;
	onRenew(): void;
	onCancel(): void;
	onResetCamera(): void;
	onRouteToggle(): void;
	onFiltersChange(filters: RenderFilterState): void;
	onSurfaceModeChange(mode: SurfaceMode): void;
}

export type RouteToolbarState =
	| { kind: 'idle' }
	| { kind: 'select-source' }
	| { kind: 'select-target'; sourceLabel: string }
	| {
			kind: 'complete';
			sourceLabel: string;
			targetLabel: string;
			distance: number;
	  }
	| {
			kind: 'unreachable';
			sourceLabel: string;
			targetLabel: string;
	  };

interface FilterToggle {
	readonly label: HTMLLabelElement;
	readonly input: HTMLInputElement;
}

export class ViewToolbar {
	readonly element: HTMLElement;
	readonly search: SearchController;
	private readonly menu: HTMLDetailsElement;
	private readonly refreshButton: HTMLButtonElement;
	private readonly renewButton: HTMLButtonElement;
	private readonly cancelButton: HTMLButtonElement;
	private readonly resetButton: HTMLButtonElement;
	private readonly routeButton: HTMLButtonElement;
	private readonly tagsToggle: FilterToggle;
	private readonly attachmentsToggle: FilterToggle;
	private readonly existingFilesToggle: FilterToggle;
	private readonly orphansToggle: FilterToggle;
	private readonly surfaceSelect: HTMLSelectElement;

	constructor(
		parent: HTMLElement,
		private readonly callbacks: ViewToolbarCallbacks,
		initialSurfaceMode: SurfaceMode,
		initialFilters: RenderFilterState = DEFAULT_RENDER_FILTERS,
	) {
		this.element = parent.createDiv();
		this.element.className = 'spherical-graph-toolbar';
		this.element.setAttribute('role', 'toolbar');
		this.element.setAttribute('aria-label', 'Spherical graph controls');

		const searchSlot = this.element.createDiv();
		searchSlot.className = 'spherical-graph-toolbar-search';
		this.search = new SearchController(searchSlot, callbacks);

		this.menu = this.element.createEl('details');
		this.menu.className = 'spherical-graph-controls-menu';
		const summary = this.menu.createEl('summary');
		summary.className = 'spherical-graph-controls-summary';
		summary.textContent = VIEW_CONTROL_COPY.graphControls;
		summary.title = VIEW_CONTROL_COPY.graphControls;
		summary.setAttribute('aria-label', VIEW_CONTROL_COPY.graphControls);

		const panel = this.menu.createDiv();
		panel.className = 'spherical-graph-controls-panel';

		const actions = createSection(
			panel,
			VIEW_CONTROL_COPY.actions,
			'actions',
		);
		const actionGrid = actions.createDiv();
		actionGrid.className = 'spherical-graph-controls-grid';
		this.refreshButton = createButton(
			actionGrid,
			VIEW_CONTROL_COPY.refresh,
			'spherical-graph-action-refresh',
		);
		this.renewButton = createButton(
			actionGrid,
			VIEW_CONTROL_COPY.renew,
			'spherical-graph-action-renew',
		);
		this.cancelButton = createButton(
			actionGrid,
			VIEW_CONTROL_COPY.cancelCalculation,
			'spherical-graph-action-cancel',
		);
		this.resetButton = createButton(
			actionGrid,
			VIEW_CONTROL_COPY.resetCamera,
			'spherical-graph-action-reset',
		);
		this.routeButton = createButton(
			actionGrid,
			VIEW_CONTROL_COPY.findRoute,
			'spherical-graph-action-route',
		);
		this.routeButton.dataset.routeState = 'idle';
		this.routeButton.setAttribute('aria-pressed', 'false');
		actionGrid.append(
			this.refreshButton,
			this.renewButton,
			this.cancelButton,
			this.routeButton,
			this.resetButton,
		);

		const filters = createSection(
			panel,
			VIEW_CONTROL_COPY.filters,
			'filters',
		);
		const filterGrid = filters.createDiv();
		filterGrid.className =
			'spherical-graph-controls-grid spherical-graph-filter-grid';
		this.tagsToggle = createFilterToggle(
			filterGrid,
			VIEW_CONTROL_COPY.tags,
			'tags',
		);
		this.attachmentsToggle = createFilterToggle(
			filterGrid,
			VIEW_CONTROL_COPY.attachments,
			'attachments',
		);
		this.existingFilesToggle = createFilterToggle(
			filterGrid,
			VIEW_CONTROL_COPY.existingFilesOnly,
			'existing-files-only',
		);
		this.orphansToggle = createFilterToggle(
			filterGrid,
			VIEW_CONTROL_COPY.orphans,
			'orphans',
		);
		filterGrid.append(
			this.tagsToggle.label,
			this.attachmentsToggle.label,
			this.existingFilesToggle.label,
			this.orphansToggle.label,
		);

		const appearance = createSection(
			panel,
			VIEW_CONTROL_COPY.appearance,
			'appearance',
		);
		const surfaceLabel = appearance.createEl('label');
		surfaceLabel.className = 'spherical-graph-surface-control';
		const surfaceText = surfaceLabel.createSpan();
		surfaceText.className = 'spherical-graph-surface-label';
		surfaceText.textContent = VIEW_CONTROL_COPY.surface;
		this.surfaceSelect = surfaceLabel.createEl('select');
		this.surfaceSelect.className = 'spherical-graph-surface-select';
		this.surfaceSelect.setAttribute(
			'aria-label',
			VIEW_CONTROL_COPY.surface,
		);
		addOption(
			this.surfaceSelect,
			'solid',
			VIEW_CONTROL_COPY.surfaceSolid,
		);
		addOption(
			this.surfaceSelect,
			'transparent',
			VIEW_CONTROL_COPY.surfaceTransparent,
		);
		addOption(
			this.surfaceSelect,
			'hidden',
			VIEW_CONTROL_COPY.surfaceHidden,
		);
		this.surfaceSelect.value = initialSurfaceMode;
		surfaceLabel.append(surfaceText, this.surfaceSelect);
		appearance.append(surfaceLabel);

		panel.append(actions, filters, appearance);
		this.menu.append(summary, panel);
		this.element.append(searchSlot, this.menu);
		parent.append(this.element);
		this.setFilterState(initialFilters);

		this.refreshButton.addEventListener('click', this.onRefresh);
		this.renewButton.addEventListener('click', this.onRenew);
		this.cancelButton.addEventListener('click', this.onCancel);
		this.resetButton.addEventListener('click', this.onReset);
		this.routeButton.addEventListener('click', this.onRoute);
		this.tagsToggle.input.addEventListener(
			'change',
			this.onFiltersChange,
		);
		this.attachmentsToggle.input.addEventListener(
			'change',
			this.onFiltersChange,
		);
		this.existingFilesToggle.input.addEventListener(
			'change',
			this.onFiltersChange,
		);
		this.orphansToggle.input.addEventListener(
			'change',
			this.onFiltersChange,
		);
		this.surfaceSelect.addEventListener('change', this.onSurfaceChange);
	}

	setNodes(nodes: readonly RenderNode[]): void {
		this.search.setNodes(nodes);
		this.routeButton.disabled = nodes.length < 2;
	}

	setTagsAvailable(tagCount: number): void {
		this.tagsToggle.input.disabled = tagCount === 0;
		this.tagsToggle.label.dataset.disabled = String(tagCount === 0);
	}

	setTagsVisible(visible: boolean): void {
		this.tagsToggle.input.checked = visible;
	}

	setFilterState(filters: RenderFilterState): void {
		this.tagsToggle.input.checked = filters.showTags;
		this.attachmentsToggle.input.checked = filters.showAttachments;
		this.existingFilesToggle.input.checked =
			filters.existingFilesOnly;
		this.orphansToggle.input.checked = filters.showOrphans;
	}

	setStatus(presentation: StatusPresentation): void {
		this.refreshButton.disabled = !presentation.canRefresh;
		this.renewButton.disabled = !presentation.canRenew;
		this.cancelButton.disabled = !presentation.canCancel;
		this.cancelButton.hidden = !presentation.canCancel;
		this.element.dataset.busy = String(presentation.isBusy);
	}

	setSurfaceMode(mode: SurfaceMode): void {
		this.surfaceSelect.value = mode;
	}

	setRouteState(state: RouteToolbarState): void {
		this.routeButton.dataset.routeState = state.kind;
		this.routeButton.setAttribute(
			'aria-pressed',
			String(state.kind !== 'idle'),
		);
		switch (state.kind) {
			case 'idle':
				this.routeButton.textContent = VIEW_CONTROL_COPY.findRoute;
				this.routeButton.title = VIEW_CONTROL_COPY.findRoute;
				break;
			case 'select-source':
				this.routeButton.textContent =
					VIEW_CONTROL_COPY.routeSelectStart;
				this.routeButton.title =
					'Select the first note on the globe. Select this control again to cancel.';
				break;
			case 'select-target':
				this.routeButton.textContent =
					VIEW_CONTROL_COPY.routeSelectEnd;
				this.routeButton.title =
					`Start: ${state.sourceLabel}. Select the destination on the globe.`;
				break;
			case 'complete':
				this.routeButton.textContent =
					`Route · ${state.distance} ${state.distance === 1 ? 'hop' : 'hops'}`;
				this.routeButton.title =
					`${state.sourceLabel} → ${state.targetLabel}. All shortest routes are highlighted. Select to clear.`;
				break;
			case 'unreachable':
				this.routeButton.textContent =
					VIEW_CONTROL_COPY.routeUnavailable;
				this.routeButton.title =
					`${state.sourceLabel} and ${state.targetLabel} are disconnected. Select to clear.`;
				break;
		}
		this.routeButton.setAttribute(
			'aria-label',
			this.routeButton.title,
		);
	}

	dispose(): void {
		this.refreshButton.removeEventListener('click', this.onRefresh);
		this.renewButton.removeEventListener('click', this.onRenew);
		this.cancelButton.removeEventListener('click', this.onCancel);
		this.resetButton.removeEventListener('click', this.onReset);
		this.routeButton.removeEventListener('click', this.onRoute);
		this.tagsToggle.input.removeEventListener(
			'change',
			this.onFiltersChange,
		);
		this.attachmentsToggle.input.removeEventListener(
			'change',
			this.onFiltersChange,
		);
		this.existingFilesToggle.input.removeEventListener(
			'change',
			this.onFiltersChange,
		);
		this.orphansToggle.input.removeEventListener(
			'change',
			this.onFiltersChange,
		);
		this.surfaceSelect.removeEventListener(
			'change',
			this.onSurfaceChange,
		);
		this.search.dispose();
		this.element.remove();
	}

	private closeMenu(): void {
		this.menu.open = false;
	}

	private readonly onRefresh = (): void => {
		if (!this.refreshButton.disabled) {
			this.closeMenu();
			this.callbacks.onRefresh();
		}
	};

	private readonly onRenew = (): void => {
		if (!this.renewButton.disabled) {
			this.closeMenu();
			this.callbacks.onRenew();
		}
	};

	private readonly onCancel = (): void => {
		if (!this.cancelButton.disabled) {
			this.closeMenu();
			this.callbacks.onCancel();
		}
	};

	private readonly onReset = (): void => {
		this.closeMenu();
		this.callbacks.onResetCamera();
	};

	private readonly onRoute = (): void => {
		if (!this.routeButton.disabled) {
			this.closeMenu();
			this.callbacks.onRouteToggle();
		}
	};

	private readonly onFiltersChange = (): void => {
		this.callbacks.onFiltersChange({
			showTags: this.tagsToggle.input.checked,
			showAttachments: this.attachmentsToggle.input.checked,
			existingFilesOnly: this.existingFilesToggle.input.checked,
			showOrphans: this.orphansToggle.input.checked,
		});
	};

	private readonly onSurfaceChange = (): void => {
		const value = this.surfaceSelect.value;
		if (
			value === 'solid' ||
			value === 'transparent' ||
			value === 'hidden'
		) {
			this.callbacks.onSurfaceModeChange(value);
		}
	};
}

function createSection(
	parent: HTMLElement,
	label: string,
	kind: string,
): HTMLElement {
	const section = parent.createEl('section');
	section.className = 'spherical-graph-controls-section';
	section.dataset.kind = kind;
	const heading = section.createDiv();
	heading.className = 'spherical-graph-controls-heading';
	heading.textContent = label;
	section.append(heading);
	return section;
}

function createButton(
	parent: HTMLElement,
	label: string,
	className: string,
): HTMLButtonElement {
	const button = parent.createEl('button');
	button.type = 'button';
	button.className = `spherical-graph-toolbar-button ${className}`;
	button.textContent = label;
	button.title = label;
	button.setAttribute('aria-label', label);
	return button;
}

function createFilterToggle(
	parent: HTMLElement,
	labelText: string,
	filterId: string,
): FilterToggle {
	const label = parent.createEl('label');
	label.className = 'spherical-graph-filter-toggle';
	label.dataset.filter = filterId;
	const input = label.createEl('input');
	input.type = 'checkbox';
	input.className = 'spherical-graph-filter-checkbox';
	input.setAttribute('aria-label', labelText);
	const indicator = label.createSpan();
	indicator.className = 'spherical-graph-filter-indicator';
	const text = label.createSpan();
	text.className = 'spherical-graph-filter-label';
	text.textContent = labelText;
	label.append(input, indicator, text);
	return { label, input };
}

function addOption(
	select: HTMLSelectElement,
	value: SurfaceMode,
	label: string,
): void {
	const option = select.createEl('option');
	option.value = value;
	option.textContent = label;
	select.append(option);
}
