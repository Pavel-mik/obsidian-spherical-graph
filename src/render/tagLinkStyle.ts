import { ShaderMaterial } from 'three';

/** Keep the existing satellite occlusion/protection shader with pixel ribbons. */
export function inheritTagVisibility(material: ShaderMaterial, legacy: ShaderMaterial): void {
 Object.assign(material.uniforms, legacy.uniforms);
 const main = legacy.vertexShader.indexOf('void main() {');
 const body = legacy.vertexShader.slice(main + 'void main() {'.length, legacy.vertexShader.lastIndexOf('gl_Position ='));
 material.vertexShader = legacy.vertexShader.slice(0, main) + material.vertexShader.replace('void main() {', 'void main() {' + body);
 material.fragmentShader = 'varying float vLinkVisibility; varying float vPerspectiveVisibility;\n' +
  material.fragmentShader.replace('void main() {', 'void main() { if (vLinkVisibility < 0.025) discard;')
   .replace('alpha * lineOpacity', 'alpha * lineOpacity * vLinkVisibility * vPerspectiveVisibility');
}
