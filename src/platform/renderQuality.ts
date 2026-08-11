export const RENDER_QUALITY_MODES = [
	'automatic',
	'battery-saver',
	'high-quality',
] as const;

export type RenderQualityMode = (typeof RENDER_QUALITY_MODES)[number];
