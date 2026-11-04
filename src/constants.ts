export const PLUGIN_ID = 'spherical-graph';
export const PLUGIN_NAME = 'Spherical Graph';
export const VIEW_TYPE = 'spherical-graph-view';

export const SCHEMA_VERSION = 2;
export const ALGORITHM_VERSION = 2;

export const SPHERE_RADIUS = 10;
export const NODE_SURFACE_LIFT = 0.08;
export const EDGE_SURFACE_LIFT = 0.04;
export const DEFAULT_GLOBE_SIZE = 100;
export const BASE_NODE_MARKER_SIZE = 0.11;
/**
 * Shared by desktop, tablet and phone: the shell sits 75% of a globe radius
 * above the surface, at 1.75 times the radius from the centre.
 */
export const DEFAULT_TAG_ORBIT_HEIGHT_PERCENT = 75;
export const MIN_TAG_ORBIT_HEIGHT_PERCENT = 5;
export const MAX_TAG_ORBIT_HEIGHT_PERCENT = 100;
export const DEFAULT_TAG_ORBIT_RADIUS =
	SPHERE_RADIUS *
	(1 + DEFAULT_TAG_ORBIT_HEIGHT_PERCENT / 100);
export const DEFAULT_ATMOSPHERE_HEIGHT_PERCENT = 10;
export const MIN_ATMOSPHERE_HEIGHT_PERCENT = 1;
export const MAX_ATMOSPHERE_HEIGHT_PERCENT = 30;
export const DEFAULT_ATMOSPHERE_RADIUS =
	SPHERE_RADIUS *
	(1 + DEFAULT_ATMOSPHERE_HEIGHT_PERCENT / 100);
export const TAG_LINK_START_RADIUS =
	SPHERE_RADIUS + NODE_SURFACE_LIFT + 0.025;
export const BASE_TAG_MARKER_SIZE = 0.14;

export const POSITION_NORM_TOLERANCE = 1e-5;
export const MIN_VECTOR_NORM = 1e-12;

/**
 * Leaves enough breathing room for the globe and its atmosphere at the
 * default 45 degree field of view. The previous value only barely contained
 * the surface and made a newly generated map look pre-zoomed.
 */
export const DEFAULT_CAMERA_DISTANCE = 32;
export const MIN_CAMERA_DISTANCE = 12;
export const MAX_CAMERA_DISTANCE = 60;

export const GRAPH_CHANGE_DEBOUNCE_MIN_MS = 100;
export const GRAPH_CHANGE_DEBOUNCE_MAX_MS = 10_000;
