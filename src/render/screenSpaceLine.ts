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
 const vertices = Math.floor(segments.length / 6) * 6;
 const positions = new Float32Array(vertices * 3), starts = new Float32Array(vertices * 3), ends = new Float32Array(vertices * 3);
 const corners = new Float32Array(vertices * 2), distances = new Float32Array(vertices), opacities = new Float32Array(vertices);
 const along = [0,0,1,0,1,1], sides = [-1,1,-1,1,1,-1];
 let distance = 0;
 for (let i = 0; i < vertices; i += 6) {
  const length = Math.hypot(segments[i+3]!-segments[i]!,segments[i+4]!-segments[i+1]!,segments[i+5]!-segments[i+2]!);
  const opacity=Math.max(0, Math.min(1,style.opacityBySegment?.[i/6] ?? 1));
  for (let j=0;j<6;j++) {
   const vertex=i+j, t=along[j]!;
   for (let axis=0;axis<3;axis++) {
    const offset=vertex*3+axis;
    starts[offset]=segments[i+axis]!; ends[offset]=segments[i+3+axis]!;
    positions[offset]=t ? ends[offset] : starts[offset];
   }
   corners[vertex*2]=t; corners[vertex*2+1]=sides[j]!;
   distances[vertex]=distance+t*length; opacities[vertex]=opacity;
  }
  distance += length;
 }
 const geometry = new BufferGeometry();
 geometry.setAttribute('position', new BufferAttribute(positions, 3));
 geometry.setAttribute('segmentStart', new BufferAttribute(starts, 3));
 geometry.setAttribute('segmentEnd', new BufferAttribute(ends, 3));
 geometry.setAttribute('corner', new BufferAttribute(corners, 2));
 geometry.setAttribute('lineDistance', new BufferAttribute(distances, 1));
 geometry.setAttribute('strokeOpacity', new BufferAttribute(opacities, 1));
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
