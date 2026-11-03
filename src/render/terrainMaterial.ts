import { ATLAS_LIGHT_GLSL, CARTOGRAPHY as T } from './cartography';

/** Fine optical mineral detail over real displaced geometry. No layout writes. */
export function sculptedLandFragment(noise: string): string {
 return `
  uniform float landOpacity;
  uniform float detailFade;
  varying vec3 landColor;
  varying vec3 landShadeColor;
  varying vec3 landLightColor;
  varying vec3 mineralA;
  varying vec3 mineralB;
  varying vec3 mineralC;
  varying vec3 landCountryTint;
  varying float landStrata;
  varying float landElevation;
  varying vec3 sphereDirection;
  varying vec3 terrainViewPosition;
  varying vec3 terrainViewNormal;
  ${noise}
  void main() {
   vec3 p = normalize(sphereDirection);
   vec3 warp = vec3(atlasNoise(p*8.0),atlasNoise(p*8.0+7.1),atlasNoise(p*8.0+19.3))-0.5;
   float patchA = atlasFbm(p*6.0+warp*1.5+vec3(3.1,8.7,2.5));
   float patchB = atlasFbm(p*11.0+warp*2.0+vec3(9.2,1.4,6.8));
   float patchC = atlasNoise(p*23.0+warp*3.0);
   vec3 color = mix(mineralB,mineralA,smoothstep(0.30,0.70,patchA));
   color = mix(color,landColor,0.48);
   color = mix(color,mineralC,smoothstep(0.45,0.72,patchB)*0.16);
   color = mix(color,mineralA,smoothstep(0.43,0.76,patchC)*0.10*detailFade);
   // Country identity changes hue, not just the brightness of one family.
   color *= mix(vec3(1.0),landCountryTint,${T.material.countryTintStrength.toFixed(2)});
   color = mix(color,landLightColor,0.04*(1.0-landElevation));
   color = mix(color,landShadeColor,0.18*smoothstep(0.25,0.90,landElevation));
   vec3 baseNormal = normalize(terrainViewNormal);
   float fine = atlasFbm(p*61.0+warp*3.0);
   vec3 dp1=dFdx(terrainViewPosition),dp2=dFdy(terrainViewPosition);
   vec3 r1=cross(dp2,baseNormal),r2=cross(baseNormal,dp1);
   float determinant=max(abs(dot(dp1,r1)),0.000001);
   vec3 gradient=(r1*dFdx(fine)+r2*dFdy(fine))/determinant;
   vec3 normal=normalize(baseNormal-gradient*${T.material.reliefFineNormalStrength.toFixed(2)}*detailFade);
   vec3 light=normalize(${ATLAS_LIGHT_GLSL});
   float diffuse=max(dot(normal,light),0.0);
   float lighting=${T.material.landAmbient.toFixed(2)}+diffuse*${T.material.landKey.toFixed(2)};
   // Narrow directional risers complement the real terraces. Derivative
   // filtering keeps subpixel strata calm instead of producing a dotted mesh.
   float bands=landStrata*${T.material.reliefBands.toFixed(1)},phase=fract(bands),aa=max(fwidth(bands)*0.5,0.004);
   float wall=smoothstep(0.38-aa,0.43+aa,phase)*(1.0-smoothstep(0.57-aa,0.62+aa,phase));
   vec3 slope=(r1*dFdx(landStrata)+r2*dFdy(landStrata))/determinant;
   vec3 lightTangent=light-baseNormal*dot(baseNormal,light);
   float face=clamp(dot(normalize(-slope+vec3(0.00001)),normalize(lightTangent+vec3(0.00001)))*0.5+0.5,0.0,1.0);
   float strataDetail=detailFade*(1.0-smoothstep(0.25,0.70,aa));
   color*=1.0-wall*${T.material.strataShadowOpacity.toFixed(2)}*(1.0-face*0.85)*strataDetail;
   // A small contact shadow at the foot is strongest on the unlit side.
   // Avoid an equally dark ink line around every plateau.
   float foot=1.0-smoothstep(aa+0.015,aa+0.075,abs(phase-0.38));
   color*=1.0-foot*0.17*(1.0-face)*strataDetail;
   float lip=1.0-smoothstep(aa,aa*2.0,abs(phase-0.62));
   color=mix(color,landLightColor,lip*${T.material.strataLipOpacity.toFixed(2)}*face*face*strataDetail);
   // Material grain is stationary in object space and fades at overview scale.
   float grain=atlasNoise(p*317.0)-0.5;
   float chips=atlasNoise(p*137.0+warp*4.0);
   float cavity=1.0-smoothstep(0.52,0.79,1.0-fine)*0.20*detailFade;
   color*=lighting*cavity*(1.0+(fine-0.5)*0.15*detailFade+(chips-0.5)*0.045*detailFade+grain*${T.material.grainOpacity.toFixed(3)}*detailFade);
   float facing=max(dot(normalize(terrainViewNormal),normalize(-terrainViewPosition)),0.0);
   color*=mix(0.82,1.0,smoothstep(0.0,0.35,facing));
   gl_FragColor=vec4(color,landOpacity);
   #include <colorspace_fragment>
  }
 `;
}
