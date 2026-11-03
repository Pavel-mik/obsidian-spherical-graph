import {
 BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial, Vector2,
} from 'three';
import { ATLAS_LIGHT_GLSL } from './cartography';

export interface ScreenLineStyle {
 color: string; widthPx: number; opacity: number; halo?: boolean; dash?: readonly number[];
 opacityBySegment?: readonly number[]; surfaceInk?: boolean;
}

/** Batched ribbons expanded in clip space: width is in CSS px at every depth. */
export function screenSpaceLine(segments: Float32Array | readonly number[], style: ScreenLineStyle): Mesh<BufferGeometry, ShaderMaterial> {
 const positions: number[] = [], starts: number[] = [], ends: number[] = [], corners: number[] = [], distances: number[] = [], opacities: number[] = [];
 let distance = 0;
 for (let i = 0; i + 5 < segments.length; i += 6) {
  const a = Array.from(segments.slice(i, i + 3)), b = Array.from(segments.slice(i + 3, i + 6));
  const length = Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0), (b[2] ?? 0) - (a[2] ?? 0));
  for (const [along, side] of [[0,-1],[0,1],[1,-1],[0,1],[1,1],[1,-1]]) {
   positions.push(...(along === 0 ? a : b)); starts.push(...a); ends.push(...b);
   corners.push(along ?? 0, side ?? 0); distances.push(distance + (along ?? 0) * length);
   opacities.push(Math.max(0,Math.min(1,style.opacityBySegment?.[i/6]??1)));
  }
  distance += length;
 }
 const geometry = new BufferGeometry();
 geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
 geometry.setAttribute('segmentStart', new BufferAttribute(new Float32Array(starts), 3));
 geometry.setAttribute('segmentEnd', new BufferAttribute(new Float32Array(ends), 3));
 geometry.setAttribute('corner', new BufferAttribute(new Float32Array(corners), 2));
 geometry.setAttribute('lineDistance', new BufferAttribute(new Float32Array(distances), 1));
 geometry.setAttribute('strokeOpacity', new BufferAttribute(new Float32Array(opacities), 1));
 geometry.computeBoundingSphere();
 const material = new ShaderMaterial({
  depthTest: true, depthWrite: false, transparent: true, toneMapped: false, side: DoubleSide,
  uniforms: {
   lineColor: { value: new Color(style.color) }, lineWidth: { value: style.widthPx },
   lineOpacity: { value: style.opacity }, viewport: { value: new Vector2(1, 1) },
   halo: { value: style.halo ? 1 : 0 },
   surfaceInk: { value: style.surfaceInk ? 1 : 0 },
   dash: { value: new Vector2(style.dash?.[0] ?? 0, style.dash?.[1] ?? 0) },
  },
  vertexShader: `
   attribute vec3 segmentStart;
   attribute vec3 segmentEnd;
   attribute vec2 corner;
   attribute float lineDistance;
   attribute float strokeOpacity;
   uniform vec2 viewport;
   uniform float lineWidth;
   uniform float surfaceInk;
   varying float across;
   varying float distanceAlong;
   varying float opacityScale;
   varying float inkLighting;
   void main() {
    vec4 a = projectionMatrix * modelViewMatrix * vec4(segmentStart, 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(segmentEnd, 1.0);
    vec2 delta = (b.xy / b.w - a.xy / a.w) * viewport;
    vec2 direction = delta / max(length(delta), 0.00001);
    vec2 normal = vec2(-direction.y, direction.x);
    vec4 clip = mix(a, b, corner.x);
    // Leave a full pixel outside the nominal stroke for coverage filtering.
    // Shrinking the filter inside a subpixel ribbon erases most of its ink.
    clip.xy += normal * corner.y * (lineWidth + 2.0) / viewport * clip.w;
    gl_Position = clip;
    across = corner.y * (lineWidth * 0.5 + 1.0);
    distanceAlong = lineDistance;
    opacityScale = strokeOpacity;
    inkLighting = 1.0;
    if(surfaceInk > 0.5) {
     vec3 surfaceNormal = normalize(normalMatrix * normalize(mix(segmentStart, segmentEnd, corner.x)));
     inkLighting = 0.45 + 0.55 * max(dot(surfaceNormal, normalize(${ATLAS_LIGHT_GLSL})), 0.0);
    }
   }
  `,
  fragmentShader: `
   uniform vec3 lineColor;
   uniform float lineOpacity;
   uniform float lineWidth;
   uniform float halo;
   uniform vec2 dash;
   varying float across;
   varying float distanceAlong;
   varying float opacityScale;
   varying float inkLighting;
   void main() {
    float halfWidth = lineWidth * 0.5;
    float pixelSpan = max(fwidth(across), 0.001);
    float alpha = clamp((min(halfWidth, across + pixelSpan * 0.5) -
      max(-halfWidth, across - pixelSpan * 0.5)) / pixelSpan, 0.0, 1.0);
    if (halo > 0.5) alpha = pow(max(0.0, 1.0 - abs(across) / max(halfWidth, 0.001)), 2.0);
    if (dash.x > 0.0) {
     float pxDistance = distanceAlong / max(fwidth(distanceAlong), 0.00001);
     alpha *= 1.0 - step(dash.x, mod(pxDistance, dash.x + dash.y));
    }
    gl_FragColor = vec4(lineColor * inkLighting, alpha * lineOpacity * opacityScale);
    #include <colorspace_fragment>
   }
  `,
 });
 const mesh = new Mesh(geometry, material);
 // Shader expansion is intentionally outside the world-space bounding volume.
 mesh.frustumCulled = false;
 return mesh;
}
