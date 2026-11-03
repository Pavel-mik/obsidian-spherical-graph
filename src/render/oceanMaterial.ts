import { ATLAS_LIGHT_GLSL } from './cartography';

/** Matte bathymetry in object space: broad elongated folds, not moving waves. */
export function oceanFragment(noise:string):string{
 return `
  uniform vec3 oceanColor;
  uniform float oceanDetail;
  uniform float showShallows;
  uniform vec3 oceanDeep;
  uniform vec3 oceanLight;
  uniform float oceanOpacity;
  varying vec3 sphereDirection;
  varying vec3 viewNormal;
  varying vec3 viewDirection;
  varying float coastalWater;
  ${noise}
  float bathymetry(vec3 p){
   vec3 warp=vec3(atlasNoise(p*3.5),atlasNoise(p*3.5+9.1),atlasNoise(p*3.5+17.3))-0.5;
   float fold=atlasFbm(vec3(p.x*9.0,p.y*3.2,p.z*6.0)+warp*1.8+vec3(5.3,9.1,2.8));
   return 1.0-abs(fold*2.0-1.0);
  }
  void main(){
   vec3 p=normalize(sphereDirection),n=normalize(viewNormal);
   float broad=atlasFbm(p*3.7+vec3(2.4,8.1,4.3));
   float fold=0.65,fine=0.5;
   if(oceanDetail>0.4){
    fold=bathymetry(p);fine=atlasNoise(p*64.0+vec3(1.7,9.2,2.1));
    vec3 dp1=dFdx(-viewDirection),dp2=dFdy(-viewDirection);
    vec3 r1=cross(dp2,n),r2=cross(n,dp1);
    float determinant=max(abs(dot(dp1,r1)),0.000001);
    vec3 gradient=(r1*dFdx(fold)+r2*dFdy(fold))/determinant;
    n=normalize(n-gradient*0.10*oceanDetail);
   }
   float diffuse=max(dot(n,normalize(${ATLAS_LIGHT_GLSL})),0.0);
   float facing=max(dot(normalize(viewNormal),normalize(viewDirection)),0.0);
   vec3 water=mix(oceanDeep,oceanLight,smoothstep(0.08,0.95,diffuse)*0.74);
   vec3 color=mix(oceanColor,water,0.78)*(0.76+broad*0.23+fold*0.13+(fine-0.5)*0.035);
   color*=1.0-smoothstep(0.76,0.95,fold)*0.08*oceanDetail;
   // Confine a subdued shelf to the immediate coast; avoid a cyan apron.
   float shelf=smoothstep(0.50,0.96,coastalWater)*showShallows;
   color=mix(color,oceanLight*0.72,shelf*0.18);
   color*=mix(0.65,1.0,smoothstep(0.0,0.60,facing));
   gl_FragColor=vec4(color,oceanOpacity);
   #include <colorspace_fragment>
  }
 `;
}
