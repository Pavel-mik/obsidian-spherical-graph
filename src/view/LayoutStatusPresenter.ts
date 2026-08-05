import { UI_STRINGS } from '../i18n';
import { ViewStatusModel } from './viewTypes';

export type StatusTone = 'neutral' | 'busy' | 'pending' | 'error';

export interface StatusPresentation {
	text: string;
	tone: StatusTone;
	isBusy: boolean;
	canRefresh: boolean;
	canRenew: boolean;
	canCancel: boolean;
	renewLabel?: string;
}

export function presentLayoutStatus(
	model: ViewStatusModel,
): StatusPresentation {
	const suffix = model.compatibilityMode
		? ` · ${UI_STRINGS.workerFallback}`
		: '';
	if (model.transientNotice === 'cancelled') {
		return {
			text: UI_STRINGS.calculationCancelled + suffix,
			tone: 'neutral',
			isBusy: false,
			canRefresh: model.state.kind === 'fixed-dirty',
			canRenew: true,
			canCancel: false,
		};
	}

	switch (model.state.kind) {
		case 'no-layout':
			return {
				text: UI_STRINGS.noSavedLayout + suffix,
				tone: 'neutral',
				isBusy: false,
				canRefresh: false,
				canRenew: true,
				canCancel: false,
				renewLabel: 'Generate map',
			};
		case 'initializing':
			return busyStatus(
				UI_STRINGS.initializing,
				model,
				suffix,
			);
		case 'fixed-clean':
			return {
				text: `${UI_STRINGS.upToDate} · ${model.nodeCount} notes · ${model.edgeCount} links${continentSuffix(model)}${suffix}`,
				tone: 'neutral',
				isBusy: false,
				canRefresh: true,
				canRenew: true,
				canCancel: false,
			};
		case 'fixed-dirty': {
			const diff = model.state.diff;
			const linkChanges =
				diff.addedEdgeCount +
				diff.removedEdgeCount +
				diff.changedEdgeWeightCount;
			const filterText = diff.filterChanged ? ' · filters changed' : '';
			const warning = diff.largeChangeWarning
				? ' · Renew may produce a better global map'
				: '';
			return {
				text: `${UI_STRINGS.changesDetected} · +${diff.addedNodeIds.length} / -${diff.removedNodeIds.length} notes · ${linkChanges} link changes${filterText}${warning}${suffix}`,
				tone: 'pending',
				isBusy: false,
				canRefresh: true,
				canRenew: true,
				canCancel: false,
			};
		}
		case 'refreshing':
			return busyStatus(UI_STRINGS.refreshing, model, suffix);
		case 'renewing':
			return busyStatus(UI_STRINGS.renewing, model, suffix);
		case 'error':
			return {
				text: `${UI_STRINGS.layoutError} · ${model.state.message}${suffix}`,
				tone: 'error',
				isBusy: false,
				canRefresh: false,
				canRenew: true,
				canCancel: false,
			};
	}
}

function continentSuffix(model: ViewStatusModel): string {
	const count = model.continentCount ?? 0;
	return count > 0
		? ` · ${count} ${count === 1 ? 'continent' : 'continents'}`
		: '';
}

export class LayoutStatusPresenter {
	readonly element: HTMLElement;
	private readonly progress: HTMLProgressElement;

	constructor(parent: HTMLElement) {
		this.element = parent.createDiv();
		this.element.className = 'spherical-graph-status';
		this.element.setAttribute('role', 'status');
		this.element.setAttribute('aria-live', 'polite');
		parent.append(this.element);
		this.progress = parent.createEl('progress');
		this.progress.className = 'spherical-graph-status-progress';
		this.progress.setAttribute('aria-label', 'Layout calculation progress');
		this.progress.hidden = true;
		parent.append(this.progress);
	}

	update(model: ViewStatusModel): StatusPresentation {
		const presentation = presentLayoutStatus(model);
		this.element.textContent = presentation.text;
		this.element.dataset.tone = presentation.tone;
		this.element.dataset.busy = String(presentation.isBusy);
		this.progress.hidden = !presentation.isBusy;
		return presentation;
	}
}

function busyStatus(
	label: string,
	model: ViewStatusModel,
	suffix: string,
): StatusPresentation {
	const progress = model.progress;
	const phase =
		progress === undefined
			? ''
			: ` · ${formatPhase(progress.phase)} · iteration ${progress.iteration}`;
	return {
		text: `${label}${phase}${suffix}`,
		tone: 'busy',
		isBusy: true,
		canRefresh: false,
		canRenew: false,
		canCancel: true,
	};
}

function formatPhase(phase: string): string {
	return phase
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}
