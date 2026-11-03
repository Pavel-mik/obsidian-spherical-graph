import { Color, Group, Mesh, PerspectiveCamera, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';
import { SPHERE_RADIUS } from '../constants';
import { CARTOGRAPHY as T } from './cartography';

/** Static screen-space atmosphere behind opaque terrain, separate from clouds. */
export class HorizonGlow {
 private readonly geometry=new PlaneGeometry(2,2);
 private readonly viewport=new Vector2();
 private readonly screenCentre=new Vector2();
 private readonly material=new ShaderMaterial({
  transparent:true,depthTest:true,depthWrite:false,toneMapped:false,
  uniforms:{viewport:{value:this.viewport},centre:{value:this.screenCentre},radius:{value:1},
   width:{value:T.material.atmosphereSoftWidthPx},opacity:{value:T.material.atmospherePeakOpacity},
   tint:{value:new Color(T.colors.globe.rim)}},
  vertexShader:'varying vec2 uvScreen;void main(){uvScreen=position.xy*0.5+0.5;gl_Position=vec4(position.xy,0.999998,1.0);}',
  fragmentShader:`uniform vec2 viewport;uniform vec2 centre;uniform float radius;uniform float width;uniform float opacity;uniform vec3 tint;varying vec2 uvScreen;
   void main(){vec2 p=uvScreen*viewport-centre;float edge=length(p)-radius;
    if(edge< -1.0||edge>width*2.5)discard;
    float side=0.42+0.58*max(dot(normalize(p),normalize(vec2(-0.60,0.76))),0.0);
    float a=exp(-max(edge,0.0)*max(edge,0.0)/(width*width*0.6))*opacity*side;
    gl_FragColor=vec4(tint,a);
    #include <colorspace_fragment>
   }`,
 });
 private readonly mesh=new Mesh(this.geometry,this.material);
 private readonly centre=new Vector3();
 constructor(private readonly group:Group){this.mesh.name='spherical-graph-horizon-glow';this.mesh.renderOrder=3;this.mesh.frustumCulled=false;group.add(this.mesh);}
 render(camera:PerspectiveCamera,width:number,height:number,visible:boolean,phone=false):void{
  this.mesh.visible=visible;if(!visible)return;
  this.centre.set(0,0,0).project(camera);
  this.viewport.set(width,height);
  this.screenCentre.set((this.centre.x*.5+.5)*width,(this.centre.y*.5+.5)*height);
  this.material.uniforms.radius!.value=SPHERE_RADIUS*camera.projectionMatrix.elements[5]*height*.5/Math.sqrt(Math.max(1,camera.position.lengthSq()-SPHERE_RADIUS*SPHERE_RADIUS));
  this.material.uniforms.width!.value=phone?4:T.material.atmosphereSoftWidthPx;
 }
 dispose():void{this.group.remove(this.mesh);this.geometry.dispose();this.material.dispose();}
}
