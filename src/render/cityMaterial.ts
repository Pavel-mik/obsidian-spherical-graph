import { DoubleSide, ShaderMaterial, Vector2 } from 'three';

export function cityMaterial(mode: 'core' | 'halo' | 'ring', fadeAtLimb = false, scaleWithView = false): ShaderMaterial {
 const effect = mode === 'halo'
  ? 'alpha = pow(1.0 - smoothstep(0.0, 1.0, radius), 2.0) * style.y;'
  : mode === 'ring'
   ? 'float inner = 1.0 - style.y / max(style.x, 0.001); alpha *= smoothstep(inner - aa, inner + aa, radius) * (1.0 - style.w * 0.60);'
   : `float keyline = smoothstep(0.91, 1.0, radius);
      vec3 beadNormal = normalize(vec3(cityUv, sqrt(max(0.0, 1.0 - radius * radius))));
      float beadLight = max(dot(beadNormal, normalize(vec3(-0.4,0.6,0.9))), 0.0);
      color = cityColor * (0.76 + beadLight * 0.40);
      float hotspot = (1.0 - smoothstep(0.0, 0.55, radius)) * style.w;
      color = mix(color, vec3(1.0,0.92,0.74), hotspot * 0.18);
      color = mix(color, vec3(0.019, 0.050, 0.046), keyline * mix(0.42,0.18,style.w));
      if (style.z > 0.5 && style.z < 1.5) {
       radius = max(abs(cityUv.x), abs(cityUv.y));
       alpha = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, radius);
      }
      if (style.z > 1.5) alpha *= smoothstep(0.52, 0.62, length(cityUv));
      float limbContrast = 1.0;
      color *= limbContrast;
      alpha *= style.y;`;
 return new ShaderMaterial({
  defines: { ...(fadeAtLimb && { CITY_LIMB: 1 }), ...(scaleWithView && { CITY_SCALE: 1 }) },
  // A billboard is one flat surface. One transparent pass covers either face.
  forceSinglePass: true, transparent: true, depthTest: true, depthWrite: false, side: DoubleSide, toneMapped: false,
  uniforms: { markerScale: { value: 1 }, viewport: { value: new Vector2(1, 1) }, transition: { value: 1 } },
  vertexShader: `
   #ifdef CITY_LIMB
   attribute float limbFade;
   #endif
   #ifdef CITY_SCALE
   attribute vec3 radiusRule; uniform float markerScale;
   #endif
   attribute vec4 cityStyle;
   attribute vec4 previousStyle;
   varying vec2 cityUv;
   varying vec3 cityColor;
   varying vec4 style;
   uniform vec2 viewport;
   uniform float transition;
   void main() {
    vec4 center = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    style = mix(previousStyle, cityStyle, transition);
    #ifdef CITY_LIMB
    vec3 world=(modelMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0)).xyz;
    float facing=dot(normalize(world),normalize(cameraPosition))-length(world)/max(0.001,length(cameraPosition))-0.015;
    style.y*=mix(1.0,0.55+0.45*smoothstep(0.0,0.25,facing),limbFade);
    #endif
    #ifdef CITY_SCALE
    float radiusAtZoom=max(radiusRule.x,radiusRule.y*markerScale)+radiusRule.z;
    if(cityStyle.x>0.0) style.x*=radiusAtZoom/cityStyle.x;
    #endif
    if (style.x <= 0.0) { gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
    float paddedRadius = style.x + 1.0;
    center.xy += position.xy * paddedRadius * 2.0 / viewport * center.w;
    gl_Position = center;
    cityUv = position.xy * paddedRadius / max(style.x, 0.001);
    cityColor = instanceColor;
   }
  `,
  fragmentShader: `
   varying vec2 cityUv;
   varying vec3 cityColor;
   varying vec4 style;
   void main() {
    if (style.x <= 0.0) discard;
    float radius = length(cityUv);
    float aa = max(fwidth(radius) * 0.5, 0.001);
    float alpha = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, radius);
    vec3 color = cityColor;
    ${effect}
    if (alpha < 0.001) discard;
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
   }
  `,
 });
}
