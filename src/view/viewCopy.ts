import { UI_STRINGS } from '../i18n';

/**
 * Visible control and confirmation copy is intentionally closed over the
 * design-system allowlist. Titles and aria labels reuse these exact values.
 */
export const VIEW_CONTROL_COPY = {
	graphControls: 'Map controls',
	layout: 'Layout',
	layoutDescription: 'Update note positions',
	explore: 'Explore',
	exploreDescription: 'Navigate and present',
	savedMap: 'Saved map',
	savedMapDescription: 'Persist or restore this globe',
	visibleContent: 'Visible content',
	visibleContentDescription: 'Hide items without moving the layout',
	globe: 'Globe',
	globeDescription: 'Surface and environmental layers',
	refresh: 'Refresh layout',
	refreshDescription:
		'Include pending vault changes while preserving the current map.',
	renew: 'Renew layout',
	renewDescription: 'Generate a new layout for the entire vault.',
	cancelCalculation: 'Cancel calculation',
	cancelDescription: 'Stop the active calculation and preserve the last map.',
	resetCamera: 'Reset camera',
	resetCameraDescription: 'Restore the default camera view.',
	saveMap: 'Save map',
	saveMapDescription: 'Save the current layout, camera, filters, and pins.',
	loadMap: 'Load map',
	loadMapDescription: 'Restore the last saved or synced map.',
	fullscreen: 'Fullscreen',
	fullscreenDescription: 'Open a distraction-free rotating globe.',
	autoRotate: 'Auto rotate',
	findRoute: UI_STRINGS.routeIdle,
	findRouteDescription: 'Find every shortest path between two notes.',
	tags: 'Tags',
	attachments: 'Attachments',
	existingFilesOnly: 'Existing files only',
	orphans: 'Orphans',
	continents: 'Continents',
	atmosphere: 'Atmosphere',
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
