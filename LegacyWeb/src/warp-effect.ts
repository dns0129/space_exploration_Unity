import * as THREE from "three";

/** Camera-independent, additive optical streaks; navigation still uses the real world. */
export function createWarpEffect() {
  const material = new THREE.ShaderMaterial({
    uniforms: { strength: { value: 0 }, time: { value: 0 }, aspect: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }`,
    fragmentShader: `
      uniform float strength, time, aspect;
      varying vec2 vUv;
      float hash(float x){ return fract(sin(x*127.1)*43758.5453); }
      void main(){
        vec2 p=(vUv-0.5)*vec2(aspect,1.0);
        float r=length(p), angle=atan(p.y,p.x);
        float lane=floor((angle+3.14159)*130.0);
        float thin=pow(max(0.0,1.0-abs(fract((angle+3.14159)*130.0)-0.5)*2.0),12.0);
        float flow=fract(log(max(r,0.008))*0.62-time*(0.3+hash(lane)*0.7)*2.0+hash(lane+3.0));
        float streak=thin*smoothstep(0.2,0.55,flow)*(1.0-smoothstep(0.85,1.0,flow));
        float aperture=smoothstep(0.03,0.18,r);
        float halo=pow(max(0.0,1.0-abs(r-0.43)*2.0),5.0)*0.13;
        vec3 color=mix(vec3(0.1,0.35,0.62),vec3(0.65,0.9,1.0),hash(lane));
        gl_FragColor=vec4(color,(streak*0.65+halo)*aperture*strength);
      }`,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  mesh.visible = false;
  return { mesh, material };
}
