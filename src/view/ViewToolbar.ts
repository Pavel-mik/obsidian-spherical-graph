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
	onTagsToggle(): void;
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

export class ViewToolbar {
	readonly element: HTMLElement;
	readonly search: SearchController;
	private readonly refreshButton: HTMLButtonElement;
	private readonly renewButton: HTMLButtonElement;
	private readonly cancelButton: HTMLButtonElement;
	private readonly resetButton: HTMLButtonElement;
	private readonly routeButton: HTMLButtonElement;
	private readonly tagsButton: HTMLButtonElement;
	private readonly surfaceSelect: HTMLSelectElement;

	constructor(
		parent: HTMLElement,
		private readonly callbacks: ViewToolbarCallbacks,
		initialSurfaceMode: SurfaceMode,
	) {
		this.element = parent.createDiv();
		this.element.className = 'spherical-graph-toolbar';
		this.element.setAttribute('role', 'toolbar');
		this.element.setAttribute('aria-label', 'Spherical graph controls');

		const searchSlot = this.element.createDiv();
		searchSlot.className = 'spherical-graph-toolbar-search';
		this.search = new SearchController(searchSlot, callbacks);

		const actions = this.element.createDiv();
		actions.className = 'spherical-graph-toolbar-actions';
		this.refreshButton = createButton(
			actions,
			VIEW_CONTROL_COPY.refresh,
			'spherical-graph-action-refresh',
		);
		this.renewButton = createButton(
			actions,
			VIEW_CONTROL_COPY.renew,
			'spherical-graph-action-renew',
		);
		this.cancelButton = createButton(
			actions,
			VIEW_CONTROL_COPY.cancelCalculation,
			'spherical-graph-action-cancel',
		);
		this.resetButton = createButton(
			actions,
			VIEW_CONTROL_COPY.resetCamera,
			'spherical-graph-action-reset',
		);
		this.routeButton = createButton(
			actions,
			VIEW_CONTROL_COPY.findRoute,
			'spherical-graph-action-route',
		);
		this.routeButton.dataset.routeState = 'idle';
		this.routeButton.setAttribute('aria-pressed', 'false');
		this.tagsButton = createButton(
			actions,
			VIEW_CONTROL_COPY.tags,
			'spherical-graph-action-tags',
		);
		this.tagsButton.setAttribute('aria-pressed', 'true');
		this.setTagsVisible(true);

		const surfaceLabel = this.element.createEl('label');
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

		actions.append(
			this.refreshButton,
			this.renewButton,
			this.cancelButton,
			this.routeButton,
			this.tagsButton,
			this.resetButton,
			surfaceLabel,
		);
		this.element.append(searchSlot, actions);
		parent.append(this.element);

		this.refreshButton.addEventListener('click', this.onRefresh);
		this.renewButton.addEventListener('click', this.onRenew);
		this.cancelButton.addEventListener('click', this.onCancel);
		this.resetButton.addEventListener('click', this.onReset);
		this.routeButton.addEventListener('click', this.onRoute);
		this.tagsButton.addEventListener('click', this.onTags);
		this.surfaceSelect.addEventListener('change', this.onSurfaceChange);
	}

	setNodes(nodes: readonly RenderNode[]): void {
		this.search.setNodes(nodes);
		this.routeButton.disabled = nodes.length < 2;
	}

	setTagsAvailable(tagCount: number): void {
		this.tagsButton.disabled = tagCount === 0;
	}

	setTagsVisible(visible: boolean): void {
		this.tagsButton.setAttribute('aria-pressed', String(visible));
		this.tagsButton.title = visible
			? VIEW_CONTROL_COPY.hideTags
			: VIEW_CONTROL_COPY.showTags;
		this.tagsButton.setAttribute(
			'aria-label',
			this.tagsButton.title,
		);
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
		this.tagsButton.removeEventListener('click', this.onTags);
		this.surfaceSelect.removeEventListener('change', this.onSurfaceChange);
		this.search.dispose();
		this.element.remove();
	}

	private readonly onRefresh = (): void => {
		if (!this.refreshButton.disabled) {
			this.callbacks.onRefresh();
		}
	};

	private readonly onRenew = (): void => {
		if (!this.renewButton.disabled) {
			this.callbacks.onRenew();
		}
	};

	private readonly onCancel = (): void => {
		if (!this.cancelButton.disabled) {
			this.callbacks.onCancel();
		}
	};

	private readonly onReset = (): void => {
		this.callbacks.onResetCamera();
	};

	private readonly onRoute = (): void => {
		if (!this.routeButton.disabled) {
			this.callbacks.onRouteToggle();
		}
	};

	private readonly onTags = (): void => {
		if (!this.tagsButton.disabled) {
			this.callbacks.onTagsToggle();
		}
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
