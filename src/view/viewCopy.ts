import { UI_STRINGS } from '../i18n';

/**
 * Visible control and confirmation copy is intentionally closed over the
 * design-system allowlist. Titles and aria labels reuse these exact values.
 */
export const VIEW_CONTROL_COPY = {
	graphControls: 'Map',
	actions: 'Actions',
	filters: 'Filters',
	appearance: 'Appearance',
	refresh: 'Refresh layout',
	renew: 'Renew layout',
	cancelCalculation: 'Cancel calculation',
	resetCamera: 'Reset camera',
	autoRotate: 'Auto rotate',
	findRoute: UI_STRINGS.routeIdle,
	tags: 'Tags',
	attachments: 'Attachments',
	existingFilesOnly: 'Existing files only',
	orphans: 'Orphans',
	continents: 'Continents',
	showTags: 'Show tags',
	hideTags: 'Hide tags',
	routeSelectStart: UI_STRINGS.routeSelectStart,
	routeSelectEnd: UI_STRINGS.routeSelectEnd,
	routeClear: UI_STRINGS.routeClear,
	routeUnavailable: UI_STRINGS.routeUnavailable,
	surface: UI_STRINGS.surfaceMode,
	surfaceSolid: UI_STRINGS.surfaceSolid,
	surfaceTransparent: UI_STRINGS.surfaceTransparent,
	surfaceHidden: UI_STRINGS.surfaceHidden,
} as const;

export const RENEW_CONFIRMATION_COPY = {
	title: UI_STRINGS.renewConfirmationTitle,
	body: UI_STRINGS.renewConfirmationBody,
	cancel: UI_STRINGS.cancel,
	confirm: 'Renew layout',
} as const;
