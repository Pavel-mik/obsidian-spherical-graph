import tokens from '../../docs/design/2026-11-01-concepts/ziva-kartografie.tokens.json';
import { PerspectiveCamera, Vector2 } from 'three';

/** The approved specification is bundled locally; no runtime file/network access. */
export const CARTOGRAPHY = tokens;
/** One camera-space key for all physical cartographic materials. */
export const ATLAS_LIGHT_GLSL = `vec3(${tokens.material.cameraLightDirection.map(v => v.toFixed(2)).join(',')})`;

export type CityState = keyof typeof tokens.node.states;

export function cityState(flags: {
 selected: boolean; routeStart: boolean; routeEnd: boolean; route: boolean;
 search: boolean; active: boolean; neighbor: boolean; directoryPeer: boolean;
}): CityState {
 if (flags.selected) return 'selected';
 if (flags.routeStart || flags.routeEnd) return 'routeEndpoint';
 if (flags.route) return 'route';
 if (flags.search) return 'search';
 if (flags.active) return 'active';
 if (flags.neighbor) return 'neighbor';
 if (flags.directoryPeer) return 'directoryPeer';
 return 'normal';
}

/** CSS pixels per scene unit at the view centre; never uses drawing-buffer DPR. */
export function pixelsPerWorldUnit(camera: PerspectiveCamera, height: number): number {
 return height / (2 * Math.tan(camera.fov * Math.PI / 360) * camera.position.length());
}

export function updateLineViewport(
 material: { uniforms: Record<string, { value: unknown }> },
 width: number, height: number,
): void {
 const viewport = material.uniforms.viewport?.value;
 if (viewport instanceof Vector2) viewport.set(Math.max(1, width), Math.max(1, height));
}
