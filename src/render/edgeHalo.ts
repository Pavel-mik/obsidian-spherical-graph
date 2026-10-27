import { Color, DoubleSide, ShaderMaterial } from 'three';

/** A translucent wash fading continuously across the edge, without a hard border. */
export function createEdgeHaloMaterial(color: string): ShaderMaterial {
	return new ShaderMaterial({
		uniforms: { haloColor: { value: new Color(color).lerp(new Color('#ffffff'), 0.2) } },
		depthTest: true,
		depthWrite: false,
		side: DoubleSide,
		toneMapped: false,
		transparent: true,
		vertexShader: `
			varying float vAcross;
			void main() {
				vAcross = uv.y * 2.0 - 1.0;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			uniform vec3 haloColor;
			varying float vAcross;
			void main() {
				float fade = pow(max(0.0, 1.0 - abs(vAcross)), 2.0);
				gl_FragColor = vec4(haloColor, fade * 0.30);
				#include <colorspace_fragment>
			}
		`,
	});
}

